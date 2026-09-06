"""The event log: one JSON line per event, per `contracts/event_log_schema.json`.

The determinism contract is here in one place. A line is written with
`sort_keys=True` and separators that never vary, and floats are rounded before
they arrive, so two runs of the same episode produce the same bytes. `wall_time`
is the single exception the contract carves out, and `equal_ignoring_wall_time`
is the comparison `engine/replay.py` uses.

The other rule this module enforces is ordering: lines come out in
non-decreasing `sim_time_s`, ties in the event loop's insertion order. The
writer asserts it rather than trusting it, because a log that is out of order
replays out of order and the failure surfaces a long way from the cause.
"""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

from engine import CONTRACTS_VERSION
from engine.contracts import validate
from engine.storage import put_text, read_text

__all__ = [
    "EventLog",
    "equal_ignoring_wall_time",
    "log_key",
    "read_log",
    "replay_diff",
]

REPLAY_EXCLUDED = ("wall_time",)


def log_key(
    env_version: str, lake_version: str, scenario_id: str, seed: int, episode_id: str
) -> str:
    """`logs/<env_version>/<lake_version>/<scenario_id>/seed=<seed>/<episode_id>.jsonl`."""
    return f"logs/{env_version}/{lake_version}/{scenario_id}/seed={seed}/{episode_id}.jsonl"


def _dumps(line: dict[str, Any]) -> str:
    return json.dumps(line, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


class EventLog:
    """Collects lines in order, then writes them once the episode ends.

    Held in memory because an episode is a few thousand lines and the log is the
    unit of replay; `gen/run.py` writes lake records as it goes, which is the
    thing `contracts/s3_layout.md` §5 actually requires to survive a crash.
    """

    def __init__(
        self,
        *,
        episode_id: str,
        seed: int,
        env_version: str,
        spec_version: str = "",
        scenario_id: str = "",
        validate_lines: bool = True,
    ) -> None:
        self.episode_id = episode_id
        self.seed = int(seed)
        self.env_version = env_version
        self.spec_version = spec_version
        self.scenario_id = scenario_id
        self.validate_lines = validate_lines
        self.lines: list[dict[str, Any]] = []
        self._last_time_s: float = -1.0

    def emit(
        self,
        *,
        sim_time_s: int,
        type: str,
        seat: str | None,
        payload: dict[str, Any],
        **extra: Any,
    ) -> dict[str, Any]:
        if sim_time_s < self._last_time_s:
            raise ValueError(
                f"event log out of order: {type} at {sim_time_s}s after {self._last_time_s}s"
            )
        self._last_time_s = sim_time_s
        line: dict[str, Any] = {
            "sim_time_s": sim_time_s,
            "wall_time": dt.datetime.now(dt.UTC)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
            "type": type,
            "seat": seat,
            "payload": payload,
            "seed": self.seed,
            "env_version": self.env_version,
            "episode_id": self.episode_id,
        }
        if self.scenario_id:
            line["scenario_id"] = self.scenario_id
        line.update({k: v for k, v in extra.items() if v is not None})
        if self.validate_lines:
            validate("event_log_schema.json", line)
        self.lines.append(line)
        return line

    # --- output --------------------------------------------------------------

    def to_jsonl(self) -> str:
        return "".join(_dumps(line) + "\n" for line in self.lines)

    def write_local(self, path: str | Path) -> Path:
        out = Path(path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(self.to_jsonl())
        return out

    def publish(self, *, lake_version: str = "lake_v0") -> str:
        """Write to `logs/` per `contracts/s3_layout.md`, S3 or local mirror."""
        key = log_key(
            self.env_version, lake_version, self.scenario_id or "adhoc", self.seed, self.episode_id
        )
        return put_text(
            key,
            self.to_jsonl(),
            env_version=self.env_version,
            spec_version=self.spec_version,
            lake_version=lake_version,
            seed=self.seed,
            episode_id=self.episode_id,
            contracts_version=CONTRACTS_VERSION,
            content_type="application/x-ndjson",
            # A log that cannot be traced back to an engine version and an
            # episode is not a log; fail at the write, not on discovery.
            require=("env_version", "episode_id"),
        )


def read_log(source: str | Path) -> list[dict[str, Any]]:
    """Read a log from a path, an S3 URI, or a bucket key."""
    text = read_text(str(source))
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def _strip(line: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in line.items() if k not in REPLAY_EXCLUDED}
    payload = dict(out.get("payload") or {})
    # Real seconds a person took are wall time by another name.
    payload.pop("wall_time_to_decide_s", None)
    out["payload"] = payload
    return out


def equal_ignoring_wall_time(a: list[dict[str, Any]], b: list[dict[str, Any]]) -> bool:
    if len(a) != len(b):
        return False
    return all(_dumps(_strip(x)) == _dumps(_strip(y)) for x, y in zip(a, b, strict=True))


def replay_diff(
    original: list[dict[str, Any]], replayed: list[dict[str, Any]], limit: int = 5
) -> list[str]:
    """Human-readable first differences. Empty list means byte-identical."""
    diffs: list[str] = []
    if len(original) != len(replayed):
        diffs.append(f"line count: original {len(original)}, replay {len(replayed)}")
    for index, (x, y) in enumerate(zip(original, replayed, strict=False)):
        left, right = _dumps(_strip(x)), _dumps(_strip(y))
        if left != right:
            diffs.append(f"line {index}:\n  original: {left}\n  replay:   {right}")
        if len(diffs) >= limit:
            break
    return diffs
