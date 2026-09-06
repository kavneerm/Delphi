"""The release cycle, under both policies.

`contracts/env_config_schema.json`: both policies emit `release_requested` and
then `release_granted` or `release_denied`, sharing a `release_id`. Nothing
downstream may tell them apart by shape.
"""

from __future__ import annotations

from conftest import make_config, run

from engine.contracts import IRREVERSIBLE
from engine.human_agent import ScriptedChannel
from engine.run import run_episode

AUTO = {"policy": "auto", "approval_probability": 0.5}
HUMAN = {"policy": "human", "pause_clock": True, "on_timeout": "deny", "route_to_seat": "nsc"}


def _cycle(lines: list[dict]) -> dict[str, list[dict]]:
    by_id: dict[str, list[dict]] = {}
    for line in lines:
        if line["type"].startswith("release_"):
            by_id.setdefault(line["payload"]["release_id"], []).append(line)
    return by_id


def test_auto_release_emits_a_complete_cycle() -> None:
    episode = run(make_config(release_policy=AUTO))
    cycles = _cycle(episode.log.lines)
    assert cycles, "the stub run must produce at least one release request"
    for release_id, lines in cycles.items():
        kinds = [line["type"] for line in lines]
        assert kinds[0] == "release_requested"
        assert len(kinds) == 2
        assert kinds[1] in ("release_granted", "release_denied")
        assert all(line["payload"]["release_id"] == release_id for line in lines)
        answer = lines[1]["payload"]
        assert answer["decided_by"] == "auto"
        assert 0.0 <= answer["approval_probability"] <= 1.0


def test_human_release_emits_the_same_cycle_with_a_different_decider() -> None:
    episode = run_episode(
        make_config(
            release_policy=HUMAN,
            clock_mode={
                "mode": "checkpoint",
                "schedule_type": "fixed",
                "interval_s": 3600,
                "seal_decisions": True,
            },
        ),
        human_seat="nsc",
        channel=ScriptedChannel(releases=[True, False], default_release=False),
    )
    cycles = _cycle(episode.log.lines)
    assert cycles
    for lines in cycles.values():
        assert [line["type"] for line in lines][0] == "release_requested"
        assert lines[1]["payload"]["decided_by"] in ("human", "model")
    # The shape is identical to auto: same two event types, same join key.
    assert {line["type"] for line in episode.log.lines if line["type"].startswith("release_")} <= {
        "release_requested",
        "release_granted",
        "release_denied",
    }


def test_a_granted_release_lets_the_action_land_and_a_denied_one_blocks_it() -> None:
    episode = run(make_config(release_policy={"policy": "auto", "approval_probability": 0.5}))
    outcomes = {
        line["payload"]["release_id"]: line["type"]
        for line in episode.log.lines
        if line["type"] in ("release_granted", "release_denied")
    }
    actions = {
        line["payload"]["release_id"]: line["payload"]
        for line in episode.log.lines
        if line["type"] == "action" and line["payload"].get("release_id")
    }
    assert actions, "released actions must appear as action lines"
    for release_id, payload in actions.items():
        if outcomes.get(release_id) == "release_denied":
            assert payload.get("blocked") is True
            assert payload.get("blocked_reason") == "release_denied"
        else:
            assert not payload.get("blocked")


def test_every_irreversible_action_goes_through_release_regardless_of_spec() -> None:
    """contracts: irreversible actions need release whatever the spec says."""
    episode = run(make_config())
    for seat in episode.seats.played:
        for action_type in IRREVERSIBLE:
            assert episode._needs_release(seat, action_type)


def test_no_release_is_ever_answered_twice() -> None:
    episode = run(make_config())
    answers: dict[str, int] = {}
    for line in episode.log.lines:
        if line["type"] in ("release_granted", "release_denied"):
            answers[line["payload"]["release_id"]] = (
                answers.get(line["payload"]["release_id"], 0) + 1
            )
    assert all(count == 1 for count in answers.values())


def test_zero_approval_probability_denies_everything() -> None:
    episode = run(make_config(release_policy={"policy": "auto", "approval_probability": 0.0}))
    granted = [line for line in episode.log.lines if line["type"] == "release_granted"]
    denied = [line for line in episode.log.lines if line["type"] == "release_denied"]
    assert not granted
    assert denied, "p=0 is a legitimate configuration and must still produce the cycle"


def test_per_action_probability_overrides_the_default() -> None:
    episode = run(
        make_config(
            release_policy={
                "policy": "auto",
                "approval_probability": 1.0,
                "per_action_probability": {"kinetic": 0.0, "counter_rpo": 0.0},
            }
        )
    )
    requests = {
        line["payload"]["release_id"]: line["payload"]["action"]["type"]
        for line in episode.log.lines
        if line["type"] == "release_requested"
    }
    for line in episode.log.lines:
        if line["type"] not in ("release_granted", "release_denied"):
            continue
        action_type = requests[line["payload"]["release_id"]]
        if action_type in ("kinetic", "counter_rpo"):
            assert line["type"] == "release_denied"
        else:
            assert line["type"] == "release_granted"
