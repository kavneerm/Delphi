"""Live wire protocol for a human at a seat.

`contracts/` fixes the event log and the decision schema but not the live
protocol, so this defines one. It is deliberately small, and it is a proposal
rather than a contract: agent7-ui is the consumer, and if `ui/server/PROTOCOL.md`
says something different, this conforms to that instead.

    python -m engine.bridge --seed 1 --storm G5 --hours 72 --port 8765

Then connect a WebSocket to `ws://127.0.0.1:8765`. Falls back to a plain TCP
newline-delimited JSON socket if the `websockets` package is not installed, so
the protocol is testable with `nc`.

## The one rule that matters

**Everything sent to a seat comes from that seat's filtered view.** The bridge
never sends the event log, because the log is the god's-eye record — it carries
every seat's actions, beliefs and the storm's true state. Rendering a live
episode from the log would show the person at NSC what Red believes. The bridge
sends `engine/seats.py` output and nothing else, which is filtered by
construction.

## Messages

Server → client:

    {"type": "hello",     "seat": "nsc", "episode_id": "...", "env_version": "env_v1",
                          "clock_mode": "checkpoint", "release_policy": "human",
                          "duration_s": 259200, "menu": [...], "ladder": [...]}
    {"type": "view",      "sim_time_s": 10800, "view": {...}}      # the filtered view
    {"type": "prompt",    "kind": "decision", "sim_time_s": 10800, "view": {...}}
    {"type": "prompt",    "kind": "release",  "sim_time_s": 10800,
                          "request": {"release_id": "...", "action": {...},
                                      "requesting_seat": "usspacecom"}, "view": {...}}
    {"type": "event",     "event": {...}}      # one event-log line, AFTER it is public
    {"type": "paused",    "sim_time_s": 10800, "reason": "awaiting_operator"}
    {"type": "resumed",   "sim_time_s": 10800}
    {"type": "ended",     "sim_time_s": 259200, "summary": {...}}
    {"type": "error",     "message": "..."}

Client → server:

    {"type": "decision", "decision": {...}}                  # action_schema decision
    {"type": "release",  "release_id": "...", "granted": true, "rationale": "..."}
    {"type": "observe"}                                      # re-send the view
    {"type": "pause"} / {"type": "resume"}
    {"type": "snapshot"} -> {"type": "snapshot", "snapshot_id": "..."}
    {"type": "fork", "snapshot_id": "...", "seed": 99, "n": 3}
        -> {"type": "forked", "branches": [{"episode_id": ..., "summary": {...}}, ...]}

`decision` and `release` are the only two the engine blocks on. Anything
malformed comes back as `error` and the engine keeps waiting, so a fat-fingered
client cannot end an episode.

## Which events are safe to stream

`event` messages are filtered: a line is forwarded only once its content is
public or already visible to this seat. `attribution_revealed` before
`episode_end` is **never** forwarded — it is the answer.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import threading
from collections.abc import Mapping
from typing import Any

from engine.config import EnvConfig
from engine.contracts import LADDER
from engine.episode import Episode
from engine.human_agent import ExternalDecisionChannel, HumanAgent
from engine.stubs import build_stubs

__all__ = ["Bridge", "SeatBridgeChannel", "main"]

#: Event types a live client may see as they happen. Everything else is either
#: another seat's business or the answer to the exercise.
PUBLIC_EVENTS = frozenset(
    {
        "storm_update",
        "checkpoint",
        "episode_end",
        "release_requested",
        "release_granted",
        "release_denied",
        "human_action",
    }
)


def _safe_event(line: Mapping[str, Any], seat: str) -> bool:
    """Is this log line safe to stream to a live operator at `seat`?"""
    kind = str(line.get("type"))
    if kind == "attribution_revealed":
        return False  # the answer; withheld until episode_end
    if kind in PUBLIC_EVENTS:
        return True
    if kind in ("action", "message_sent", "message_delivered", "inject"):
        # Only this seat's own traffic. Everything else reaches the seat through
        # its filtered view, at its own feed latency, or not at all.
        return line.get("seat") == seat
    return False


class SeatBridgeChannel(ExternalDecisionChannel):
    """An `ExternalDecisionChannel` wired to a socket instead of a UI thread.

    The engine thread blocks in `request_decision` / `request_release`; the
    server thread fulfils them. Everything crossing between the two goes through
    the base class's queues, which are already thread-safe.
    """

    def __init__(self, bridge: Bridge) -> None:
        super().__init__()
        self.bridge = bridge

    def _announce(self, kind: str, context: Mapping[str, Any]) -> None:
        super()._announce(kind, context)
        if kind == "decision":
            self.bridge.push(
                {
                    "type": "prompt",
                    "kind": "decision",
                    "sim_time_s": self.bridge.sim_time_s,
                    "view": dict(context),
                }
            )
        else:
            request = dict(context.get("request") or {})
            self.bridge.push(
                {
                    "type": "prompt",
                    "kind": "release",
                    "sim_time_s": self.bridge.sim_time_s,
                    "request": {
                        "release_id": request.get("release_id"),
                        "action": request.get("action"),
                        "requesting_seat": request.get("requesting_seat"),
                        "releasing_seat": request.get("releasing_seat"),
                        "justification": request.get("justification"),
                    },
                    "view": dict(context.get("view") or {}),
                }
            )
        self.bridge.push(
            {
                "type": "paused",
                "sim_time_s": self.bridge.sim_time_s,
                "reason": "awaiting_operator",
            }
        )

    def _clear(self) -> None:
        super()._clear()
        self.bridge.push({"type": "resumed", "sim_time_s": self.bridge.sim_time_s})


class Bridge:
    """Runs one episode on a worker thread and serves one seat to one client."""

    def __init__(
        self,
        config: EnvConfig,
        *,
        seat: str = "nsc",
        stub_policy: str = "aggressive",
        operator_label: str = "operator",
    ) -> None:
        self.config = config
        self.seat = seat
        self.stub_policy = stub_policy
        self.operator_label = operator_label
        self.channel = SeatBridgeChannel(self)
        self.outbox: asyncio.Queue[dict[str, Any]] | None = None
        self.themeloop: asyncio.AbstractEventLoop | None = None
        self.episode: Episode | None = None
        self.snapshots: dict[str, dict[str, Any]] = {}
        self._emitted = 0
        self._thread: threading.Thread | None = None
        self._done = threading.Event()

    # --- plumbing ------------------------------------------------------------

    @property
    def sim_time_s(self) -> int:
        return self.episode.loop.sim_time_s if self.episode else 0

    def push(self, message: dict[str, Any]) -> None:
        """Called from the engine thread; hands a message to the server loop."""
        if self.outbox is None or self.themeloop is None:
            return
        self.themeloop.call_soon_threadsafe(self.outbox.put_nowait, message)

    def _drain_log(self) -> None:
        """Forward whatever the episode has newly logged, filtered for this seat."""
        if self.episode is None:
            return
        lines = self.episode.log.lines
        while self._emitted < len(lines):
            line = lines[self._emitted]
            self._emitted += 1
            if _safe_event(line, self.seat):
                self.push({"type": "event", "event": line})

    # --- the episode ---------------------------------------------------------

    def _build(self) -> Episode:
        def factory(episode: Episode) -> dict[str, Any]:
            agents: dict[str, Any] = build_stubs(
                episode.specs, episode.rng, policy=self.stub_policy
            )
            if self.seat in agents:
                agents[self.seat] = HumanAgent(
                    self.seat,
                    episode.specs[self.seat],
                    self.channel,
                    operator_label=self.operator_label,
                    fallback=agents[self.seat],
                )
            return agents

        return Episode(
            self.config,
            agent_factory=factory,
            agents_descriptor={
                "kind": "human",
                "policy": self.stub_policy,
                "human_seat": self.seat,
                "transport": "bridge",
            },
        )

    def _run_episode(self) -> None:
        episode = self._build()
        self.episode = episode
        self.push(
            {
                "type": "hello",
                "seat": self.seat,
                "episode_id": episode.episode_id,
                "env_version": self.config.env_version,
                "clock_mode": self.config.mode,
                "release_policy": self.config.policy,
                "duration_s": self.config.duration_s,
                "menu": episode.seats.available_actions(self.seat),
                "ladder": [
                    {"rung": e["rung"], "type": e["type"], "irreversible": e["irreversible"]}
                    for e in LADDER
                ],
            }
        )
        try:
            episode.run()
        except Exception as exc:  # pragma: no cover - a crash must reach the client
            self.push({"type": "error", "message": f"episode failed: {exc}"})
        finally:
            self._drain_log()
            summary = episode.log.lines[-1]["payload"] if episode.log.lines else {}
            self.push({"type": "ended", "sim_time_s": self.sim_time_s, "summary": summary})
            self._done.set()

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run_episode, daemon=True)
        self._thread.start()

    # --- client messages -----------------------------------------------------

    def handle(self, message: Mapping[str, Any]) -> None:
        kind = str(message.get("type"))
        if kind == "decision":
            decision = message.get("decision")
            if not isinstance(decision, Mapping):
                self.push({"type": "error", "message": "decision must be an object"})
                return
            self.channel.submit_decision(dict(decision))
        elif kind == "release":
            release_id = message.get("release_id")
            if not release_id:
                self.push({"type": "error", "message": "release needs a release_id"})
                return
            self.channel.submit_release(
                str(release_id),
                granted=bool(message.get("granted")),
                rationale=str(message.get("rationale") or ""),
            )
        elif kind == "observe":
            if self.episode is not None:
                self.push(
                    {
                        "type": "view",
                        "sim_time_s": self.sim_time_s,
                        "view": self.episode.view(self.seat),
                    }
                )
        elif kind == "pause":
            if self.episode is not None:
                self.episode.pause()
                self.push({"type": "paused", "sim_time_s": self.sim_time_s, "reason": "operator"})
        elif kind == "resume":
            if self.episode is not None:
                self.episode.loop.paused = False
                self.push({"type": "resumed", "sim_time_s": self.sim_time_s})
        elif kind == "snapshot":
            if self.episode is not None:
                snapshot_id = f"snap-{self.sim_time_s}-{len(self.snapshots):03d}"
                self.snapshots[snapshot_id] = self.episode.loop.snapshot()
                self.push(
                    {
                        "type": "snapshot",
                        "snapshot_id": snapshot_id,
                        "sim_time_s": self.sim_time_s,
                    }
                )
        elif kind == "fork":
            self._fork(message)
        else:
            self.push({"type": "error", "message": f"unknown message type {kind!r}"})

    def _fork(self, message: Mapping[str, Any]) -> None:
        """Branch futures from a snapshot. The demo's what-if button."""
        snapshot = self.snapshots.get(str(message.get("snapshot_id")))
        if snapshot is None or self.episode is None:
            self.push({"type": "error", "message": "no such snapshot_id"})
            return
        seed = int(message.get("seed") or self.config.seed)
        count = max(1, min(8, int(message.get("n") or 3)))
        branches: list[dict[str, Any]] = []
        for index in range(count):
            branch = self._build()
            branch.loop.restore(snapshot)
            from engine.rng import RngBook, derive_seed

            branch_seed = derive_seed(seed, f"fork:{index}")
            branch.loop.seed = branch_seed
            branch.rng.restore(RngBook(branch_seed).snapshot())
            branch.loop.paused = False
            # A forked branch has no operator; the persona takes the seat back.
            branch.agents[self.seat] = build_stubs(
                branch.specs, branch.rng, policy=self.stub_policy
            )[self.seat]
            branch.agents[self.seat].bind(lambda s=self.seat, b=branch: b.view(s))
            try:
                branch.run()
                summary = branch.log.lines[-1]["payload"] if branch.log.lines else {}
                branches.append(
                    {
                        "episode_id": branch.episode_id,
                        "seed": branch_seed,
                        "utilities": summary.get("utilities", {}),
                        "decision_count": summary.get("decision_count", 0),
                    }
                )
            except Exception as exc:  # pragma: no cover
                branches.append({"error": str(exc)})
        self.push({"type": "forked", "branches": branches})


