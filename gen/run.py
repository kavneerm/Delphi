"""Run frontier-model episodes for the lake or the ten-episode cost check."""

from __future__ import annotations

import argparse
import asyncio
import dataclasses
import random
from typing import Any

from engine.config import EnvConfig
from engine.episode import Episode
from gen.agent import GenAgent
from gen.config import GenConfig
from gen.contracts import validation_errors, validator
from gen.keys import episode_records_key, run_summary_key
from gen.llm import LLMClient
from gen.specs import seat_assignment_pool
from infra.storage import Storage, Versions

FULL_EPISODES = 36
FULL_DECISIONS_PER_EPISODE = 1008
FULL_BUDGET_CAP_USD = 1500.0


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


def full_episode_config(config: GenConfig, seed: int) -> EnvConfig:
    """One production 72-hour continuous-clock episode.

    The continuous clock produces 1,008 decisions with the approved nine-seat
    persona clocks.  Thirty-six episodes therefore make a 36,288-record initial
    lake: inside Agent 3's 30–50k definition-of-done range while retaining a
    conservative $1.5k ceiling derived from the live Terra probe.
    """
    grouped = seat_assignment_pool(config.specs_root)
    chooser = random.Random(seed)
    assignment = {
        seat: chooser.choice(specs)["spec_id"] for seat, specs in sorted(grouped.items()) if specs
    }
    return EnvConfig.from_dict(
        {
            "env_version": config.env_version,
            "spec_version": config.spec_version,
            "seed": seed,
            "duration_s": 72 * 3600,
            "scenario_id": "lake_v1_continuous",
            "seats": assignment,
            "clock_mode": {"mode": "continuous", "tick_s": 60},
            "release_policy": {"policy": "auto", "approval_probability": 0.5},
            "storm": {"profile": "may2024", "severity": "G5", "onset_sim_time_s": 0},
        }
    )


def records_for(episode: Episode, config: GenConfig) -> list[dict[str, Any]]:
    """Turn engine-owned decision snapshots into contract-valid lake records."""
    telemetry = {
        seat: iter(getattr(agent, "telemetry", [])) for seat, agent in episode.agents.items()
    }
    records: list[dict[str, Any]] = []
    for decision in episode.decision_records:
        seat = str(decision["seat"])
        item = next(telemetry[seat], None)
        if item is None:
            raise RuntimeError(f"missing generation telemetry for {episode.episode_id}/{seat}")
        record = {
            "record_id": f"{episode.episode_id}-{seat}-{int(decision['sim_time_s'])}",
            "lake_version": config.lake_version,
            "spec_id": episode.specs[seat]["spec_id"],
            "spec_version": config.spec_version,
            "env_version": config.env_version,
            "seed": episode.config.seed,
            "episode_id": episode.episode_id,
            "seat": seat,
            "sim_time_s": decision["sim_time_s"],
            "filtered_state": decision["filtered_state"],
            "injects_seen": decision["injects_seen"],
            "messages_seen": decision["messages_seen"],
            "output": decision["output"],
            "outcome_utility": episode.utilities.get(seat),
            "judge_scores": None,
            "pair_id": None,
            "scenario_id": episode.config.scenario_id,
            "gen_model": item.gen_model or config.model,
            "gen_source": "frontier",
            "prompt_version": item.prompt_version,
            "judge_version": config.judge_version,
            "schema_retries": item.schema_retries,
            "tokens": item.tokens,
            "clock_mode": episode.config.mode,
            "release_policy": episode.config.policy,
            "release_outcome": "not_required",
        }
        errors = validation_errors(validator("lake_record_schema.json"), record)
        if errors:
            raise ValueError(f"invalid lake record {record['record_id']}: {errors[:3]}")
        records.append(record)
    return records


def write_episode(episode: Episode, config: GenConfig, store: Storage) -> str:
    """Persist an episode's immutable decision records and its replayable event log."""
    records = records_for(episode, config)
    versions = Versions(
        env_version=config.env_version,
        spec_version=config.spec_version,
        lake_version=config.lake_version,
        seed=episode.config.seed,
        episode_id=episode.episode_id,
    )
    key = episode_records_key(
        config.lake_version,
        config.env_version,
        config.spec_version,
        episode.config.scenario_id,
        episode.config.seed,
        episode.episode_id,
    )
    store.put_jsonl(
        key,
        records,
        versions=versions,
        require=("env_version", "spec_version", "lake_version", "episode_id"),
    )
    episode.log.publish()
    return key


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


async def run_full(config: GenConfig, episodes: int = FULL_EPISODES) -> dict[str, Any]:
    """Generate the budget-capped initial lake, stopping only at episode boundaries.

    Eight calls are in flight at most.  This stays well below the organization
    TPM ceiling observed during the earlier 10-way burst, while the fixed episode
    count is conservative even if prompt caching vanishes.
    """
    if episodes != FULL_EPISODES:
        raise ValueError(f"full run is budget-capped at exactly {FULL_EPISODES} episodes")
    if not config.approved():
        raise PermissionError("create gen/APPROVED after the human generation gate")
    config = dataclasses.replace(config, concurrency=min(config.concurrency, 8))
    loop = asyncio.get_running_loop()
    client = LLMClient(config)
    store = Storage.from_env()

    def one(seed: int) -> Episode:
        cfg = full_episode_config(config, seed)

        def factory(episode: Episode) -> dict[str, GenAgent]:
            return {
                seat: GenAgent(
                    seat,
                    spec,
                    config=config,
                    client=client,
                    loop=loop,
                    episode_id=episode.episode_id,
                )
                for seat, spec in episode.specs.items()
            }

        episode = Episode(
            cfg,
            agent_factory=factory,
            agents_descriptor={"kind": "frontier", "model": config.model},
        )
        episode.run()
        return episode

    try:
        keys: list[str] = []
        for seed in range(1, episodes + 1):
            episode = await asyncio.to_thread(one, seed)
            keys.append(write_episode(episode, config, store))
            usage = client.usage.as_dict()
            print(
                {
                    "episode": seed,
                    "records": len(episode.decision_records),
                    "calls": usage["calls"],
                    "usage": usage,
                },
                flush=True,
            )
        summary = {
            "episodes": episodes,
            "expected_decisions": episodes * FULL_DECISIONS_PER_EPISODE,
            "keys": keys,
            "usage": client.usage.as_dict(),
            "budget_cap_usd": FULL_BUDGET_CAP_USD,
        }
        store.put_json(
            run_summary_key(config.lake_version, "initial-36-episodes"),
            summary,
            versions=Versions(
                env_version=config.env_version,
                spec_version=config.spec_version,
                lake_version=config.lake_version,
            ),
            require=("env_version", "spec_version", "lake_version"),
        )
        return summary
    finally:
        await client.aclose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cost-check", action="store_true")
    parser.add_argument("--full", action="store_true", help="run the human-approved initial lake")
    parser.add_argument("--episodes", type=int, default=10)
    args = parser.parse_args(argv)
    if args.cost_check == args.full:
        parser.error("pass exactly one of --cost-check or --full")
    if args.cost_check:
        if args.episodes != 10:
            parser.error("the human gate requires exactly ten episodes")
        print(asyncio.run(run_cost_check(GenConfig(), args.episodes)))
    else:
        if args.episodes != FULL_EPISODES:
            parser.error(f"the $1.5k budget cap permits exactly {FULL_EPISODES} episodes")
        print(asyncio.run(run_full(GenConfig(), args.episodes)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
