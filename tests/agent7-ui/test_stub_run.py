"""The UI's stub logs must satisfy contracts/event_log_schema.json.

The whole point of the stub is that when agent1-engine publishes
engine/samples/stub_run.jsonl the UI can swap the file and change nothing else.
That only holds if the stub is validated against the same contract the engine
writes to.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
CONTRACTS = REPO / "contracts"
UI_DATA = REPO / "ui" / "data"

jsonschema = pytest.importorskip("jsonschema", reason="jsonschema not installed")

STUBS = ("stub_run.jsonl", "stub_run_checkpoint.jsonl", "stub_run_alt.jsonl")


@pytest.fixture(scope="session")
def validator() -> jsonschema.protocols.Validator:
    from referencing import Registry, Resource
    from referencing.jsonschema import DRAFT202012

    resources = []
    for path in CONTRACTS.glob("*.json"):
        schema = json.loads(path.read_text(encoding="utf-8"))
        resources.append((path.name, Resource(contents=schema, specification=DRAFT202012)))
    registry = Registry().with_resources(resources)
    root = json.loads((CONTRACTS / "event_log_schema.json").read_text(encoding="utf-8"))
    return jsonschema.Draft202012Validator(root, registry=registry)


def _lines(name: str) -> list[dict]:
    path = UI_DATA / name
    return [json.loads(ln) for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]


@pytest.mark.parametrize("name", STUBS)
def test_every_line_validates(validator, name: str) -> None:
    for i, line in enumerate(_lines(name), start=1):
        errors = sorted(validator.iter_errors(line), key=lambda e: e.path)
        assert not errors, f"{name}:{i} {errors[0].message} at {list(errors[0].path)}"


@pytest.mark.parametrize("name", STUBS)
def test_ordering_is_non_decreasing(name: str) -> None:
    times = [ln["sim_time_s"] for ln in _lines(name)]
    assert times == sorted(times), f"{name} violates the non-decreasing sim_time_s ordering rule"


@pytest.mark.parametrize("name", STUBS)
def test_exactly_one_episode_end_and_it_is_last(name: str) -> None:
    lines = _lines(name)
    ends = [i for i, ln in enumerate(lines) if ln["type"] == "episode_end"]
    assert len(ends) == 1, f"{name} has {len(ends)} episode_end lines"
    assert ends[0] == len(lines) - 1, f"{name} episode_end is not the last line"


@pytest.mark.parametrize("name", STUBS)
def test_episode_id_and_seed_are_constant(name: str) -> None:
    lines = _lines(name)
    assert len({ln["episode_id"] for ln in lines}) == 1
    assert len({ln["seed"] for ln in lines}) == 1


@pytest.mark.parametrize("name", STUBS)
def test_release_ids_pair_up(name: str) -> None:
    requested, answered = set(), set()
    for ln in _lines(name):
        if ln["type"] == "release_requested":
            requested.add(ln["payload"]["release_id"])
        elif ln["type"] in ("release_granted", "release_denied"):
            answered.add(ln["payload"]["release_id"])
    assert answered <= requested, f"{name} answers a release that was never requested"


@pytest.mark.parametrize("name", STUBS)
def test_delivered_messages_were_sent(name: str) -> None:
    sent, delivered = set(), set()
    for ln in _lines(name):
        if ln["type"] == "message_sent":
            sent.add(ln["payload"]["message_id"])
        elif ln["type"] == "message_delivered":
            delivered.add(ln["payload"]["message_id"])
    assert delivered <= sent, f"{name} delivers a message that was never sent"


def test_checkpoint_events_only_in_checkpoint_mode() -> None:
    assert not any(ln["type"] == "checkpoint" for ln in _lines("stub_run.jsonl"))
    assert any(ln["type"] == "checkpoint" for ln in _lines("stub_run_checkpoint.jsonl"))


def test_seat_decision_timestamps_drift_apart() -> None:
    """The demo claim: nine seats never share a decision timestamp under the
    continuous clock. If they do, the persona cards lose their whole point."""
    by_seat: dict[str, list[float]] = {}
    for ln in _lines("stub_run.jsonl"):
        if ln["type"] == "action":
            by_seat.setdefault(ln["seat"], []).append(ln["payload"]["decided_at_sim_time_s"])
    assert len(by_seat) == 9, f"only {len(by_seat)} seats acted"
    firsts = [sorted(v)[0] for v in by_seat.values()]
    assert len(set(firsts)) == len(firsts), (
        "two seats took their first decision at the same sim time"
    )


def test_generator_is_deterministic(tmp_path: Path) -> None:
    out = tmp_path / "a.jsonl"
    tool = REPO / "ui" / "tools" / "make_stub_run.py"

    def run() -> list[str]:
        subprocess.run(
            [sys.executable, str(tool), "--seed", "1041", "--out", str(out)],
            check=True,
            capture_output=True,
        )
        # wall_time is real elapsed time and is excluded from replay comparison
        # by contracts/event_log_schema.json, but this generator derives it from
        # sim_time so it is stable too; strip it anyway to honour the rule.
        return [
            json.dumps(
                {k: v for k, v in json.loads(ln).items() if k != "wall_time"}, sort_keys=True
            )
            for ln in out.read_text().splitlines()
        ]

    assert run() == run()
