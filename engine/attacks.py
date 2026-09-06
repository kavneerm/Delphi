"""Four attack types, and the effects they leave behind.

`jam`, `dazzle`, `ground_cyber` and `rpo` (reached through the `counter_rpo`
rung). Each one produces an **effect** — an observable degradation with a start,
a magnitude and an end — and each effect carries two things that decide how hard
the scenario is:

* a **telemetry signature**, `natural` or `interference` or `cyber_anomaly` or
  `proximity`, which only operator seats can read (`contracts.OPERATOR_SEATS`);
  every other seat sees the outage and not what it looks like underneath;
* an **attribution lag**, drawn per effect from a per-type distribution, after
  which the cause becomes establishable rather than merely suspected.

Storm-driven outages are effects too, with signature `natural`. That is the
whole point: the same observable, two causes, and one flag that a minority of
seats can see.

Distributions come from `calib/attribution_lags.csv` when Agent 2 publishes it.
Columns read (all optional): `attack_type, distribution, median_hours, sigma,
floor_hours, source_url`. Until then the medians below are placeholders and are
tagged `TODO_CALIB`.
"""

from __future__ import annotations

import csv
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from engine.contracts import OPERATOR_SEATS
from engine.storm import TODO_CALIB, calib_dir

__all__ = ["ATTACK_FOR_ACTION", "AttackLayer", "AttackProfile", "load_attribution_lags"]

#: Ladder rung -> attack kind. Only these four rungs create effects.
ATTACK_FOR_ACTION: dict[str, str] = {
    "jam": "jam",
    "dazzle": "dazzle",
    "ground_cyber": "ground_cyber",
    "counter_rpo": "rpo",
}

CAUSE_FOR_ATTACK: dict[str, str] = {
    "jam": "hostile_jam",
    "dazzle": "hostile_dazzle",
    "ground_cyber": "hostile_ground_cyber",
    "rpo": "hostile_rpo",
}


@dataclass
class AttackProfile:
    """How one attack type behaves."""

    kind: str
    default_duration_minutes: float
    magnitude: float
    signature: str
    #: Lognormal in hours: median and shape. `floor_hours` is the earliest any
    #: draw can resolve, because nothing is attributed instantly.
    median_hours: float
    sigma: float
    floor_hours: float
    source: str = TODO_CALIB

    def draw_lag_s(self, rng: Any, stream: str) -> int:
        mu = math.log(max(1e-6, self.median_hours))
        hours = rng.lognormal(stream, mu, self.sigma)
        return int(round(max(self.floor_hours, hours) * 3600.0))


#: Placeholder profiles. Medians reflect the rough public shape — electronic
#: attack is noticed fast and named slowly, cyber is named slowest of all — and
#: are replaced wholesale by calib/attribution_lags.csv.
DEFAULT_PROFILES: dict[str, AttackProfile] = {
    "jam": AttackProfile(
        kind="jam",
        default_duration_minutes=120.0,
        magnitude=0.55,
        signature="interference",
        median_hours=6.0,
        sigma=0.80,
        floor_hours=0.5,
    ),
    "dazzle": AttackProfile(
        kind="dazzle",
        default_duration_minutes=45.0,
        magnitude=0.70,
        signature="interference",
        median_hours=18.0,
        sigma=0.90,
        floor_hours=1.0,
    ),
    "ground_cyber": AttackProfile(
        kind="ground_cyber",
        default_duration_minutes=720.0,
        magnitude=0.80,
        signature="cyber_anomaly",
        median_hours=72.0,
        sigma=1.10,
        floor_hours=4.0,
    ),
    "rpo": AttackProfile(
        kind="rpo",
        default_duration_minutes=1440.0,
        magnitude=0.20,
        signature="proximity",
        median_hours=12.0,
        sigma=0.70,
        floor_hours=1.0,
    ),
}


