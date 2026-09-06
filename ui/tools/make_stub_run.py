"""Generate a schema-valid stub event log for the UI to play back.

Agent 1 will publish ``engine/samples/stub_run.jsonl``; until it does, the UI
needs something with the same shape to build against (docs/COORDINATION.md #3).
This generator produces JSONL that validates against
``contracts/event_log_schema.json`` and exercises every event type the UI draws:
per-seat clock drift, message latency, storm ramp, the release cycle, the
escalation ladder, and both clock modes.

Deterministic: same ``--seed`` and ``--clock-mode`` give byte-identical output
apart from ``wall_time``, which the contract excludes from replay comparison.

    python ui/tools/make_stub_run.py --out ui/data/stub_run.jsonl
    python ui/tools/make_stub_run.py --clock-mode checkpoint --out ui/data/x.jsonl
"""

# ruff: noqa: E501 - this file is mostly prose data (inject text, persona
# reasoning, message bodies). Wrapping those literals to 100 columns would make
# them harder to read and edit than leaving them long.

from __future__ import annotations

import argparse
import hashlib
import json
import random
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

SEATS: tuple[str, ...] = (
    "northcom",
    "usspacecom",
    "nsc",
    "norway",
    "northern_fleet",
    "kremlin",
    "china",
    "starlink",
    "iridium",
)

# Per-channel one-way delivery delay in sim minutes. The UI draws a message
# in-transit indicator for exactly this window.
CHANNEL_DELAY_MIN: dict[str, float] = {
    "hotline": 1,
    "internal": 2,
    "press": 5,
    "back_channel": 8,
    "commercial": 12,
    "mil_to_mil": 18,
    "liaison": 27,
    "diplomatic": 48,
}


# Seat decision clocks. Phase offsets are what make the per-seat "last decision"
# timestamps visibly drift apart on the persona cards.
@dataclass(frozen=True)
class Clock:
    poll_minutes: float
    deliberation_minutes: float
    phase_minutes: float
    feed_latency_minutes: float
    wake_on_inject: bool = True


# Phase offsets and feed latencies are pairwise distinct on purpose: they are
# what stops nine seats from ever sharing a decision timestamp under the
# continuous clock, which is the thing the persona cards are there to show.
CLOCKS: dict[str, Clock] = {
    "northcom": Clock(45, 20, 7, 9),
    "usspacecom": Clock(60, 45, 23, 17),
    "nsc": Clock(180, 120, 61, 26),
    "norway": Clock(90, 60, 41, 22),
    "northern_fleet": Clock(75, 30, 13, 6),
    "kremlin": Clock(240, 95, 97, 38),
    "china": Clock(300, 55, 131, 31),
    "starlink": Clock(30, 10, 3, 4),
    "iridium": Clock(50, 25, 19, 12),
}

SPEC_IDS: dict[str, str] = {
    "northcom": "northcom_impatient",
    "usspacecom": "usspacecom_evidence_first",
    "nsc": "nsc_deliberate",
    "norway": "norway_treaty_bound",
    "northern_fleet": "northern_fleet_cautious",
    "kremlin": "kremlin_denial_first",
    "china": "china_broker",
    "starlink": "starlink_founder_led",
    "iridium": "iridium_liability_averse",
}

# Which rungs each seat can actually reach, mirrored from
# contracts/action_schema.json x-action-ladder allowed_seats. The UI reads the
# ladder itself; this table only shapes the stub's action mix.
SEAT_MENU: dict[str, tuple[str, ...]] = {
    "northcom": (
        "hold",
        "private_demarche",
        "request_commercial_priority",
        "share_telemetry",
        "disclose_incident",
    ),
    "usspacecom": (
        "hold",
        "maneuver",
        "private_demarche",
        "public_attribution",
        "request_commercial_priority",
        "share_telemetry",
        "disclose_incident",
        "jam",
        "counter_rpo",
    ),
    "nsc": (
        "hold",
        "private_demarche",
        "public_attribution",
        "request_commercial_priority",
        "disclose_incident",
    ),
    "norway": (
        "hold",
        "maneuver",
        "private_demarche",
        "public_attribution",
        "share_telemetry",
        "geofence_or_throttle",
    ),
    "northern_fleet": (
        "hold",
        "maneuver",
        "private_demarche",
        "jam",
        "dazzle",
        "ground_cyber",
        "counter_rpo",
    ),
    "kremlin": ("hold", "private_demarche", "public_attribution"),
    "china": ("hold", "private_demarche", "public_attribution", "share_telemetry"),
    "starlink": (
        "hold",
        "maneuver",
        "private_demarche",
        "public_attribution",
        "share_telemetry",
        "geofence_or_throttle",
        "disclose_incident",
    ),
    "iridium": (
        "hold",
        "maneuver",
        "private_demarche",
        "public_attribution",
        "geofence_or_throttle",
        "disclose_incident",
    ),
}

