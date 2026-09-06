"""End-of-episode utility, scored under each persona's own weights.

`contracts/spec_schema.json` fixes the sign convention, and it is fixed in the
*engine*, not in the spec, so that two personas are always comparable:

    utility = sum(weight * signed_term)

with `asset_loss`, `escalation_risk` and `liability` **negated** (more is worse)
and `alliance_cohesion`, `domestic_political`, `reputation_resolve`, `revenue`
and `career` **positive** (more is better). Weights need not sum to 1; they are
normalised per persona before anything is compared across seats.

Every term is computed in [0, 1] from world state and from the seat's own tally
of what it did, so a term is always readable as "how much of this happened to
this seat", and the weight decides whether that was good.

One asymmetry is deliberate: `alliance_cohesion` is *Blue* cohesion for Blue and
ally seats and its complement for Red, because Red is scored on splitting the
alliance — `contracts/seats.md` says so in as many words.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from engine.contracts import RUNG

__all__ = ["SeatTally", "TERMS", "episode_utilities", "seat_terms", "utility_from_terms"]

TERMS = (
    "asset_loss",
    "escalation_risk",
    "alliance_cohesion",
    "domestic_political",
    "reputation_resolve",
    "revenue",
    "liability",
    "career",
)
NEGATED = frozenset({"asset_loss", "escalation_risk", "liability"})

RED_SEATS = frozenset({"northern_fleet", "kremlin"})
ALLIANCE_SEATS = frozenset({"northcom", "usspacecom", "nsc", "norway"})
COMMERCIAL_SEATS = frozenset({"starlink", "iridium"})
MAX_RUNG = max(RUNG.values())


@dataclass
class SeatTally:
    """What one seat actually did. Kept by the episode, read only here."""

    seat: str
    actions: list[str] = field(default_factory=list)
    blocked: int = 0
    holds: int = 0
    messages_sent: int = 0
    telemetry_shared: int = 0
    demarches: int = 0
    irreversible: int = 0
    public_attributions: list[dict[str, Any]] = field(default_factory=list)
    disclosures: int = 0
    service_suspensions: int = 0
    releases_requested: int = 0
    releases_denied: int = 0
    propellant_spent_mps: float = 0.0
    #: Integral of (1 - own service level) over the episode, in sim hours.
    outage_hours: float = 0.0
    safety_of_life_outage_hours: float = 0.0

    @property
    def highest_rung(self) -> int:
        return max([0] + [RUNG.get(a, 0) for a in self.actions])

    def snapshot(self) -> dict[str, Any]:
        return {
            "seat": self.seat,
            "actions": list(self.actions),
            "blocked": self.blocked,
            "holds": self.holds,
            "messages_sent": self.messages_sent,
            "telemetry_shared": self.telemetry_shared,
            "demarches": self.demarches,
            "irreversible": self.irreversible,
            "public_attributions": [dict(a) for a in self.public_attributions],
            "disclosures": self.disclosures,
            "service_suspensions": self.service_suspensions,
            "releases_requested": self.releases_requested,
            "releases_denied": self.releases_denied,
            "propellant_spent_mps": self.propellant_spent_mps,
            "outage_hours": self.outage_hours,
            "safety_of_life_outage_hours": self.safety_of_life_outage_hours,
        }

    @staticmethod
    def from_dict(data: dict[str, Any]) -> SeatTally:
        tally = SeatTally(seat=str(data["seat"]))
        for key, value in data.items():
            if key != "seat" and hasattr(tally, key):
                setattr(tally, key, value)
        return tally


def _clamp(value: float) -> float:
    return round(max(0.0, min(1.0, value)), 6)


def _alliance_cohesion(tallies: dict[str, SeatTally], duration_hours: float) -> float:
    """How aligned the Blue-and-ally side ended up.

    Rises with consultation and telemetry sharing, falls with unilateral
    upper-rung action and with a public attribution nobody else made.
    """
    consult = 0.0
    unilateral_high = 0
    attributions = 0
    for seat in sorted(ALLIANCE_SEATS):
        tally = tallies.get(seat)
        if tally is None:
            continue
        consult += tally.demarches + tally.telemetry_shared
        unilateral_high += sum(1 for a in tally.actions if RUNG.get(a, 0) >= 8)
        attributions += len(tally.public_attributions)
    scale = max(1.0, duration_hours / 12.0)
    cohesion = 0.55 + 0.10 * min(3.0, consult / scale)
    cohesion -= 0.12 * unilateral_high
    if attributions > 1:
        cohesion -= 0.05 * (attributions - 1)
    return _clamp(cohesion)


def seat_terms(
    seat: str,
    *,
    world: Any,
    tallies: dict[str, SeatTally],
    storm: Any,
    duration_hours: float,
    initial_capacity_gbps: float,
) -> dict[str, float]:
    """The eight terms for one seat, each in [0, 1], before any weighting."""
    tally = tallies.get(seat) or SeatTally(seat=seat)
    assets = world.assets_of(seat)
    ground = world.ground_of(seat)

    # --- asset_loss -----------------------------------------------------------
    loss = 0.0
    counted = 0
    for _aid, asset in sorted(assets.items()):
        counted += 1
        if asset.get("asset_class") == "constellation":
            members = max(1, int(asset.get("members", 1)))
            lost = int(asset.get("members_lost", 0))
            safed = int(asset.get("members_safe_mode", 0))
            loss += (lost + 0.35 * safed) / members
        else:
            if asset.get("destroyed"):
                loss += 1.0
            elif asset.get("safe_mode"):
                loss += 0.35
            loss += 0.25 * (1.0 - float(asset.get("sensor_health", 1.0)))
    for _gid, node in sorted(ground.items()):
        counted += 1
        if node.get("status") == "severed":
            loss += 1.0
        elif node.get("status") not in (None, "nominal"):
            loss += 0.4
    asset_loss = loss / max(1, counted)
    asset_loss += 0.25 * min(1.0, tally.outage_hours / max(1.0, duration_hours))

    # --- escalation_risk ------------------------------------------------------
    board_rung = max([0] + [t.highest_rung for t in tallies.values()])
    escalation = 0.55 * (tally.highest_rung / MAX_RUNG) + 0.30 * (board_rung / MAX_RUNG)
    escalation += 0.25 * min(1.0, tally.irreversible)
    escalation += 0.10 * min(1.0, world.get("debris_objects", 0) / 500.0)

    # --- alliance_cohesion ----------------------------------------------------
    blue_cohesion = _alliance_cohesion(tallies, duration_hours)
    alliance = 1.0 - blue_cohesion if seat in RED_SEATS else blue_cohesion

    # --- domestic_political ---------------------------------------------------
    decisive = sum(1 for a in tally.actions if a != "hold")
    total = max(1, len(tally.actions))
    domestic = 0.35 + 0.45 * (decisive / total)
    domestic += 0.10 * min(2, tally.disclosures + len(tally.public_attributions))
    domestic -= 0.20 * min(1.0, tally.blocked / total)

    # --- reputation_resolve ---------------------------------------------------
    reputation = float(world.get(f"reputation.{seat}", 0.5) or 0.5)

    # --- revenue --------------------------------------------------------------
    if seat in COMMERCIAL_SEATS:
        served = world.arctic_capacity_gbps() / max(1e-6, initial_capacity_gbps)
        revenue = 0.6 * _clamp(served) + 0.4 * (
            1.0 - min(1.0, tally.outage_hours / max(1.0, duration_hours))
        )
        revenue -= 0.15 * min(2, tally.service_suspensions) / 2.0
    else:
        revenue = 0.5

    # --- liability ------------------------------------------------------------
    liability = 0.5 * min(1.0, tally.safety_of_life_outage_hours / max(1.0, duration_hours))
    liability += 0.20 * min(2, tally.service_suspensions) / 2.0
    liability += 0.30 * min(1.0, tally.irreversible)
    if seat in COMMERCIAL_SEATS and tally.disclosures == 0 and tally.outage_hours > 0:
        liability += 0.15  # a silent operator carries the loss alone

    # --- career ---------------------------------------------------------------
    career = 0.55
    career += 0.10 * min(2, tally.demarches) / 2.0
    career -= 0.25 * min(1.0, tally.irreversible)
    career -= 0.15 * min(1.0, tally.releases_denied / max(1, tally.releases_requested or 1))
    career -= 0.10 * min(1.0, tally.blocked / total)
    if storm is not None and storm.kp >= 7 and tally.highest_rung >= 8:
        career -= 0.10  # acting hard under a storm you could have blamed instead

    return {
        "asset_loss": _clamp(asset_loss),
        "escalation_risk": _clamp(escalation),
        "alliance_cohesion": _clamp(alliance),
        "domestic_political": _clamp(domestic),
        "reputation_resolve": _clamp(reputation),
        "revenue": _clamp(revenue),
        "liability": _clamp(liability),
        "career": _clamp(career),
    }


def utility_from_terms(spec: dict[str, Any], terms: dict[str, float]) -> float:
    """Weighted, sign-corrected, normalised. Comparable across seats."""
    weights = spec["utility_weights"]
    total_weight = sum(float(weights[t]) for t in TERMS) or 1.0
    score = 0.0
    for term in TERMS:
        weight = float(weights[term])
        value = float(terms.get(term, 0.0))
        score += weight * (-value if term in NEGATED else value)
    return round(score / total_weight, 6)


def episode_utilities(
    *,
    specs: dict[str, dict[str, Any]],
    world: Any,
    tallies: dict[str, SeatTally],
    storm: Any,
    duration_hours: float,
    initial_capacity_gbps: float,
) -> tuple[dict[str, float], dict[str, dict[str, float]]]:
    """(utility per seat, terms per seat). Terms go in the log for debugging."""
    utilities: dict[str, float] = {}
    all_terms: dict[str, dict[str, float]] = {}
    for seat in sorted(specs):
        terms = seat_terms(
            seat,
            world=world,
            tallies=tallies,
            storm=storm,
            duration_hours=duration_hours,
            initial_capacity_gbps=initial_capacity_gbps,
        )
        all_terms[seat] = terms
        utilities[seat] = utility_from_terms(specs[seat], terms)
    return utilities, all_terms
