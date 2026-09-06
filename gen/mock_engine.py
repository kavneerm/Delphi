"""A contract-faithful stand-in for the engine, used until agent1-engine publishes.

`docs/COORDINATION.md` section 3: mock, proceed, swap later. This is that mock. It is
*not* a physics engine — there is no orbit propagation, no storm curve fitted to Kp, no
attribution-lag distribution from `calib/`. What it is, precisely:

* a deterministic priority-queue event loop over one 72-hour episode, seeded once;
* both `clock_mode`s from `env_config_schema.json` — asynchronous per-seat wake policies,
  and synchronous sealed checkpoints;
* `release_policy: auto`, drawing every release from the episode seed, which is what the
  training lake runs under;
* per-seat filtered views carrying only the keys `lake_record_schema.json` documents,
  built only from feeds the seat's spec lists;
* message routing with per-channel delay, per-feed latency and clearance drops;
* a placeholder end-of-episode utility, so `outcome_utility` is a number and
  `train/filter.py`'s percentile cutoff has something to cut on.

**What it must never do is leak.** The single property this mock exists to preserve is
`contracts/README.md` rule 4: a filtered state contains nothing the seat could not know.
Ground truth — the Red hidden type, the hacktivist affiliation, the true cause — is held
in `Scenario.ground_truth` and read only at episode end. `tests/agent3-gen` asserts it.

When `engine.agent_api` lands, `gen/run.py` drives the real engine and this file becomes
test scaffolding.
"""

from __future__ import annotations

import asyncio
import hashlib
import heapq
import itertools
import random
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from gen.contracts import (
    irreversible,
    ladder,
    menu_for_seat,
    rung,
    validation_errors,
    validator,
)
from gen.engine_api import DecisionResult, SeatAgent, SeatView, WakePolicy
from gen.scenario import Scenario

MINUTE = 60.0

#: Sim-minute delay a message takes on each channel before the recipient's own feed
#: latency is added. `action_schema.json#/$defs/message` fixes the channel list and says
#: back_channel and hotline are fast and private; the numbers are this mock's.
CHANNEL_DELAY_MINUTES = {
    "diplomatic": 90.0,
    "mil_to_mil": 30.0,
    "liaison": 45.0,
    "commercial": 20.0,
    "press": 10.0,
    "internal": 5.0,
    "back_channel": 10.0,
    "hotline": 2.0,
}

#: Which channels every seat with a media feed can observe, per the contract note on
#: `press`. Everything else reaches only its addressee.
PUBLIC_CHANNELS = frozenset({"press"})

CLEARANCE_ORDER = (
    "open",
    "commercial_proprietary",
    "restricted",
    "secret",
    "top_secret_sci",
)

#: Sim-minutes between an action taking effect and the *observing* seats seeing it, by
#: action type. A placeholder for `calib/attribution_lags.csv`, which agent2-calib owns;
#: `MockEngine` reads that file instead as soon as it exists.
TODO_CALIB_ATTRIBUTION_LAG_MINUTES = {
    "jam": 240.0,
    "dazzle": 300.0,
    "ground_cyber": 600.0,
    "counter_rpo": 120.0,
    "kinetic": 30.0,
    "terrestrial_response": 60.0,
    "maneuver": 180.0,
}

#: Actions everyone sees the moment they land.
_OVERT = frozenset({"public_attribution", "disclose_incident", "geofence_or_throttle"})

_STORM_LEVEL = {
    "quiet": 0.0,
    "G1": 0.15,
    "G2": 0.3,
    "G3": 0.45,
    "G4": 0.7,
    "G5": 0.85,
    "carrington": 1.0,
}


def episode_id_for(scenario_id: str, seed: int, salt: str) -> str:
    """`<scenario_id>-<seed>-<8 hex>`, per `contracts/s3_layout.md` section 3."""
    digest = hashlib.sha256(f"{scenario_id}:{seed}:{salt}".encode()).hexdigest()[:8]
    return f"{scenario_id}-{seed}-{digest}"