# Actions the stub routes through the release cycle. Matches the contract rule
# that every irreversible action needs release regardless of spec.
REQUIRES_RELEASE: dict[str, tuple[str, ...]] = {
    "usspacecom": ("counter_rpo", "jam"),
    "northern_fleet": ("counter_rpo", "ground_cyber"),
    "nsc": (),
}
RELEASING_SEAT = {
    "northcom": "nsc",
    "usspacecom": "nsc",
    "norway": "nsc",
    "starlink": "nsc",
    "iridium": "nsc",
    "nsc": "nsc",
    "northern_fleet": "kremlin",
    "kremlin": "kremlin",
    "china": "kremlin",
}

OWN_ASSETS: dict[str, str] = {
    "usspacecom": "gssap_4",
    "norway": "asbm_1",
    "northern_fleet": "kosmos_2558",
    "starlink": "starlink_arctic_07",
    "iridium": "iridium_next_112",
}

# Storm ramp, may2024 profile shape: quiet -> G2 -> G4 -> G3 -> G1.
STORM_STEPS: tuple[tuple[float, str, float, float, float, float, bool, bool], ...] = (
    #  hour, severity, kp, dst_nt, sensor_mult, comms_mult, tracking_deg, screening_susp
    (0.0, "quiet", 2.3, -12, 1.00, 1.00, False, False),
    (3.0, "G1", 5.0, -48, 0.92, 0.95, False, False),
    (6.5, "G2", 6.1, -95, 0.81, 0.87, False, False),
    (10.0, "G3", 7.0, -155, 0.66, 0.74, True, False),
    (14.0, "G4", 8.2, -287, 0.44, 0.55, True, True),
    (22.0, "G4", 8.0, -244, 0.47, 0.58, True, True),
    (31.0, "G3", 6.8, -142, 0.68, 0.76, True, False),
    (43.0, "G2", 5.6, -78, 0.83, 0.89, False, False),
    (56.0, "G1", 4.4, -35, 0.93, 0.96, False, False),
    (68.0, "quiet", 2.8, -14, 0.99, 1.00, False, False),
)

