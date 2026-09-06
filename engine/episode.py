"""One episode, start to finish.

Owns the wiring: the loop drives the world, the storm, the attacks, the injects
and the seats, and every consequence goes through `engine/log.py`. Two axes
change the shape of the run and nothing else:

* **`clock_mode`** — `continuous` runs each seat on its own decision clock, so
  seats act on stale, unequal pictures; `checkpoint` wakes every seat together
  and collects sealed simultaneous decisions. Same log format, same lake
  records, same metrics. Nothing downstream may branch on which was used.
* **`release_policy`** — `human` routes every `requires_release` and every
  irreversible action to the NSC seat and pauses the clock; `auto` resolves it
  from a probability drawn off the episode seed. Both emit `release_requested`
  and then `release_granted` or `release_denied`, sharing a `release_id`.

The episode also carries what a lake record needs but the event log does not:
`decision_records` holds beliefs, reasoning and the exact filtered state each
decision was made on, so `gen/run.py` can write `lake_record`s without re-deriving
anything.
"""

from __future__ import annotations

import copy
import hashlib
import json
from collections.abc import Callable, Mapping
from typing import Any

from engine import CONTRACTS_VERSION
from engine.agent_api import coerce_decision
from engine.attacks import ATTACK_FOR_ACTION, AttackLayer, load_attribution_lags
from engine.config import EnvConfig
from engine.contracts import IRREVERSIBLE, RELEASING_SEAT, RUNG, SEATS, seat_can
from engine.injects import HacktivistInjects, RuleActors, load_replay, synthetic_timeline
from engine.log import EventLog
from engine.loop import EventLoop
from engine.rng import RngBook
from engine.seats import Seats
from engine.specs import load_pool
from engine.storm import StormLayer, load_profile
from engine.utility import SeatTally, episode_utilities
from engine.world import World

__all__ = ["Episode", "make_episode_id"]

MIN_WAKE_GAP_S = 1800


def make_episode_id(scenario_id: str, seed: int, config: Mapping[str, Any]) -> str:
    """`<scenario>-<seed>-<8 hex>`, deterministic so replay lands on the same id."""
    material = json.dumps(config, sort_keys=True, default=str)
    digest = hashlib.blake2b(material.encode(), digest_size=4).hexdigest()
    stem = (scenario_id or "adhoc").replace("_", "-")[:40]
    return f"{stem}-{seed}-{digest}"


