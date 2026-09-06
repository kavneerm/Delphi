"""The interface a real agent implements.

This is the seam between the engine and everything that thinks. `gen/agent.py`,
`train/serve.py`, `engine/stubs.py` and `engine/human_agent.py` all satisfy it,
and the engine cannot tell them apart.

    class MyAgent(BaseAgent):
        def act(self, view):
            return {"beliefs": ..., "messages": [...], "action": {...},
                    "reasoning": "..."}

Three members matter:

* **`observe()`** returns this seat's filtered state — exactly what
  `engine/seats.py` produced, and nothing else. It takes no arguments because
  the engine binds a view provider before the episode starts, so an agent can
  pull its own picture between decision points (a human at the NSC seat does
  exactly that).
* **`act(view)`** returns one decision matching `contracts/action_schema.json`.
  The engine validates it, and an invalid decision becomes a logged `hold`
  rather than a crashed episode — a served model that drifts should cost one
  decision point, not a sweep cell.
* **`wake_policy`** is the seat's decision clock. Under
  `clock_mode: continuous` the engine reads all of it; under `checkpoint` only
  `deliberation_minutes` still applies.

`default_params_for()` is here rather than in the stubs because `gen/prompt.py`
needs the same thing on a schema-failure retry: the minimum params that make an
action type valid for a given seat and view.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

from engine.contracts import ACTION_TYPES, RUNG, validator

__all__ = [
    "Agent",
    "BaseAgent",
    "WakePolicy",
    "coerce_decision",
    "default_params_for",
    "hold_decision",
    "validate_decision",
]


@dataclass(frozen=True)
class WakePolicy:
    """When a seat decides and how long it takes to act."""

    poll_minutes: float = 60.0
    wake_on_inject: bool = True
    deliberation_minutes: float = 30.0

    @staticmethod
    def from_spec(spec: Mapping[str, Any]) -> WakePolicy:
        clock = spec.get("decision_clock") or {}
        return WakePolicy(
            poll_minutes=float(clock.get("poll_minutes", 60.0)),
            wake_on_inject=bool(clock.get("wake_on_inject", True)),
            deliberation_minutes=float(clock.get("deliberation_minutes", 30.0)),
        )


@runtime_checkable
class Agent(Protocol):
    """What the engine requires of anything occupying a seat."""

    seat: str
    spec: Mapping[str, Any]
    wake_policy: WakePolicy

    def bind(self, view_provider: Callable[[], Mapping[str, Any]]) -> None:
        """Engine hands the agent a way to pull its own filtered state."""

    def observe(self) -> Mapping[str, Any]:
        """This seat's filtered state right now."""

    def act(self, view: Mapping[str, Any]) -> Mapping[str, Any]:
        """One decision per `contracts/action_schema.json`."""

    def on_episode_end(self, summary: Mapping[str, Any]) -> None:
        """Utilities and ground truth, after the last line is written."""


class BaseAgent:
    """Everything except `act()`. Subclass this."""

    def __init__(self, seat: str, spec: Mapping[str, Any]) -> None:
        self.seat = seat
        self.spec = spec
        self.wake_policy = WakePolicy.from_spec(spec)
        self._view_provider: Callable[[], Mapping[str, Any]] | None = None

    def bind(self, view_provider: Callable[[], Mapping[str, Any]]) -> None:
        self._view_provider = view_provider

    def observe(self) -> Mapping[str, Any]:
        if self._view_provider is None:
            raise RuntimeError(f"agent for seat {self.seat} is not bound to an engine")
        return self._view_provider()

    def act(self, view: Mapping[str, Any]) -> Mapping[str, Any]:  # pragma: no cover - abstract
        raise NotImplementedError

    def decide_release(
        self, request: Mapping[str, Any], view: Mapping[str, Any]
    ) -> tuple[bool, str]:
        """Answer a release request routed to this seat.

        Returns `(granted, rationale)`. The default is to deny: silence is not
        consent, and `contracts/env_config_schema.json` says so for the human
        timeout case too.
        """
        return False, "No release. The case for it has not been made."

    def on_episode_end(self, summary: Mapping[str, Any]) -> None:
        return None


# --- decisions ----------------------------------------------------------------