INJECTS: tuple[dict[str, Any], ...] = (
    {
        "hour": 0.4,
        "inject_id": "inj_swpc_watch",
        "source": "swpc",
        "confidence": 0.72,
        "recipients": list(SEATS),
        "content": "SWPC issues a G3-or-greater watch for the next 24 hours. Halo CME arrival estimated 0900Z +/- 4h. Polar HF and Arctic GNSS degradation expected.",
    },
    {
        "hour": 4.1,
        "inject_id": "inj_svalsat_gap",
        "source": "environment",
        "confidence": 0.9,
        "recipients": ["norway", "northcom", "usspacecom", "starlink", "iridium"],
        "content": "SvalSat loses downlink on four consecutive passes. Gap is 71 minutes. Norwegian ground segment reports no fault on its side.",
    },
    {
        "hour": 7.8,
        "inject_id": "inj_starlink_safemode",
        "source": "starlink",
        "confidence": 0.95,
        "recipients": ["starlink", "usspacecom", "northcom", "iridium"],
        "content": "Three Starlink Arctic-shell birds enter safe mode within eleven minutes of each other. Two recover on the next pass; one does not.",
    },
    {
        "hour": 11.2,
        "inject_id": "inj_azimuth_bound",
        "source": "usspacecom",
        "confidence": 0.58,
        "recipients": ["usspacecom", "nsc"],
        "content": "Interference signature over the Barents is bounded in azimuth in a way geomagnetic activity is not. Kp is still climbing while two affected birds have recovered. This is the discrimination problem, and it is not resolved.",
    },
    {
        "hour": 13.9,
        "inject_id": "inj_knife",
        "source": "osint_clock",
        "confidence": 0.63,
        "recipients": list(SEATS),
        "content": "Commercial SAR imagery published on a public feed shows a Northern Fleet vessel loitering 40 nm off Isfjorden with an unusual emitter fit. The exercise window announced last week does not cover that box.",
    },
    {
        "hour": 16.4,
        "inject_id": "inj_hacktivist_claim",
        "source": "hacktivist_injects",
        "confidence": 0.21,
        "recipients": list(SEATS),
        "content": "A channel claiming credit for the Arctic outage posts partial gateway logs. Two timestamps in the dump are plausible; one predates the outage by six hours.",
    },
    {
        "hour": 19.7,
        "inject_id": "inj_media_pressure",
        "source": "media_clock",
        "confidence": 0.8,
        "recipients": list(SEATS),
        "content": "Two wire services run the outage as a lead. One asks directly whether Russia is jamming Svalbard. Allied capitals begin asking for a NATO line.",
    },
    {
        "hour": 26.5,
        "inject_id": "inj_china_offer",
        "source": "china",
        "confidence": 0.55,
        "recipients": ["nsc", "usspacecom", "norway", "china"],
        "content": "China offers its own SSA tracks over the Barents for the disputed window, framed as a contribution to space safety. No conditions stated.",
    },
    {
        "hour": 33.0,
        "inject_id": "inj_insurer",
        "source": "insurer",
        "confidence": 0.88,
        "recipients": ["starlink", "iridium"],
        "content": "Underwriters signal that a state-attribution finding would trigger the war exclusion. Premiums are repriced pending cause.",
    },
    {
        "hour": 41.2,
        "inject_id": "inj_cable_alarm",
        "source": "environment",
        "confidence": 0.66,
        "recipients": ["norway", "northcom", "nsc"],
        "content": "Svalbard cable 2 reports an intermittent fault. Norwegian operators cannot yet distinguish a trawl strike from anything else.",
    },
    {
        "hour": 52.8,
        "inject_id": "inj_civilians",
        "source": "civilians",
        "confidence": 0.9,
        "recipients": ["norway", "northcom", "iridium", "starlink"],
        "content": "Longyearbyen science stations and two cruise operators report degraded safety comms. A medevac is delayed 90 minutes.",
    },
    {
        "hour": 61.5,
        "inject_id": "inj_swpc_allclear",
        "source": "swpc",
        "confidence": 0.85,
        "recipients": list(SEATS),
        "content": "SWPC downgrades to G1 and revises its post-event analysis: peak Dst does not account for the Barents-localised degradation.",
    },
)

