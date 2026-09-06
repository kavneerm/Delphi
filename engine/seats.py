"""Per-seat filtered views, message routing, and the decision clock.

The engine's central asymmetry lives here. A seat sees exactly the feeds its
spec lists, each with its own latency and confidence scale; it sees an effect's
telemetry signature only if it operates hardware; it sees a message only if the
channel delivered it and its clearance covers it. Everything else is invisible,
and `filtered_view()` is the only way anything reaches an agent.

`contracts/lake_record_schema.json` is strict about this: `filtered_state`
becomes the user turn of a training example, so a leak here trains a model to
know things it will not know at evaluation. The rule enforced in this module is
simple — no ground truth, no other seat's `private_type`, no undelivered
message, and no storm state beyond what the seat's own space-weather feed said.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any

from engine.contracts import ACTORS, RUNG, SEATS

__all__ = ["SeatState", "Seats", "channel_feed"]

#: Which spec feed a channel arrives on, for latency purposes.
CHANNEL_FEED: dict[str, str] = {
    "diplomatic": "liaison_norway",
    "mil_to_mil": "partner_telemetry",
    "liaison": "liaison_norway",
    "commercial": "customer_reports",
    "press": "media",
    "internal": "internal_reporting",
    "back_channel": "internal_reporting",
    "hotline": "internal_reporting",
}

#: Channels that survive a degraded comms picture. Everything else is at risk.
ROBUST_CHANNELS = frozenset({"hotline", "back_channel", "diplomatic"})

#: Feeds through which a seat learns about someone else's problem.
THIRD_PARTY_FEEDS = (
    "ssa_catalog",
    "commercial_ssa",
    "partner_telemetry",
    "allied_intel",
    "sigint",
    "osint",
    "media",
    "customer_reports",
)
OWN_FEEDS = ("own_telemetry", "ground_station_status", "cable_status", "internal_reporting")


def channel_feed(channel: str) -> str:
    return CHANNEL_FEED.get(channel, "media")


@dataclass
class SeatState:
    """One seat's private bookkeeping. Never handed to another seat."""

    seat: str
    spec: dict[str, Any]
    injects_seen: list[dict[str, Any]] = field(default_factory=list)
    messages_seen: list[dict[str, Any]] = field(default_factory=list)
    observed_actions: list[dict[str, Any]] = field(default_factory=list)
    space_weather: dict[str, Any] = field(default_factory=dict)
    pending_releases: list[dict[str, Any]] = field(default_factory=list)
    last_decision_s: int | None = None
    next_poll_s: int | None = None
    decision_count: int = 0
    #: Set once at episode end, for the lake record's outcome_utility.
    utility: float | None = None

    # --- spec accessors ------------------------------------------------------

    @property
    def clearance(self) -> str:
        return str(self.spec["information"]["clearance"])

    @property
    def feeds(self) -> dict[str, dict[str, Any]]:
        return {f["name"]: f for f in self.spec["information"]["feeds"]}

    @property
    def poll_minutes(self) -> float:
        return float(self.spec["decision_clock"]["poll_minutes"])

    @property
    def wake_on_inject(self) -> bool:
        return bool(self.spec["decision_clock"]["wake_on_inject"])

    @property
    def deliberation_s(self) -> int:
        return int(round(float(self.spec["decision_clock"]["deliberation_minutes"]) * 60))

    @property
    def authority(self) -> dict[str, list[str]]:
        return self.spec["authority"]

    def feed_latency_s(self, name: str, default_minutes: float = 60.0) -> int:
        feed = self.feeds.get(name)
        minutes = float(feed["latency_minutes"]) if feed else default_minutes
        return int(round(minutes * 60.0))

    def has_feed(self, name: str) -> bool:
        return name in self.feeds

    def confidence_scale(self, name: str) -> float:
        feed = self.feeds.get(name)
        return float(feed["confidence_scale"]) if feed else 0.5

    def own_latency_s(self) -> int:
        """Fastest feed onto its own hardware."""
        present = [self.feed_latency_s(f) for f in OWN_FEEDS if self.has_feed(f)]
        return min(present) if present else 3600

    def third_party_latency_s(self) -> int:
        """Fastest feed onto somebody else's problem."""
        present = [self.feed_latency_s(f) for f in THIRD_PARTY_FEEDS if self.has_feed(f)]
        return min(present) if present else 7200

    def snapshot(self) -> dict[str, Any]:
        return {
            "injects_seen": copy.deepcopy(self.injects_seen),
            "messages_seen": copy.deepcopy(self.messages_seen),
            "observed_actions": copy.deepcopy(self.observed_actions),
            "space_weather": copy.deepcopy(self.space_weather),
            "pending_releases": copy.deepcopy(self.pending_releases),
            "last_decision_s": self.last_decision_s,
            "next_poll_s": self.next_poll_s,
            "decision_count": self.decision_count,
            "utility": self.utility,
        }

    def restore(self, snap: dict[str, Any]) -> None:
        self.injects_seen = copy.deepcopy(snap["injects_seen"])
        self.messages_seen = copy.deepcopy(snap["messages_seen"])
        self.observed_actions = copy.deepcopy(snap["observed_actions"])
        self.space_weather = copy.deepcopy(snap["space_weather"])
        self.pending_releases = copy.deepcopy(snap["pending_releases"])
        self.last_decision_s = snap["last_decision_s"]
        self.next_poll_s = snap["next_poll_s"]
        self.decision_count = int(snap["decision_count"])
        self.utility = snap["utility"]