def hold_decision(reasoning: str = "Hold and watch the next feed update.") -> dict[str, Any]:
    """A valid, minimal decision. The fallback for anything that goes wrong."""
    return {
        "beliefs": {"hostile": 0.2, "natural": 0.5, "unknown": 0.3, "per_actor": {}},
        "messages": [],
        "action": {"type": "hold", "params": {}},
        "reasoning": reasoning,
    }


def default_params_for(action_type: str, *, seat: str, view: Mapping[str, Any]) -> dict[str, Any]:
    """The minimum params that make this action type valid, from what the seat sees.

    Used by the stubs to build actions and by a generator retrying after a
    schema failure. Targets are drawn from the view, never from world state, so
    this cannot leak anything the seat could not see.
    """
    own = [a.get("asset_id") for a in view.get("own_assets") or [] if a.get("asset_id")]
    own_orbital = [
        a.get("asset_id")
        for a in view.get("own_assets") or []
        if a.get("asset_class") in ("heo_node", "constellation")
    ]
    seen = [
        e.get("target_asset_id")
        for e in view.get("observed_effects") or []
        if e.get("target_asset_id") and not e.get("own_asset")
    ]
    target = seen[0] if seen else "unknown_object"
    params: dict[str, Any] = {}
    if action_type == "maneuver":
        params = {"asset_id": (own_orbital or own or ["unknown_asset"])[0], "delta_v_mps": 5.0}
    elif action_type == "private_demarche":
        params = {"recipient": "kremlin" if seat not in ("kremlin", "northern_fleet") else "nsc"}
    elif action_type == "public_attribution":
        params = {"attributed_actor": "unknown", "confidence_stated": 0.4}
    elif action_type == "request_commercial_priority":
        params = {"provider": "iridium", "capability": "arctic_bandwidth"}
    elif action_type == "share_telemetry":
        params = {
            "recipient": "norway" if seat != "norway" else "usspacecom",
            "data_class": "ssa_tracks",
        }
    elif action_type == "geofence_or_throttle":
        params = {"region": "north_of_74n", "mode": "throttle", "service_tier": "consumer"}
    elif action_type == "disclose_incident":
        params = {"scope": "customers", "detail_level": "minimal"}
    elif action_type in ("jam", "dazzle"):
        params = {"target_asset_id": target, "duration_minutes": 60}
    elif action_type == "ground_cyber":
        params = {"target_system": "gateway", "effect": "degrade"}
    elif action_type == "counter_rpo":
        params = {
            "asset_id": (own_orbital or own or ["unknown_asset"])[0],
            "target_asset_id": target,
            "standoff_km": 50,
        }
    elif action_type == "kinetic":
        params = {"target_asset_id": target, "weapon_class": "unspecified"}
    elif action_type == "terrestrial_response":
        params = {"target_id": target, "response_class": "sanctions"}
    return params


def validate_decision(decision: Mapping[str, Any]) -> list[str]:
    """Contract errors in a decision. Empty list means valid."""
    errors = [e.message for e in validator("action_schema.json").iter_errors(dict(decision))]
    beliefs = (decision.get("beliefs") or {}) if isinstance(decision, Mapping) else {}
    try:
        total = float(beliefs["hostile"]) + float(beliefs["natural"]) + float(beliefs["unknown"])
    except (KeyError, TypeError, ValueError):
        return errors
    if abs(total - 1.0) > 0.01:
        errors.append(f"beliefs hostile+natural+unknown must sum to 1.0, got {total:.3f}")
    return errors


def coerce_decision(decision: Any, *, seat: str) -> tuple[dict[str, Any], list[str]]:
    """Make a decision safe to apply. Returns (decision, errors it had).

    An invalid decision becomes a `hold` that says why, so the episode keeps its
    shape and the failure is visible in the log rather than fatal.
    """
    if not isinstance(decision, Mapping):
        return hold_decision(f"Malformed decision from seat {seat}; holding."), [
            "decision is not an object"
        ]
    errors = validate_decision(decision)
    if errors:
        return hold_decision(
            f"Decision from seat {seat} failed schema validation; holding. {errors[0]}"
        ), errors
    action_type = str(decision["action"]["type"])
    if action_type not in ACTION_TYPES or action_type not in RUNG:  # pragma: no cover
        return hold_decision(f"Unknown action {action_type}; holding."), ["unknown action type"]
    return dict(decision), []
