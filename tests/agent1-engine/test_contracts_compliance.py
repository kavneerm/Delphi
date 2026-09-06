"""Everything the engine emits must satisfy `contracts/`.

If a schema changes, this file fails rather than the engine quietly drifting out
of contract with the six other agents reading its output.
"""

from __future__ import annotations

import pytest
from conftest import make_config, run

from engine.agent_api import validate_decision
from engine.contracts import ALLOWED_SEATS, IRREVERSIBLE, SEATS, validator
from engine.specs import load_pool

CLOCKS = [
    {"mode": "continuous", "tick_s": 60},
    {"mode": "checkpoint", "schedule_type": "fixed", "interval_s": 3600, "seal_decisions": True},
]


@pytest.mark.parametrize("clock", CLOCKS, ids=["continuous", "checkpoint"])
def test_every_log_line_validates(clock) -> None:
    episode = run(make_config(clock_mode=clock))
    check = validator("event_log_schema.json")
    for index, line in enumerate(episode.log.lines):
        errors = list(check.iter_errors(line))
        assert not errors, f"line {index} ({line['type']}): {errors[0].message}"


@pytest.mark.parametrize("clock", CLOCKS, ids=["continuous", "checkpoint"])
def test_log_ordering_and_terminator(clock) -> None:
    episode = run(make_config(clock_mode=clock))
    times = [line["sim_time_s"] for line in episode.log.lines]
    assert times == sorted(times), "lines must be in non-decreasing sim_time_s"
    assert episode.log.lines[-1]["type"] == "episode_end"
    assert sum(1 for line in episode.log.lines if line["type"] == "episode_end") == 1


def test_episode_end_carries_the_required_grouping_fields() -> None:
    episode = run(make_config())
    end = episode.log.lines[-1]
    assert end["spec_version"] and end["clock_mode"] and end["release_policy"]
    assert set(end["payload"]["utilities"]) == set(SEATS)
    assert set(end["payload"]["seats"]) == set(SEATS)


def test_checkpoint_lines_appear_only_in_checkpoint_mode() -> None:
    continuous = run(make_config(clock_mode=CLOCKS[0]))
    checkpoint = run(make_config(clock_mode=CLOCKS[1]))
    assert not [line for line in continuous.log.lines if line["type"] == "checkpoint"]
    assert [line for line in checkpoint.log.lines if line["type"] == "checkpoint"]


def test_both_clock_modes_emit_the_same_set_of_event_types_otherwise() -> None:
    """Nothing downstream should have to branch on how an episode was run."""
    continuous = {line["type"] for line in run(make_config(clock_mode=CLOCKS[0])).log.lines}
    checkpoint = {line["type"] for line in run(make_config(clock_mode=CLOCKS[1])).log.lines}
    assert checkpoint - continuous == {"checkpoint"}
    assert continuous - checkpoint == set()


def test_every_decision_the_engine_recorded_is_a_valid_decision() -> None:
    episode = run(make_config())
    assert episode.decision_records
    for record in episode.decision_records:
        assert not validate_decision(record["output"])


def test_every_placeholder_spec_validates_and_respects_the_authority_invariants() -> None:
    for seat, spec in load_pool().items():
        validator("spec_schema.json").validate(spec)
        assert spec["seat"] == seat
        authority = spec["authority"]
        lists = [set(authority[k]) for k in ("unilateral", "requires_release", "recommend_only")]
        assert not lists[0] & lists[1] and not lists[0] & lists[2] and not lists[1] & lists[2]
        for action_type in lists[0] | lists[1]:
            assert seat in ALLOWED_SEATS[action_type], (
                f"{seat} claims authority for {action_type}, which is not on its menu"
            )


def test_no_action_lands_that_the_seat_was_not_allowed_to_take() -> None:
    episode = run(make_config())
    for line in episode.log.lines:
        if line["type"] != "action" or line["payload"].get("blocked"):
            continue
        seat = line["seat"]
        action_type = line["payload"]["action"]["type"]
        assert seat in ALLOWED_SEATS[action_type]
        authority = episode.specs[seat]["authority"]
        assert action_type == "hold" or action_type in (
            set(authority["unilateral"]) | set(authority["requires_release"])
        )


def test_no_irreversible_action_lands_without_a_granted_release() -> None:
    episode = run(make_config())
    granted = {
        line["payload"]["release_id"]
        for line in episode.log.lines
        if line["type"] == "release_granted"
    }
    for line in episode.log.lines:
        payload = line["payload"]
        if line["type"] != "action" or payload.get("blocked"):
            continue
        if payload["action"]["type"] in IRREVERSIBLE:
            assert payload.get("release_id") in granted, (
                "an irreversible action landed without a granted release"
            )


def test_the_ladder_ids_from_the_fold_never_reappear() -> None:
    """nato, ksat and hacktivist-as-a-seat were folded; nothing may resurrect them."""
    episode = run(make_config())
    import json

    blob = json.dumps(episode.log.lines)
    for gone in ('"nato"', '"ksat"', '"seat": "hacktivist"'):
        assert gone not in blob