def load_attribution_lags() -> dict[str, AttackProfile]:
    """Attack profiles with any calibrated lags folded in."""
    profiles = {k: AttackProfile(**vars(v)) for k, v in DEFAULT_PROFILES.items()}
    path: Path = calib_dir() / "attribution_lags.csv"
    if not path.is_file():
        return profiles
    with path.open(newline="") as handle:
        for row in csv.DictReader(handle):
            kind = (row.get("attack_type") or "").strip()
            kind = ATTACK_FOR_ACTION.get(kind, kind)
            if kind not in profiles:
                continue
            profile = profiles[kind]
            if row.get("median_hours"):
                profile.median_hours = float(row["median_hours"])
            if row.get("sigma"):
                profile.sigma = float(row["sigma"])
            if row.get("floor_hours"):
                profile.floor_hours = float(row["floor_hours"])
            profile.source = str(row.get("source_url") or "calib/attribution_lags.csv")
    return profiles


@dataclass
class Effect:
    """One observable degradation in the world, hostile or natural."""

    effect_id: str
    kind: str
    cause: str
    origin_actor: str
    start_s: int
    end_s: int
    magnitude: float
    signature: str
    target_asset_id: str | None = None
    target_system: str | None = None
    target_actor: str | None = None
    description: str = ""
    attribution_time_s: int | None = None
    permanent_damage: bool = False
    resolved: bool = False
    extra: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "effect_id": self.effect_id,
            "kind": self.kind,
            "cause": self.cause,
            "origin_actor": self.origin_actor,
            "start_s": self.start_s,
            "end_s": self.end_s,
            "magnitude": self.magnitude,
            "signature": self.signature,
            "target_asset_id": self.target_asset_id,
            "target_system": self.target_system,
            "target_actor": self.target_actor,
            "description": self.description,
            "attribution_time_s": self.attribution_time_s,
            "permanent_damage": self.permanent_damage,
            "resolved": self.resolved,
            "extra": dict(self.extra),
        }

    @staticmethod
    def from_dict(data: dict[str, Any]) -> Effect:
        return Effect(**{**data, "extra": dict(data.get("extra") or {})})

    def observable_for(self, seat: str, now_s: int) -> dict[str, Any]:
        """What this seat can see of the effect at `now_s`.

        The signature is the whole asymmetry: an operator seat can say "that
        looks like interference", everyone else can only say "it is down".
        """
        view: dict[str, Any] = {
            "effect_id": self.effect_id,
            "target_asset_id": self.target_asset_id,
            "target_system": self.target_system,
            "observed_since_s": self.start_s,
            "ongoing": now_s < self.end_s,
            "severity": round(self.magnitude, 3),
            "description": self.description,
        }
        if seat in OPERATOR_SEATS:
            view["telemetry_signature"] = self.signature
        else:
            view["telemetry_signature"] = "unknown"
        return view


