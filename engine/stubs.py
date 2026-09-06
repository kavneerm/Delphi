"""Scripted agents, so a full episode runs with no model in the loop.

Three policies, per `docs/agent_workstreams.md`:

* **hold** — never leaves rung 0. The floor: any metric this population scores
  is the metric of doing nothing.
* **random_in_menu** — samples uniformly from the menu the engine will actually
  accept from that seat. Deliberately dumb, and useful precisely because it
  exercises rungs a sensible agent would not: blocked actions, release requests,
  irreversible actions under `auto`.
* **aggressive** — climbs the ladder as the picture degrades. Beliefs move with
  the evidence the seat has actually seen, so it produces a plausible-looking
  trace to build the UI and the lake plumbing against.

All three are seeded off the episode RNG, so a stub run is as reproducible as
any other. None of them calls anything.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from engine.agent_api import BaseAgent, WakePolicy, default_params_for, hold_decision
from engine.contracts import RUNG

__all__ = ["AggressiveStub", "HoldStub", "RandomStub", "STUB_POLICIES", "build_stubs"]


def _evidence(view: Mapping[str, Any]) -> dict[str, float]:
    """How bad it looks from here, from the view alone.

    `interference` counts signature evidence, which only operator seats have;
    every other seat reads the same outage with `unknown` and cannot climb on it.
    """
    effects = list(view.get("observed_effects") or [])
    ongoing = [e for e in effects if e.get("ongoing")]
    interference = sum(
        1
        for e in effects
        if e.get("telemetry_signature") in ("interference", "cyber_anomaly", "proximity")
    )
    natural = sum(1 for e in effects if e.get("telemetry_signature") == "natural")
    hostile_injects = sum(
        1
        for i in view.get("injects_seen") or []
        if any(
            word in str(i.get("content", "")).lower()
            for word in ("claims responsibility", "inconsistent with", "deliberate")
        )
    )
    degradation = 1.0 - float(
        (view.get("degradation") or {}).get("sensor_confidence_multiplier", 1.0)
    )
    return {
        "ongoing": float(len(ongoing)),
        "interference": float(interference),
        "natural": float(natural),
        "hostile_injects": float(hostile_injects),
        "storm": round(degradation, 4),
    }


def _beliefs(view: Mapping[str, Any], prior: Mapping[str, Any]) -> dict[str, Any]:
    """Move the persona's priors with what the seat has actually seen."""
    ev = _evidence(view)
    hostile = float(prior.get("p_hostile_prior", 0.3))
    natural = float(prior.get("p_natural_prior", 0.4))
    unknown = float(prior.get("p_unknown_prior", 0.3))
    hostile += 0.12 * ev["interference"] + 0.05 * ev["hostile_injects"]
    natural += 0.10 * ev["natural"] + 0.35 * ev["storm"]
    unknown += 0.05 * ev["ongoing"] - 0.05 * (ev["interference"] + ev["natural"])
    hostile, natural, unknown = (max(0.01, v) for v in (hostile, natural, unknown))
    total = hostile + natural + unknown
    hostile, natural, unknown = (round(v / total, 4) for v in (hostile, natural, unknown))
    # Rounding three numbers independently need not leave them summing to 1.
    unknown = round(1.0 - hostile - natural, 4)
    per_actor: dict[str, float] = {}
    if hostile > 0.35:
        per_actor = {"northern_fleet": round(min(0.9, hostile * 0.7), 4)}
        if ev["hostile_injects"]:
            per_actor["hacktivist_injects"] = round(min(0.5, hostile * 0.3), 4)
    return {
        "hostile": hostile,
        "natural": natural,
        "unknown": unknown,
        "per_actor": per_actor,
    }


class HoldStub(BaseAgent):
    """Does nothing, in character."""

    policy = "hold"

    def act(self, view: Mapping[str, Any]) -> Mapping[str, Any]:
        beliefs = _beliefs(view, self.spec.get("priors") or {})
        decision = hold_decision(
            "Nothing in the picture yet justifies moving. Waiting for the next feed update."
        )
        decision["beliefs"] = beliefs
        return decision


