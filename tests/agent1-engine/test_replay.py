"""Replay determinism: the claim the whole engine rests on."""

from __future__ import annotations

import pytest
from conftest import make_config, run

from engine.log import equal_ignoring_wall_time, replay_diff
from engine.replay import config_from_log, replay_log

CHECKPOINT_MODES = [
    {"mode": "checkpoint", "schedule_type": "fixed", "interval_s": 3600, "seal_decisions": True},
    {
        "mode": "checkpoint",
        "schedule_type": "variable_tempo",
        "checkpoints_s": [3600, 7200, 9000, 10800, 18000, 25200],
        "seal_decisions": True,
    },
    {
        "mode": "checkpoint",
        "schedule_type": "adaptive",
        "interval_s": 7200,
        "adaptive_triggers": ["inject", "non_hold_action", "release_pending"],
        "min_interval_s": 1800,
        "max_interval_s": 14400,
        "seal_decisions": True,
    },
]


def test_same_seed_produces_identical_logs(tmp_path) -> None:
    first = run(make_config())
    second = run(make_config())
    assert equal_ignoring_wall_time(first.log.lines, second.log.lines), replay_diff(
        first.log.lines, second.log.lines
    )


def test_different_seed_produces_a_different_log() -> None:
    a = run(make_config(seed=7))
    b = run(make_config(seed=8))
    assert not equal_ignoring_wall_time(a.log.lines, b.log.lines)


def test_replay_reproduces_a_continuous_episode(tmp_path) -> None:
    episode = run(make_config())
    path = tmp_path / "episode.jsonl"
    episode.log.write_local(path)
    replayed, original, mode = replay_log(str(path))
    assert mode == "rerun"
    assert not replay_diff(original, replayed.lines)


@pytest.mark.parametrize("clock", CHECKPOINT_MODES, ids=["fixed", "variable_tempo", "adaptive"])
def test_replay_reproduces_every_checkpoint_schedule(tmp_path, clock) -> None:
    episode = run(make_config(clock_mode=clock))
    path = tmp_path / "episode.jsonl"
    episode.log.write_local(path)
    replayed, original, _ = replay_log(str(path))
    assert not replay_diff(original, replayed.lines)


def test_replay_reproduces_a_human_played_episode(tmp_path) -> None:
    """A human episode replays from the log, since the person cannot be re-run."""
    from engine.human_agent import ScriptedChannel
    from engine.run import run_episode

    config = make_config(
        release_policy={
            "policy": "human",
            "pause_clock": True,
            "on_timeout": "deny",
            "route_to_seat": "nsc",
        },
        clock_mode={
            "mode": "checkpoint",
            "schedule_type": "fixed",
            "interval_s": 3600,
            "seal_decisions": True,
        },
    )
    episode = run_episode(
        config,
        human_seat="nsc",
        channel=ScriptedChannel(releases=[True, False, True], default_release=False),
    )
    path = tmp_path / "human.jsonl"
    episode.log.write_local(path)
    replayed, original, mode = replay_log(str(path))
    assert mode == "logged"
    # The world evolves identically; the seats' actions come back off the log.
    original_actions = [
        (line["sim_time_s"], line["seat"], line["payload"]["action"]["type"])
        for line in original
        if line["type"] == "action"
    ]
    replayed_actions = [
        (line["sim_time_s"], line["seat"], line["payload"]["action"]["type"])
        for line in replayed.lines
        if line["type"] == "action"
    ]
    assert replayed_actions == original_actions


def test_log_carries_the_config_replay_rebuilds_from() -> None:
    episode = run(make_config())
    config, descriptor, episode_id = config_from_log(episode.log.lines)
    assert config.seed == episode.config.seed
    assert config.mode == episode.config.mode
    assert config.policy == episode.config.policy
    assert descriptor["kind"] == "stubs"
    assert episode_id == episode.episode_id


def test_wall_time_is_the_only_field_excluded_from_comparison() -> None:
    a = run(make_config())
    b = run(make_config())
    assert [line["wall_time"] for line in a.log.lines] != [
        line["wall_time"] for line in b.log.lines
    ], "wall_time should differ between runs; that is why it is excluded"
    assert equal_ignoring_wall_time(a.log.lines, b.log.lines)
