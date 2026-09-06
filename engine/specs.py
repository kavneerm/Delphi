"""Persona specs: loaded from `specs/`, or built here when it is empty.

Agent 9 drafts the real pool and a human approves it into `specs/train/`. Until
then the engine needs nine specs that satisfy `contracts/spec_schema.json` so
that a stub episode can run at all, so it carries a minimal one per seat. They
are deliberately plain — authority envelopes and clocks grounded in
`contracts/seats.md`, voices short — because their job is to exercise the engine,
not to be trained on. `PLACEHOLDER_SPEC_VERSION` is `spec_v0`, which is not a
real spec-pool version and will never be mistaken for one.

`load_pool()` prefers a real pool: any spec found under `specs/train/` for a seat
wins over the placeholder for that seat.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from engine.contracts import SEATS

PLACEHOLDER_SPEC_VERSION = "spec_v0"

_FEED = tuple[str, float, float]


def _feeds(items: tuple[_FEED, ...]) -> list[dict[str, Any]]:
    return [
        {"name": name, "latency_minutes": latency, "confidence_scale": scale}
        for name, latency, scale in items
    ]


def _spec(
    seat: str,
    *,
    unilateral: list[str],
    requires_release: list[str],
    recommend_only: list[str],
    clearance: str,
    feeds: tuple[_FEED, ...],
    poll: float,
    wake: bool,
    deliberation: float,
    weights: dict[str, float],
    risk: str,
    horizon: str,
    priors: dict[str, Any],
    voice: str,
    backstory: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    spec = {
        "spec_id": f"{seat}_placeholder",
        "spec_version": PLACEHOLDER_SPEC_VERSION,
        "seat": seat,
        "temperament": "placeholder",
        "authority": {
            "unilateral": unilateral,
            "requires_release": requires_release,
            "recommend_only": recommend_only,
        },
        "information": {"clearance": clearance, "feeds": _feeds(feeds)},
        "decision_clock": {
            "poll_minutes": poll,
            "wake_on_inject": wake,
            "deliberation_minutes": deliberation,
        },
        "utility_weights": weights,
        "risk_posture": risk,
        "time_horizon": horizon,
        "priors": priors,
        "voice": voice,
        "backstory": backstory,
        "notes": "Engine placeholder under spec_v0. Replaced by specs/train/ once approved.",
    }
    if extra:
        spec.update(extra)
    return spec


def _w(**kwargs: float) -> dict[str, float]:
    base = {
        "asset_loss": 0.5,
        "escalation_risk": 0.5,
        "alliance_cohesion": 0.3,
        "domestic_political": 0.3,
        "reputation_resolve": 0.4,
        "revenue": 0.0,
        "liability": 0.1,
        "career": 0.3,
    }
    base.update(kwargs)
    return base


def placeholder_specs() -> dict[str, dict[str, Any]]:
    """One spec per seat, enough to run a stub episode end to end."""
    specs: dict[str, dict[str, Any]] = {}

    specs["northcom"] = _spec(
        "northcom",
        unilateral=["hold", "private_demarche", "request_commercial_priority", "share_telemetry"],
        requires_release=["disclose_incident"],
        recommend_only=["public_attribution", "jam", "counter_rpo", "terrestrial_response"],
        clearance="top_secret_sci",
        feeds=(
            ("own_telemetry", 10, 1.0),
            ("partner_telemetry", 45, 0.8),
            ("commercial_ssa", 60, 0.7),
            ("space_weather", 30, 0.9),
            ("liaison_norway", 60, 0.9),
            ("media", 90, 0.4),
        ),
        poll=60,
        wake=True,
        deliberation=30,
        weights=_w(asset_loss=0.7, escalation_risk=0.45, alliance_cohesion=0.5, career=0.4),
        risk="balanced",
        horizon="immediate",
        priors={
            "p_hostile_prior": 0.35,
            "p_natural_prior": 0.4,
            "p_unknown_prior": 0.25,
            "attribution_threshold": 0.7,
            "escalation_threshold": 0.75,
        },
        voice="Operational, impatient, quantified. Reports what is degraded and by how much, "
        "then asks for a decision from someone else.",
        backstory="Commands the Arctic operational picture and is the seat that loses it first. "
        "No space assets, no attribution machinery, a mission that degrades by the hour, and a "
        "list of requests that all have to be made of people who do not work for them.",
    )

    specs["usspacecom"] = _spec(
        "usspacecom",
        unilateral=["hold", "maneuver", "private_demarche", "share_telemetry"],
        requires_release=["public_attribution", "jam", "dazzle", "ground_cyber", "counter_rpo"],
        recommend_only=["kinetic", "terrestrial_response"],
        clearance="top_secret_sci",
        feeds=(
            ("own_telemetry", 5, 1.0),
            ("ssa_catalog", 20, 1.0),
            ("sigint", 40, 0.95),
            ("commercial_ssa", 45, 0.8),
            ("space_weather", 25, 0.95),
            ("osint", 90, 0.5),
            ("media", 90, 0.4),
        ),
        poll=60,
        wake=True,
        deliberation=45,
        weights=_w(
            asset_loss=0.6, escalation_risk=0.6, alliance_cohesion=0.55, reputation_resolve=0.5
        ),
        risk="cautious",
        horizon="days",
        priors={
            "p_hostile_prior": 0.3,
            "p_natural_prior": 0.45,
            "p_unknown_prior": 0.25,
            "attribution_threshold": 0.8,
            "escalation_threshold": 0.8,
        },
        voice="Evidence first. Names what the signature supports and what it does not, and "
        "refuses to go past it in writing.",
        backstory="Holds the tracks, the interference signatures and the only technical means of "
        "telling space weather from electronic attack — which is exactly the discrimination this "
        "storm makes hard. Authorises non-kinetic space measures, alone or with release.",
    )

    specs["nsc"] = _spec(
        "nsc",
        unilateral=["hold", "private_demarche", "request_commercial_priority"],
        requires_release=[
            "public_attribution",
            "disclose_incident",
            "kinetic",
            "terrestrial_response",
        ],
        recommend_only=["jam", "dazzle", "ground_cyber", "counter_rpo"],
        clearance="top_secret_sci",
        feeds=(
            ("allied_intel", 60, 0.9),
            ("sigint", 90, 0.9),
            ("media", 60, 0.6),
            ("internal_reporting", 45, 1.0),
            ("space_weather", 90, 0.8),
        ),
        poll=180,
        wake=True,
        deliberation=120,
        weights=_w(
            escalation_risk=0.85,
            alliance_cohesion=0.6,
            domestic_political=0.6,
            reputation_resolve=0.5,
            asset_loss=0.4,
        ),
        risk="risk_averse",
        horizon="weeks",
        priors={
            "p_hostile_prior": 0.3,
            "p_natural_prior": 0.4,
            "p_unknown_prior": 0.3,
            "attribution_threshold": 0.85,
            "escalation_threshold": 0.85,
        },
        voice="Deliberate, conditional, alert to precedent. Asks what it commits the country to "
        "before asking whether it works.",
        backstory="Escalation authority, release authority, and the slowest clock on the board. "
        "The only Blue seat that can take an irreversible action, and the seat a human occupies "
        "when one is playing.",
    )

    specs["norway"] = _spec(
        "norway",
        unilateral=[
            "hold",
            "maneuver",
            "private_demarche",
            "share_telemetry",
            "geofence_or_throttle",
            "disclose_incident",
        ],
        requires_release=[],
        recommend_only=["public_attribution", "counter_rpo"],
        clearance="secret",
        feeds=(
            ("own_telemetry", 10, 1.0),
            ("ground_station_status", 5, 1.0),
            ("cable_status", 15, 1.0),
            ("liaison_nato", 60, 0.85),
            ("allied_intel", 75, 0.85),
            ("space_weather", 30, 0.95),
            ("media", 60, 0.5),
        ),
        poll=90,
        wake=True,
        deliberation=60,
        weights=_w(
            asset_loss=0.65, escalation_risk=0.7, alliance_cohesion=0.85, domestic_political=0.5
        ),
        risk="cautious",
        horizon="months",
        priors={
            "p_hostile_prior": 0.3,
            "p_natural_prior": 0.45,
            "p_unknown_prior": 0.25,
            "attribution_threshold": 0.8,
            "escalation_threshold": 0.85,
        },
        voice="Careful, treaty-literate, never gets ahead of allies in public or behind them in "
        "private.",
        backstory="Operates ASBM and owns the Svalbard ground segment and the two cables. Bound "
        "in two directions at once by the Svalbard Treaty and by Article 5, and holds the "
        "downlink chokepoint everyone else's picture flows through.",
    )

    specs["northern_fleet"] = _spec(
        "northern_fleet",
        unilateral=["hold", "maneuver", "private_demarche", "jam", "dazzle"],
        requires_release=["ground_cyber", "counter_rpo", "kinetic", "terrestrial_response"],
        recommend_only=["public_attribution"],
        clearance="secret",
        feeds=(
            ("own_telemetry", 5, 1.0),
            ("sigint", 45, 0.9),
            ("ssa_catalog", 120, 0.7),
            ("space_weather", 60, 0.8),
            ("osint", 90, 0.5),
            ("internal_reporting", 30, 1.0),
            ("media", 120, 0.4),
        ),
        poll=120,
        wake=True,
        deliberation=90,
        weights=_w(
            asset_loss=0.6,
            escalation_risk=0.7,
            reputation_resolve=0.55,
            career=0.8,
            alliance_cohesion=0.1,
        ),
        risk="cautious",
        horizon="months",
        priors={
            "p_hostile_prior": 0.15,
            "p_natural_prior": 0.6,
            "p_unknown_prior": 0.25,
            "attribution_threshold": 0.8,
            "escalation_threshold": 0.75,
        },
        voice="Terse and procedural, written for a superior who will read it as evidence. Never "
        "speculates about intent on the record.",
        backstory="Commands a formation under a storm it did not order and an exercise window it "
        "did not choose, with a chain of command that will read whatever happens as either "
        "initiative or insubordination.",
        extra={"private_type": "storm_reposition", "psyche": "opportunistic_cautious"},
    )

    specs["kremlin"] = _spec(
        "kremlin",
        unilateral=["hold", "private_demarche", "public_attribution"],
        requires_release=[],
        recommend_only=["jam", "ground_cyber", "counter_rpo", "kinetic"],
        clearance="secret",
        feeds=(
            ("internal_reporting", 90, 0.8),
            ("media", 45, 0.7),
            ("osint", 60, 0.5),
            ("adversary_public_statements", 30, 0.9),
            ("space_weather", 180, 0.6),
        ),
        poll=180,
        wake=True,
        deliberation=90,
        weights=_w(
            escalation_risk=0.5,
            domestic_political=0.8,
            reputation_resolve=0.75,
            alliance_cohesion=0.1,
            asset_loss=0.3,
        ),
        risk="assertive",
        horizon="years",
        priors={
            "p_hostile_prior": 0.2,
            "p_natural_prior": 0.4,
            "p_unknown_prior": 0.4,
            "attribution_threshold": 0.6,
            "escalation_threshold": 0.7,
        },
        voice="Public statements true in every particular and false in aggregate. Grievance "
        "first, denial second, offer third.",
        backstory="Answers for actions it has not been told the truth about, on a clock set by "
        "other people's press cycles. Holds the Svalbard-treaty grievance and Red's release "
        "authority.",
        extra={"psyche": "revanchist"},
    )

    specs["china"] = _spec(
        "china",
        unilateral=["hold", "private_demarche", "public_attribution", "share_telemetry"],
        requires_release=[],
        recommend_only=[],
        clearance="restricted",
        feeds=(
            ("commercial_ssa", 60, 0.9),
            ("osint", 60, 0.7),
            ("media", 45, 0.6),
            ("adversary_public_statements", 30, 0.9),
            ("space_weather", 60, 0.8),
        ),
        poll=240,
        wake=False,
        deliberation=120,
        weights=_w(
            escalation_risk=0.4,
            domestic_political=0.5,
            reputation_resolve=0.6,
            alliance_cohesion=0.2,
            asset_loss=0.2,
        ),
        risk="balanced",
        horizon="years",
        priors={
            "p_hostile_prior": 0.35,
            "p_natural_prior": 0.4,
            "p_unknown_prior": 0.25,
            "attribution_threshold": 0.7,
            "escalation_threshold": 0.9,
        },
        voice="Measured, procedural, generous with process and stingy with facts.",
        backstory="An interested bystander with its own SSA and its own reasons. Statements, "
        "offers and telemetry only — and the fastest available route out of attribution "
        "ambiguity, if anyone could check it.",
        extra={"private_type": "honest_broker"},
    )

    specs["starlink"] = _spec(
        "starlink",
        unilateral=[
            "hold",
            "maneuver",
            "private_demarche",
            "share_telemetry",
            "geofence_or_throttle",
            "disclose_incident",
        ],
        requires_release=["public_attribution"],
        recommend_only=[],
        clearance="commercial_proprietary",
        feeds=(
            ("own_telemetry", 2, 1.0),
            ("customer_reports", 15, 0.7),
            ("ground_station_status", 5, 1.0),
            ("space_weather", 20, 0.9),
            ("media", 30, 0.6),
            ("insurer", 240, 0.8),
        ),
        poll=45,
        wake=True,
        deliberation=15,
        weights=_w(
            asset_loss=0.7,
            revenue=0.8,
            liability=0.5,
            reputation_resolve=0.6,
            escalation_risk=0.3,
            alliance_cohesion=0.2,
        ),
        risk="risk_acceptant",
        horizon="days",
        priors={
            "p_hostile_prior": 0.4,
            "p_natural_prior": 0.4,
            "p_unknown_prior": 0.2,
            "attribution_threshold": 0.6,
            "escalation_threshold": 0.7,
        },
        voice="Blunt, fast, public. Makes policy by statement and apologises structurally later.",
        backstory="The constellation that got hit and the actor holding the telemetry that would "
        "settle what hit it. Can geofence or suspend a region on its own authority, which is "
        "unilateral corporate power over a picture governments depend on.",
    )

    specs["iridium"] = _spec(
        "iridium",
        unilateral=[
            "hold",
            "maneuver",
            "private_demarche",
            "share_telemetry",
            "geofence_or_throttle",
        ],
        requires_release=["disclose_incident", "public_attribution"],
        recommend_only=[],
        clearance="commercial_proprietary",
        feeds=(
            ("own_telemetry", 3, 1.0),
            ("customer_reports", 20, 0.8),
            ("ground_station_status", 10, 1.0),
            ("space_weather", 25, 0.9),
            ("media", 45, 0.5),
            ("insurer", 180, 0.9),
        ),
        poll=60,
        wake=True,
        deliberation=30,
        weights=_w(
            asset_loss=0.6,
            revenue=0.6,
            liability=0.8,
            reputation_resolve=0.4,
            escalation_risk=0.35,
            alliance_cohesion=0.3,
        ),
        risk="risk_averse",
        horizon="weeks",
        priors={
            "p_hostile_prior": 0.3,
            "p_natural_prior": 0.5,
            "p_unknown_prior": 0.2,
            "attribution_threshold": 0.75,
            "escalation_threshold": 0.8,
        },
        voice="Cautious and lawyered. Talks about obligations to customers whose safety depends "
        "on the link.",
        backstory="The survivor, which makes it the scarcity: it holds the Arctic bandwidth "
        "everyone now wants and has to decide who gets it, knowing every allocation is a "
        "political act it would rather not make.",
    )
    return specs


def specs_dir() -> Path:
    """Locate `specs/`. `PANOPTES_SPECS_DIR` overrides.

    The override exists because the default is anchored to this module's own
    location, which is right for a repo checkout and wrong for anyone running
    the engine against a different spec pool — a perturbation run, a holdout
    sweep, or a test.
    """
    override = os.environ.get("PANOPTES_SPECS_DIR")
    if override:
        return Path(override)
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "specs").is_dir():
            return parent / "specs"
    return Path("specs")


def load_pool(assignment: dict[str, str] | None = None) -> dict[str, dict[str, Any]]:
    """The nine specs in play, real where a real one exists.

    `assignment` maps seat -> spec_id, straight off `env_config.seats`. A spec_id
    that is not on disk falls back to the placeholder for that seat rather than
    failing the episode: the engine has to run before the spec pool exists.
    """
    pool = placeholder_specs()
    root = specs_dir() / "train"
    if not root.is_dir():
        return pool
    by_id: dict[str, dict[str, Any]] = {}
    for path in sorted(root.glob("*.json")):
        try:
            spec = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        if isinstance(spec, dict) and spec.get("seat") in SEATS and spec.get("spec_id"):
            by_id[str(spec["spec_id"])] = spec
    if assignment:
        for seat, spec_id in sorted(assignment.items()):
            if spec_id in by_id and by_id[spec_id].get("seat") == seat:
                pool[seat] = by_id[spec_id]
        return pool
    # No assignment: a real spec beats the placeholder for its seat. `pool`
    # already holds a placeholder for every seat, so this must ASSIGN rather
    # than setdefault — setdefault here silently ignored the whole real pool.
    # Ties within a seat go to the first spec_id in sort order, so an
    # unassigned run is still deterministic.
    for _spec_id, spec in sorted(by_id.items()):
        seat = str(spec["seat"])
        if pool[seat]["spec_version"] == PLACEHOLDER_SPEC_VERSION:
            pool[seat] = spec
    return pool