@dataclass
class EpisodeSpec:
    """One episode to run: the env config, the scenario, and who sits where."""

    episode_id: str
    env_config: dict[str, Any]
    scenario: Scenario
    specs: dict[str, dict[str, Any]]  # seat -> spec
    grid_cell: dict[str, Any] = field(default_factory=dict)
    pair_id: str | None = None
    pair_flipped_field: str | None = None
    pair_variant: str | None = None

    @property
    def seed(self) -> int:
        return int(self.env_config["seed"])

    @property
    def scenario_id(self) -> str:
        return self.scenario.scenario_id

    @property
    def clock_mode(self) -> str:
        return self.env_config["clock_mode"]["mode"]

    @property
    def release_policy(self) -> str:
        return self.env_config["release_policy"]["policy"]

    def validate(self) -> None:
        errors = validation_errors(validator("env_config_schema.json"), self.env_config)
        if errors:
            raise ValueError(f"{self.episode_id}: invalid env config: {errors[:3]}")


@dataclass
class DecisionRecord:
    """One decision, as the engine saw it. `gen/run.py` turns this into a lake record."""

    episode_id: str
    seat: str
    spec: dict[str, Any]
    sim_time_s: float
    view: SeatView
    result: DecisionResult
    release_outcome: str | None
    checkpoint_index: int | None


@dataclass
class EpisodeResult:
    episode_id: str
    decisions: list[DecisionRecord]
    utilities: dict[str, float]
    ground_truth: dict[str, Any]
    ladder_max_rung: int
    irreversible_actions: int
    blocked_actions: int


# --------------------------------------------------------------------------