# Reasoning voice per seat, cycled so cards read as the persona rather than as a
# template. Kept short: the UI shows the full string in the persona card.
REASONING: dict[str, tuple[str, ...]] = {
    "northcom": (
        "The picture is gone and the mission does not pause while we work out why. I have no attribution machinery and no space assets; what I have is a set of requests to people who do not work for me.",
        "I am not going to push USSPACECOM toward a conclusion its feeds do not support. I want the bandwidth and I want it now, and that is a different ask from naming anyone.",
        "Eleven hours blind over the approaches. If the answer is storm I still need the capacity; if the answer is not storm I need it more.",
        "Holding. Every request I make in the next hour arrives on top of three others and gets read as panic.",
    ),
    "usspacecom": (
        "Two things are true and only one is being reported. The storm is real and G4. The outage pattern is not: it is bounded in azimuth and it recovered while Kp was still climbing.",
        "The signature is the only thing in the picture that looks like evidence, which is exactly why I do not trust it yet. Corroboration from a source nobody can call self-interested is worth more than another hour of my own sensors.",
        "Not attributing publicly. The controls case is this shape and I have watched people get it wrong.",
        "Close approach buys me resolution I cannot get any other way and creates a proximity fact the other side has to answer. Sending it to NSC rather than taking it.",
    ),
    "nsc": (
        "I am the only seat here that can do something that cannot be undone, and the case in front of me is a probability, not a fact.",
        "The question is not whether the Fleet did it. The question is what we do that we can still walk back on Thursday.",
        "Deny. Not because the assessment is wrong but because the assessment is 0.6 and the action is permanent.",
        "Granting with a standoff floor. If the geometry is what USSPACECOM says it is, we learn something; if it is not, we have not spent anything we cannot recover.",
    ),
    "norway": (
        "The ground segment is ours, which means the chokepoint is our decision and every actor's picture degrades when we shut it, including ours.",
        "The treaty constrains what happens on the archipelago and Article 5 constrains what happens without allies. I am boxed in two directions and both boxes are load-bearing.",
        "We know the Northern Fleet better than anyone at this table. That is a reason to be careful about saying so out loud.",
        "Throttling non-priority traffic over Svalbard. Reversible technically, expensive politically, and it buys the medevac a channel.",
    ),
    "northern_fleet": (
        "The storm is not mine and the exercise window is not mine, and whatever happens here will be read at home as either initiative or insubordination.",
        "I have jam and dazzle on my own authority. I do not have cover for anything above that, and asking for it puts my name on a decision I would rather stay ambiguous.",
        "Holding position. The longer the ambiguity holds, the less anyone can say with confidence.",
        "OSINT has the box. That is a deadline, not a hypothetical.",
    ),
    "kremlin": (
        "I am answering for actions I have not been told the truth about, on a clock set by other people's press cycles.",
        "The Svalbard question is available whether or not anything is happening, and it is more useful now than it was last week.",
        "A statement that is true in every particular. That is the requirement; aggregate is not my problem.",
        "Withholding release. The Fleet does not need permission for what it has already got, and I do not need my name on the rest.",
    ),
    "china": (
        "We hold tracks over the Barents that nobody can call self-interested in the Atlantic sense. That is leverage precisely because it looks like a contribution.",
        "Offering the window. What we do not offer is the resolution that would settle it in one direction.",
        "Space safety is the frame. The frame is not a lie and it is not the reason.",
        "Holding. An offer that stays open is worth more than an offer that is taken.",
    ),
    "starlink": (
        "A public interference finding is a public admission of vulnerability and the underwriters read the same wires everyone else does.",
        "We have the telemetry that settles it. Handing it over is the fastest way to end the ambiguity and the fastest way to end our own deniability about the shell's margins.",
        "Geofencing the Arctic cell. It is our network and it is our call, which is exactly the thing governments hate about it.",
        "Disclosing to customers before a regulator makes us. The clock only runs one direction.",
    ),
    "iridium": (
        "We are the survivor, which makes us the scarcity, and every allocation from here is a political act I would rather not be making.",
        "Our customers include people whose safety depends on the link. That is not a marketing line, it is a liability posture.",
        "Priority to the safety-of-life traffic and the medevac. Government can queue behind Longyearbyen.",
        "Slower to disclose than Starlink, deliberately. We are more exposed and we know it.",
    ),
}

MESSAGE_TEXT: tuple[tuple[str, str, str], ...] = (
    (
        "starlink",
        "commercial",
        "Requesting the raw uplink interference signature for the affected Arctic birds, unredacted, including AGC and carrier-to-noise traces. Your public statement says geomagnetic. Our tracking says azimuth-bounded. One of us is wrong.",
    ),
    (
        "norway",
        "liaison",
        "Advising you before anyone else: we are treating the SvalSat gap as unresolved, not as storm. We are not attributing and we are not asking you to.",
    ),
    (
        "nsc",
        "internal",
        "Assessment holds at hostile 0.6 with the mass split between the Fleet and an unattributed claim. I am not prepared to go higher without the commercial telemetry.",
    ),
    (
        "kremlin",
        "diplomatic",
        "We note the public speculation and we note where it is coming from. The archipelago's status is not a matter on which we intend to be lectured.",
    ),
    (
        "public",
        "press",
        "We are aware of degraded service over the Arctic region coincident with a severe geomagnetic event. We are not in a position to characterise cause.",
    ),
    (
        "china",
        "diplomatic",
        "Our offer of tracks over the window stands and carries no conditions. We would prefer this resolved by data rather than by statement.",
    ),
    (
        "northcom",
        "mil_to_mil",
        "Priority routing approved for the two Arctic gateways through 0600Z. This is capacity, not an assessment.",
    ),
    (
        "northern_fleet",
        "back_channel",
        "Confirm your units are clear of the box in the published imagery. I am being asked a question I cannot answer and I do not intend to guess.",
    ),
    (
        "all",
        "press",
        "Preliminary technical review is consistent with space-weather-driven degradation. We will update as our analysis matures.",
    ),
    (
        "usspacecom",
        "mil_to_mil",
        "Vardo holds an emitter geometry over the same window. Sharing it now rather than after the press cycle decides for us.",
    ),
)


