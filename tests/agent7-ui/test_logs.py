"""Guards on the logs the console plays back.

The UI does not produce logs any more -- agent1-engine does. What still has to be
checked here is the UI's side of the bargain: every run named in
``ui/data/runs.json`` exists, validates against ``contracts/event_log_schema.json``,
and satisfies the ordering and pairing rules the schema states in prose but cannot
express. If one of those breaks, the console draws something wrong rather than
failing loudly, so it is worth a test.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
CONTRACTS = REPO / "contracts"
RUNS = json.loads((REPO / "ui" / "data" / "runs.json").read_text(encoding="utf-8"))["runs"]

jsonschema = pytest.importorskip("jsonschema", reason="jsonschema not installed")

RUN_IDS = [r["id"] for r in RUNS]
BY_ID = {r["id"]: r for r in RUNS}


@pytest.fixture(scope="session")
def validator():
    from referencing import Registry, Resource
    from referencing.jsonschema import DRAFT202012

    resources = [
        (
            p.name,
            Resource(contents=json.loads(p.read_text(encoding="utf-8")), specification=DRAFT202012),
        )
        for p in CONTRACTS.glob("*.json")
    ]
    registry = Registry().with_resources(resources)
    root = json.loads((CONTRACTS / "event_log_schema.json").read_text(encoding="utf-8"))
    return jsonschema.Draft202012Validator(root, registry=registry)


@cache
def _lines(run_id: str) -> tuple[dict, ...]:
    # Cached: several tests walk every run, and the continuous log is 8k lines.
    path = REPO / BY_ID[run_id]["path"]
    return tuple(json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip())


@pytest.mark.parametrize("run_id", RUN_IDS)
def test_run_file_exists(run_id: str) -> None:
    assert (REPO / BY_ID[run_id]["path"]).is_file(), f"{BY_ID[run_id]['path']} is missing"


@pytest.mark.parametrize("run_id", RUN_IDS)
def test_every_line_validates(validator, run_id: str) -> None:
    for i, line in enumerate(_lines(run_id), start=1):
        errors = sorted(validator.iter_errors(line), key=lambda e: list(e.path))
        assert not errors, f"{run_id}:{i} {errors[0].message} at {list(errors[0].path)}"


@pytest.mark.parametrize("run_id", RUN_IDS)
def test_ordering_and_terminator(run_id: str) -> None:
    lines = _lines(run_id)
    times = [x["sim_time_s"] for x in lines]
    assert times == sorted(times), "violates the non-decreasing sim_time_s ordering rule"
    ends = [i for i, x in enumerate(lines) if x["type"] == "episode_end"]
    assert ends == [len(lines) - 1], "episode_end must be the last line and appear exactly once"


@pytest.mark.parametrize("run_id", RUN_IDS)
def test_manifest_describes_the_file(run_id: str) -> None:
    """A wrong clock_mode in runs.json silently mislabels the compare view."""
    entry = BY_ID[run_id]
    end = _lines(run_id)[-1]
    assert end["clock_mode"] == entry["clock_mode"]
    assert end["release_policy"] == entry["release_policy"]
    assert _lines(run_id)[0]["seed"] == entry["seed"]


@pytest.mark.parametrize("run_id", RUN_IDS)
def test_release_and_message_ids_pair_up(run_id: str) -> None:
    requested, answered, sent, delivered = set(), set(), set(), set()
    for x in _lines(run_id):
        p = x["payload"]
        if x["type"] == "release_requested":
            requested.add(p["release_id"])
        elif x["type"] in ("release_granted", "release_denied"):
            answered.add(p["release_id"])
        elif x["type"] == "message_sent":
            sent.add(p["message_id"])
        elif x["type"] == "message_delivered":
            delivered.add(p["message_id"])
    assert answered <= requested, "a release was answered that was never requested"
    assert delivered <= sent, "a message was delivered that was never sent"


def test_checkpoint_lines_track_the_clock_mode() -> None:
    """contracts/event_log_schema.json: checkpoint lines are absent entirely
    under clock_mode 'continuous'."""
    for run_id in RUN_IDS:
        has_cp = any(x["type"] == "checkpoint" for x in _lines(run_id))
        assert has_cp == (BY_ID[run_id]["clock_mode"] == "checkpoint"), run_id


def test_compare_pair_is_one_seed_two_clocks() -> None:
    """The Clock-compare view is only honest if both sides really are the same
    seed and scenario."""
    groups: dict[str, list[dict]] = {}
    for r in RUNS:
        groups.setdefault(r["compare_group"], []).append(r)
    pairs = [g for g in groups.values() if len(g) > 1]
    assert pairs, "no compare_group has two runs; the clock-compare view has nothing to show"
    for g in pairs:
        assert len({r["seed"] for r in g}) == 1, "compare group spans more than one seed"
        assert {r["clock_mode"] for r in g} == {"continuous", "checkpoint"}
        scenarios = {_lines(r["id"])[0].get("scenario_id") for r in g}
        assert len(scenarios) == 1, f"compare group spans scenarios {scenarios}"


def test_ground_tracks_are_present_for_the_map() -> None:
    """The map needs assets.ground_tracks state_change lines to place markers."""
    for run_id in RUN_IDS:
        tracks = [
            x
            for x in _lines(run_id)
            if x["type"] == "state_change" and x["payload"].get("what") == "assets.ground_tracks"
        ]
        assert len(tracks) > 10, f"{run_id} has {len(tracks)} ground-track samples"
        assert isinstance(tracks[0]["payload"]["value"], dict)


def test_model_beliefs_are_still_absent_from_action_lines() -> None:
    """The persona cards are specified to show beliefs and reasoning, and the
    event log does not carry them for model-driven seats:
    contracts/lake_record_schema.json owns those fields.

    agent1-engine offered to add them to the action payload (docs/HANDOFFS.md,
    2026-09-05) and I have asked for it. Until then the cards say so rather than
    inventing a number -- in a demo about attribution confidence, a fabricated
    belief is the one thing that must never appear on screen.

    When the handoff lands this test fails. That is the signal to wire the cards
    to the real numbers and delete the test.
    """
    with_beliefs = [
        (run_id, x["seat"])
        for run_id in RUN_IDS
        for x in _lines(run_id)
        if x["type"] == "action" and "beliefs" in x["payload"]
    ]
    assert not with_beliefs, (
        f"beliefs are on action lines now -- wire the cards to them: {with_beliefs[:3]}"
    )


def test_human_action_beliefs_are_read_back() -> None:
    """The other half of the same story: beliefs the *operator* records are
    contract-sanctioned on human_action (event_log_schema.json: "what the
    operator recorded believing, if the UI collected it"). The human-seat panel
    writes them, so at least one run must prove they survive the round trip."""
    found = [
        x["payload"]["beliefs"]
        for run_id in RUN_IDS
        for x in _lines(run_id)
        if x["type"] == "human_action" and "beliefs" in x["payload"]
    ]
    assert found, "no human_action carries beliefs; the operator belief round trip is untested"
    for b in found:
        total = b["hostile"] + b["natural"] + b["unknown"]
        assert abs(total - 1.0) <= 0.01, f"beliefs do not sum to 1 within 0.01: {b}"