class MockEngine:
    """Runs one episode. Deterministic given the seed; the models inside are not."""

    def __init__(self, episode: EpisodeSpec) -> None:
        episode.validate()
        self.episode = episode
        self.scenario = episode.scenario
        self.duration_s = float(episode.env_config["duration_s"])
        self.rng = random.Random(f"{episode.seed}:engine")
        self.now = 0.0
        self._counter = itertools.count()
        self._queue: list[tuple[float, int, str, dict[str, Any]]] = []

        self.seats = list(episode.specs)
        self.wake: dict[str, WakePolicy] = {
            seat: WakePolicy.from_spec(spec) for seat, spec in episode.specs.items()
        }
        self.injects_seen: dict[str, list[dict[str, Any]]] = {s: [] for s in self.seats}
        self.messages_seen: dict[str, list[dict[str, Any]]] = {s: [] for s in self.seats}
        self.pending_releases: dict[str, list[dict[str, Any]]] = {s: [] for s in self.seats}
        #: Actions this seat has *observed* anyone take. The seat's whole view of the
        #: ladder; never the true action log.
        self.observed_actions: dict[str, list[dict[str, Any]]] = {s: [] for s in self.seats}

        self.decisions: list[DecisionRecord] = []
        self._scheduled_decisions: dict[str, set[float]] = {s: set() for s in self.seats}
        self._own_action_costs: dict[str, list[dict[str, float]]] = {s: [] for s in self.seats}
        self._blocked = 0
        self._irreversible = 0
        self._max_rung = 0
        self._release_seq = itertools.count(1)
        self._degraded_since: dict[str, float] = {}
        self._severity = str((episode.env_config.get("storm") or {}).get("severity", "quiet"))

    # -- queue --------------------------------------------------------------

    def _push(self, at: float, kind: str, payload: dict[str, Any]) -> None:
        if at > self.duration_s:
            return
        heapq.heappush(self._queue, (max(at, self.now), next(self._counter), kind, payload))

    # -- feeds and visibility ----------------------------------------------

    def _feeds(self, seat: str) -> dict[str, float]:
        return {
            f["name"]: float(f["latency_minutes"])
            for f in self.episode.specs[seat]["information"]["feeds"]
        }

    def _feed_latency(self, seat: str, feed: str | None) -> float | None:
        """Sim seconds this seat waits, or None if it has no feed for this at all."""
        feeds = self._feeds(seat)
        if feed is not None:
            if feed not in feeds:
                return None  # inject_schema: a recipient without the feed never receives it
            return feeds[feed] * MINUTE
        if not feeds:
            return None
        return min(feeds.values()) * MINUTE

    def _clearance_ok(self, seat: str, classification: str | None) -> bool:
        if classification is None:
            return True
        ceiling = self.episode.specs[seat]["information"]["clearance"]
        return CLEARANCE_ORDER.index(classification) <= CLEARANCE_ORDER.index(ceiling)

    # -- filtered state -----------------------------------------------------

    def _storm_report(self, seat: str) -> dict[str, Any]:
        """What this seat's space-weather feed says, which may lag the true state."""
        latency = self._feed_latency(seat, "space_weather")
        if latency is None:
            return {"available": False}
        level = _STORM_LEVEL.get(self._severity, 0.0)
        # After the storm passes at hour 60 the reported level decays.
        if self.now > 60 * 3600:
            level *= 0.2
        return {
            "available": True,
            "severity_reported": self._severity,
            "sensor_confidence_multiplier": round(1.0 - 0.6 * level, 3),
            "comms_bandwidth_multiplier": round(1.0 - 0.7 * level, 3),
            "as_of_sim_time_s": max(0.0, self.now - latency),
        }

    def _own_assets(self, seat: str) -> list[dict[str, Any]]:
        cell = self.episode.grid_cell
        degraded_from = 0.5 * 3600
        if seat == "starlink":
            return [
                {
                    "asset_id": "arctic_plane_a",
                    "class": "constellation",
                    "status": "degraded" if self.now >= degraded_from else "nominal",
                    "note": "Arctic-tasked plane, elevated anomaly count",
                },
                {"asset_id": "arctic_plane_b", "class": "constellation", "status": "nominal"},
            ]
        if seat == "iridium":
            survives = bool(cell.get("iridium_survives", True))
            return [
                {
                    "asset_id": "polar_plane_1",
                    "class": "constellation",
                    "status": ("degraded" if survives else "safe_mode")
                    if self.now >= 3 * 3600
                    else "nominal",
                    "note": "the only remaining wideband path north of 74N"
                    if survives
                    else "no remaining wideband path north of 74N",
                }
            ]
        if seat == "norway":
            return [
                {
                    "asset_id": "svalsat",
                    "class": "ground_station",
                    "status": "degraded" if self.now >= 3600 else "nominal",
                },
                {"asset_id": "svalbard_cable_1", "class": "cable", "status": "nominal"},
                {"asset_id": "svalbard_cable_2", "class": "cable", "status": "nominal"},
                {"asset_id": "asbm_1", "class": "heo_node", "status": "nominal"},
            ]
        if seat == "northern_fleet":
            return [
                {"asset_id": "rf_sat_1", "class": "heo_node", "status": "nominal"},
                {"asset_id": "rf_sat_2", "class": "heo_node", "status": "nominal"},
                {"asset_id": "kola_ew_site", "class": "ground_site", "status": "nominal"},
            ]
        if seat == "usspacecom":
            return [
                {
                    "asset_id": "ssa_sensor_north",
                    "class": "pass_based_sensor",
                    "status": "degraded",
                },
                {"asset_id": "milsat_relay_1", "class": "heo_node", "status": "nominal"},
            ]
        return []

    def _observed_effects(self, seat: str) -> list[dict[str, Any]]:
        effects: list[dict[str, Any]] = []
        if self.now >= 1800 and seat in ("starlink", "norway", "northcom", "usspacecom", "iridium"):
            effects.append(
                {
                    "effect": "arctic_wideband_outage",
                    "first_seen_sim_time_s": 1800,
                    "severity": "major",
                    "telemetry_signature": (
                        "charging_consistent"
                        if seat not in ("usspacecom",)
                        else "charging_consistent_with_fast_rise_time"
                    ),
                }
            )
        if self.now >= 18 * 3600 and seat in ("usspacecom", "norway", "starlink"):
            effects.append(
                {
                    "effect": "close_approach",
                    "first_seen_sim_time_s": 18 * 3600,
                    "severity": "unresolved",
                    "detail": "a repositioned foreign spacecraft holding inside 30 km",
                }
            )
        return effects

    def _ladder_state(self, seat: str) -> dict[str, Any]:
        observed = self.observed_actions[seat]
        highest = max((rung()[a["action_type"]] for a in observed), default=0)
        return {
            "observed_actions": observed,
            "highest_observed_rung": highest,
            "note": "Only what this seat has seen. Actions it has not observed are absent, "
            "not zero.",
        }

    def build_view(self, seat: str, checkpoint_index: int | None = None) -> SeatView:
        spec = self.episode.specs[seat]
        wake = self.wake[seat]
        filtered_state = {
            "own_assets": self._own_assets(seat),
            "observed_effects": self._observed_effects(seat),
            "space_weather": self._storm_report(seat),
            "ladder_state": self._ladder_state(seat),
            "available_actions": menu_for_seat(seat, spec["authority"]),
            "clock": {
                "sim_time_s": self.now,
                "sim_hours_elapsed": round(self.now / 3600, 2),
                "sim_hours_remaining": round((self.duration_s - self.now) / 3600, 2),
                "next_poll_sim_time_s": self.now + wake.poll_minutes * MINUTE,
                "deliberation_minutes": wake.deliberation_minutes,
            },
            "pending_releases": list(self.pending_releases[seat]),
        }
        return SeatView(
            episode_id=self.episode.episode_id,
            seat=seat,
            sim_time_s=self.now,
            filtered_state=filtered_state,
            injects_seen=list(self.injects_seen[seat]),
            messages_seen=list(self.messages_seen[seat]),
            checkpoint_index=checkpoint_index,
        )

    # -- scheduling ---------------------------------------------------------

    def _seed_injects(self) -> None:
        for inject in self.scenario.injects:
            for seat in self.seats:
                recipients = inject["recipients"]
                if seat not in recipients and "all" not in recipients:
                    continue
                latency = self._feed_latency(seat, inject.get("feed"))
                if latency is None:
                    continue
                self._push(
                    inject["sim_time_s"] + latency,
                    "inject",
                    {"seat": seat, "inject": inject},
                )

    def _schedule_polls(self) -> None:
        for seat in self.seats:
            policy = self.wake[seat]
            t = 0.0
            while t <= self.duration_s:
                self._schedule_decision(seat, t)
                t += policy.poll_minutes * MINUTE

    def _schedule_decision(self, seat: str, at: float) -> None:
        at = max(at, self.now)
        if at in self._scheduled_decisions[seat]:
            return
        self._scheduled_decisions[seat].add(at)
        self._push(at, "decision_point", {"seat": seat})

    def _schedule_checkpoints(self) -> list[float]:
        clock = self.episode.env_config["clock_mode"]
        schedule_type = clock["schedule_type"]
        if schedule_type == "fixed":
            interval = float(clock["interval_s"])
            times = []
            t = 0.0
            while t <= self.duration_s:
                times.append(t)
                t += interval
            return times
        if schedule_type == "variable_tempo":
            return [float(t) for t in clock["checkpoints_s"] if t <= self.duration_s]
        # adaptive: nominal interval, pulled forward by triggers. The mock pulls the
        # next checkpoint forward to the knife inject and to each inject time within
        # [min_interval_s, max_interval_s] of the last one.
        nominal = float(clock.get("interval_s", clock["max_interval_s"]))
        lo, hi = float(clock["min_interval_s"]), float(clock["max_interval_s"])
        triggers = sorted({float(i["sim_time_s"]) for i in self.scenario.injects})
        times = [0.0]
        while times[-1] < self.duration_s:
            last = times[-1]
            pulled = next((t for t in triggers if last + lo <= t <= last + hi), None)
            nxt = pulled if pulled is not None else min(last + nominal, last + hi)
            if nxt <= last:
                nxt = last + lo
            times.append(nxt)
        return [t for t in times if t <= self.duration_s]

    # -- release ------------------------------------------------------------

    def _needs_release(self, seat: str, action_type: str) -> bool:
        spec = self.episode.specs[seat]
        if action_type in spec["authority"].get("requires_release", []):
            return True
        # env_config_schema: every irreversible action needs release regardless of spec.
        return action_type in irreversible()

    def _adjudicate(self, seat: str, action_type: str) -> tuple[str, float]:
        """Returns (outcome, sim-seconds until it is answered).

        Only `release_policy: auto` runs here — the generation lake is headless by
        construction (`docs/agent_workstreams.md`, Agent 3). Under `human` the engine
        routes to the nsc seat and pauses the clock, which is agent1's job and a demo
        path, not a generation path.
        """
        policy = self.episode.env_config["release_policy"]
        if policy["policy"] != "auto":
            raise RuntimeError(
                "gen only generates under release_policy 'auto'; "
                f"got {policy['policy']!r}. See docs/agent_workstreams.md, Agent 3."
            )
        per_action = policy.get("per_action_probability", {})
        probability = float(per_action.get(action_type, policy["approval_probability"]))
        draw = random.Random(
            f"{self.episode.seed}:release:{seat}:{action_type}:{next(self._release_seq)}"
        ).random()
        outcome = "granted" if draw < probability else "denied"
        return outcome, float(policy.get("delay_minutes", 0.0)) * MINUTE

    # -- effects ------------------------------------------------------------

    def _observers(self, actor: str, action_type: str) -> list[tuple[str, float]]:
        """(seat, sim-seconds of attribution lag) for everyone who eventually sees it."""
        out: list[tuple[str, float]] = []
        for seat in self.seats:
            if seat == actor:
                out.append((seat, 0.0))
                continue
            if action_type in _OVERT:
                out.append((seat, self._feed_latency(seat, "media") or 0.0))
                continue
            lag = TODO_CALIB_ATTRIBUTION_LAG_MINUTES.get(action_type)
            if lag is None:
                continue  # private_demarche, share_telemetry, request_* reach only the addressee
            jitter = random.Random(f"{self.episode.seed}:lag:{actor}:{seat}:{action_type}").uniform(
                0.6, 1.6
            )
            out.append((seat, lag * jitter * MINUTE))
        return out

    def _land_action(self, seat: str, decision: dict[str, Any]) -> None:
        action = decision["action"]
        action_type = action["type"]
        entry = next(e for e in ladder() if e["type"] == action_type)
        self._own_action_costs[seat].append(entry["costs"])
        self._max_rung = max(self._max_rung, entry["rung"])
        if entry["irreversible"]:
            self._irreversible += 1
        if action_type == "hold":
            return
        for observer, lag in self._observers(seat, action_type):
            record = {
                "action_type": action_type,
                "observed_at_sim_time_s": round(self.now + lag, 1),
                # An observer sees the effect, not necessarily who caused it.
                "attributed_to": seat if observer == seat or action_type in _OVERT else "unknown",
                "purpose": (action.get("params") or {}).get("purpose"),
            }
            self._push(self.now + lag, "observe_action", {"seat": observer, "record": record})

    def _route_messages(self, sender: str, decision: dict[str, Any]) -> None:
        for index, message in enumerate(decision.get("messages") or []):
            channel = message["channel"]
            base = CHANNEL_DELAY_MINUTES.get(channel, 30.0) * MINUTE
            to = message["to"]
            if to == "all" or (to == "public" and channel in PUBLIC_CHANNELS) or channel == "press":
                recipients = [s for s in self.seats if s != sender]
            elif to == "public":
                recipients = [s for s in self.seats if s != sender]
            elif channel == "internal":
                recipients = []
            else:
                recipients = [to] if to in self.seats else []
            for recipient in recipients:
                if not self._clearance_ok(recipient, message.get("classification")):
                    continue  # engine drops it and logs the drop
                feed = "media" if channel == "press" else None
                latency = self._feed_latency(recipient, feed)
                if latency is None:
                    continue
                self._push(
                    self.now + base + latency,
                    "message",
                    {
                        "seat": recipient,
                        "entry": {
                            "from": sender,
                            "message": message,
                            "delivered_at_sim_time_s": round(self.now + base + latency, 1),
                            "message_id": f"{self.episode.episode_id}-{sender}-"
                            f"{int(self.now)}-{index}",
                        },
                    },
                )

    # -- one decision -------------------------------------------------------

    async def _decide(
        self,
        agent: SeatAgent,
        seat: str,
        checkpoint_index: int | None,
        on_record: Callable[[DecisionRecord], Any] | None,
    ) -> tuple[DecisionRecord, dict[str, Any]] | None:
        view = self.build_view(seat, checkpoint_index)
        result = await agent.act(view)
        decision = result.decision
        action_type = decision["action"]["type"]

        blocked = action_type not in view.filtered_state["available_actions"]
        if blocked:
            self._blocked += 1

        release_outcome: str | None = "not_required"
        delay = 0.0
        if not blocked and self._needs_release(seat, action_type):
            release_outcome, delay = self._adjudicate(seat, action_type)

        record = DecisionRecord(
            episode_id=self.episode.episode_id,
            seat=seat,
            spec=self.episode.specs[seat],
            sim_time_s=self.now,
            view=view,
            result=result,
            release_outcome=release_outcome,
            checkpoint_index=checkpoint_index,
        )
        self.decisions.append(record)
        if on_record is not None:
            maybe = on_record(record)
            if asyncio.iscoroutine(maybe):
                await maybe
        return record, {"blocked": blocked, "release_outcome": release_outcome, "delay": delay}

    def _apply(self, record: DecisionRecord, meta: dict[str, Any]) -> None:
        seat, decision = record.seat, record.result.decision
        self._route_messages(seat, decision)
        if meta["blocked"] or meta["release_outcome"] == "denied":
            return
        landing = self.now + meta["delay"] + self.wake[seat].deliberation_minutes * MINUTE
        self._push(landing, "action_land", {"seat": seat, "decision": decision})

    # -- utility ------------------------------------------------------------

    def _utilities(self) -> dict[str, float]:
        """TODO_CALIB placeholder for `engine/utility.py`.

        Signs follow the convention `spec_schema.json` fixes: `asset_loss`,
        `escalation_risk` and `liability` are negated, the other five are positive. The
        magnitudes are this mock's invention and exist so `outcome_utility` is a number.
        """
        escalation = self._max_rung / 13.0
        out: dict[str, float] = {}
        for seat, spec in self.episode.specs.items():
            weights = spec["utility_weights"]
            costs = self._own_action_costs[seat]
            signaling = sum(c["signaling"] for c in costs) / max(len(costs), 1)
            degraded = [
                a for a in self._own_assets(seat) if a.get("status") in ("degraded", "safe_mode")
            ]
            asset_loss = len(degraded) / max(len(self._own_assets(seat)), 1)
            acted = sum(
                1
                for d in self.decisions
                if d.seat == seat and d.result.decision["action"]["type"] != "hold"
            )
            total_decisions = max(sum(1 for d in self.decisions if d.seat == seat), 1)
            activity = acted / total_decisions
            terms = {
                "asset_loss": asset_loss,
                "escalation_risk": escalation,
                "alliance_cohesion": 1.0 - signaling,
                "domestic_political": activity,
                "reputation_resolve": signaling,
                "revenue": 1.0 - asset_loss,
                "liability": signaling * asset_loss,
                "career": 1.0 - abs(activity - 0.5) * 2,
            }
            negated = {"asset_loss", "escalation_risk", "liability"}
            total_weight = sum(weights.values()) or 1.0
            utility = (
                sum(weights[k] * (-v if k in negated else v) for k, v in terms.items())
                / total_weight
            )
            out[seat] = round(utility, 4)
        return out

    # -- the loop -----------------------------------------------------------

    async def run(
        self,
        agents: dict[str, SeatAgent],
        on_record: Callable[[DecisionRecord], Any] | None = None,
    ) -> EpisodeResult:
        missing = set(self.seats) - set(agents)
        if missing:
            raise ValueError(f"no agent for seats {sorted(missing)}")
        self._seed_injects()
        if self.episode.clock_mode == "continuous":
            await self._run_continuous(agents, on_record)
        else:
            await self._run_checkpoint(agents, on_record)
        return EpisodeResult(
            episode_id=self.episode.episode_id,
            decisions=self.decisions,
            utilities=self._utilities(),
            ground_truth=self.scenario.ground_truth,
            ladder_max_rung=self._max_rung,
            irreversible_actions=self._irreversible,
            blocked_actions=self._blocked,
        )

    def _drain_until(self, until: float) -> list[tuple[str, dict[str, Any]]]:
        """Apply every non-decision event up to `until`; return decision points found."""
        pending: list[tuple[str, dict[str, Any]]] = []
        while self._queue and self._queue[0][0] <= until:
            at, _, kind, payload = heapq.heappop(self._queue)
            self.now = at
            if kind == "inject":
                seat = payload["seat"]
                self.injects_seen[seat].append(payload["inject"])
                if self.wake[seat].wake_on_inject:
                    self._schedule_decision(seat, at)
            elif kind == "message":
                seat = payload["seat"]
                self.messages_seen[seat].append(payload["entry"])
                if self.wake[seat].wake_on_inject:
                    self._schedule_decision(seat, at)
            elif kind == "observe_action":
                self.observed_actions[payload["seat"]].append(payload["record"])
            elif kind == "action_land":
                self._land_action(payload["seat"], payload["decision"])
            elif kind == "decision_point":
                pending.append((kind, payload))
        return pending

    async def _run_continuous(
        self,
        agents: dict[str, SeatAgent],
        on_record: Callable[[DecisionRecord], Any] | None,
    ) -> None:
        self._schedule_polls()
        while self._queue:
            at, _, kind, payload = heapq.heappop(self._queue)
            if at > self.duration_s:
                break
            self.now = at
            if kind == "decision_point":
                seat = payload["seat"]
                outcome = await self._decide(agents[seat], seat, None, on_record)
                if outcome is not None:
                    self._apply(*outcome)
            else:
                heapq.heappush(self._queue, (at, next(self._counter), kind, payload))
                self._drain_until(at)

    async def _run_checkpoint(
        self,
        agents: dict[str, SeatAgent],
        on_record: Callable[[DecisionRecord], Any] | None,
    ) -> None:
        seal = bool(self.episode.env_config["clock_mode"].get("seal_decisions", True))
        for index, at in enumerate(self._schedule_checkpoints()):
            self._drain_until(at)
            self.now = at
            if seal:
                # Sealed: every seat sees the same world, nobody sees another seat's
                # decision from this index. env_config_schema calls this the contract.
                views = {seat: self.build_view(seat, index) for seat in self.seats}
                outcomes = await asyncio.gather(
                    *(
                        self._decide_prebuilt(agents[s], s, views[s], index, on_record)
                        for s in self.seats
                    )
                )
                for outcome in outcomes:
                    if outcome is not None:
                        self._apply(*outcome)
            else:
                for seat in self.seats:
                    outcome = await self._decide(agents[seat], seat, index, on_record)
                    if outcome is not None:
                        self._apply(*outcome)
        self._drain_until(self.duration_s)

    async def _decide_prebuilt(
        self,
        agent: SeatAgent,
        seat: str,
        view: SeatView,
        checkpoint_index: int,
        on_record: Callable[[DecisionRecord], Any] | None,
    ) -> tuple[DecisionRecord, dict[str, Any]] | None:
        result = await agent.act(view)
        decision = result.decision
        action_type = decision["action"]["type"]
        blocked = action_type not in view.filtered_state["available_actions"]
        if blocked:
            self._blocked += 1
        release_outcome: str | None = "not_required"
        delay = 0.0
        if not blocked and self._needs_release(seat, action_type):
            release_outcome, delay = self._adjudicate(seat, action_type)
        record = DecisionRecord(
            episode_id=self.episode.episode_id,
            seat=seat,
            spec=self.episode.specs[seat],
            sim_time_s=view.sim_time_s,
            view=view,
            result=result,
            release_outcome=release_outcome,
            checkpoint_index=checkpoint_index,
        )
        self.decisions.append(record)
        if on_record is not None:
            maybe = on_record(record)
            if asyncio.iscoroutine(maybe):
                await maybe
        return record, {"blocked": blocked, "release_outcome": release_outcome, "delay": delay}