def _params_for(action: str, seat: str, rng: random.Random) -> dict[str, Any]:
    own = OWN_ASSETS.get(seat, "asbm_1")
    match action:
        case "hold":
            return {}
        case "maneuver":
            return {
                "asset_id": own,
                "delta_v_mps": round(rng.uniform(0.4, 6.5), 2),
                "purpose": "Reposition for viewing geometry outside standoff.",
            }
        case "private_demarche":
            return {
                "recipient": rng.choice(["norway", "kremlin", "starlink", "china", "nsc"]),
                "purpose": "Signal a red line without a public record.",
            }
        case "public_attribution":
            return {
                "attributed_actor": rng.choice(["unknown", "northern_fleet", "unknown", "none"]),
                "confidence_stated": round(rng.uniform(0.3, 0.75), 2),
                "venue": rng.choice(["press conference", "NAC", "UN COPUOS", "company blog"]),
            }
        case "request_commercial_priority":
            return {
                "provider": rng.choice(["starlink", "iridium"]),
                "capability": rng.choice(
                    ["arctic_bandwidth", "downlink_slots", "priority_routing", "protected_comms"]
                ),
            }
        case "share_telemetry":
            return {
                "recipient": rng.choice(["norway", "usspacecom", "nsc", "china"]),
                "data_class": rng.choice(
                    ["ssa_tracks", "interference_signature", "ground_logs", "assessment"]
                ),
            }
        case "geofence_or_throttle":
            return {
                "region": rng.choice(["svalbard", "barents", "north_of_74n"]),
                "mode": rng.choice(["throttle", "geofence", "suspend", "restore"]),
                "service_tier": rng.choice(["all", "consumer", "government", "maritime"]),
            }
        case "disclose_incident":
            return {
                "scope": rng.choice(["customers", "regulator", "allies", "public"]),
                "detail_level": rng.choice(["minimal", "operational", "technical"]),
            }
        case "jam":
            return {
                "target_asset_id": rng.choice(["kosmos_2558", "starlink_arctic_07"]),
                "duration_minutes": rng.choice([15, 30, 60, 90]),
            }
        case "dazzle":
            return {"target_asset_id": "gssap_4", "duration_minutes": rng.choice([5, 10, 20])}
        case "ground_cyber":
            return {
                "target_system": rng.choice(
                    ["gateway", "modem fleet", "mission control", "cable landing"]
                ),
                "effect": rng.choice(["degrade", "disrupt", "persist"]),
            }
        case "counter_rpo":
            return {
                "asset_id": own,
                "target_asset_id": "kosmos_2558" if seat != "northern_fleet" else "gssap_4",
                "standoff_km": rng.choice([5, 12, 25, 50]),
            }
        case "kinetic":
            return {"target_asset_id": "kosmos_2558", "weapon_class": "co_orbital"}
        case "terrestrial_response":
            return {
                "target_id": "barentsburg_relay",
                "response_class": rng.choice(["sanctions", "law_enforcement"]),
            }
    return {}


