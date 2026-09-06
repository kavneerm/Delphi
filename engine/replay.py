"""`python -m engine.replay <log>` — reproduce an episode from its log.

    python -m engine.replay .wargame-local/logs/env_v1/lake_v0/adhoc/seed=1/<id>.jsonl

Two modes, chosen automatically from what the log says produced it:

* **rerun** — the log's first line carries the whole `env_config` and the agent
  descriptor. If the agents were stubs, replay rebuilds them from the same seed
  and re-runs the episode. This is the strong claim: same seed, same world, same
  bytes.
* **logged** — for an episode driven by a model, whose decisions are not
  reproducible by re-running anything. Replay feeds the recorded actions and
  messages back in on their recorded decision times, so the world evolves the
  way it did. Beliefs and reasoning never entered the log and never enter the
  comparison.

Either way the comparison is `equal_ignoring_wall_time`: every field byte for
byte except `wall_time`, which `contracts/event_log_schema.json` excludes.
"""

from __future__ import annotations

import argparse
from collections.abc import Mapping
from typing import Any

from engine.agent_api import BaseAgent
from engine.config import EnvConfig
from engine.episode import Episode
from engine.log import EventLog, read_log, replay_diff
from engine.stubs import build_stubs

__all__ = ["LoggedAgent", "config_from_log", "main", "replay_log"]


def config_from_log(lines: list[dict[str, Any]]) -> tuple[EnvConfig, dict[str, Any], str]:
    """Pull the config, the agent descriptor and the episode id out of a log."""
    for line in lines:
        payload = line.get("payload") or {}
        if line.get("type") == "state_change" and payload.get("what") == "config.env":
            config = EnvConfig.from_dict(dict(payload["value"]))
            return (
                config,
                dict(payload.get("agents") or {"kind": "external"}),
                str(line["episode_id"]),
            )
    raise ValueError("log has no config.env line; it was not written by engine/log.py")


class LoggedAgent(BaseAgent):
    """Replays one seat's recorded decisions, in order.

    Messages come back from the `message_sent` lines that share the decision's
    sim time, so a model-driven episode reproduces its world without the model.
    """

    def __init__(self, seat: str, spec: Mapping[str, Any], script: list[dict[str, Any]]) -> None:
        super().__init__(seat, spec)
        self.script = script
        self.index = 0

    def act(self, view: Mapping[str, Any]) -> Mapping[str, Any]:
        if self.index >= len(self.script):
            from engine.agent_api import hold_decision

            return hold_decision("No further recorded decisions for this seat.")
        decision = self.script[self.index]
        self.index += 1
        return decision

    def decide_release(
        self, request: Mapping[str, Any], view: Mapping[str, Any]
    ) -> tuple[bool, str]:
        return False, "Replayed episode: release outcomes come from the log."


def _scripts_from_log(lines: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Reconstruct each seat's decisions from `action` and `message_sent` lines."""
    by_decision: dict[str, dict[str, Any]] = {}
    order: dict[str, list[str]] = {}
    for line in lines:
        payload = line.get("payload") or {}
        if line.get("type") != "action":
            continue
        seat = str(line.get("seat"))
        decision_id = str(payload.get("decision_id"))
        by_decision[decision_id] = {
            "seat": seat,
            "decided_at": float(payload.get("decided_at_sim_time_s", 0)),
            "action": dict(payload["action"]),
            "messages": [],
        }
        order.setdefault(seat, []).append(decision_id)
    for line in lines:
        if line.get("type") != "message_sent":
            continue
        seat = str(line.get("seat"))
        at = float(line["sim_time_s"])
        candidates = [
            d for d in order.get(seat, []) if abs(by_decision[d]["decided_at"] - at) < 1e-6
        ]
        if candidates:
            message = dict((line.get("payload") or {}).get("message") or {})
            if message:
                by_decision[candidates[0]]["messages"].append(message)
    scripts: dict[str, list[dict[str, Any]]] = {}
    for seat, ids in sorted(order.items()):
        ids.sort(key=lambda d: by_decision[d]["decided_at"])
        scripts[seat] = [
            {
                "beliefs": {"hostile": 0.2, "natural": 0.5, "unknown": 0.3, "per_actor": {}},
                "messages": by_decision[d]["messages"],
                "action": by_decision[d]["action"],
                "reasoning": "Replayed from the event log.",
            }
            for d in ids
        ]
    return scripts


def replay_log(source: str, *, mode: str = "auto") -> tuple[EventLog, list[dict[str, Any]], str]:
    """Re-run an episode from its log. Returns (new log, original lines, mode used)."""
    original = read_log(source)
    config, descriptor, episode_id = config_from_log(original)
    chosen = mode
    if chosen == "auto":
        chosen = "rerun" if descriptor.get("kind") == "stubs" else "logged"

    if chosen == "rerun":
        policy = descriptor.get("policy", "aggressive")

        def factory(episode: Episode) -> dict[str, Any]:
            return build_stubs(episode.specs, episode.rng, policy=policy)

    else:
        scripts = _scripts_from_log(original)

        def factory(episode: Episode) -> dict[str, Any]:
            return {
                seat: LoggedAgent(seat, spec, scripts.get(seat, []))
                for seat, spec in sorted(episode.specs.items())
            }

    episode = Episode(
        config,
        agent_factory=factory,
        episode_id=episode_id,
        agents_descriptor=descriptor,
    )
    episode.run()
    return episode.log, original, chosen


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="engine.replay", description="Reproduce an episode from its event log."
    )
    parser.add_argument("log", help="path, S3 URI, or bucket key")
    parser.add_argument("--mode", default="auto", choices=["auto", "rerun", "logged"])
    parser.add_argument("--out", default=None, help="write the replayed log here")
    parser.add_argument("--limit", type=int, default=3, help="how many diffs to print")
    args = parser.parse_args(argv)

    replayed, original, mode = replay_log(args.log, mode=args.mode)
    if args.out:
        replayed.write_local(args.out)
    diffs = replay_diff(original, replayed.lines, limit=args.limit)
    print(f"mode            {mode}")
    print(f"original lines  {len(original)}")
    print(f"replayed lines  {len(replayed.lines)}")
    if not diffs:
        print("REPLAY OK: byte-identical except wall_time")
        return 0
    print(f"REPLAY MISMATCH: {len(diffs)} difference(s) shown")
    for diff in diffs:
        print(diff)
    return 1


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
