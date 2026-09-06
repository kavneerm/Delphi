"""Run frontier-model episodes for the lake or the ten-episode cost check."""

from __future__ import annotations

import argparse
import asyncio
import dataclasses
import random
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from typing import Any

from engine.config import EnvConfig
from engine.episode import Episode
from gen.agent import GenAgent
from gen.config import GenConfig
from gen.contracts import validation_errors, validator
from gen.keys import episode_records_key, part_key, run_summary_key
from gen.llm import LLMClient
from gen.specs import seat_assignment_pool
from infra.storage import Storage, Versions

FULL_EPISODES = 36
FULL_DECISIONS_PER_EPISODE = 1008
FULL_BUDGET_CAP_USD = 1500.0
# Sixteen concurrent full-size structured-output requests can stall indefinitely
# in the current client/provider path (verified 2026-09-06: no socket activity
# and all bridges blocked). Eight completes through the same bridge and retains
# substantial TPM headroom, so use the fastest setting that is actually proven.
FULL_CONCURRENCY = 8
ADAPTED_EPISODE_S = 54 * 3600
GRID_SEVERITIES = ("quiet", "G1", "G3", "G5")


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


def full_episode_config(
    config: GenConfig, seed: int, *, duration_s: int = ADAPTED_EPISODE_S
) -> EnvConfig:
    """One production continuous-clock episode from the balanced Red/storm grid.

    The continuous clock reads each selected persona's own poll interval and
    keeps wake-on-inject enabled. New work is 54 simulated hours; existing
    in-flight 72-hour episodes are not reconstructed or shortened.
    """
    grouped = seat_assignment_pool(config.specs_root)
    chooser = random.Random(seed)
    assignment = {
        seat: chooser.choice(specs)["spec_id"] for seat, specs in sorted(grouped.items()) if specs
    }
    # The Red type belongs to Northern Fleet; the independent Red psyche belongs
    # to Kremlin. Cycling their real, approved persona cards is a grid over both
    # axes without synthesising or editing a spec. A 3×3×4 grid is 36 cells.
    fleet = sorted(grouped["northern_fleet"], key=lambda spec: str(spec["private_type"]))
    kremlin = sorted(grouped["kremlin"], key=lambda spec: str(spec["psyche"]))
    cell = seed - 1
    fleet_spec = fleet[cell % len(fleet)]
    psyche_spec = kremlin[(cell // len(fleet)) % len(kremlin)]
    severity = GRID_SEVERITIES[(cell // (len(fleet) * len(kremlin))) % len(GRID_SEVERITIES)]
    assignment["northern_fleet"] = str(fleet_spec["spec_id"])
    assignment["kremlin"] = str(psyche_spec["spec_id"])
    scenario_id = (
        f"lake_grid_{severity.lower()}_{fleet_spec['private_type']}_{psyche_spec['psyche']}"
    )
    return EnvConfig.from_dict(
        {
            "env_version": config.env_version,
            "spec_version": config.spec_version,
            "seed": seed,
            "duration_s": duration_s,
            "scenario_id": scenario_id,
            "seats": assignment,
            "clock_mode": {"mode": "continuous", "tick_s": 60},
            "release_policy": {"policy": "auto", "approval_probability": 0.5},
            "storm": {"profile": "may2024", "severity": severity, "onset_sim_time_s": 0},
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
            "grid_cell": {
                "storm_severity": episode.config.storm.get("severity", ""),
                "red_private_type": episode.specs["northern_fleet"].get("private_type", ""),
                "red_psyche": episode.specs["kremlin"].get("psyche", ""),
                "synthetic_hold": item.synthetic_hold,
                "view_hash": item.view_hash,
            },
        }
        errors = validation_errors(validator("lake_record_schema.json"), record)
        if errors:
            raise ValueError(f"invalid lake record {record['record_id']}: {errors[:3]}")
        records.append(record)
    return records


def streaming_sink(
    *,
    episode: Episode,
    config: GenConfig,
    store: Storage,
) -> Callable[[Any, Mapping[str, Any], Mapping[str, Any]], None]:
    """Durably flush an unfinalised decision part immediately after it is chosen.

    The contract's immutable `.jsonl` records require final episode utility, so
    they close at episode end. These `.json` parts are deliberately outside the
    record prefix: they give progress visibility and survive an interrupted batch
    without letting a consumer train on an incomplete outcome.
    """
    versions = Versions(
        env_version=config.env_version,
        spec_version=config.spec_version,
        lake_version=config.lake_version,
        seed=episode.config.seed,
        episode_id=episode.episode_id,
    )

    def sink(item: Any, view: Mapping[str, Any], output: Mapping[str, Any]) -> None:
        record_id = f"{episode.episode_id}-{item.seat}-{int(item.sim_time_s)}"
        payload = {
            "record_id": record_id,
            "episode_id": episode.episode_id,
            "seed": episode.config.seed,
            "seat": item.seat,
            "sim_time_s": item.sim_time_s,
            "filtered_state": dict(view),
            "output": dict(output),
            "synthetic_hold": bool(item.synthetic_hold),
            "view_hash": item.view_hash,
            "tokens": item.tokens,
            "written_at_utc": datetime.now(UTC).isoformat(timespec="seconds"),
            "grid_cell": {
                "storm_severity": episode.config.storm.get("severity", ""),
                "red_private_type": episode.specs["northern_fleet"].get("private_type", ""),
                "red_psyche": episode.specs["kremlin"].get("psyche", ""),
            },
        }
        store.put_json(
            part_key(config.lake_version, episode.episode_id, item.decision_index, record_id),
            payload,
            versions=versions,
            require=("env_version", "spec_version", "lake_version", "episode_id"),
        )

    return sink


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
    """Run ten real episodes, persist each completed episode, and report usage.

    The cost gate uses sealed, sparse decision schedules, but the resulting
    episodes are still contract-valid and replayable.  Persisting immediately
    means an interrupted later episode cannot discard the completed ones.
    """
    loop = asyncio.get_running_loop()
    client = LLMClient(config)
    store = Storage.from_env()

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
        keys: list[str] = []
        for seed in range(1, episodes + 1):
            episode = await asyncio.to_thread(one, seed)
            completed.append(episode)
            key = write_episode(episode, config, store)
            keys.append(key)
            print(
                {
                    "episode": seed,
                    "records": len(episode.decision_records),
                    "lake_key": key,
                    "calls": client.usage.calls,
                },
                flush=True,
            )
        usage = client.usage.as_dict()
        usage["episodes"] = len(completed)
        usage["decisions"] = sum(len(episode.decision_records) for episode in completed)
        usage["keys"] = keys
        return usage
    finally:
        await client.aclose()


async def run_full(
    config: GenConfig, episodes: int = FULL_EPISODES, *, start_seed: int = 1
) -> dict[str, Any]:
    """Generate the budget-capped initial lake, stopping only at episode boundaries.

    Eight calls are in flight at most. This stays below Luna's 2M TPM ceiling
    with the observed 12k-token prompt shape and avoids the observed 16-way
    full-prompt bridge stall, while the fixed episode count is conservative even
    if prompt caching vanishes.
    """
    if episodes < 1 or start_seed < 1 or start_seed + episodes - 1 > FULL_EPISODES:
        raise ValueError(f"run must stay inside the budget-capped seeds 1..{FULL_EPISODES}")
    if not config.approved():
        raise PermissionError("create gen/APPROVED after the human generation gate")
    config = dataclasses.replace(config, concurrency=min(config.concurrency, FULL_CONCURRENCY))
    loop = asyncio.get_running_loop()
    client = LLMClient(config)
    store = Storage.from_env()

    def one(seed: int) -> Episode:
        cfg = full_episode_config(config, seed)

        def factory(episode: Episode) -> dict[str, GenAgent]:
            sink = streaming_sink(episode=episode, config=config, store=store)
            return {
                seat: GenAgent(
                    seat,
                    spec,
                    config=config,
                    client=client,
                    loop=loop,
                    episode_id=episode.episode_id,
                    record_sink=sink,
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
        # Episode.run is synchronous, but each GenAgent hands its request back to
        # this event loop. A batch of eight worker threads therefore keeps eight
        # requests in flight (rather than accidentally serialising 1,008 calls per
        # episode), while the batch boundary is a safe, observable budget checkpoint.
        stop_seed = start_seed + episodes
        for first_seed in range(start_seed, stop_seed, config.concurrency):
            seeds = range(first_seed, min(first_seed + config.concurrency, stop_seed))
            batch = await asyncio.gather(*(asyncio.to_thread(one, seed) for seed in seeds))
            for episode in batch:
                keys.append(write_episode(episode, config, store))
                usage = client.usage.as_dict()
                print(
                    {
                        "episode": episode.config.seed,
                        "records": len(episode.decision_records),
                        "calls": usage["calls"],
                        "usage": usage,
                    },
                    flush=True,
                )
        summary = {
            "episodes": episodes,
            "start_seed": start_seed,
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
    parser.add_argument("--start-seed", type=int, default=1)
    args = parser.parse_args(argv)
    if args.cost_check == args.full:
        parser.error("pass exactly one of --cost-check or --full")
    if args.cost_check:
        if args.episodes != 10:
            parser.error("the human gate requires exactly ten episodes")
        print(asyncio.run(run_cost_check(GenConfig(), args.episodes)))
    else:
        print(asyncio.run(run_full(GenConfig(), args.episodes, start_seed=args.start_seed)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