class AttackLayer:
    """Creates and ages effects. Knows nothing about who is allowed to do what."""

    def __init__(self, profiles: dict[str, AttackProfile] | None = None) -> None:
        self.profiles = profiles if profiles is not None else load_attribution_lags()
        self.effects: dict[str, Effect] = {}
        self._counter: int = 0

    def _next_id(self, prefix: str) -> str:
        self._counter += 1
        return f"{prefix}_{self._counter:04d}"

    # --- creation ------------------------------------------------------------

    def launch(
        self,
        *,
        action_type: str,
        actor: str,
        params: dict[str, Any],
        now_s: int,
        rng: Any,
        dazzle_damage_probability: float = 0.06,
    ) -> Effect:
        """Turn an executed rung into an effect in the world."""
        kind = ATTACK_FOR_ACTION[action_type]
        profile = self.profiles[kind]
        effect_id = self._next_id(kind)
        minutes = float(params.get("duration_minutes") or profile.default_duration_minutes)
        magnitude = profile.magnitude
        if kind == "rpo":
            standoff = float(params.get("standoff_km") or 50.0)
            # Closer is louder: 1 km reads as a hold-at-risk, 1000 km as a look.
            magnitude = round(min(0.6, 0.6 * math.exp(-standoff / 250.0) + 0.08), 3)
            minutes = float(params.get("duration_minutes") or profile.default_duration_minutes)
        effect = Effect(
            effect_id=effect_id,
            kind=kind,
            cause=CAUSE_FOR_ATTACK[kind],
            origin_actor=actor,
            start_s=int(now_s),
            end_s=int(now_s + minutes * 60.0),
            magnitude=magnitude,
            signature=profile.signature,
            target_asset_id=params.get("target_asset_id"),
            target_system=params.get("target_system"),
            target_actor=params.get("target_actor"),
            description=_describe(kind, params),
        )
        effect.attribution_time_s = effect.start_s + profile.draw_lag_s(
            rng, f"attribution:{effect_id}"
        )
        if kind == "dazzle" and rng.chance(f"dazzle_damage:{effect_id}", dazzle_damage_probability):
            effect.permanent_damage = True
            effect.end_s = 10**9  # never recovers; the rung stays "reversible", the world does not
            effect.description += " Sensor response has not recovered."
        self.effects[effect_id] = effect
        return effect

    def natural(
        self,
        *,
        now_s: int,
        duration_s: int,
        target_asset_id: str | None,
        magnitude: float,
        description: str,
        cause: str = "natural_space_weather",
        target_system: str | None = None,
    ) -> Effect:
        """A storm- or hardware-driven outage. Same observable, honest signature."""
        effect_id = self._next_id("nat")
        effect = Effect(
            effect_id=effect_id,
            kind="natural",
            cause=cause,
            origin_actor="environment",
            start_s=int(now_s),
            end_s=int(now_s + duration_s),
            magnitude=float(magnitude),
            signature="natural",
            target_asset_id=target_asset_id,
            target_system=target_system,
            description=description,
            attribution_time_s=int(now_s),
        )
        self.effects[effect_id] = effect
        return effect

    # --- queries -------------------------------------------------------------

    def active(self, now_s: int) -> list[Effect]:
        return [e for _eid, e in sorted(self.effects.items()) if e.start_s <= now_s < e.end_s]

    def visible_to(self, seat: str, now_s: int, owned: set[str]) -> list[dict[str, Any]]:
        """Effects this seat can observe, with the signature gated by seat.

        A seat sees an effect on its own assets immediately; effects on someone
        else's assets only once they are big enough to show up on a shared feed.
        """
        out: list[dict[str, Any]] = []
        for effect in sorted(self.effects.values(), key=lambda e: (e.start_s, e.effect_id)):
            if effect.start_s > now_s:
                continue
            target = effect.target_asset_id or effect.target_system or ""
            mine = target in owned
            if not mine and effect.magnitude < 0.35:
                continue
            view = effect.observable_for(seat, now_s)
            view["own_asset"] = mine
            out.append(view)
        return out

    def attributable(self, now_s: int) -> list[Effect]:
        """Effects whose attribution lag has run out and that nobody has resolved."""
        return [
            e
            for _eid, e in sorted(self.effects.items())
            if not e.resolved and e.attribution_time_s is not None and e.attribution_time_s <= now_s
        ]

    def degradation_for(self, asset_id: str, now_s: int) -> float:
        """Total multiplicative degradation on one asset right now, 0..1."""
        factor = 1.0
        for effect in self.active(now_s):
            if effect.target_asset_id == asset_id:
                factor *= 1.0 - min(1.0, effect.magnitude)
        return round(factor, 4)

    # --- snapshot ------------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        return {
            "counter": self._counter,
            "effects": {k: v.as_dict() for k, v in sorted(self.effects.items())},
        }

    def restore(self, snap: dict[str, Any]) -> None:
        self._counter = int(snap["counter"])
        self.effects = {k: Effect.from_dict(v) for k, v in snap["effects"].items()}


def _describe(kind: str, params: dict[str, Any]) -> str:
    target = params.get("target_asset_id") or params.get("target_system") or "an unnamed target"
    if kind == "jam":
        return f"Uplink/downlink interference on {target}."
    if kind == "dazzle":
        return f"Imaging payload on {target} saturated; response curve off nominal."
    if kind == "ground_cyber":
        effect = params.get("effect") or "disrupt"
        return f"Ground segment {target}: anomalous behaviour consistent with {effect}."
    standoff = params.get("standoff_km")
    return f"Close approach on {target} inside {standoff} km."
