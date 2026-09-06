"""Shared fixtures for the engine tests."""

from __future__ import annotations

from typing import Any

import pytest

from engine.config import EnvConfig
from engine.episode import Episode
from engine.stubs import build_stubs

SHORT_HOURS = 8


def make_config(**overrides: Any) -> EnvConfig:
    """A small, fast, fully specified episode."""
    raw: dict[str, Any] = {
        "env_version": "env_v1",
        "seed": 7,
        "duration_s": SHORT_HOURS * 3600,
        "scenario_id": "test_scenario",
        "clock_mode": {"mode": "continuous", "tick_s": 60},
        "release_policy": {"policy": "auto", "approval_probability": 0.5},
        "storm": {"profile": "synthetic", "severity": "G5", "onset_sim_time_s": 0},
        "hacktivist_injects": {
            "enabled": True,
            "affiliation_weights": {
                "russian_directed": 0.3,
                "freelance": 0.5,
                "opportunistic": 0.2,
            },
            "claim_rate_per_hour": 0.3,
            "true_claim_probability": 0.4,
        },
    }
    raw.update(overrides)
    return EnvConfig.from_dict(raw)


def run(config: EnvConfig, policy: str = "aggressive") -> Episode:
    def factory(episode: Episode) -> dict[str, Any]:
        return build_stubs(episode.specs, episode.rng, policy=policy)

    episode = Episode(
        config,
        agent_factory=factory,
        agents_descriptor={"kind": "stubs", "policy": policy},
    )
    episode.run()
    return episode


@pytest.fixture(scope="module")
def continuous_episode() -> Episode:
    return run(make_config())


@pytest.fixture(scope="module")
def checkpoint_episode() -> Episode:
    return run(
        make_config(
            clock_mode={
                "mode": "checkpoint",
                "schedule_type": "fixed",
                "interval_s": 3600,
                "seal_decisions": True,
            }
        )
    )
