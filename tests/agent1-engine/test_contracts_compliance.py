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


def test_a_real_spec_pool_replaces_the_placeholders(tmp_path, monkeypatch) -> None:
    """Regression: `load_pool` used `setdefault` against a dict that already held
    a placeholder for every seat, so a real `specs/train/` was silently ignored
    and every episode ran on placeholders. Caught by running the engine against
    agent9-specs' actual pool.
    """
    import json

    from engine.specs import PLACEHOLDER_SPEC_VERSION, load_pool, placeholder_specs

    train = tmp_path / "train"
    train.mkdir()
    for seat, spec in placeholder_specs().items():
        real = dict(spec)
        real["spec_id"] = f"{seat}_real"
        real["spec_version"] = "spec_v1"
        (train / f"{seat}_real.json").write_text(json.dumps(real))
    # A file that is not a spec must be skipped, not crash the load.
    (train / "not_a_spec.json").write_text(json.dumps({"title": "exemplar card schema"}))

    monkeypatch.setenv("PANOPTES_SPECS_DIR", str(tmp_path))
    pool = load_pool()
    assert set(pool) == set(SEATS)
    for seat, spec in pool.items():
        assert spec["spec_version"] != PLACEHOLDER_SPEC_VERSION, f"{seat} kept its placeholder"
        assert spec["spec_id"] == f"{seat}_real"

    # An explicit seat assignment still wins, and an unknown spec_id falls back.
    assigned = load_pool({"nsc": "nsc_real", "norway": "no_such_spec"})
    assert assigned["nsc"]["spec_id"] == "nsc_real"
    assert assigned["norway"]["spec_version"] == PLACEHOLDER_SPEC_VERSION


def test_a_scenario_file_drives_an_episode_end_to_end(tmp_path) -> None:
    """`--replay <file>`: injects fire on schedule and ground truth reaches the
    reveal without ever reaching a seat.
    """
    import json

    from conftest import make_config, run

    scenario = {
        "replay_id": "test_scenario_file",
        "replay_version": "v1",
        "kind": "devset",
        "duration_s": 8 * 3600,
        "injects": [
            {
                "inject_id": "t-000",
                "sim_time_s": 1800,
                "recipients": ["all"],
                "content": "A test bulletin that every seat can see.",
                "confidence": 0.8,
                "source": "test harness",
            },
            {
                "inject_id": "t-001",
                "sim_time_s": 7200,
                "recipients": ["usspacecom"],
                "content": "A restricted finding only one seat receives.",
                "confidence": 0.6,
                "source": "test harness",
                "truthful": False,
            },
        ],
        "ground_truth": {
            "cause": "hostile_jam",
            "responsible_actor": "northern_fleet",
            "attribution_time_s": 14400,
            "real_responses": {"usspacecom": "share_telemetry"},
            "notes": "Synthetic scenario for the engine's own tests.",
        },
    }
    path = tmp_path / "scenario.json"
    path.write_text(json.dumps(scenario))

    episode = run(make_config(replay_file=str(path), scenario_id="test_scenario_file"))
    fired = {
        line["payload"]["inject_id"]
        for line in episode.log.lines
        if line["type"] == "inject" and str(line["payload"]["inject_id"]).startswith("t-")
    }
    assert fired == {"t-000", "t-001"}

    only_one = [
        line
        for line in episode.log.lines
        if line["type"] == "inject" and line["payload"]["inject_id"] == "t-001"
    ][0]
    assert only_one["payload"]["recipients"] == ["usspacecom"]

    # The file's ground truth drives the reveal...
    reveal = [
        line
        for line in episode.log.lines
        if line["type"] == "attribution_revealed" and "private_types" in line["payload"]
    ][-1]
    assert reveal["payload"]["cause"] == "hostile_jam"
    assert reveal["payload"]["responsible_actor"] == "northern_fleet"

    # ...and never reaches a seat's view, nor does the `truthful` scoring key.
    for seat in episode.seats.played:
        blob = json.dumps(episode.view(seat))
        assert "Synthetic scenario for the engine" not in blob
        assert "truthful" not in blob


def test_beliefs_and_reasoning_ride_along_on_action_lines() -> None:
    """agent7-ui asked for them so the log is self-sufficient for persona cards."""
    from conftest import make_config, run

    episode = run(make_config())
    actions = [line for line in episode.log.lines if line["type"] == "action"]
    assert actions
    for line in actions:
        beliefs = line["payload"]["beliefs"]
        assert set(beliefs) >= {"hostile", "natural", "unknown", "per_actor"}
        total = beliefs["hostile"] + beliefs["natural"] + beliefs["unknown"]
        assert abs(total - 1.0) < 0.011
        assert line["payload"]["reasoning"]


def test_initial_orbital_elements_are_in_the_log() -> None:
    """So a consumer can propagate its own arcs instead of copying engine.world."""
    from conftest import make_config, run

    episode = run(make_config())
    lines = [
        line
        for line in episode.log.lines
        if line["payload"].get("what") == "assets.initial_elements"
    ]
    assert len(lines) == 1
    elements = lines[0]["payload"]["value"]
    assert set(elements) == set(episode.world.all_asset_ids())
    # The line is the t=0 snapshot, so it must match `initial_state()` and NOT
    # the world at the end — a maneuver during the episode changes the orbit,
    # which is exactly why a consumer needs the starting elements plus the
    # maneuver action lines rather than a copy of the final state.
    from engine.world import initial_state

    start = initial_state()["assets"]
    for asset_id, entry in elements.items():
        if entry.get("orbit"):
            assert entry["orbit"]["a_km"] == start[asset_id]["orbit"]["a_km"]
            assert entry["orbit"]["e"] == start[asset_id]["orbit"]["e"]
    assert lines[0]["payload"]["mu_earth_km3_s2"] > 0
