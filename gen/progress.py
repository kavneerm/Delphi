"""Read-only 15-minute generation report: rates and completed grid coverage.

python -m gen.progress --window-minutes 15
"""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any

from gen.config import GenConfig
from gen.keys import is_record_key, records_prefix
from infra.storage import Storage


def _when(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def report(config: GenConfig, *, window_minutes: int) -> dict[str, Any]:
    store = Storage.from_env()
    cutoff = datetime.now(UTC) - timedelta(minutes=window_minutes)
    parts = []
    for key in store.list(f"lake/{config.lake_version}/_parts/"):
        if not key.endswith(".json"):
            continue
        item = store.get_json(key)
        if _when(str(item["written_at_utc"])) >= cutoff:
            parts.append(item)
    complete: Counter[tuple[str, str, str]] = Counter()
    prefix = records_prefix(config.lake_version, config.env_version, config.spec_version)
    for key in store.list(prefix):
        if not is_record_key(key):
            continue
        rows = store.get_jsonl(key)
        if not rows:
            continue
        cell = rows[0].get("grid_cell") or {}
        complete[
            (
                str(cell.get("red_private_type", "legacy")),
                str(cell.get("red_psyche", "legacy")),
                str(cell.get("storm_severity", "legacy")),
            )
        ] += 1
    api_calls = sum(1 for item in parts if int((item.get("tokens") or {}).get("prompt", 0)) > 0)
    return {
        "window_minutes": window_minutes,
        "decisions": len(parts),
        "decisions_per_minute": round(len(parts) / window_minutes, 2),
        "api_calls": api_calls,
        "api_calls_per_minute": round(api_calls / window_minutes, 2),
        "synthetic_holds": sum(bool(item.get("synthetic_hold")) for item in parts),
        "coverage": complete,
    }


def render(data: dict[str, Any]) -> str:
    lines = [
        f"# generation progress — last {data['window_minutes']} minutes",
        "",
        f"- decisions/minute: {data['decisions_per_minute']}",
        f"- API calls/minute: {data['api_calls_per_minute']}",
        f"- synthetic holds: {data['synthetic_holds']}",
        "",
        "| Red private type | Red psyche | Storm severity | Episodes complete |",
        "|---|---|---|---:|",
    ]
    for (private_type, psyche, severity), count in sorted(data["coverage"].items()):
        lines.append(f"| {private_type} | {psyche} | {severity} | {count} |")
    if not data["coverage"]:
        lines.append("| – | – | – | 0 |")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--window-minutes", type=int, default=15)
    args = parser.parse_args(argv)
    if args.window_minutes < 1:
        parser.error("--window-minutes must be positive")
    print(render(report(GenConfig(), window_minutes=args.window_minutes)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