# --- servers ------------------------------------------------------------------


async def _serve_websocket(bridge: Bridge, host: str, port: int) -> None:
    import websockets

    async def handler(connection: Any) -> None:
        async def pump() -> None:
            assert bridge.outbox is not None
            while True:
                message = await bridge.outbox.get()
                await connection.send(json.dumps(message))
                if message.get("type") == "ended":
                    return

        pumping = asyncio.create_task(pump())
        bridge.start()
        try:
            async for raw in connection:
                try:
                    bridge.handle(json.loads(raw))
                except json.JSONDecodeError:
                    bridge.push({"type": "error", "message": "not JSON"})
                bridge._drain_log()
        finally:
            pumping.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await pumping

    async with websockets.serve(handler, host, port):
        print(f"bridge listening on ws://{host}:{port}  seat={bridge.seat}")
        await asyncio.Future()


async def _serve_tcp(bridge: Bridge, host: str, port: int) -> None:
    """Newline-delimited JSON over plain TCP, so `nc` can drive it."""

    async def handler(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        async def pump() -> None:
            assert bridge.outbox is not None
            while True:
                message = await bridge.outbox.get()
                writer.write((json.dumps(message) + "\n").encode())
                await writer.drain()
                if message.get("type") == "ended":
                    return

        pumping = asyncio.create_task(pump())
        bridge.start()
        try:
            while True:
                raw = await reader.readline()
                if not raw:
                    break
                try:
                    bridge.handle(json.loads(raw))
                except json.JSONDecodeError:
                    bridge.push({"type": "error", "message": "not JSON"})
                bridge._drain_log()
        finally:
            pumping.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await pumping
            writer.close()

    server = await asyncio.start_server(handler, host, port)
    print(f"bridge listening on tcp://{host}:{port} (newline JSON)  seat={bridge.seat}")
    async with server:
        await server.serve_forever()


async def _amain(bridge: Bridge, host: str, port: int, transport: str) -> None:
    bridge.themeloop = asyncio.get_running_loop()
    bridge.outbox = asyncio.Queue()
    if transport == "websocket":
        try:
            await _serve_websocket(bridge, host, port)
            return
        except ImportError:
            print("websockets not installed; falling back to newline-JSON TCP")
    await _serve_tcp(bridge, host, port)


def main(argv: list[str] | None = None) -> int:
    from engine.run import build_config

    parser = argparse.ArgumentParser(
        prog="engine.bridge", description="Serve one seat of a live episode to a UI."
    )
    parser.add_argument("--seat", default="nsc")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--transport", default="websocket", choices=["websocket", "tcp"])
    parser.add_argument("--operator", default="operator", help="opaque label, never a real name")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--hours", type=float, default=72.0)
    parser.add_argument("--storm", default="G5")
    parser.add_argument("--storm-profile", dest="storm_profile", default=None)
    parser.add_argument("--clock", default="checkpoint", choices=["continuous", "checkpoint"])
    parser.add_argument(
        "--schedule", default="adaptive", choices=["fixed", "variable_tempo", "adaptive"]
    )
    parser.add_argument("--interval-s", dest="interval_s", type=int, default=10800)
    parser.add_argument("--min-interval-s", dest="min_interval_s", type=int, default=1800)
    parser.add_argument("--max-interval-s", dest="max_interval_s", type=int, default=21600)
    parser.add_argument("--tick-s", dest="tick_s", type=int, default=60)
    parser.add_argument("--stub-policy", dest="stub_policy", default="aggressive")
    parser.add_argument("--scenario", default=None)
    parser.add_argument("--replay", default=None)
    parser.add_argument("--config", default=None)
    args = parser.parse_args(argv)
    # A human at a seat always means release_policy human, whatever else is set.
    args.release = "human"
    args.human_seat = args.seat
    args.approval_probability = 0.6
    args.release_delay_minutes = 0.0

    bridge = Bridge(
        build_config(args),
        seat=args.seat,
        stub_policy=args.stub_policy,
        operator_label=args.operator,
    )
    try:
        asyncio.run(_amain(bridge, args.host, args.port, args.transport))
    except KeyboardInterrupt:  # pragma: no cover
        print("\nbridge stopped")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
