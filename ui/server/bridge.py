"""The live path: a person at a seat, talking to a running engine.

Everything else in the console reads a finished log off disk. This runs a real
episode in a worker thread, streams its event-log lines to the browser, routes
release requests to the operator, and answers `fork` by actually replaying the
episode forward from a snapshot rather than estimating.

    python ui/server/bridge.py                       # nsc, seed 1, G5, 72h
    python ui/server/bridge.py --seat norway --seed 7 --storm G4
    python ui/server/bridge.py --port 8778

Wire format: ui/server/PROTOCOL.md. Loopback only, no authentication, on purpose.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import sys
import threading
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from engine.config import EnvConfig  # noqa: E402
from engine.episode import Episode  # noqa: E402
from engine.human_agent import ExternalDecisionChannel, HumanAgent  # noqa: E402
from engine.stubs import build_stubs  # noqa: E402
from train.fireworks import BASE_MODELS, Client, FireworksError  # noqa: E402
from ui.server.wsproto import WebSocket, WebSocketClosed, serve  # noqa: E402

IRREVERSIBLE = ("counter_rpo", "kinetic", "terrestrial_response")


def _ladder_rungs() -> dict[str, int]:
    """Rung index per action type, from the frozen contract rather than a copy.

    contracts/action_schema.json says the ordering is meaningful, so "escalated"
    can mean something precise: the adversary went above the rung the operator
    was being asked about.
    """
    schema = json.loads((REPO / "contracts" / "action_schema.json").read_text(encoding="utf-8"))
    return {entry["type"]: int(entry["rung"]) for entry in schema["x-action-ladder"]}


RUNGS = _ladder_rungs()

# Who counts as the adversary, from the operator's chair. contracts/seats.md:
# blue + ally on one side, red on the other; china and the commercial seats take
# no physical action and so can never produce an irreversible response.
RED = ("northern_fleet", "kremlin")
BLUE = ("northcom", "usspacecom", "nsc", "norway")


def adversaries_of(seat: str) -> tuple[str, ...]:
    return BLUE if seat in RED else RED


# ── building an episode ──────────────────────────────────────────────────


def build_config(
    seed: int, hours: float, storm: str, seat: str, scenario: str, clock: str
) -> EnvConfig:
    raw: dict[str, Any] = {
        "env_version": "env_v1",
        "seed": seed,
        "duration_s": int(round(hours * 3600)),
        "scenario_id": scenario,
        "storm": {"severity": storm, "profile": "may2024", "onset_sim_time_s": 0},
        # Checkpoint/adaptive is the demo clock: contracts/seats.md calls it out
        # as the mode that makes a human pause explicit rather than a race.
        "clock_mode": (
            {"mode": "continuous", "tick_s": 60}
            if clock == "continuous"
            else {
                "mode": "checkpoint",
                "schedule_type": "adaptive",
                "interval_s": 10800,
                "adaptive_triggers": ["inject", "non_hold_action", "release_pending"],
                "min_interval_s": 1800,
                "max_interval_s": 21600,
                "seal_decisions": True,
            }
        ),
        "release_policy": {
            "policy": "human",
            "pause_clock": True,
            "on_timeout": "deny",
            "route_to_seat": seat,
        },
    }
    return EnvConfig.from_dict(raw)


def make_episode(
    config: EnvConfig,
    seat: str,
    channel: ExternalDecisionChannel,
    served: dict[str, Any] | None = None,
) -> Episode:
    """`served` = {"adapter", "deployment", "client"}: every seat the human is not sitting
    at is played by that adapter on that deployment. Without it, the stubs play as before.
    ServedAgent never raises — a network failure or a malformed completion becomes a
    logged hold whose reasoning says why, which is what the console shows."""

    def factory(episode: Episode) -> dict[str, Any]:
        agents = build_stubs(episode.specs, episode.rng, policy="aggressive")
        if served:
            from train.serve import ServedAgent  # lazy: pulls in the training stack

            for other in list(agents):
                if other != seat:
                    agents[other] = ServedAgent(
                        other,
                        served["adapter"],
                        deployment=served["deployment"],
                        client=served["client"],
                        spec=episode.specs[other],
                    )
        if seat in agents:
            agents[seat] = HumanAgent(
                seat,
                episode.specs[seat],
                channel,
                timeout_s=None,  # a demo should wait for the person, not guess
                on_timeout="deny",
                fallback=agents[seat],
            )
        return agents

    descriptor: dict[str, Any] = {"kind": "human", "policy": "aggressive", "human_seat": seat}
    if served:
        descriptor["adapter"] = served["adapter"]
        descriptor["deployment"] = served["deployment"]
    return Episode(config, agent_factory=factory, validate_lines=True, agents_descriptor=descriptor)


# ── fork ─────────────────────────────────────────────────────────────────


class _ForcedRelease:
    """Wraps a stub so one specific release gets a chosen answer.

    Everything after that release is decided by the stub as usual, which is the
    point: the fork isolates the operator's single choice and lets the rest of
    the episode play out on its own terms.
    """

    def __init__(self, inner: Any, release_id: str, granted: bool) -> None:
        self.inner = inner
        self.release_id = release_id
        self.granted = granted
        self.used = False

    def __getattr__(self, name: str) -> Any:
        return getattr(self.inner, name)

    def decide_release(self, request: Any, view: Any) -> tuple[bool, str]:
        if not self.used and str(request.get("release_id")) == self.release_id:
            self.used = True
            verdict = "granted" if self.granted else "denied"
            return self.granted, f"Fork: operator {verdict} this release."
        return self.inner.decide_release(request, view)


def _run_one_continuation(job: dict[str, Any]) -> dict[str, Any]:
    """One forked continuation. Runs in a worker process."""
    from engine.config import EnvConfig as _EnvConfig
    from engine.episode import Episode as _Episode
    from engine.stubs import build_stubs as _build_stubs

    config = _EnvConfig.from_dict(job["config"])
    snap = job["snapshot"]
    seat = job["releasing_seat"]

    def factory(ep: _Episode) -> dict[str, Any]:
        agents = _build_stubs(ep.specs, ep.rng, policy="aggressive")
        if seat in agents:
            agents[seat] = _ForcedRelease(agents[seat], job["release_id"], job["granted"])
        return agents

    ep = _Episode(config, agent_factory=factory, validate_lines=False)
    ep.restore(snap["episode"])
    ep.loop.restore(snap["loop"])

    # Re-seed rather than restoring the RNG: 50 continuations sharing a random
    # state are 50 copies of one continuation. It has to be done IN PLACE --
    # build_stubs() captured this exact RngBook when the Episode was constructed,
    # and so did the EventLoop, so rebinding ep.rng would leave both of them on
    # the original stream and every continuation identical. restore() with an
    # empty `streams` resets the master seed and lets the per-stream generators
    # be re-derived lazily. The index is folded into the seed, so the same fork
    # request returns the same numbers twice.
    ep.rng.restore(
        {
            "master_seed": config.seed * 100003 + job["index"] * 2 + (1 if job["granted"] else 0),
            "streams": {},
        }
    )

    horizon = job["t0"] + job["horizon_s"]
    ep.loop.resume(int(min(horizon, config.duration_s)))
    try:
        ep.loop.run(int(min(horizon, config.duration_s)))
    except Exception as exc:  # a crashed continuation is not a safe continuation
        return {"error": f"{type(exc).__name__}: {exc}", "index": job["index"]}

    new_lines = ep.log.lines[job["baseline_lines"] :]
    adversaries = set(job["adversaries"])
    rungs = job["rungs"]

    highest = -1
    irreversible = False
    for line in new_lines:
        if line.get("type") not in ("action", "human_action"):
            continue
        if line.get("seat") not in adversaries:
            continue
        payload = line.get("payload") or {}
        if payload.get("blocked"):
            continue
        action_type = (payload.get("action") or {}).get("type")
        if action_type is None:
            continue
        highest = max(highest, rungs.get(action_type, 0))
        if action_type in IRREVERSIBLE:
            irreversible = True

    return {
        "index": job["index"],
        "irreversible": irreversible,
        # "Escalated" has to mean something sharper than "did anything at all",
        # or every continuation qualifies and the panel discriminates nothing.
        # It means the adversary went above the rung under discussion.
        "escalated": highest > job["requested_rung"],
        "max_rung": highest,
    }


def run_fork(
    episode: Episode,
    release_id: str,
    releasing_seat: str,
    options: list[str],
    n: int,
    horizon_s: float,
    requested_action: str | None = None,
    workers: int | None = None,
) -> dict[str, Any]:
    """fork(snapshot, n) per option. Real continuations, measured, not modelled."""
    snapshot = {
        "episode": episode.snapshot(),
        "loop": episode.loop.snapshot(),
    }
    t0 = episode.loop.sim_time_s
    baseline = len(episode.log.lines)
    adversaries = adversaries_of(releasing_seat)
    config = episode.config.to_dict()
    requested_rung = RUNGS.get(requested_action or "", 0)

    jobs = [
        {
            "config": config,
            "snapshot": snapshot,
            "release_id": release_id,
            "releasing_seat": releasing_seat,
            "granted": option == "grant",
            "index": i,
            "t0": t0,
            "horizon_s": horizon_s,
            "baseline_lines": baseline,
            "adversaries": adversaries,
            "rungs": RUNGS,
            "requested_rung": requested_rung,
        }
        for option in options
        for i in range(n)
    ]

    results: dict[str, dict[str, Any]] = {
        o: {"n": n, "irreversible": 0, "escalated": 0, "completed": 0, "errors": 0, "_rungs": []}
        for o in options
    }
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for job, out in zip(jobs, pool.map(_run_one_continuation, jobs), strict=True):
            bucket = results["grant" if job["granted"] else "deny"]
            if out.get("error"):
                bucket["errors"] += 1
                continue
            bucket["completed"] += 1
            bucket["irreversible"] += int(out["irreversible"])
            bucket["escalated"] += int(out["escalated"] and not out["irreversible"])
            bucket["_rungs"].append(out["max_rung"])

    for bucket in results.values():
        seen = bucket.pop("_rungs")
        # The highest rung the adversary reached, averaged and at the tail. With
        # scripted stubs the irreversible share is usually a flat zero -- which
        # is the correct answer and a useless one to look at -- so the panel also
        # gets a number that moves.
        bucket["mean_max_rung"] = round(sum(seen) / len(seen), 2) if seen else None
        bucket["worst_rung"] = max(seen) if seen else None
    return results


# ── the session ──────────────────────────────────────────────────────────


class Session:
    """One episode, one operator seat, however many watching browsers."""

    def __init__(self, config: EnvConfig, seat: str, served: dict[str, Any] | None = None) -> None:
        self.config = config
        self.seat = seat
        self.channel = ExternalDecisionChannel()
        self.episode = make_episode(config, seat, self.channel, served)
        self.clients: set[WebSocket] = set()
        self.loop: asyncio.AbstractEventLoop | None = None
        self._sent = 0
        self._thread: threading.Thread | None = None
        self.channel.on_prompt(self._on_prompt)

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="episode", daemon=True)
        self._thread.start()

    def _run(self) -> None:
        try:
            self.episode.run()
        except Exception as exc:  # noqa: BLE001 - report, do not take the server down
            self._broadcast({"ev": "error", "message": f"episode failed: {exc}"})
        else:
            self._broadcast(
                {"ev": "clock", "paused": True, "sim_time_s": self.episode.loop.sim_time_s}
            )

    def _on_prompt(self, kind: str, context: Any) -> None:
        # Called on the engine thread while it blocks. Hand it to the asyncio
        # loop rather than touching a socket from here.
        payload = {"ev": "prompt", "kind": kind, "context": _jsonable(context)}
        if kind == "release":
            request = (context or {}).get("request") or {}
            payload["release_id"] = request.get("release_id")
        self._broadcast(payload)
        self._broadcast({"ev": "clock", "paused": True, "sim_time_s": self.episode.loop.sim_time_s})

    def _broadcast(self, msg: dict[str, Any]) -> None:
        if self.loop is None:
            return
        asyncio.run_coroutine_threadsafe(self._send_all(msg), self.loop)

    async def _send_all(self, msg: dict[str, Any]) -> None:
        for ws in list(self.clients):
            try:
                await ws.send_json(msg)
            except WebSocketClosed:
                self.clients.discard(ws)

    async def pump_lines(self) -> None:
        """Stream new log lines. Polling beats patching a callback into the
        engine's EventLog, and 100 ms is well inside a demo's tolerance."""
        while True:
            await asyncio.sleep(0.1)
            lines = self.episode.log.lines
            while self._sent < len(lines):
                line = lines[self._sent]
                self._sent += 1
                await self._send_all({"ev": "event", "line": _jsonable(line)})


def _jsonable(obj: Any) -> Any:
    """The engine hands out dataclasses and tuples here and there."""
    try:
        json.dumps(obj)
        return obj
    except TypeError:
        if isinstance(obj, dict):
            return {str(k): _jsonable(v) for k, v in obj.items()}
        if isinstance(obj, (list, tuple, set)):
            return [_jsonable(v) for v in obj]
        return str(obj)


# ── server ───────────────────────────────────────────────────────────────


async def main_async(args: argparse.Namespace, served: dict[str, Any] | None = None) -> None:
    config = build_config(args.seed, args.hours, args.storm, args.seat, args.scenario, args.clock)
    session = Session(config, args.seat, served)
    session.loop = asyncio.get_running_loop()

    async def handler(ws: WebSocket) -> None:
        session.clients.add(ws)
        await ws.send_json(
            {
                "ev": "hello",
                "episode_id": session.episode.episode_id,
                "seat": session.seat,
                "clock_mode": config.clock_mode.get("mode"),
                "release_policy": config.release_policy.get("policy"),
                "duration_s": config.duration_s,
            }
        )
        # A browser that connects late still needs the episode so far.
        for line in session.episode.log.lines:
            await ws.send_json({"ev": "event", "line": _jsonable(line)})
        pending = session.channel.pending_prompt()
        if pending:
            await ws.send_json({"ev": "prompt", **_jsonable(pending)})

        try:
            while True:
                raw = await ws.recv()
                if raw is None:
                    break
                await handle_message(session, ws, raw)
        finally:
            session.clients.discard(ws)

    server = await serve(handler, args.host, args.port)
    session.start()
    pump = asyncio.create_task(session.pump_lines())

    addr = ", ".join(str(s.getsockname()) for s in server.sockets or [])
    print(f"human seat: {args.seat}")
    print(f"episode   : {session.episode.episode_id}")
    print(f"listening : ws://{addr}")
    print("open the console (python ui/serve.py) and press Connect engine")
    try:
        async with server:
            await server.serve_forever()
    finally:
        pump.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await pump


async def handle_message(session: Session, ws: WebSocket, raw: str) -> None:
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError:
        await ws.send_json({"ev": "error", "message": "not JSON"})
        return

    op = msg.get("op")
    if op in ("hello", "subscribe"):
        return

    if op == "answer_release":
        decision = str(msg.get("decision", "deny"))
        rationale = str(msg.get("rationale") or "")
        if decision == "hold":
            # The log has two answers, not three. Hold is a denial that says so.
            hold = float(msg.get("hold_minutes") or 120)
            rationale = f"Held for {hold:.0f} sim minutes by the operator. {rationale}".strip()
        session.channel.submit_release(
            str(msg.get("release_id")), granted=decision == "grant", rationale=rationale
        )
        await session._send_all(
            {"ev": "clock", "paused": False, "sim_time_s": session.episode.loop.sim_time_s}
        )
        return

    if op == "submit_action":
        decision = {
            "action": msg.get("action") or {"type": "hold", "params": {}},
            "beliefs": msg.get("beliefs"),
            "messages": msg.get("messages") or [],
            "reasoning": msg.get("reasoning") or "",
        }
        session.channel.submit_decision({k: v for k, v in decision.items() if v is not None})
        return

    if op == "fork":
        release_id = str(msg.get("release_id"))
        options = list(msg.get("options") or ["grant", "deny"])
        n = max(1, min(200, int(msg.get("n") or 50)))
        horizon_s = float(msg.get("horizon_hours") or 12) * 3600
        try:
            results = await asyncio.get_running_loop().run_in_executor(
                None,
                run_fork,
                session.episode,
                release_id,
                session.seat,
                options,
                n,
                horizon_s,
                _release_action_type(session.episode, release_id),
            )
        except Exception as exc:  # noqa: BLE001
            await ws.send_json({"ev": "error", "message": f"fork failed: {exc}"})
            return
        await ws.send_json(
            {
                "ev": "fork_result",
                "release_id": release_id,
                "horizon_hours": horizon_s / 3600,
                "options": results,
            }
        )
        return

    await ws.send_json({"ev": "error", "message": f"unknown op {op!r}"})


def _release_action_type(episode: Episode, release_id: str) -> str | None:
    for request in episode.releases:
        if str(request.get("release_id")) == release_id:
            return str((request.get("action") or {}).get("type") or "") or None
    return None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--seat", default="nsc", help="which seat the operator occupies")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--hours", type=float, default=72.0)
    ap.add_argument("--storm", default="G5")
    ap.add_argument("--scenario", default="g5_ambiguous_signature")
    ap.add_argument("--clock", default="checkpoint", choices=["continuous", "checkpoint"])
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8778)
    ap.add_argument(
        "--adapter",
        default=None,
        help="Fireworks adapter model id; every non-human seat plays it",
    )
    ap.add_argument("--deployment", default="demo-tracka", help="deployment id to create or reuse")
    ap.add_argument("--base", default=BASE_MODELS["llama31_8b"]["id"])
    ap.add_argument(
        "--reuse-deployment",
        action="store_true",
        help="the deployment is already up; do not create it",
    )
    ap.add_argument(
        "--keep-deployment",
        action="store_true",
        help="leave the deployment up on exit (it bills per GPU-hour)",
    )
    args = ap.parse_args(argv)

    served = _bring_up(args) if args.adapter else None
    try:
        asyncio.run(main_async(args, served))
    except KeyboardInterrupt:
        print()
    finally:
        if served and not args.keep_deployment:
            _tear_down(served)
    return 0


def _bring_up(args: argparse.Namespace) -> dict[str, Any]:
    """Create the deployment (or reuse it), wait for READY, load the adapter. Blocks for
    minutes; that is the cost of an on-demand GPU and there is no hiding it."""
    client = Client.from_env()
    dep = args.deployment
    if not args.reuse_deployment:
        try:
            client.create_deployment(deployment_id=dep, base_model=args.base)
            print(f"deployment: creating {dep} on {args.base}", flush=True)
        except FireworksError as exc:
            print(f"deployment: create failed ({exc}); assuming it exists", flush=True)
    client.wait(
        lambda: client.get_deployment(dep),
        done=("READY",),
        failed=("FAILED", "DELETING", "UNSPECIFIED"),
        interval=15,
        timeout=1800,
    )
    print(f"deployment: {dep} READY", flush=True)
    try:
        client.load_lora_and_wait(dep, args.adapter)
        print(f"adapter   : {args.adapter} loaded", flush=True)
    except FireworksError as exc:
        print(f"adapter   : load reported {exc}; continuing (it may already be loaded)", flush=True)
    return {"adapter": args.adapter, "deployment": dep, "client": client}


def _tear_down(served: dict[str, Any]) -> None:
    """Loud on purpose: an un-torn-down deployment bills by the hour."""
    dep = served["deployment"]
    try:
        gone = served["client"].ensure_deployment_gone(dep)
        state = "deleted" if gone.get("deleted") else "NOT DELETED - check the Fireworks console"
        print(f"deployment: {dep} {state}", flush=True)
    except Exception as exc:  # noqa: BLE001 - never mask a failed teardown behind a prettier error
        print(f"deployment: TEARDOWN FAILED for {dep}: {exc} - delete it by hand", flush=True)


if __name__ == "__main__":
    raise SystemExit(main())