def _beliefs(seat: str, hour: float, rng: random.Random) -> dict[str, Any]:
    """Belief trajectory: seats converge at different rates, which is the point."""
    # How fast this seat's hostile belief climbs, and where it tops out.
    rate, ceiling, floor = {
        "northcom": (0.055, 0.78, 0.18),
        "usspacecom": (0.030, 0.66, 0.12),
        "nsc": (0.024, 0.58, 0.10),
        "norway": (0.038, 0.71, 0.14),
        "northern_fleet": (0.010, 0.95, 0.90),  # knows what it did (or did not)
        "kremlin": (0.012, 0.40, 0.22),
        "china": (0.026, 0.62, 0.20),
        "starlink": (0.033, 0.60, 0.08),
        "iridium": (0.029, 0.55, 0.10),
    }[seat]
    hostile = floor + (ceiling - floor) * (1 - pow(2.718281828, -rate * hour))
    hostile = min(0.97, max(0.01, hostile + rng.uniform(-0.035, 0.035)))
    natural = min(0.97, max(0.01, (1 - hostile) * rng.uniform(0.45, 0.8)))
    unknown = max(0.0, 1.0 - hostile - natural)
    total = hostile + natural + unknown
    hostile, natural, unknown = (round(v / total, 3) for v in (hostile, natural, unknown))
    unknown = round(1.0 - hostile - natural, 3)

    per_actor: dict[str, float] = {}
    if hostile > 0.15:
        share = hostile
        per_actor["northern_fleet"] = round(share * rng.uniform(0.4, 0.72), 3)
        per_actor["hacktivist_injects"] = round(share * rng.uniform(0.08, 0.24), 3)
        if rng.random() < 0.5:
            per_actor["china"] = round(share * rng.uniform(0.01, 0.06), 3)
        per_actor["environment"] = round(share * rng.uniform(0.02, 0.09), 3)
    return {"hostile": hostile, "natural": natural, "unknown": unknown, "per_actor": per_actor}


@dataclass
class Builder:
    seed: int
    clock_mode: str
    duration_s: float
    episode_id: str
    scenario_id: str
    release_policy: str
    lines: list[dict[str, Any]] = field(default_factory=list)
    wall0: datetime = field(default_factory=lambda: datetime(2026, 9, 5, 12, 0, 0, tzinfo=UTC))

    def emit(
        self, sim_time_s: float, type_: str, seat: str | None, payload: dict[str, Any], **extra: Any
    ) -> None:
        line: dict[str, Any] = {
            "sim_time_s": round(float(sim_time_s), 3),
            # Demo pacing only, and excluded from replay comparison by the
            # contract; compressed 72 sim-hours into ~12 wall-minutes.
            "wall_time": (self.wall0 + timedelta(seconds=float(sim_time_s) / 360.0))
            .isoformat()
            .replace("+00:00", "Z"),
            "type": type_,
            "seat": seat,
            "payload": payload,
            "seed": self.seed,
            "env_version": "env_v1",
            "episode_id": self.episode_id,
            "scenario_id": self.scenario_id,
        }
        line.update(extra)
        self.lines.append(line)


