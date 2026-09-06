"""Run frontier-model episodes for the lake or the ten-episode cost check."""

from __future__ import annotations

import argparse
import asyncio
from typing import Any

from engine.config import EnvConfig
from engine.episode import Episode
from gen.agent import GenAgent
from gen.config import GenConfig
from gen.llm import LLMClient


def episode_config(config: GenConfig, seed: int, *, cost_check: bool) -> EnvConfig:
    """A representative, sealed 72-hour episode with deterministic auto release."""
    return EnvConfig.from_dict(
        {
            "env_version": config.env_version,
            "spec_version": config.spec_version,
            "seed": seed,
            "duration_s": 72 * 3600,
            "scenario_id": f"cost_check_{seed}" if cost_check else f"generation_{seed}",
            "clock_mode": {
                "mode": "checkpoint",
                "schedule_type": "fixed",
                # The live cost gate samples one sealed decision from each seat;
                # a full 72-hour episode would synchronize thousands of costly
                # prompts and measure rate-limit behavior, not token economics.
                "interval_s": 72 * 3600 + 1,
                "seal_decisions": True,
            },
            "release_policy": {"policy": "auto", "approval_probability": 0.5},
            "storm": {"profile": "may2024", "severity": "G5", "onset_sim_time_s": 0},
        }
    )


async def run_cost_check(config: GenConfig, episodes: int) -> dict[str, Any]:
    """Run ten real episodes and return provider-reported token usage."""
    loop = asyncio.get_running_loop()
    client = LLMClient(config)

    def one(seed: int) -> Episode:
        cfg = episode_config(config, seed, cost_check=True)

        def factory(episode: Episode) -> dict[str, GenAgent]:
            return {
                seat: GenAgent(
                    seat,
                    spec,
                    config=config,
                    client=client,
                    loop=loop,
                    episode_id=episode.episode_id,
                    checkpoint_index=lambda: episode._checkpoint_index,
                )
                for seat, spec in episode.specs.items()
            }

        episode = Episode(cfg, agent_factory=factory, agents_descriptor={"kind": "frontier"})
        episode.run()
        return episode

    try:
        # Sequential episodes keep the ten-seat burst below the org TPM limit.
        completed = []
        for seed in range(1, episodes + 1):
            completed.append(await asyncio.to_thread(one, seed))
        usage = client.usage.as_dict()
        usage["episodes"] = len(completed)
        usage["decisions"] = sum(len(episode.decision_records) for episode in completed)
        return usage
    finally:
        await client.aclose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cost-check", action="store_true")
    parser.add_argument("--episodes", type=int, default=10)
    args = parser.parse_args(argv)
    if not args.cost_check:
        parser.error("only --cost-check is enabled until human approval of the full lake")
    if args.episodes != 10:
        parser.error("the human gate requires exactly ten episodes")
    print(asyncio.run(run_cost_check(GenConfig(), args.episodes)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
