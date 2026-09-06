"""Flat, per-seat view of the devset, for consumers that cannot walk the directory tree.

The devset on disk follows `contracts/inject_schema.json`: one directory per scenario,
holding a `scenario.json` (the inject timeline) and an `expected.json` (the scoring key,
with `ground_truth.expected_beliefs`, `real_responses` and `forbidden_actions`). Keeping
them apart is what the contract describes and what lets a timeline be authored openly
while the key stays separate.

`train/devset.py` as written loads `specs/devset/` with a non-recursive `glob("*.json")`
and reads a flat `scenario["expected"]["action"]` — so it would find nothing in the
directory layout and, if pointed at the files directly, would find no expected action.
Rather than abandon the contract shape or edit another agent's module, this module
projects the contract files into exactly the dicts that loader expects:

    from specs.drafts.devset_view import flat_scenarios
    scenarios = flat_scenarios(Path("specs/devset"))   # one dict per (scenario, seat)

Each dict carries `scenario_id`, `seat`, `expected.action`, `expected.cause`,
`is_control`, the belief band, the forbidden-action list and the inject timeline, so
`response_match`, `control_false_positive_rate` and the irreversible-action rate can all
be computed without any further lookup.

Run it directly to see what a consumer would get::

    python specs/drafts/devset_view.py [specs/devset]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

#: `train/devset.py` tests `expected.cause == "natural"`; the contract enum is richer.
#: Anything mapping to "natural" is a false-positive control: reality had no adversary.
_CONTROL_CAUSES = {"natural_space_weather", "technical_failure", "debris_or_collision"}


def _seats(expected: dict[str, Any], responses: dict[str, Any]) -> list[str]:
    """Every seat this scenario says something about, in a stable order."""
    named = set(expected.get("expected_beliefs", {})) | set(responses)
    return sorted(named)


def _action_of(entry: Any) -> str | None:
    """`real_responses` values are a bare action name or an object carrying one."""
    if isinstance(entry, str):
        return entry
    if isinstance(entry, dict):
        return entry.get("action")
    return None


def flat_scenarios(devset_dir: Path) -> list[dict[str, Any]]:
    """One dict per (scenario, seat), shaped for a flat consumer.

    A seat absent from `real_responses` gets an expected action of 'hold', which is what
    `contracts/inject_schema.json` says an absent seat means — it made no recorded
    response, and that is informative rather than missing.
    """
    out: list[dict[str, Any]] = []
    for scenario_dir in sorted(p for p in devset_dir.iterdir() if p.is_dir()):
        scenario_path = scenario_dir / "scenario.json"
        expected_path = scenario_dir / "expected.json"
        if not (scenario_path.exists() and expected_path.exists()):
            continue

        scenario = json.loads(scenario_path.read_text(encoding="utf-8"))
        truth = json.loads(expected_path.read_text(encoding="utf-8"))["ground_truth"]

        responses = truth.get("real_responses", {})
        bands = truth.get("expected_beliefs", {})
        cause = truth.get("cause", "unknown")
        is_control = cause in _CONTROL_CAUSES and truth.get("responsible_actor") in (None, "none")

        for seat in _seats(truth, responses):
            band = bands.get(seat, {})
            out.append(
                {
                    "scenario_id": scenario["replay_id"],
                    "replay_version": scenario["replay_version"],
                    "seat": seat,
                    "is_control": is_control,
                    "expected": {
                        # 'natural' is the literal train/devset.py tests for; the contract
                        # cause is carried alongside it rather than replaced.
                        "cause": "natural" if is_control else cause,
                        "contract_cause": cause,
                        "action": _action_of(responses.get(seat)) or "hold",
                        "responsible_actor": truth.get("responsible_actor"),
                        "attributed_actor": band.get("expected_attributed_actor"),
                        "hostile_min": band.get("hostile_min"),
                        "hostile_max": band.get("hostile_max"),
                        "forbidden_actions": truth.get("forbidden_actions", []),
                        "attribution_time_s": truth.get("attribution_time_s"),
                    },
                    "duration_s": scenario.get("duration_s"),
                    "injects": scenario.get("injects", []),
                }
            )
    return out


def main() -> int:
    devset_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "specs/devset")
    rows = flat_scenarios(devset_dir) if devset_dir.exists() else []
    if not rows:
        # Before promotion the scenarios still live in the drafts tree.
        devset_dir = Path(__file__).resolve().parent / "devset"
        rows = flat_scenarios(devset_dir)
    print(f"{len(rows)} (scenario, seat) rows from {devset_dir}")
    for row in rows:
        expected = row["expected"]
        control = "control" if row["is_control"] else "      "
        print(
            f"  {row['scenario_id']:<32} {row['seat']:<15} {control} "
            f"action={expected['action']:<26} "
            f"hostile=[{expected['hostile_min']}, {expected['hostile_max']}]"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