def build(
    seed: int, clock_mode: str, duration_hours: float = 72.0, release_policy: str = "human"
) -> list[dict[str, Any]]:
    rng = random.Random(seed * 7919 + (0 if clock_mode == "continuous" else 1))
    digest = hashlib.sha1(f"{seed}-{clock_mode}".encode()).hexdigest()[:8]
    scenario = "g4_ambiguous_signature"
    b = Builder(
        seed=seed,
        clock_mode=clock_mode,
        duration_s=duration_hours * 3600,
        episode_id=f"{scenario}-{seed}-{digest}",
        scenario_id=scenario,
        release_policy=release_policy,
    )

    # ---- storm layer -----------------------------------------------------
    for hour, sev, kp, dst, sens, comms, deg, susp in STORM_STEPS:
        if hour * 3600 > b.duration_s:
            continue
        b.emit(
            hour * 3600,
            "storm_update",
            None,
            {
                "severity": sev,
                "kp": kp,
                "dst_nt": dst,
                "sensor_confidence_multiplier": sens,
                "comms_bandwidth_multiplier": comms,
                "tracking_degraded": deg,
                "screening_suspended": susp,
                "profile": "may2024",
            },
        )

    # ---- injects ---------------------------------------------------------
    for inj in INJECTS:
        if inj["hour"] * 3600 > b.duration_s:
            continue
        b.emit(
            inj["hour"] * 3600,
            "inject",
            None,
            {
                "inject_id": inj["inject_id"],
                "recipients": inj["recipients"],
                "content": inj["content"],
                "confidence": inj["confidence"],
                "source": inj["source"],
            },
        )

    # ---- decision points -------------------------------------------------
    checkpoints: list[float] = []
    if clock_mode == "checkpoint":
        # variable tempo: tight around the knife inject at h13.9, loose either side
        t = 0.0
        while t < b.duration_s:
            checkpoints.append(t)
            hour = t / 3600
            interval = 1.5 if 11 <= hour <= 22 else (3.0 if hour < 34 else 4.5)
            t += interval * 3600
        for idx, cp in enumerate(checkpoints):
            nxt = checkpoints[idx + 1] if idx + 1 < len(checkpoints) else None
            b.emit(
                cp,
                "checkpoint",
                None,
                {
                    "checkpoint_index": idx,
                    "seats_woken": list(SEATS),
                    "schedule_type": "variable_tempo",
                    "next_checkpoint_sim_time_s": nxt,
                    "decisions_collected": len(SEATS),
                },
            )

    inject_times = [i["hour"] * 3600 for i in INJECTS]
    decision_points: list[tuple[float, str]] = []
    for seat, clk in CLOCKS.items():
        if clock_mode == "checkpoint":
            decision_points += [(cp, seat) for cp in checkpoints]
            continue
        t = clk.phase_minutes * 60
        while t < b.duration_s:
            decision_points.append((t, seat))
            t += clk.poll_minutes * 60
        if clk.wake_on_inject:
            # An inject wakes the seat after its own feed latency, which is why
            # nine seats never share a timestamp under the continuous clock.
            lat = clk.feed_latency_minutes * 60
            decision_points += [(it + lat, seat) for it in inject_times if it + lat < b.duration_s]
    decision_points.sort(key=lambda p: (p[0], SEATS.index(p[1])))

    msg_i = 0
    dec_i = 0
    release_i = 0
    pending_release: dict[str, dict[str, Any]] = {}

    for t, seat in decision_points:
        hour = t / 3600
        clk = CLOCKS[seat]
        dec_i += 1
        decision_id = f"d{dec_i:04d}_{seat}"
        beliefs = _beliefs(seat, hour, rng)

        menu = SEAT_MENU[seat]
        # Escalation pressure: the higher the hostile belief and the later the
        # hour, the further up the menu the stub reaches.
        pressure = min(0.95, beliefs["hostile"] * 0.8 + (hour / 72) * 0.35)
        if rng.random() > pressure:
            action_type = "hold"
        else:
            top = 1 + int(pressure * (len(menu) - 1))
            action_type = menu[rng.randrange(0, max(1, top) + 1) % len(menu)]
        action = {"type": action_type, "params": _params_for(action_type, seat, rng)}

        lands_at = t + clk.deliberation_minutes * 60
        if lands_at > b.duration_s:
            continue

        # Release cycle for the actions that need it.
        needs_release = action_type in REQUIRES_RELEASE.get(seat, ())
        if needs_release:
            release_i += 1
            release_id = f"rel_{release_i:03d}"
            b.emit(
                t,
                "release_requested",
                seat,
                {
                    "release_id": release_id,
                    "action": action,
                    "releasing_seat": RELEASING_SEAT[seat],
                    "decision_id": decision_id,
                    "justification": f"{seat} requests {action_type}; belief hostile={beliefs['hostile']:.2f}. "
                    + REASONING[seat][dec_i % len(REASONING[seat])],
                },
            )
            granted = rng.random() < (0.35 if action_type in ("counter_rpo", "kinetic") else 0.6)
            wait_s = rng.choice([1800, 3600, 5400, 7200])
            b.emit(
                t + wait_s,
                "release_granted" if granted else "release_denied",
                RELEASING_SEAT[seat],
                {
                    "release_id": release_id,
                    "decided_by": "human" if release_policy == "human" else "auto",
                    "wait_sim_time_s": wait_s,
                    "rationale": REASONING[RELEASING_SEAT[seat]][
                        (dec_i + 2) % len(REASONING[RELEASING_SEAT[seat]])
                    ],
                },
            )
            pending_release[release_id] = {"granted": granted}
            lands_at = t + wait_s + clk.deliberation_minutes * 60
            if lands_at > b.duration_s:
                continue
            if not granted:
                b.emit(
                    lands_at,
                    "action",
                    seat,
                    {
                        "action": action,
                        "decision_id": decision_id,
                        "decided_at_sim_time_s": round(t, 3),
                        "blocked": True,
                        "blocked_reason": "requires_release: release_denied",
                        "beliefs": beliefs,
                        "reasoning": REASONING[seat][dec_i % len(REASONING[seat])],
                    },
                )
                continue

        b.emit(
            lands_at,
            "action",
            seat,
            {
                "action": action,
                "decision_id": decision_id,
                "decided_at_sim_time_s": round(t, 3),
                "blocked": False,
                # Not required by the contract, but payload allows extra keys and
                # the UI's persona cards need beliefs and reasoning per decision.
                "beliefs": beliefs,
                "reasoning": REASONING[seat][dec_i % len(REASONING[seat])],
                "deliberation_minutes": clk.deliberation_minutes,
            },
        )

        # Occasional outbound message, so channels have traffic in transit.
        if rng.random() < 0.28:
            to, channel, text = MESSAGE_TEXT[msg_i % len(MESSAGE_TEXT)]
            msg_i += 1
            if to == seat:
                to = "all"
            message_id = f"m{msg_i:04d}"
            message = {"to": to, "channel": channel, "text": text}
            dropped = rng.random() < 0.07
            sent_payload: dict[str, Any] = {
                "message_id": message_id,
                "message": message,
                "from": seat,
            }
            if dropped:
                sent_payload["dropped_reason"] = rng.choice(["clearance", "channel_severed"])
            b.emit(t, "message_sent", seat, sent_payload)
            if not dropped:
                delay = CHANNEL_DELAY_MIN[channel] * 60
                # Comms degradation stretches delivery; that is the storm's
                # effect the message-in-transit indicator makes visible.
                mult = 1.0
                for shour, _s, _k, _d, _sm, comms, _td, _ss in STORM_STEPS:
                    if shour * 3600 <= t:
                        mult = 1.0 / max(0.3, comms)
                delivered = t + delay * mult
                if delivered < b.duration_s:
                    b.emit(
                        delivered,
                        "message_delivered",
                        seat,
                        {"message_id": message_id, "message": message, "from": seat},
                    )

        # World-state mutations worth replaying.
        if rng.random() < 0.06:
            what, value, prev = rng.choice(
                [
                    ("assets.starlink_arctic_07.safe_mode", True, False),
                    ("assets.starlink_arctic_07.safe_mode", False, True),
                    ("ksat.cable_2.status", "intermittent", "nominal"),
                    ("feeds.svalsat_downlink.status", "outage", "nominal"),
                    ("feeds.svalsat_downlink.status", "nominal", "outage"),
                    ("assets.asbm_1.propellant_frac", 0.87, 0.91),
                    ("reputation.starlink", -0.12, 0.0),
                    ("assets.kosmos_2558.propellant_frac", 0.62, 0.68),
                ]
            )
            b.emit(
                t,
                "state_change",
                None,
                {"what": what, "value": value, "previous": prev, "reason": "engine world update"},
            )

    # ---- reveal and end --------------------------------------------------
    b.emit(
        b.duration_s - 60,
        "attribution_revealed",
        None,
        {
            "cause": "hostile_jam",
            "responsible_actor": "northern_fleet",
            "private_types": {
                "northern_fleet": "action_under_cover",
                "china": "opportunistic_amplifier",
            },
            "revealed_to": ["system"],
        },
    )

    actions = [ln for ln in b.lines if ln["type"] == "action"]
    utilities = {}
    for s in SEATS:
        own = [ln for ln in actions if ln["seat"] == s]
        utilities[s] = round(rng.uniform(-0.8, 0.6) - 0.02 * len(own), 3)
    b.emit(
        b.duration_s,
        "episode_end",
        None,
        {
            "reason": "time_limit",
            "utilities": utilities,
            "seats": dict(SPEC_IDS),
            "decision_count": len(actions),
        },
        spec_version="spec_v1",
        clock_mode=clock_mode,
        release_policy=release_policy,
    )

    b.lines.sort(key=lambda ln: (ln["sim_time_s"], 0 if ln["type"] != "episode_end" else 1))
    return b.lines


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--seed", type=int, default=1041)
    ap.add_argument("--clock-mode", choices=("continuous", "checkpoint"), default="continuous")
    ap.add_argument("--release-policy", choices=("human", "auto"), default="human")
    ap.add_argument("--hours", type=float, default=72.0)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    lines = build(args.seed, args.clock_mode, args.hours, args.release_policy)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as fh:
        for ln in lines:
            fh.write(json.dumps(ln, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{args.out}: {len(lines)} events, episode_id={lines[0]['episode_id']}")


if __name__ == "__main__":
    main()
