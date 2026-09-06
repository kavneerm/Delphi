"""`python -m engine.run` — run one episode.

    python -m engine.run --seed 1 --storm G5 --stubs --hours 72
    python -m engine.run --seed 1 --storm G5 --stubs --clock checkpoint --schedule adaptive
    python -m engine.run --config contracts/examples/env_config_sweep_continuous_auto.json

Writes the event log to `logs/...` per `contracts/s3_layout.md` (local mirror by
default; `WARGAME_STORAGE=s3` sends it to the bucket) and prints the key.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from engine import ENV_VERSION
from engine.config import STANDARD_EPISODE_S, EnvConfig
from engine.episode import Episode
from engine.human_agent import ExternalDecisionChannel, HumanAgent, ScriptedChannel
from engine.stubs import STUB_POLICIES, build_stubs

__all__ = ["build_config", "main", "run_episode"]


def build_config(args: argparse.Namespace) -> EnvConfig:
    if args.config:
        raw: dict[str, Any] = json.loads(Path(args.config).read_text())
    else:
        raw = {}
    raw.setdefault("env_version", ENV_VERSION)
    raw["seed"] = args.seed
    raw["duration_s"] = int(round(args.hours * 3600)) if args.hours else STANDARD_EPISODE_S
    if args.scenario:
        raw["scenario_id"] = args.scenario
    if args.replay:
        raw["replay_file"] = args.replay

    if args.clock == "continuous":
        raw["clock_mode"] = {"mode": "continuous", "tick_s": args.tick_s}
    else:
        clock: dict[str, Any] = {
            "mode": "checkpoint",
            "schedule_type": args.schedule,
            "seal_decisions": True,
        }
        if args.schedule == "fixed":
            clock["interval_s"] = args.interval_s
        elif args.schedule == "variable_tempo":
            duration = int(raw["duration_s"])
            # Tempo tightens around the knife inject at ~14h and loosens after.
            times = [
                t for t in (3, 7, 11, 13, 14, 15, 17, 20, 26, 34, 44, 56, 68) if t * 3600 < duration
            ]
            clock["checkpoints_s"] = [t * 3600 for t in times] or [duration // 2]
        else:
            clock["interval_s"] = args.interval_s
            clock["adaptive_triggers"] = ["inject", "non_hold_action", "release_pending"]
            clock["min_interval_s"] = args.min_interval_s
            clock["max_interval_s"] = args.max_interval_s
        raw["clock_mode"] = clock

    if args.release == "auto":
        raw["release_policy"] = {
            "policy": "auto",
            "approval_probability": args.approval_probability,
            "per_action_probability": {
                "kinetic": 0.02,
                "terrestrial_response": 0.05,
                "counter_rpo": 0.25,
            },
            "delay_minutes": args.release_delay_minutes,
        }
    else:
        raw["release_policy"] = {
            "policy": "human",
            "pause_clock": True,
            "on_timeout": "deny",
            "route_to_seat": "nsc",
        }

    storm = dict(raw.get("storm") or {})
    if args.storm:
        storm["severity"] = args.storm
    storm.setdefault("profile", args.storm_profile or "synthetic")
    storm.setdefault("onset_sim_time_s", 0)
    raw["storm"] = storm
    return EnvConfig.from_dict(raw)


def run_episode(
    config: EnvConfig,
    *,
    stub_policy: str | dict[str, str] = "aggressive",
    validate_lines: bool = True,
    human_seat: str | None = None,
    channel: ExternalDecisionChannel | None = None,
) -> Episode:
    """One stub-driven episode. No model is called anywhere in this path.

    `human_seat` puts a person at that seat (default `nsc`), with the stubs
    filling everything else. The episode still replays: the human's answers are
    the only external input, and the clock does not move while they are being
    waited for.
    """

    def factory(episode: Episode) -> dict[str, Any]:
        agents: dict[str, Any] = build_stubs(episode.specs, episode.rng, policy=stub_policy)
        if human_seat and human_seat in agents:
            timeout = config.release_policy.get("timeout_s")
            agents[human_seat] = HumanAgent(
                human_seat,
                episode.specs[human_seat],
                channel if channel is not None else ScriptedChannel(),
                timeout_s=float(timeout) if timeout else None,
                on_timeout=str(config.release_policy.get("on_timeout") or "deny"),
                fallback=agents[human_seat],
            )
        return agents

    descriptor: dict[str, Any] = {"kind": "stubs", "policy": stub_policy}
    if human_seat:
        # A human-played episode is not reproducible by re-running the stubs,
        # so replay must drive it from the recorded decisions instead.
        descriptor = {"kind": "human", "policy": stub_policy, "human_seat": human_seat}
    episode = Episode(
        config,
        agent_factory=factory,
        validate_lines=validate_lines,
        agents_descriptor=descriptor,
    )
    episode.run()
    return episode


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="engine.run", description="Run one wargame episode.")
    parser.add_argument("--seed", type=int, default=1)
    parser.add_argument("--hours", type=float, default=72.0)
    parser.add_argument("--storm", default="G5", help="quiet|G1..G5|carrington")
    parser.add_argument(
        "--storm-profile",
        dest="storm_profile",
        default=None,
        help="profile name in calib/storm_effects.csv, e.g. may2024",
    )
    parser.add_argument("--stubs", action="store_true", help="run with scripted agents")
    parser.add_argument("--stub-policy", default="aggressive", choices=list(STUB_POLICIES))
    parser.add_argument("--clock", default="continuous", choices=["continuous", "checkpoint"])
    parser.add_argument(
        "--schedule", default="fixed", choices=["fixed", "variable_tempo", "adaptive"]
    )
    parser.add_argument("--interval-s", dest="interval_s", type=int, default=10800)
    parser.add_argument("--min-interval-s", dest="min_interval_s", type=int, default=1800)
    parser.add_argument("--max-interval-s", dest="max_interval_s", type=int, default=21600)
    parser.add_argument("--tick-s", dest="tick_s", type=int, default=60)
    parser.add_argument("--release", default="auto", choices=["auto", "human"])
    parser.add_argument(
        "--human-seat",
        dest="human_seat",
        default=None,
        help="seat a human operator here (nsc by default under --release human)",
    )
    parser.add_argument(
        "--approval-probability", dest="approval_probability", type=float, default=0.6
    )
    parser.add_argument(
        "--release-delay-minutes", dest="release_delay_minutes", type=float, default=0.0
    )
    parser.add_argument("--scenario", default=None)
    parser.add_argument("--replay", default=None, help="an inject_schema file to run")
    parser.add_argument("--config", default=None, help="an env_config_schema file")
    parser.add_argument("--out", default=None, help="also write the log to this local path")
    parser.add_argument("--no-publish", action="store_true", help="skip the logs/ write")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)

    if not args.stubs:
        parser.error("--stubs is required: engine.run drives scripted agents and calls no model")

    config = build_config(args)
    human_seat = args.human_seat
    if args.release == "human" and human_seat is None:
        human_seat = "nsc"
    episode = run_episode(config, stub_policy=args.stub_policy, human_seat=human_seat)

    if args.out:
        episode.log.write_local(args.out)
    uri = "" if args.no_publish else episode.log.publish()

    if not args.quiet:
        end = episode.log.lines[-1]["payload"]
        print(f"episode_id      {episode.episode_id}")
        print(f"clock_mode      {config.mode} / release_policy {config.policy}")
        if human_seat:
            print(f"human seat      {human_seat} (scripted channel; no operator attached)")
        print(f"seed            {config.seed}   env_version {config.env_version}")
        print(f"log lines       {len(episode.log.lines)}")
        print(f"decisions       {end['decision_count']}")
        print(
            f"storm           {end['storm']['severity']} profile {end['storm']['profile']}"
            f"{'  [TODO_CALIB placeholder]' if end['storm']['placeholder_calibration'] else ''}"
        )
        print(f"safe modes      {end['storm']['safe_mode_entries']}")
        print(f"tracking hours  {end['storm']['tracking_degraded_hours']}")
        print(f"screening hours {end['storm']['screening_suspended_hours']}")
        print(
            "utilities       "
            + ", ".join(f"{seat}={value:+.3f}" for seat, value in sorted(end["utilities"].items()))
        )
        if uri:
            print(f"log             {uri}")
        if args.out:
            print(f"local copy      {args.out}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