class RandomStub(BaseAgent):
    """Uniform over the seat's own menu. Exercises rungs nobody sensible takes."""

    policy = "random_in_menu"

    def __init__(self, seat: str, spec: Mapping[str, Any], rng: Any) -> None:
        super().__init__(seat, spec)
        self.rng = rng

    def act(self, view: Mapping[str, Any]) -> Mapping[str, Any]:
        menu = list(view.get("available_actions") or ["hold"])
        now = int((view.get("clock") or {}).get("sim_time_s", 0))
        book = self.rng.book(f"stub_random:{self.seat}:{now}")
        action_type = menu[book.randrange(len(menu))]
        decision = {
            "beliefs": _beliefs(view, self.spec.get("priors") or {}),
            "messages": [],
            "action": {
                "type": action_type,
                "params": default_params_for(action_type, seat=self.seat, view=view),
            },
            "reasoning": (
                f"Sampling the menu at {self.seat}: {action_type}. This is a stub, and the "
                "reasoning is here so the record has the right shape, not because it is good."
            ),
        }
        if action_type != "hold" and book.random() < 0.35:
            decision["messages"] = [
                {
                    "to": "all" if book.random() < 0.3 else "nsc",
                    "channel": "liaison",
                    "text": f"{self.seat} is taking {action_type} and is telling you so.",
                }
            ]
        return decision


class AggressiveStub(BaseAgent):
    """Climbs the ladder as the picture degrades, within its own authority."""

    policy = "aggressive"

    def __init__(self, seat: str, spec: Mapping[str, Any], rng: Any) -> None:
        super().__init__(seat, spec)
        self.rng = rng

    def act(self, view: Mapping[str, Any]) -> Mapping[str, Any]:
        beliefs = _beliefs(view, self.spec.get("priors") or {})
        menu = list(view.get("available_actions") or ["hold"])
        now = int((view.get("clock") or {}).get("sim_time_s", 0))
        elapsed_h = float((view.get("clock") or {}).get("sim_hours_elapsed", 0.0))
        book = self.rng.book(f"stub_aggressive:{self.seat}:{now}")

        # A ceiling that rises with belief, time and the board's own rung.
        observed_rung = int((view.get("ladder_state") or {}).get("highest_rung_observed", 0))
        pressure = beliefs["hostile"] + 0.02 * elapsed_h + 0.05 * observed_rung
        ceiling = 0
        for threshold, rung in ((0.35, 2), (0.5, 5), (0.65, 7), (0.8, 9), (1.05, 11)):
            if pressure >= threshold:
                ceiling = rung
        reachable = [a for a in menu if RUNG.get(a, 99) <= ceiling]
        if not reachable:
            reachable = ["hold"]
        # Pick the highest reachable rung most of the time, one below sometimes.
        reachable.sort(key=lambda a: RUNG.get(a, 0))
        pick = reachable[-1] if book.random() < 0.6 or len(reachable) == 1 else reachable[-2]
        if book.random() < 0.25:
            pick = "hold"
        decision: dict[str, Any] = {
            "beliefs": beliefs,
            "messages": [],
            "action": {
                "type": pick,
                "params": default_params_for(pick, seat=self.seat, view=view),
            },
            "reasoning": (
                f"Hostile probability at {beliefs['hostile']:.2f} after {elapsed_h:.1f} hours, "
                f"highest rung observed {observed_rung}. Taking {pick}."
            ),
        }
        if pick != "hold" and RUNG.get(pick, 0) >= 3:
            decision["messages"] = [
                {
                    "to": "all",
                    "channel": "press" if pick == "public_attribution" else "liaison",
                    "text": (
                        f"{self.seat}: we assess the Arctic degradation at "
                        f"{beliefs['hostile']:.0%} likely hostile and are acting accordingly."
                    ),
                }
            ]
        return decision

    def decide_release(
        self, request: Mapping[str, Any], view: Mapping[str, Any]
    ) -> tuple[bool, str]:
        """An aggressive releasing seat grants when it already believes."""
        beliefs = _beliefs(view, self.spec.get("priors") or {})
        if beliefs["hostile"] >= 0.55:
            return True, (
                f"Released. Hostile probability {beliefs['hostile']:.2f} is above the threshold "
                "this seat is willing to act on."
            )
        return False, (
            f"Denied. Hostile probability {beliefs['hostile']:.2f} does not carry an action of "
            "this weight."
        )


STUB_POLICIES = ("hold", "random_in_menu", "aggressive")


def build_stubs(
    specs: Mapping[str, Mapping[str, Any]],
    rng: Any,
    *,
    policy: str | Mapping[str, str] = "aggressive",
) -> dict[str, Any]:
    """One stub per seat. `policy` is a name for all, or a map per seat."""
    agents: dict[str, Any] = {}
    for seat in sorted(specs):
        name = policy if isinstance(policy, str) else policy.get(seat, "aggressive")
        if name == "hold":
            agents[seat] = HoldStub(seat, specs[seat])
        elif name == "random_in_menu":
            agents[seat] = RandomStub(seat, specs[seat], rng)
        else:
            agents[seat] = AggressiveStub(seat, specs[seat], rng)
    return agents


def stub_wake_policy(spec: Mapping[str, Any]) -> WakePolicy:
    return WakePolicy.from_spec(spec)