class Episode:
    """A single run. Build it, call `run()`, read `log`."""

    def __init__(
        self,
        config: EnvConfig,
        *,
        agent_factory: Callable[[Episode], dict[str, Any]],
        episode_id: str | None = None,
        validate_lines: bool = True,
        agents_descriptor: dict[str, Any] | None = None,
    ) -> None:
        self.config = config
        self.params = config.params
        self.rng = RngBook(config.seed)
        self.episode_id = episode_id or make_episode_id(
            config.scenario_id, config.seed, config.to_dict()
        )
        self.agents_descriptor = agents_descriptor or {"kind": "external"}

        self.world = World(self.params)
        self.attacks = AttackLayer(load_attribution_lags())
        storm_cfg = config.storm
        profile = load_profile(
            str(storm_cfg.get("profile") or "synthetic"),
            str(storm_cfg.get("severity") or "G5"),
        )
        if storm_cfg.get("severity"):
            profile.severity = str(storm_cfg["severity"])
        self.storm = StormLayer(
            profile,
            onset_sim_time_s=float(storm_cfg.get("onset_sim_time_s") or 0.0),
            params=self.params,
        )
        self.specs = load_pool(config.seats)
        self.seats = Seats(self.specs, list(self.params["clearance_order"]))
        self.rule_actors = RuleActors(self.rng, self.params)
        self.hacktivist = HacktivistInjects(config.hacktivist, self.rng)
        self.tallies: dict[str, SeatTally] = {
            seat: SeatTally(seat=seat) for seat in self.seats.played
        }

        self.loop = EventLoop(
            seed=config.seed,
            end_time_s=config.duration_s,
            tick_s=config.tick_s,
            rng=self.rng,
        )
        self.loop.state = self
        self.log = EventLog(
            episode_id=self.episode_id,
            seed=config.seed,
            env_version=config.env_version,
            spec_version=config.spec_version,
            scenario_id=config.scenario_id,
            validate_lines=validate_lines,
        )

        self.agents: dict[str, Any] = agent_factory(self)
        for seat, agent in sorted(self.agents.items()):
            agent.bind(lambda seat=seat: self.view(seat))

        # --- scenario --------------------------------------------------------
        self.ground_truth: dict[str, Any] | None = None
        replay_file = config.replay_file
        if replay_file:
            self.injects, self.ground_truth = load_replay(replay_file)
        else:
            red_spec = self.specs.get("northern_fleet") or {}
            self.injects = synthetic_timeline(
                seed_rng=self.rng,
                duration_s=config.duration_s,
                severity=self.storm.severity,
                red_is_acting=str(red_spec.get("private_type")) == "action_under_cover",
            )

        # --- bookkeeping -----------------------------------------------------
        self.decision_records: list[dict[str, Any]] = []
        self.releases: list[dict[str, Any]] = []
        self._pending_actions: dict[str, dict[str, Any]] = {}
        self._decision_event: dict[str, int | None] = {seat: None for seat in self.seats.played}
        self._next_decision_s: dict[str, int] = {seat: 0 for seat in self.seats.played}
        self._counter = 0
        self._checkpoint_index = 0
        self._checkpoint_trigger = "schedule"
        self._media_level = 0.15
        self._insurer_fired = False
        self._finished = False
        self.initial_capacity_gbps = self.world.arctic_capacity_gbps()
        self.utilities: dict[str, float] = {}
        self.terms: dict[str, dict[str, float]] = {}
        self.end_reason = "time_limit"

        self.world.on_change(self._on_world_change)
        self._register_handlers()
        self._seed_schedule()

    # --- ids ------------------------------------------------------------------

    def _next(self, prefix: str) -> str:
        self._counter += 1
        return f"{prefix}-{self._counter:05d}"

    # --- wiring ---------------------------------------------------------------

    def _register_handlers(self) -> None:
        loop = self.loop
        loop.on("storm_update", self._handle_storm)
        loop.on("propagate", self._handle_propagate)
        loop.on("inject", self._handle_inject)
        loop.on("rule_actor", self._handle_rule_actor)
        loop.on("decision_point", self._handle_decision_point)
        loop.on("checkpoint", self._handle_checkpoint)
        loop.on("action_effect", self._handle_action_effect)
        loop.on("message_delivery", self._handle_message_delivery)
        loop.on("release_resolve", self._handle_release_resolve)
        loop.on("attack_expire", self._handle_attack_expire)
        loop.on("attribution_expire", self._handle_attribution_expire)
        loop.on("safe_mode_recover", self._handle_safe_mode_recover)
        loop.on("episode_end", self._handle_episode_end)

    def _seed_schedule(self) -> None:
        cfg = self.config
        loop = self.loop
        # The config itself goes in the log first: it is what replay rebuilds from.
        self.log.emit(
            sim_time_s=0,
            type="state_change",
            seat=None,
            payload={
                "what": "config.env",
                "value": cfg.to_dict(),
                "reason": "episode_start",
                "agents": self.agents_descriptor,
                "contracts_version": CONTRACTS_VERSION,
                "specs": {seat: spec.get("spec_id") for seat, spec in sorted(self.specs.items())},
            },
            clock_mode=cfg.mode,
            release_policy=cfg.policy,
        )
        # Initial orbital elements, so a consumer can propagate its own arcs
        # instead of interpolating 30-minute ground-track samples or keeping a
        # hand-copy of engine.world. agent7-ui asked; the log is now
        # self-sufficient for drawing the map.
        self.log.emit(
            sim_time_s=0,
            type="state_change",
            seat=None,
            payload={
                "what": "assets.initial_elements",
                "value": {
                    asset_id: {
                        "name": asset.get("name"),
                        "owner": asset.get("owner"),
                        "asset_class": asset.get("asset_class"),
                        "mission": asset.get("mission"),
                        "orbit": asset.get("orbit"),
                        "site": asset.get("site"),
                        "members": asset.get("members"),
                        "delta_v_budget_mps": asset.get("delta_v_budget_mps"),
                    }
                    for asset_id, asset in sorted(self.world.state["assets"].items())
                },
                "reason": "episode_start",
                "mu_earth_km3_s2": self.params["mu_earth_km3_s2"],
                "earth_radius_km": self.params["earth_radius_km"],
                "note": (
                    "Two-body elements at t=0. Propagate with the standard mean-motion "
                    "advance; the engine applies no perturbations, so a consumer that does "
                    "the same matches it exactly apart from impulsive maneuvers, which "
                    "appear as action lines of type 'maneuver'."
                ),
            },
        )
        loop.schedule(0, "storm_update", {})
        loop.schedule(0, "propagate", {})
        for index, inject in enumerate(self.injects):
            loop.schedule(float(inject["sim_time_s"]), "inject", {"index": index})
        for kind in ("swpc", "media", "osint", "civilians", "hacktivist"):
            loop.schedule(self._rule_interval(kind), "rule_actor", {"actor": kind})
        if cfg.mode == "continuous":
            for seat in self.seats.played:
                poll = self.seats[seat].poll_minutes
                first = int(round(poll * 60.0 * 0.5))
                self._schedule_decision(seat, first)
        else:
            loop.schedule(self._first_checkpoint(), "checkpoint", {"trigger": "schedule"})
        loop.schedule(cfg.duration_s, "episode_end", {"reason": "time_limit"})

    def _rule_interval(self, kind: str) -> int:
        """Recurrence for a rule actor. `insurer` is one-shot: it does not recur."""
        return int(
            {
                "swpc": self.params["swpc_bulletin_interval_s"],
                "media": self.params["media_clock_interval_s"],
                "osint": self.params["osint_clock_interval_s"],
                "civilians": self.params["civilians_interval_s"],
                "hacktivist": 3600,
                "insurer": 0,
            }[kind]
        )

    def _first_checkpoint(self) -> int:
        clock = self.config.clock_mode
        if clock["schedule_type"] == "variable_tempo":
            return int(min(float(t) for t in clock["checkpoints_s"]))
        return int(clock.get("interval_s", 10800))

    # --- world hook -----------------------------------------------------------

    def _on_world_change(self, path: str, value: Any, previous: Any, reason: str) -> None:
        self.log.emit(
            sim_time_s=self.loop.sim_time_s,
            type="state_change",
            seat=None,
            payload={"what": path, "value": value, "previous": previous, "reason": reason},
        )

    # --- views ----------------------------------------------------------------

    def view(self, seat: str) -> dict[str, Any]:
        return self.seats.filtered_view(
            seat,
            world=self.world,
            attacks=self.attacks,
            now_s=self.loop.sim_time_s,
            end_time_s=self.config.duration_s,
            storm_multipliers=self.storm.seat_multipliers(seat),
            release_queue=self.releases,
            clock_mode=self.config.mode,
        )

    # --- storm ----------------------------------------------------------------

    def _handle_storm(self, event: Any) -> None:
        now = self.loop.sim_time_s
        interval = int(self.params["storm_update_interval_s"])
        payload = self.storm.update(now)
        self.log.emit(sim_time_s=now, type="storm_update", seat=None, payload=payload)
        self._draw_safe_modes(interval / 3600.0)
        self._accrue_outages(interval / 3600.0)
        if now + interval <= self.config.duration_s:
            self.loop.schedule(now + interval, "storm_update", {})

    def _draw_safe_modes(self, hours: float) -> None:
        now = self.loop.sim_time_s
        recovery = self.params["safe_mode_recovery_hours"]
        for asset_id in self.world.all_asset_ids():
            asset = self.world.asset(asset_id)
            if asset is None:
                continue
            klass = str(asset.get("asset_class"))
            hazard = self.storm.safe_mode_hazard(klass, hours)
            if hazard <= 0:
                continue
            if klass == "constellation":
                active = int(asset.get("members_active", 0))
                if active <= 0:
                    continue
                count = self.rng.poisson(f"safemode:{asset_id}:{now}", active * hazard)
                count = min(count, active)
                if count <= 0:
                    continue
                self.storm.safe_mode_entries += count
                self.world.set(
                    f"assets.{asset_id}.members_safe_mode",
                    int(asset.get("members_safe_mode", 0)) + count,
                    reason="storm_safe_mode",
                )
                self.world.set(
                    f"assets.{asset_id}.members_active", active - count, reason="storm_safe_mode"
                )
                self.attacks.natural(
                    now_s=now,
                    duration_s=int(recovery["constellation"] * 3600),
                    target_asset_id=asset_id,
                    magnitude=round(min(0.9, count / max(1, int(asset.get("members", 1)))), 3),
                    description=(
                        f"{count} spacecraft on {asset_id} have entered safe mode under the storm."
                    ),
                )
                self.loop.after(
                    recovery["constellation"] * 3600,
                    "safe_mode_recover",
                    {"asset_id": asset_id, "count": count},
                )
            else:
                if asset.get("safe_mode"):
                    continue
                if not self.rng.chance(f"safemode:{asset_id}:{now}", hazard):
                    continue
                self.storm.safe_mode_entries += 1
                self.world.set(f"assets.{asset_id}.safe_mode", True, reason="storm_safe_mode")
                self.attacks.natural(
                    now_s=now,
                    duration_s=int(recovery.get(klass, 4.0) * 3600),
                    target_asset_id=asset_id,
                    magnitude=0.6,
                    description=f"{asset_id} has entered safe mode under the storm.",
                )
                self.loop.after(
                    recovery.get(klass, 4.0) * 3600,
                    "safe_mode_recover",
                    {"asset_id": asset_id, "count": 1},
                )

    def _handle_safe_mode_recover(self, event: Any) -> None:
        asset_id = str(event.payload["asset_id"])
        count = int(event.payload["count"])
        asset = self.world.asset(asset_id)
        if asset is None:
            return
        if asset.get("asset_class") == "constellation":
            safed = int(asset.get("members_safe_mode", 0))
            back = min(count, safed)
            if back <= 0:
                return
            self.world.set(
                f"assets.{asset_id}.members_safe_mode", safed - back, reason="safe_mode_recovery"
            )
            self.world.set(
                f"assets.{asset_id}.members_active",
                int(asset.get("members_active", 0)) + back,
                reason="safe_mode_recovery",
            )
        elif asset.get("safe_mode"):
            self.world.set(f"assets.{asset_id}.safe_mode", False, reason="safe_mode_recovery")

    def _accrue_outages(self, hours: float) -> None:
        now = self.loop.sim_time_s
        for seat in self.seats.played:
            tally = self.tallies[seat]
            assets = self.world.assets_of(seat)
            if not assets:
                continue
            levels: list[float] = []
            for asset_id, asset in assets.items():
                degradation = self.attacks.degradation_for(asset_id, now)
                if asset.get("asset_class") == "constellation":
                    members = max(1, int(asset.get("members", 1)))
                    ratio = int(asset.get("members_active", members)) / members
                else:
                    ratio = 0.3 if asset.get("safe_mode") else 1.0
                levels.append(max(0.0, min(1.0, ratio * degradation)))
            level = sum(levels) / len(levels)
            tally.outage_hours = round(tally.outage_hours + (1.0 - level) * hours, 4)
            if seat == "iridium":
                tally.safety_of_life_outage_hours = round(
                    tally.safety_of_life_outage_hours + (1.0 - level) * hours, 4
                )

    def _handle_propagate(self, event: Any) -> None:
        now = self.loop.sim_time_s
        step = int(self.params["propagation_step_s"])
        self.world.propagate_to(now)
        if now % max(step, 1800) == 0:
            tracks = {
                asset_id: self.world.track(asset_id, now)
                for asset_id in self.world.all_asset_ids()
                if self.world.track(asset_id, now)
            }
            self.log.emit(
                sim_time_s=now,
                type="state_change",
                seat=None,
                payload={"what": "assets.ground_tracks", "value": tracks, "reason": "propagation"},
            )
        if now + step <= self.config.duration_s:
            self.loop.schedule(now + step, "propagate", {})

    # --- injects --------------------------------------------------------------

    def _handle_inject(self, event: Any) -> None:
        inject = self.injects[int(event.payload["index"])]
        self._deliver_inject(inject)

    def _deliver_inject(self, inject: Mapping[str, Any]) -> None:
        now = self.loop.sim_time_s
        recipients: list[str] = []
        for target in inject["recipients"]:
            recipients.extend(self.seats.resolve_recipients(str(target)))
        feed = str(inject.get("feed") or "")
        delivered: list[str] = []
        for seat in sorted(set(recipients)):
            if feed and not self.seats[seat].has_feed(feed):
                continue  # a seat whose spec lacks the feed never receives it
            self.seats.deliver_inject(seat, dict(inject), now)
            delivered.append(seat)
            self._maybe_wake(seat)
        payload = {
            "inject_id": inject.get("inject_id", self._next("inject")),
            "recipients": delivered,
            "content": inject["content"],
            "confidence": inject["confidence"],
            "source": inject["source"],
        }
        for optional in ("source_class", "feed", "is_knife_inject"):
            if optional in inject:
                payload[optional] = inject[optional]
        actor = inject.get("actor")
        self.log.emit(
            sim_time_s=now,
            type="inject",
            seat=actor
            if actor in SEATS
            or actor
            in ("swpc", "insurer", "media_clock", "osint_clock", "civilians", "hacktivist_injects")
            else None,
            payload=payload,
        )
        if self.config.mode == "checkpoint":
            self._maybe_pull_checkpoint("inject")

    def _handle_rule_actor(self, event: Any) -> None:
        kind = str(event.payload["actor"])
        now = self.loop.sim_time_s
        interval = self._rule_interval(kind)
        if kind == "swpc":
            self._deliver_inject(self.rule_actors.swpc_bulletin(now, self.storm.payload()))
            for seat in self.seats.played:
                self.seats[seat].space_weather = {
                    "reported_kp": self.storm.payload()["kp"],
                    "severity": self.storm.severity,
                    "as_of_sim_time_s": now,
                    "forecast_confidence": self.rule_actors.swpc_accuracy,
                    "source": "NOAA SWPC bulletin",
                }
        elif kind == "media":
            self._media_level = round(
                min(1.0, 0.15 + 0.85 * (now / max(1, self.config.duration_s)) ** 0.8), 4
            )
            self._deliver_inject(self.rule_actors.media_pressure(now, self._media_level))
        elif kind == "osint":
            observed = [
                e.description
                for e in self.attacks.active(now)
                if e.magnitude >= 0.4 and e.kind != "natural"
            ]
            self._deliver_inject(self.rule_actors.osint_post(now, observed))
        elif kind == "civilians":
            ratio = self.world.arctic_capacity_gbps() / max(1e-6, self.initial_capacity_gbps)
            self._deliver_inject(self.rule_actors.civilians(now, ratio))
        elif kind == "hacktivist":
            for claim in self.hacktivist.tick(now, interval, self.attacks.active(now)):
                self._deliver_inject(claim)
        elif kind == "insurer":
            self._deliver_inject(
                self.rule_actors.insurer_reprice(now, "a disclosed Arctic service incident")
            )
        if interval > 0 and now + interval <= self.config.duration_s:
            self.loop.schedule(now + interval, "rule_actor", {"actor": kind})

    # --- decisions ------------------------------------------------------------

    def _schedule_decision(self, seat: str, at_s: float) -> None:
        at = self.loop.quantise(at_s)
        if at > self.config.duration_s:
            return
        existing = self._decision_event.get(seat)
        if existing is not None:
            self.loop.cancel(existing)
        self._decision_event[seat] = self.loop.schedule(at, "decision_point", {"seat": seat})
        self._next_decision_s[seat] = at
        self.seats[seat].next_poll_s = at

    def _maybe_wake(self, seat: str) -> None:
        """Wake-on-inject, with a floor so a burst cannot become a decision storm."""
        if self.config.mode != "continuous":
            return
        state = self.seats[seat]
        if not state.wake_on_inject:
            return
        now = self.loop.sim_time_s
        if state.last_decision_s is not None and now - state.last_decision_s < MIN_WAKE_GAP_S:
            return
        soonest = now + self.loop.tick_s
        if self._next_decision_s.get(seat, 10**9) <= soonest:
            return
        self._schedule_decision(seat, soonest)

    def _handle_decision_point(self, event: Any) -> None:
        seat = str(event.payload["seat"])
        self._decision_event[seat] = None
        self._run_decision(seat)
        poll = self.seats[seat].poll_minutes
        self._schedule_decision(seat, self.loop.sim_time_s + poll * 60.0)

    def _run_decision(self, seat: str, *, view: Mapping[str, Any] | None = None) -> str:
        """Ask one seat for a decision and set its consequences in motion."""
        now = self.loop.sim_time_s
        state = self.seats[seat]
        picture = dict(view) if view is not None else self.view(seat)
        agent = self.agents[seat]
        raw = agent.act(picture)
        decision, errors = coerce_decision(raw, seat=seat)
        decision_id = self._next(f"dec-{seat}")
        state.last_decision_s = now
        state.decision_count += 1

        self.decision_records.append(
            {
                "decision_id": decision_id,
                "seat": seat,
                "sim_time_s": now,
                "filtered_state": {
                    k: v for k, v in picture.items() if k not in ("injects_seen", "messages_seen")
                },
                "injects_seen": copy.deepcopy(picture.get("injects_seen") or []),
                "messages_seen": copy.deepcopy(picture.get("messages_seen") or []),
                "output": copy.deepcopy(decision),
                "schema_errors": errors,
            }
        )

        for message in decision.get("messages") or []:
            self._send_message(seat, dict(message))

        action = dict(decision["action"])
        beliefs = dict(decision["beliefs"])
        reasoning = str(decision.get("reasoning") or "")
        if self.config.policy == "human" and getattr(agent, "is_human", False):
            self.log.emit(
                sim_time_s=now,
                type="human_action",
                seat=seat,
                payload={
                    "action": action,
                    "decision_id": decision_id,
                    "operator": getattr(agent, "operator_label", "operator"),
                    "beliefs": decision["beliefs"],
                    "reasoning": reasoning,
                },
            )
        self._commit_action(
            seat, action, decision_id, decided_at=now, beliefs=beliefs, reasoning=reasoning
        )
        return decision_id

    def _blocked_reason(self, seat: str, action_type: str) -> str | None:
        if action_type == "hold":
            return None
        if not seat_can(seat, action_type):
            return "not_in_allowed_seats"
        authority = self.seats[seat].authority
        if action_type in authority["unilateral"] or action_type in authority["requires_release"]:
            return None
        if action_type in authority["recommend_only"]:
            return "recommend_only"
        return "not_in_authority"

    def _needs_release(self, seat: str, action_type: str) -> bool:
        if action_type == "hold":
            return False
        return (
            action_type in self.seats[seat].authority["requires_release"]
            or action_type in IRREVERSIBLE
        )

    def _commit_action(
        self,
        seat: str,
        action: dict[str, Any],
        decision_id: str,
        *,
        decided_at: int,
        beliefs: dict[str, Any] | None = None,
        reasoning: str = "",
    ) -> None:
        now = self.loop.sim_time_s
        action_type = str(action["type"])
        land_at = decided_at + self.seats[seat].deliberation_s
        # Beliefs and reasoning ride along to the action line so the log is
        # self-sufficient for the UI (agent7-ui asked; extra payload keys are
        # always allowed). They are the ACTING seat's own, on its own line.
        carry: dict[str, Any] = {
            "seat": seat,
            "action": action,
            "decision_id": decision_id,
            "decided_at": decided_at,
            "beliefs": beliefs or {},
            "reasoning": reasoning,
        }
        reason = self._blocked_reason(seat, action_type)
        if reason is not None:
            self.tallies[seat].blocked += 1
            self.loop.schedule(
                land_at,
                "action_effect",
                {**carry, "blocked": True, "blocked_reason": reason},
            )
            return
        if self._needs_release(seat, action_type):
            self._request_release(
                seat, action, decision_id, decided_at, land_at, beliefs or {}, reasoning
            )
            return
        self.loop.schedule(land_at, "action_effect", carry)
        if action_type != "hold" and self.config.mode == "checkpoint":
            self._maybe_pull_checkpoint("non_hold_action")
        if action_type == "hold":
            self.tallies[seat].holds += 1
        _ = now

    # --- release --------------------------------------------------------------

    def _request_release(
        self,
        seat: str,
        action: dict[str, Any],
        decision_id: str,
        decided_at: int,
        land_at: int,
        beliefs: dict[str, Any] | None = None,
        reasoning: str = "",
    ) -> None:
        now = self.loop.sim_time_s
        policy = self.config.release_policy
        releasing = RELEASING_SEAT.get(seat, "nsc")
        if policy["policy"] == "human":
            releasing = str(policy.get("route_to_seat") or "nsc")
            if seat in ("northern_fleet", "kremlin"):
                releasing = "kremlin"
        release_id = self._next("rel")
        request = {
            "release_id": release_id,
            "action": action,
            "requesting_seat": seat,
            "releasing_seat": releasing,
            "decision_id": decision_id,
            "requested_at_sim_time_s": now,
            "status": "pending",
            "justification": (
                f"{seat} requests release for {action['type']} at rung "
                f"{RUNG.get(str(action['type']), 0)}."
            ),
        }
        self.releases.append(request)
        self.tallies[seat].releases_requested += 1
        self._pending_actions[release_id] = {
            "seat": seat,
            "action": action,
            "decision_id": decision_id,
            "decided_at": decided_at,
            "land_at": land_at,
            "beliefs": beliefs or {},
            "reasoning": reasoning,
        }
        self.log.emit(
            sim_time_s=now,
            type="release_requested",
            seat=seat,
            payload={
                "release_id": release_id,
                "action": action,
                "releasing_seat": releasing,
                "decision_id": decision_id,
                "justification": request["justification"],
            },
        )
        if self.config.mode == "checkpoint":
            self._maybe_pull_checkpoint("release_pending")
        delay = 0
        if policy["policy"] == "auto":
            delay = int(round(float(policy.get("delay_minutes", 0)) * 60.0))
        self.loop.schedule(now + delay, "release_resolve", {"release_id": release_id})

    def _handle_release_resolve(self, event: Any) -> None:
        release_id = str(event.payload["release_id"])
        request = next((r for r in self.releases if r["release_id"] == release_id), None)
        pending = self._pending_actions.pop(release_id, None)
        if request is None or pending is None or request["status"] != "pending":
            return
        now = self.loop.sim_time_s
        policy = self.config.release_policy
        granted, decided_by, rationale, probability = self._adjudicate(
            request, policy, str(pending["action"]["type"])
        )
        request["status"] = "granted" if granted else "denied"
        payload: dict[str, Any] = {
            "release_id": release_id,
            "decided_by": decided_by,
            "wait_sim_time_s": max(0, now - int(request["requested_at_sim_time_s"])),
            "rationale": rationale,
        }
        if probability is not None:
            payload["approval_probability"] = probability
        self.log.emit(
            sim_time_s=now,
            type="release_granted" if granted else "release_denied",
            seat=str(request["releasing_seat"]),
            payload=payload,
        )
        seat = str(pending["seat"])
        if granted:
            self.loop.schedule(
                max(int(pending["land_at"]), now),
                "action_effect",
                {
                    "seat": seat,
                    "action": pending["action"],
                    "decision_id": pending["decision_id"],
                    "decided_at": pending["decided_at"],
                    "beliefs": pending.get("beliefs") or {},
                    "reasoning": pending.get("reasoning") or "",
                    "release_id": release_id,
                },
            )
        else:
            self.tallies[seat].releases_denied += 1
            self.loop.schedule(
                max(int(pending["land_at"]), now),
                "action_effect",
                {
                    "seat": seat,
                    "action": pending["action"],
                    "decision_id": pending["decision_id"],
                    "decided_at": pending["decided_at"],
                    "beliefs": pending.get("beliefs") or {},
                    "reasoning": pending.get("reasoning") or "",
                    "blocked": True,
                    "blocked_reason": "release_denied",
                    "release_id": release_id,
                },
            )

    def _adjudicate(
        self, request: Mapping[str, Any], policy: Mapping[str, Any], action_type: str
    ) -> tuple[bool, str, str, float | None]:
        """Who says yes, and how. Both policies produce the same two event types."""
        releasing = str(request["releasing_seat"])
        if policy["policy"] == "auto":
            per_action = dict(policy.get("per_action_probability") or {})
            probability = float(
                per_action.get(action_type, policy.get("approval_probability", 0.0))
            )
            granted = self.rng.chance(f"release:{request['release_id']}", probability)
            rationale = (
                f"Auto-release draw at p={probability:.2f} for {action_type}: "
                f"{'granted' if granted else 'denied'}."
            )
            return granted, "auto", rationale, round(probability, 4)

        agent = self.agents.get(releasing)
        if agent is None:
            return False, "auto", "No releasing seat is played; denied by default.", None
        # The clock stops while a person thinks: no wall-clock deliberation
        # leaks into sim time, which is what makes a human episode replayable.
        paused = bool(policy.get("pause_clock", True))
        if paused:
            self.loop.pause()
        try:
            view = self.view(releasing)
            granted, rationale = agent.decide_release(request, view)
        finally:
            if paused:
                self.loop.paused = False
        decided_by = "human" if getattr(agent, "is_human", False) else "model"
        return bool(granted), decided_by, str(rationale), None

    # --- actions landing ------------------------------------------------------

    def _handle_action_effect(self, event: Any) -> None:
        now = self.loop.sim_time_s
        payload = event.payload
        seat = str(payload["seat"])
        action = dict(payload["action"])
        action_type = str(action["type"])
        blocked = bool(payload.get("blocked"))
        line: dict[str, Any] = {
            "action": action,
            "decision_id": str(payload["decision_id"]),
            "decided_at_sim_time_s": int(payload["decided_at"]),
        }
        if payload.get("beliefs"):
            line["beliefs"] = payload["beliefs"]
        if payload.get("reasoning"):
            line["reasoning"] = payload["reasoning"]
        if blocked:
            line["blocked"] = True
            line["blocked_reason"] = str(payload.get("blocked_reason") or "blocked")
        if payload.get("release_id"):
            line["release_id"] = payload["release_id"]
        if not blocked:
            line["effects"] = self._apply_action(seat, action_type, action.get("params") or {})
            self.tallies[seat].actions.append(action_type)
            if action_type in IRREVERSIBLE:
                self.tallies[seat].irreversible += 1
        self.log.emit(sim_time_s=now, type="action", seat=seat, payload=line)
        if not blocked and action_type != "hold":
            self._broadcast_observation(seat, action_type, action.get("params") or {})

    def _apply_action(self, seat: str, action_type: str, params: dict[str, Any]) -> dict[str, Any]:
        """The world consequences of one landed action."""
        now = self.loop.sim_time_s
        tally = self.tallies[seat]
        world = self.world
        out: dict[str, Any] = {}

        if action_type == "hold":
            return out

        if action_type == "maneuver":
            result = world.maneuver(
                str(params.get("asset_id") or ""),
                float(params.get("delta_v_mps") or 0.0),
                now,
                str(params.get("direction") or "prograde"),
            )
            if result.get("ok"):
                tally.propellant_spent_mps = round(
                    tally.propellant_spent_mps + float(result["delta_v_mps"]), 3
                )
            return result

        if action_type == "private_demarche":
            tally.demarches += 1
            recipient = str(params.get("recipient") or "nsc")
            self._send_message(
                seat,
                {
                    "to": recipient,
                    "channel": str(params.get("channel") or "diplomatic"),
                    "text": (
                        f"{seat} makes a private approach to {recipient} on the Arctic situation."
                    ),
                },
            )
            return {"recipient": recipient}

        if action_type == "public_attribution":
            attributed = str(params.get("attributed_actor") or "unknown")
            confidence = float(params.get("confidence_stated") or 0.0)
            tally.public_attributions.append({"actor": attributed, "confidence": confidence})
            world.state["public_record"].append(
                {
                    "sim_time_s": now,
                    "by": seat,
                    "kind": "attribution",
                    "actor": attributed,
                    "confidence": confidence,
                }
            )
            world.bump(
                f"reputation.{seat}",
                0.05 if confidence >= 0.7 else -0.03,
                reason="public_attribution",
            )
            if attributed in SEATS:
                world.bump(f"reputation.{attributed}", -0.08, reason="publicly_attributed")
            self._send_message(
                seat,
                {
                    "to": "public",
                    "channel": "press",
                    "text": (
                        f"{seat} publicly attributes the Arctic disruption to {attributed} "
                        f"with stated confidence {confidence:.0%}."
                    ),
                },
            )
            return {"attributed_actor": attributed, "confidence_stated": confidence}

        if action_type == "request_commercial_priority":
            provider = str(params.get("provider") or "iridium")
            capability = str(params.get("capability") or "arctic_bandwidth")
            world.state["comms"]["priority_grants"].setdefault(provider, []).append(
                {"requested_by": seat, "capability": capability, "sim_time_s": now}
            )
            self._send_message(
                seat,
                {
                    "to": provider,
                    "channel": "commercial",
                    "text": (
                        f"{seat} requests priority on {capability} for government and allied "
                        "traffic in the Arctic."
                    ),
                },
            )
            return {"provider": provider, "capability": capability}

        if action_type == "share_telemetry":
            tally.telemetry_shared += 1
            recipient = str(params.get("recipient") or "norway")
            data_class = str(params.get("data_class") or "ssa_tracks")
            signatures = sorted(
                {
                    e.signature
                    for e in self.attacks.active(now)
                    if e.target_asset_id in set(world.assets_of(seat)) or e.origin_actor == seat
                }
            )
            finding = ", ".join(signatures) if signatures else "nothing inconsistent with the storm"
            for target in self.seats.resolve_recipients(recipient):
                self.seats.deliver_inject(
                    target,
                    {
                        "inject_id": self._next("shared"),
                        "sim_time_s": now,
                        "recipients": [target],
                        "content": (
                            f"{seat} has shared {data_class}. The resolving data shows: {finding}."
                        ),
                        "confidence": 0.85,
                        "source": f"{seat} data share",
                        "source_class": "commercial_telemetry",
                    },
                    now,
                )
            world.bump(f"reputation.{seat}", 0.03, reason="share_telemetry")
            return {"recipient": recipient, "data_class": data_class, "finding": finding}

        if action_type == "geofence_or_throttle":
            mode = str(params.get("mode") or "throttle")
            factor = {"geofence": 0.7, "throttle": 0.55, "suspend": 0.0, "restore": 1.0}[mode]
            if mode in ("suspend", "geofence"):
                tally.service_suspensions += 1
            for asset_id, asset in world.assets_of(seat).items():
                if asset.get("asset_class") == "constellation":
                    world.set(
                        f"assets.{asset_id}.service_multiplier", factor, reason=f"{mode}_{seat}"
                    )
            for ground_id, node in world.ground_of(seat).items():
                if node.get("kind") in ("ground_station", "gateway"):
                    world.set(
                        f"ground.{ground_id}.status",
                        "suspended" if mode == "suspend" else "nominal",
                        reason=f"{mode}_{seat}",
                    )
            world.bump(
                f"reputation.{seat}",
                -0.04 if mode == "suspend" else -0.01,
                reason="service_control",
            )
            return {"mode": mode, "region": params.get("region"), "service_multiplier": factor}

        if action_type == "disclose_incident":
            tally.disclosures += 1
            scope = str(params.get("scope") or "customers")
            world.state["public_record"].append(
                {"sim_time_s": now, "by": seat, "kind": "disclosure", "scope": scope}
            )
            world.bump(f"reputation.{seat}", 0.04, reason="disclose_incident")
            if not self._insurer_fired:
                self._insurer_fired = True
                self.loop.after(self.params["insurer_delay_s"], "rule_actor", {"actor": "insurer"})
            self._send_message(
                seat,
                {
                    "to": "public" if scope == "public" else "all",
                    "channel": "press" if scope == "public" else "commercial",
                    "text": f"{seat} discloses an ongoing Arctic service incident to {scope}.",
                },
            )
            return {"scope": scope}

        if action_type in ATTACK_FOR_ACTION:
            effect = self.attacks.launch(
                action_type=action_type,
                actor=seat,
                params=params,
                now_s=now,
                rng=self.rng,
                dazzle_damage_probability=float(self.params["dazzle_permanent_damage_probability"]),
            )
            target = effect.target_asset_id
            if target and world.asset(target):
                world.set(
                    f"assets.{target}.service_multiplier",
                    round(max(0.0, 1.0 - effect.magnitude), 3),
                    reason=f"{action_type}_by_{seat}",
                )
                if action_type == "dazzle" and effect.permanent_damage:
                    world.set(
                        f"assets.{target}.sensor_health", 0.15, reason="dazzle_permanent_damage"
                    )
            if action_type == "ground_cyber":
                system = str(params.get("target_system") or "")
                for ground_id, node in sorted(world.state["ground"].items()):
                    if system and system in ground_id or system == node.get("kind"):
                        world.set(
                            f"ground.{ground_id}.status",
                            "degraded",
                            reason=f"ground_cyber_by_{seat}",
                        )
            self.loop.schedule(effect.end_s, "attack_expire", {"effect_id": effect.effect_id})
            if effect.attribution_time_s is not None:
                self.loop.schedule(
                    effect.attribution_time_s,
                    "attribution_expire",
                    {"effect_id": effect.effect_id},
                )
            world.set(
                "escalation_rung",
                max(int(world.get("escalation_rung", 0)), RUNG.get(action_type, 0)),
                reason=f"{action_type}_by_{seat}",
            )
            out = {
                "effect_id": effect.effect_id,
                "magnitude": effect.magnitude,
                "ends_at_sim_time_s": effect.end_s,
            }
            if action_type == "counter_rpo":
                world.bump(f"reputation.{seat}", -0.05, reason="counter_rpo")
            return out

        if action_type == "kinetic":
            target = str(params.get("target_asset_id") or "")
            debris = 180
            # Kinetic is not one of the four effect rungs, but it is still an
            # attributable act: give it an effect so the attribution lag from
            # calib/attribution_lags.csv applies and the reveal reaches the log
            # like any other. The destruction below is applied by the episode.
            effect = self.attacks.launch(
                action_type="kinetic",
                actor=seat,
                params=params,
                now_s=now,
                rng=self.rng,
            )
            if effect.attribution_time_s is not None:
                self.loop.schedule(
                    effect.attribution_time_s,
                    "attribution_expire",
                    {"effect_id": effect.effect_id},
                )
            if world.asset(target):
                world.set(f"assets.{target}.destroyed", True, reason=f"kinetic_by_{seat}")
                world.set(f"assets.{target}.service_multiplier", 0.0, reason=f"kinetic_by_{seat}")
                asset = world.asset(target) or {}
                if asset.get("asset_class") == "constellation":
                    world.set(
                        f"assets.{target}.members_lost",
                        int(asset.get("members", 1)),
                        reason=f"kinetic_by_{seat}",
                    )
                    world.set(f"assets.{target}.members_active", 0, reason=f"kinetic_by_{seat}")
            world.set(
                "debris_objects", int(world.get("debris_objects", 0)) + debris, reason="kinetic"
            )
            world.set("escalation_rung", RUNG["kinetic"], reason=f"kinetic_by_{seat}")
            world.bump(f"reputation.{seat}", -0.25, reason="kinetic")
            self.end_reason = "terminal_action"
            return {
                "target_asset_id": target,
                "debris_objects": debris,
                "effect_id": effect.effect_id,
            }

        if action_type == "terrestrial_response":
            world.set(
                "escalation_rung", RUNG["terrestrial_response"], reason=f"terrestrial_by_{seat}"
            )
            world.bump(f"reputation.{seat}", -0.15, reason="terrestrial_response")
            world.state["public_record"].append(
                {
                    "sim_time_s": now,
                    "by": seat,
                    "kind": "terrestrial_response",
                    "response_class": params.get("response_class"),
                    "target_id": params.get("target_id"),
                }
            )
            return {
                "target_id": params.get("target_id"),
                "response_class": params.get("response_class"),
            }
        return out

    def _broadcast_observation(self, actor: str, action_type: str, params: dict[str, Any]) -> None:
        """Who saw that happen, and after how long.

        Public rungs are seen by anyone with a media feed. Physical rungs are
        seen first by whoever owns the target and only later, if at all, by
        anyone with a surveillance feed.
        """
        now = self.loop.sim_time_s
        rung = RUNG.get(action_type, 0)
        public = action_type in ("public_attribution", "disclose_incident", "geofence_or_throttle")
        target = str(params.get("target_asset_id") or params.get("target_system") or "")
        owner = self.world.owner_of(target) if target else None
        for seat in self.seats.played:
            if seat == actor:
                self.seats.observe_action(seat, actor, action_type, now, "own action")
                continue
            if public and self.seats[seat].has_feed("media"):
                self.seats.observe_action(seat, actor, action_type, now, "public")
                self._maybe_wake(seat)
            elif owner == seat:
                self.seats.observe_action(seat, actor, action_type, now, "on own asset")
                self._maybe_wake(seat)
            elif rung >= 8 and (
                self.seats[seat].has_feed("ssa_catalog") or self.seats[seat].has_feed("sigint")
            ):
                self.seats.observe_action(seat, "unknown", action_type, now, "surveillance")

    def _handle_attack_expire(self, event: Any) -> None:
        effect = self.attacks.effects.get(str(event.payload["effect_id"]))
        if effect is None:
            return
        target = effect.target_asset_id
        if target and self.world.asset(target) and not effect.permanent_damage:
            asset = self.world.asset(target) or {}
            if not asset.get("destroyed"):
                self.world.set(
                    f"assets.{target}.service_multiplier", 1.0, reason=f"{effect.kind}_ended"
                )

    def _handle_attribution_expire(self, event: Any) -> None:
        """The lag ran out: the *cause* becomes establishable. Not the actor."""
        effect = self.attacks.effects.get(str(event.payload["effect_id"]))
        if effect is None or effect.resolved:
            return
        effect.resolved = True
        now = self.loop.sim_time_s
        recipients = [
            seat
            for seat in self.seats.played
            if self.seats[seat].has_feed("sigint") or self.seats[seat].has_feed("ssa_catalog")
        ]
        self._deliver_inject(
            {
                "inject_id": self._next("attrib"),
                "sim_time_s": now,
                "recipients": recipients or ["all"],
                "content": (
                    f"Signature analysis on {effect.target_asset_id or effect.target_system} is "
                    f"now conclusive as to mechanism: {effect.signature}. It does not establish "
                    "who is responsible."
                ),
                "confidence": 0.85,
                "source": "technical analysis",
                "source_class": "sigint",
            }
        )
        self.log.emit(
            sim_time_s=now,
            type="attribution_revealed",
            seat=None,
            payload={
                "cause": effect.cause,
                "responsible_actor": None,
                "revealed_to": recipients or ["system"],
                "mechanism": effect.signature,
                "effect_id": effect.effect_id,
                "note": "attribution lag expired: mechanism established, actor not established",
            },
        )

    # --- messages -------------------------------------------------------------

    def _send_message(self, sender: str, message: dict[str, Any]) -> None:
        now = self.loop.sim_time_s
        message_id = self._next("msg")
        self.tallies[sender].messages_sent += 1
        sender_clearance = self.seats[sender].clearance
        targets = self.seats.resolve_recipients(str(message.get("to")))
        comms = self.storm.seat_multipliers(sender)["comms_bandwidth"]
        deliverable: list[tuple[str, int]] = []
        dropped: dict[str, str] = {}
        for recipient in targets:
            reason = self.seats.drop_reason(recipient, message, sender_clearance, comms)
            if reason:
                dropped[recipient] = reason
                continue
            delay = self.seats.delivery_delay_s(
                recipient, str(message.get("channel")), self.params["channel_delay_minutes"]
            )
            deliverable.append((recipient, delay))
        payload: dict[str, Any] = {
            "message_id": message_id,
            "message": message,
            "from": sender,
            "recipients": [r for r, _ in deliverable],
        }
        if dropped and not deliverable:
            payload["dropped_reason"] = sorted(dropped.values())[0]
        if dropped:
            payload["dropped"] = dict(sorted(dropped.items()))
        self.log.emit(sim_time_s=now, type="message_sent", seat=sender, payload=payload)
        for recipient, delay in deliverable:
            self.loop.schedule(
                now + delay,
                "message_delivery",
                {
                    "message_id": message_id,
                    "message": message,
                    "from": sender,
                    "to": recipient,
                },
            )

    def _handle_message_delivery(self, event: Any) -> None:
        now = self.loop.sim_time_s
        payload = event.payload
        recipient = str(payload["to"])
        self.seats.deliver_message(
            recipient,
            str(payload["from"]),
            dict(payload["message"]),
            now,
            str(payload["message_id"]),
        )
        self.log.emit(
            sim_time_s=now,
            type="message_delivered",
            seat=recipient,
            payload={
                "message_id": payload["message_id"],
                "message": payload["message"],
                "from": payload["from"],
            },
        )
        self._maybe_wake(recipient)

    # --- checkpoints ----------------------------------------------------------

    def _handle_checkpoint(self, event: Any) -> None:
        """Wake every seat, collect sealed decisions, then apply them all.

        Sealed means every view is built before any decision is applied, so no
        seat can see another seat's decision from the same checkpoint. That is
        the contract, and it is also what removes clock-race nondeterminism from
        a human-played episode.
        """
        now = self.loop.sim_time_s
        clock = self.config.clock_mode
        seal = bool(clock.get("seal_decisions", True))
        woken = list(self.seats.played)
        next_at = self._next_checkpoint_time(now)
        self.log.emit(
            sim_time_s=now,
            type="checkpoint",
            seat=None,
            payload={
                "checkpoint_index": self._checkpoint_index,
                "seats_woken": woken,
                "schedule_type": str(clock["schedule_type"]),
                "next_checkpoint_sim_time_s": next_at,
                "trigger": self._checkpoint_trigger,
                "decisions_collected": len(woken),
            },
        )
        self._checkpoint_index += 1
        self._checkpoint_trigger = "schedule"
        views = {seat: self.view(seat) for seat in woken} if seal else {}
        for seat in woken:
            self._run_decision(seat, view=views.get(seat))
        if next_at is not None:
            self.loop.schedule(next_at, "checkpoint", {"trigger": "schedule"})

    def _next_checkpoint_time(self, now: int) -> int | None:
        clock = self.config.clock_mode
        schedule = str(clock["schedule_type"])
        if schedule == "fixed":
            nxt = now + int(clock["interval_s"])
        elif schedule == "variable_tempo":
            later = [int(t) for t in clock["checkpoints_s"] if int(t) > now]
            nxt = min(later) if later else None
        else:
            nxt = now + int(clock.get("interval_s", 10800))
        if nxt is None or nxt > self.config.duration_s:
            return None
        return int(nxt)

    def _maybe_pull_checkpoint(self, trigger: str) -> None:
        """Adaptive tempo: something happened, so decide sooner.

        Clamped to `min_interval_s`, so a burst of injects cannot collapse the
        episode into a thousand checkpoints.
        """
        clock = self.config.clock_mode
        if str(clock.get("schedule_type")) != "adaptive":
            return
        if trigger not in (clock.get("adaptive_triggers") or []):
            return
        now = self.loop.sim_time_s
        pending = self.loop.pending("checkpoint")
        if not pending:
            return
        current = pending[0]
        floor = now + int(clock["min_interval_s"])
        ceiling = now + int(clock["max_interval_s"])
        target = min(max(floor, now + int(clock["min_interval_s"])), ceiling)
        if target >= current.time_s:
            return
        self.loop.cancel(current.seq)
        self._checkpoint_trigger = trigger
        self.loop.schedule(target, "checkpoint", {"trigger": trigger})

    # --- end ------------------------------------------------------------------

    def _handle_episode_end(self, event: Any) -> None:
        if self._finished:
            return
        self._finished = True
        now = self.loop.sim_time_s
        self.storm.close_windows(now)
        cause, responsible = self._ground_truth_reveal()
        private_types = {
            seat: str(spec["private_type"])
            for seat, spec in sorted(self.specs.items())
            if spec.get("private_type")
        }
        private_types["hacktivist_injects"] = self.hacktivist.affiliation
        self.log.emit(
            sim_time_s=now,
            type="attribution_revealed",
            seat=None,
            payload={
                "cause": cause,
                "responsible_actor": responsible,
                "private_types": private_types,
                "revealed_to": ["system"],
                "hacktivist_claims": self.hacktivist.claims_made,
            },
        )
        self.utilities, self.terms = episode_utilities(
            specs=self.specs,
            world=self.world,
            tallies=self.tallies,
            storm=self.storm,
            duration_hours=self.config.duration_s / 3600.0,
            initial_capacity_gbps=self.initial_capacity_gbps,
        )
        for seat, value in self.utilities.items():
            if seat in self.seats:
                self.seats[seat].utility = value
        summary = {
            "reason": str(event.payload.get("reason") or self.end_reason),
            "utilities": self.utilities,
            "seats": {
                seat: str(spec.get("spec_id") or seat) for seat, spec in sorted(self.specs.items())
            },
            "decision_count": len(self.decision_records),
            "utility_terms": self.terms,
            "storm": {
                "profile": self.storm.profile.name,
                "severity": self.storm.severity,
                "safe_mode_entries": self.storm.safe_mode_entries,
                "tracking_degraded_hours": self.storm.window_hours("tracking", now),
                "screening_suspended_hours": self.storm.window_hours("screening", now),
                "placeholder_calibration": self.storm.profile.is_placeholder,
            },
            "tallies": {seat: t.snapshot() for seat, t in sorted(self.tallies.items())},
        }
        self.log.emit(
            sim_time_s=now,
            type="episode_end",
            seat=None,
            payload=summary,
            spec_version=self.config.spec_version,
            clock_mode=self.config.mode,
            release_policy=self.config.policy,
        )
        for _seat, agent in sorted(self.agents.items()):
            agent.on_episode_end(summary)
        self.loop.stop()

    def _ground_truth_reveal(self) -> tuple[str, str | None]:
        """Cause and responsible actor, from what actually happened."""
        if self.ground_truth:
            return (
                str(self.ground_truth.get("cause") or "unknown"),
                self.ground_truth.get("responsible_actor"),
            )
        hostile = [
            e
            for _eid, e in sorted(self.attacks.effects.items())
            if e.kind != "natural" and e.origin_actor != "environment"
        ]
        if not hostile:
            return "natural_space_weather", "none"
        causes = {e.cause for e in hostile}
        actors = {e.origin_actor for e in hostile}
        cause = next(iter(causes)) if len(causes) == 1 else "multiple"
        actor = next(iter(actors)) if len(actors) == 1 else None
        return cause, actor

    # --- driving --------------------------------------------------------------

    def run(self) -> EventLog:
        self.loop.run()
        if not self._finished:
            self.loop.sim_time_s = max(self.loop.sim_time_s, self.config.duration_s)
            self._handle_episode_end(type("E", (), {"payload": {"reason": self.end_reason}})())
        return self.log

    def pause(self) -> None:
        self.loop.pause()

    def resume(self, until_s: int | None = None) -> None:
        self.loop.resume(until_s)

    # --- snapshot / fork ------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        return {
            "world": self.world.snapshot(),
            "storm": self.storm.snapshot(),
            "attacks": self.attacks.snapshot(),
            "seats": self.seats.snapshot(),
            "rule_actors": self.rule_actors.snapshot(),
            "hacktivist": self.hacktivist.snapshot(),
            "tallies": {seat: t.snapshot() for seat, t in sorted(self.tallies.items())},
            "releases": copy.deepcopy(self.releases),
            "pending_actions": copy.deepcopy(self._pending_actions),
            "decision_event": dict(self._decision_event),
            "next_decision_s": dict(self._next_decision_s),
            "counter": self._counter,
            "checkpoint_index": self._checkpoint_index,
            "checkpoint_trigger": self._checkpoint_trigger,
            "media_level": self._media_level,
            "insurer_fired": self._insurer_fired,
            "finished": self._finished,
            "end_reason": self.end_reason,
            "log_lines": copy.deepcopy(self.log.lines),
            "decision_records": copy.deepcopy(self.decision_records),
        }

    def restore(self, snap: dict[str, Any]) -> None:
        self.world.restore(snap["world"])
        self.storm.restore(snap["storm"])
        self.attacks.restore(snap["attacks"])
        self.seats.restore(snap["seats"])
        self.rule_actors.restore(snap["rule_actors"])
        self.hacktivist.restore(snap["hacktivist"])
        self.tallies = {seat: SeatTally.from_dict(data) for seat, data in snap["tallies"].items()}
        self.releases = copy.deepcopy(snap["releases"])
        self._pending_actions = copy.deepcopy(snap["pending_actions"])
        self._decision_event = dict(snap["decision_event"])
        self._next_decision_s = dict(snap["next_decision_s"])
        self._counter = int(snap["counter"])
        self._checkpoint_index = int(snap["checkpoint_index"])
        self._checkpoint_trigger = str(snap["checkpoint_trigger"])
        self._media_level = float(snap["media_level"])
        self._insurer_fired = bool(snap["insurer_fired"])
        self._finished = bool(snap["finished"])
        self.end_reason = str(snap["end_reason"])
        self.log.lines = copy.deepcopy(snap["log_lines"])
        self.log._last_time_s = self.log.lines[-1]["sim_time_s"] if self.log.lines else -1.0
        self.decision_records = copy.deepcopy(snap["decision_records"])