class Seats:
    """The nine seats, their views, and the routing between them."""

    def __init__(self, specs: dict[str, dict[str, Any]], clearance_order: list[str]) -> None:
        self.states: dict[str, SeatState] = {
            seat: SeatState(seat=seat, spec=specs[seat]) for seat in SEATS if seat in specs
        }
        self.clearance_order = list(clearance_order)

    def __getitem__(self, seat: str) -> SeatState:
        return self.states[seat]

    def __contains__(self, seat: str) -> bool:
        return seat in self.states

    @property
    def played(self) -> tuple[str, ...]:
        return tuple(seat for seat in SEATS if seat in self.states)

    # --- clearance -----------------------------------------------------------

    def clearance_rank(self, level: str) -> int:
        try:
            return self.clearance_order.index(level)
        except ValueError:
            return 0

    def can_read(self, seat: str, classification: str) -> bool:
        state = self.states.get(seat)
        if state is None:
            return False
        return self.clearance_rank(classification) <= self.clearance_rank(state.clearance)

    # --- routing -------------------------------------------------------------

    def resolve_recipients(self, to: str) -> list[str]:
        """`all` is every played seat; `public` is every seat with a media feed."""
        if to == "all":
            return list(self.played)
        if to == "public":
            return [s for s in self.played if self.states[s].has_feed("media")]
        if to in self.states:
            return [to]
        return []

    def delivery_delay_s(
        self,
        recipient: str,
        channel: str,
        channel_delay_minutes: dict[str, float],
    ) -> int:
        base = int(round(float(channel_delay_minutes.get(channel, 60)) * 60.0))
        state = self.states.get(recipient)
        if state is None:
            return base
        feed = channel_feed(channel)
        latency = state.feed_latency_s(feed, default_minutes=30.0) if state.has_feed(feed) else 0
        return base + latency

    def drop_reason(
        self,
        recipient: str,
        message: dict[str, Any],
        sender_clearance: str,
        comms_multiplier: float,
    ) -> str | None:
        """Why this message will never arrive, or None if it will."""
        if recipient not in self.states:
            return "no_such_recipient"
        classification = str(message.get("classification") or sender_clearance)
        if not self.can_read(recipient, classification):
            return "clearance"
        channel = str(message.get("channel"))
        if channel not in ROBUST_CHANNELS and comms_multiplier < 0.40:
            return "channel_severed"
        return None

    # --- delivery ------------------------------------------------------------

    def deliver_message(
        self, recipient: str, sender: str, message: dict[str, Any], now_s: int, message_id: str
    ) -> None:
        state = self.states.get(recipient)
        if state is None:
            return
        state.messages_seen.append(
            {
                "from": sender,
                "message": copy.deepcopy(message),
                "delivered_at_sim_time_s": int(now_s),
                "message_id": message_id,
            }
        )

    def deliver_inject(self, recipient: str, inject: dict[str, Any], now_s: int) -> None:
        state = self.states.get(recipient)
        if state is None:
            return
        seen = copy.deepcopy(inject)
        # The seat sees the confidence its own feed reports, not the author's.
        feed = str(inject.get("feed") or "")
        scale = state.confidence_scale(feed) if feed else 1.0
        seen["confidence"] = round(min(1.0, max(0.0, float(inject["confidence"]) * scale)), 4)
        seen["delivered_at_sim_time_s"] = int(now_s)
        # `truthful` is a scoring key, never a seat's business.
        seen.pop("truthful", None)
        seen.pop("is_knife_inject", None)
        state.injects_seen.append(seen)

    def observe_action(
        self, observer: str, actor: str, action_type: str, now_s: int, detail: str = ""
    ) -> None:
        state = self.states.get(observer)
        if state is None:
            return
        state.observed_actions.append(
            {
                "actor": actor,
                "action_type": action_type,
                "rung": RUNG.get(action_type, 0),
                "observed_at_sim_time_s": int(now_s),
                "detail": detail,
            }
        )

    # --- the view ------------------------------------------------------------

    def available_actions(self, seat: str) -> list[str]:
        """The menu the engine will actually accept from this seat.

        `allowed_seats` intersected with the spec's authority. `recommend_only`
        is excluded by construction: a seat can put it in a message, never in an
        action.
        """
        state = self.states[seat]
        auth = state.authority
        allowed = list(dict.fromkeys(list(auth["unilateral"]) + list(auth["requires_release"])))
        menu = [a for a in allowed if a in RUNG]
        if "hold" not in menu:
            menu.insert(0, "hold")
        return sorted(menu, key=lambda a: RUNG[a])

    def filtered_view(
        self,
        seat: str,
        *,
        world: Any,
        attacks: Any,
        now_s: int,
        end_time_s: int,
        storm_multipliers: dict[str, float],
        release_queue: list[dict[str, Any]],
        clock_mode: str,
    ) -> dict[str, Any]:
        """Everything this seat knows, and nothing else.

        Deliberately reconstructed from scratch each call rather than mutated in
        place, so a bug can leak at most one decision point rather than
        accumulating into the record.
        """
        state = self.states[seat]
        owned = set(world.assets_of(seat)) | set(world.ground_of(seat))

        own_assets: list[dict[str, Any]] = []
        for asset_id, asset in world.assets_of(seat).items():
            entry: dict[str, Any] = {
                "asset_id": asset_id,
                "name": asset.get("name"),
                "asset_class": asset.get("asset_class"),
                "mission": asset.get("mission"),
                "safe_mode": bool(asset.get("safe_mode", False)),
                "service_multiplier": round(float(asset.get("service_multiplier", 1.0)), 3),
            }
            if "delta_v_budget_mps" in asset:
                entry["delta_v_remaining_mps"] = round(float(asset["delta_v_budget_mps"]), 2)
            if asset.get("asset_class") == "constellation":
                entry["members_active"] = int(asset.get("members_active", 0))
                entry["members_safe_mode"] = int(asset.get("members_safe_mode", 0))
                entry["members_lost"] = int(asset.get("members_lost", 0))
                entry["capacity_gbps"] = round(float(asset.get("capacity_gbps", 0.0)), 2)
            if asset.get("orbit"):
                entry["ground_track"] = world.track(asset_id, now_s)
            if asset.get("asset_class") == "pass_sensor":
                entry["pass_open"] = world.pass_open(asset_id, now_s)
                entry["sensor_health"] = round(float(asset.get("sensor_health", 1.0)), 3)
            own_assets.append(entry)
        for ground_id, node in world.ground_of(seat).items():
            own_assets.append(
                {
                    "asset_id": ground_id,
                    "name": node.get("name"),
                    "asset_class": node.get("kind"),
                    "status": node.get("status"),
                    "capacity_gbps": node.get("capacity_gbps"),
                    "slots_available": node.get("slots_available"),
                }
            )

        own_latency = state.own_latency_s()
        third_latency = state.third_party_latency_s()
        observed: list[dict[str, Any]] = []
        for view in attacks.visible_to(seat, now_s, owned):
            latency = own_latency if view.get("own_asset") else third_latency
            if view["observed_since_s"] + latency > now_s:
                continue
            entry = dict(view)
            entry["observed_since_s"] = view["observed_since_s"] + latency
            observed.append(entry)

        ladder_state = {
            "highest_rung_observed": max([0] + [int(a["rung"]) for a in state.observed_actions]),
            "actions_observed": list(state.observed_actions),
            "own_rung": max(
                [0]
                + [
                    RUNG.get(str(a.get("action_type")), 0)
                    for a in state.observed_actions
                    if a.get("actor") == seat
                ]
            ),
        }

        my_releases = [
            r
            for r in release_queue
            if r.get("releasing_seat") == seat or r.get("requesting_seat") == seat
        ]
        pending = [
            {
                "release_id": r["release_id"],
                "action_type": r["action"]["type"],
                "requesting_seat": r["requesting_seat"],
                "releasing_seat": r["releasing_seat"],
                "requested_at_sim_time_s": r["requested_at_sim_time_s"],
                "must_answer": r.get("releasing_seat") == seat,
                "justification": r.get("justification", ""),
            }
            for r in my_releases
            if r.get("status") == "pending"
        ]

        return {
            "seat": seat,
            "own_assets": own_assets,
            "observed_effects": observed,
            "space_weather": copy.deepcopy(state.space_weather),
            "ladder_state": ladder_state,
            "available_actions": self.available_actions(seat),
            "clock": {
                "sim_time_s": int(now_s),
                "sim_hours_elapsed": round(now_s / 3600.0, 3),
                "hours_remaining": round(max(0, end_time_s - now_s) / 3600.0, 3),
                "next_poll_s": state.next_poll_s,
                "deliberation_minutes": state.deliberation_s / 60.0,
                "clock_mode": clock_mode,
            },
            "pending_releases": pending,
            "degradation": {
                "sensor_confidence_multiplier": storm_multipliers.get("sensor_confidence", 1.0),
                "comms_bandwidth_multiplier": storm_multipliers.get("comms_bandwidth", 1.0),
                "arctic_capacity_gbps": world.arctic_capacity_gbps(),
            },
            "injects_seen": copy.deepcopy(state.injects_seen),
            "messages_seen": copy.deepcopy(state.messages_seen),
            "authority": copy.deepcopy(state.authority),
            "counterparts": [a for a in ACTORS if a != seat],
        }

    # --- snapshot ------------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        return {seat: state.snapshot() for seat, state in sorted(self.states.items())}

    def restore(self, snap: dict[str, Any]) -> None:
        for seat, state in self.states.items():
            if seat in snap:
                state.restore(snap[seat])
