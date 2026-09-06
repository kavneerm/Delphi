"""Render the final validation table from whatever completed metric artifacts exist."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def rows(payloads: list[dict[str, Any]]) -> list[tuple[str, str, str]]:
    """Flatten metric dictionaries without imposing a future evaluator's schema."""
    result: list[tuple[str, str, str]] = []
    for payload in payloads:
        source = str(payload.get("source") or payload.get("run_id") or "partial")
        for name, value in sorted((payload.get("metrics") or {}).items()):
            result.append((source, str(name), str(value)))
    return result


def render(payloads: list[dict[str, Any]]) -> str:
    table = ["# Panoptes validation report", "", "| source | metric | value |", "|---|---|---:|"]
    table.extend(f"| {source} | {name} | {value} |" for source, name, value in rows(payloads))
    if len(table) == 4:
        table.append("| pending | No final evaluation metrics yet | — |")
    table.extend(["", "This report is partial until the single authorized final evaluation run."])
    return "\n".join(table) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, action="append", default=[])
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    payloads: list[dict[str, Any]] = []
    for path in args.input:
        data = json.loads(path.read_text())
        payloads.extend(data if isinstance(data, list) else [data])
    args.out.write_text(render(payloads))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
