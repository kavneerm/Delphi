"""TODO_SCENARIO — synthetic inject timelines built from a grid cell.

The dev-set and replay scenarios are human-authored (`specs/devset/`, `eval/replays/`).
Until `specs/devset/` is populated, generation still needs a timeline to run against, so
this module builds one from the sweep coordinates: the storm arrives, the picture
degrades, an ambiguous discriminating event lands at hour 18, and the noise channels run
throughout.

Every inject validates against `inject_schema.json#/$defs/inject`. `gen/run.py` prefers
a real scenario file whenever one exists for the cell; see `load_or_build`.

The knife inject is the one marked `is_knife_inject`. `contracts/targets.md` measures
counterfactual sensitivity at exactly that decision point, so both arms of a pair must
see the same one at the same sim time — which they do, because it is a function of the
cell and the cell is shared across the pair.
"""

from __future__ import annotations

import json
import random
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from gen.config import GenConfig
from gen.contracts import subschema_validator, validation_errors
from gen.quarantine import assert_clean

HOUR = 3600.0
STANDARD_DURATION_S = 259200.0  # 72 sim hours

#: How confident the sources sound, by the grid's intel_confidence dimension.
_CONFIDENCE = {"low": 0.30, "medium": 0.60, "high": 0.85}

_STORM_TEXT = {
    "quiet": "Geomagnetic conditions nominal. Kp 2, no watches or warnings in effect.",
    "G1": "Minor geomagnetic storm watch. Kp 5 expected. Weak power-grid fluctuations, "
    "minor impact on satellite operations possible.",
    "G2": "Moderate geomagnetic storm warning. Kp 6. HF radio degradation at high "
    "latitudes; satellite orientation irregularities possible.",
    "G3": "Strong geomagnetic storm warning. Kp 7. Surface charging on satellite "
    "components, increased drag on low-Earth orbit, intermittent high-latitude "
    "navigation and HF outages.",
    "G4": "Severe geomagnetic storm warning. Kp 8. Widespread high-latitude satellite "
    "tracking difficulty, spacecraft charging, HF radio propagation sporadic or blacked "
    "out for one to two days.",
    "G5": "Extreme geomagnetic storm warning. Kp 9. Extensive surface charging and "
    "orientation problems, uplink and downlink degradation, satellite tracking and "
    "orbit-prediction errors for several days, HF radio impossible in many areas.",
    "carrington": "Extreme geomagnetic storm, historic magnitude. Kp 9+ sustained. "
    "Tracking effectively suspended at high latitude, widespread spacecraft anomalies "
    "and safe-mode entries, conjunction screening unreliable.",
}

_SEVERE = ("G4", "G5", "carrington")


@dataclass
class Scenario:
    """An inject timeline plus the ground truth the engine holds and never shows."""

    scenario_id: str
    injects: list[dict[str, Any]]
    duration_s: float = STANDARD_DURATION_S
    knife_sim_time_s: float | None = None
    #: Held by the engine for the `attribution_revealed` line at episode end. Never in a
    #: filtered state, never in a prompt, never on a lake record.
    ground_truth: dict[str, Any] = field(default_factory=dict)

    def for_seat(self, seat: str, up_to_s: float) -> list[dict[str, Any]]:
        """Injects addressed to `seat` and already delivered at `up_to_s`."""
        out = []
        for inject in self.injects:
            if inject["sim_time_s"] > up_to_s:
                continue
            recipients = inject["recipients"]
            if seat in recipients or "all" in recipients:
                out.append(inject)
        return out


#: Abbreviations, so a scenario_id stays inside the 64-character episode_id budget
#: (`<scenario_id>-<seed>-<8 hex>`, `lake_record_schema.json#/properties/episode_id`).
#: Nothing is lost: the full coordinates are on every record under `grid_cell`.
_ABBREV = {
    "storm_severity": {
        "quiet": "quiet",
        "G1": "g1",
        "G2": "g2",
        "G3": "g3",
        "G4": "g4",
        "G5": "g5",
        "carrington": "carr",
    },
    "intel_confidence": {"low": "ilo", "medium": "imd", "high": "ihi"},
    "red_private_type": {
        "storm_reposition": "sr",
        "opportunistic_isr": "oi",
        "action_under_cover": "auc",
    },
    "red_psyche": {
        "revisionist": "rev",
        "revanchist": "rvn",
        "opportunistic_cautious": "opc",
        "regime_survival": "rgs",
    },
    "commercial_sharing_policy": {"closed": "shc", "on_request": "shr", "open": "sho"},
}


def _abbrev(dimension: str, value: Any, default: str) -> str:
    return _ABBREV[dimension].get(str(value), default)


def scenario_id_for(cell: dict[str, Any]) -> str:
    """A stable, key-safe, short id for one grid cell."""
    parts = [
        _abbrev("storm_severity", cell.get("storm_severity"), "g3"),
        _abbrev("intel_confidence", cell.get("intel_confidence"), "imd"),
        _abbrev("red_private_type", cell.get("red_private_type"), "sr"),
        _abbrev("red_psyche", cell.get("red_psyche"), "rev"),
        "cr1" if cell.get("pre_existing_crisis") else "cr0",
        _abbrev("commercial_sharing_policy", cell.get("commercial_sharing_policy"), "shr"),
        "ir1" if cell.get("iridium_survives", True) else "ir0",
    ]
    return "_".join(parts)


def _inject(
    t: float,
    recipients: list[str],
    content: str,
    confidence: float,
    source: str,
    inject_id: str,
    *,
    feed: str | None = None,
    source_class: str | None = None,
    truthful: bool = True,
    knife: bool = False,
) -> dict[str, Any]:
    out: dict[str, Any] = {
        "sim_time_s": float(t),
        "recipients": recipients,
        "content": content,
        "confidence": round(float(confidence), 3),
        "source": source,
        "inject_id": inject_id,
    }
    if feed:
        out["feed"] = feed
    if source_class:
        out["source_class"] = source_class
    if not truthful:
        out["truthful"] = False
    if knife:
        out["is_knife_inject"] = True
    return out


def build(cell: dict[str, Any], seed: int) -> Scenario:
    """A 72-hour synthetic timeline for one grid cell."""
    rng = random.Random(f"{seed}:scenario")
    severity = str(cell.get("storm_severity", "G3"))
    conf = _CONFIDENCE[str(cell.get("intel_confidence", "medium"))]
    red_type = str(cell.get("red_private_type", "storm_reposition"))
    crisis = bool(cell.get("pre_existing_crisis"))
    sharing = str(cell.get("commercial_sharing_policy", "on_request"))
    iridium_survives = bool(cell.get("iridium_survives", True))
    severe = severity in _SEVERE
    hostile = red_type in ("opportunistic_isr", "action_under_cover")

    injects: list[dict[str, Any]] = []

    if crisis:
        injects.append(
            _inject(
                0.25 * HOUR,
                ["all"],
                "Standing note: the archipelago sovereignty dispute escalated last month. "
                "Fisheries enforcement incidents in the Barents remain unresolved and both "
                "capitals have recalled working-level contacts. Any incident in the region "
                "will be read against that background.",
                0.9,
                "duty officer summary",
                "crisis_background",
                source_class="internal",
            )
        )

    injects.append(
        _inject(
            0.0,
            ["all"],
            f"Space weather bulletin. {_STORM_TEXT[severity]}",
            0.9 if severity != "quiet" else 0.95,
            "NOAA SWPC bulletin",
            "storm_bulletin",
            feed="space_weather",
            source_class="space_weather",
        )
    )

    injects.append(
        _inject(
            0.5 * HOUR,
            ["starlink"],
            "Constellation health: elevated anomaly counts on Arctic-tasked planes. "
            f"{'Multiple' if severe else 'Several'} spacecraft reporting attitude-control "
            "irregularities and uplink acquisition failures above 70N. No confirmed losses.",
            0.95,
            "constellation operations",
            "starlink_health",
            feed="own_telemetry",
            source_class="internal",
        )
    )

    injects.append(
        _inject(
            1.0 * HOUR,
            ["norway"],
            "Svalbard ground segment: downlink acquisition failures on successive passes at "
            "SvalSat. Antenna pointing nominal. Cable link status nominal. Cause not yet "
            "established; the storm is the obvious candidate and the pattern does not rule "
            "out uplink interference.",
            0.9,
            "ground segment operations",
            "svalsat_anomaly",
            feed="ground_station_status",
            source_class="internal",
        )
    )

    injects.append(
        _inject(
            1.5 * HOUR,
            ["northcom", "usspacecom"],
            "Arctic communications picture degraded. Wideband service to northern "
            "approaches intermittent; two of three tasked relays not responding to "
            "scheduled contacts. Operational impact immediate.",
            0.9,
            "joint operations centre",
            "picture_degraded",
            source_class="internal",
        )
    )

    injects.append(
        _inject(
            2.0 * HOUR,
            ["starlink", "iridium"],
            "Customer traffic: complaint volume from maritime and research accounts north "
            "of 74N rising sharply. Two research stations report loss of primary link. A "
            "cruise operator has asked whether service will be restored before their next "
            "leg.",
            0.8,
            "customer support escalation",
            "customer_reports",
            feed="customer_reports",
            source_class="customer",
        )
    )

    injects.append(
        _inject(
            3.0 * HOUR,
            ["iridium", "northcom", "norway"],
            (
                "Cross-constellation status: the secondary constellation is holding service "
                "at reduced capacity, and is now the only wideband path north of 74N."
                if iridium_survives
                else "Cross-constellation status: the secondary constellation has also lost "
                "Arctic capacity. Multiple spacecraft in safe mode. There is no remaining "
                "wideband path north of 74N."
            ),
            0.9,
            "network operations",
            "iridium_status",
            source_class="internal",
        )
    )

    injects.append(
        _inject(
            4.0 * HOUR,
            ["starlink", "iridium", "norway"],
            {
                "closed": "Legal reminder: standing policy is that resolving telemetry and "
                "interference signatures are not shared outside the company without a court "
                "order or an executed government agreement.",
                "on_request": "Legal reminder: resolving telemetry may be shared with "
                "government partners on request, subject to a same-day review of liability "
                "exposure.",
                "open": "Legal reminder: standing policy is that anomaly telemetry is "
                "published to partners and, on a delay, publicly. Counsel has flagged that "
                "the insurer reads those publications.",
            }[sharing],
            0.95,
            "general counsel",
            "sharing_policy",
            source_class="internal",
        )
    )

    injects.append(
        _inject(
            4.0 * HOUR,
            ["northern_fleet"],
            {
                "storm_reposition": "Exercise direction: reposition the two orbital assets "
                "out of the charging environment before the next storm peak. The window is "
                "narrow and the manoeuvre will be visible.",
                "opportunistic_isr": "Exercise direction: the window is open and Western "
                "coverage of the northern approaches is degraded. Collect what can be "
                "collected. Do not create an incident.",
                "action_under_cover": "Exercise direction: proceed with the tasked effect "
                "during the storm window. Attribution is expected to be slow and contested. "
                "Nothing goes on the record.",
            }[red_type],
            0.95,
            "fleet headquarters",
            "red_tasking",
            feed="internal_reporting",
            source_class="internal",
        )
    )

    injects.append(
        _inject(
            6.0 * HOUR,
            ["all"],
            "Tracking bulletin: high-latitude orbit determination is degraded. Conjunction "
            "screening is suspended for objects with recent manoeuvre history until "
            "solutions reconverge."
            if severe
            else "Tracking bulletin: orbit determination residuals elevated at high "
            "latitude. Screening continues with wider uncertainty volumes.",
            0.85,
            "space surveillance network",
            "tracking_degraded",
            feed="ssa_catalog",
            source_class="internal",
        )
    )

    injects.append(
        _inject(
            8.0 * HOUR,
            ["all"],
            "Open-source imagery analysis posted publicly: two Russian spacecraft have "
            "changed orbit in the last 24 hours. The analyst calls the timing 'notable' "
            "and does not claim to know the purpose.",
            min(0.7, conf + 0.1),
            "social media, orbital analyst",
            "osint_manoeuvre",
            feed="osint",
            source_class="osint",
        )
    )

    if conf >= 0.6:
        injects.append(
            _inject(
                12.0 * HOUR,
                ["usspacecom"],
                "Collection note: an emitter consistent with a mobile uplink jammer was "
                "active in the northern theatre during two of the outage windows. "
                "Geolocation is coarse. The correlation is suggestive and not conclusive; "
                "the storm covers the same windows."
                if hostile
                else "Collection note: no emitter activity correlates with the outage "
                "windows. Absence of evidence at this collection posture is weak evidence.",
                conf,
                "signals intelligence summary",
                "sigint_note",
                feed="sigint",
                source_class="sigint",
            )
        )

    # --- the knife inject -------------------------------------------------
    injects.append(
        _inject(
            18.0 * HOUR,
            ["usspacecom", "northcom", "norway", "starlink", "nsc"],
            "Discriminating event, unresolved. A relay in the Arctic constellation dropped "
            "carrier for 41 minutes. The telemetry signature has both a charging profile "
            "and a rise time faster than charging usually produces. Separately, one of the "
            "repositioned Russian spacecraft is now inside 30 km of a Western asset and "
            "station-keeping there. The two facts are not known to be connected. The "
            "storm is at peak."
            if severe
            else "Discriminating event, unresolved. A relay in the Arctic constellation "
            "dropped carrier for 41 minutes. The telemetry signature is not a clean match "
            "for charging. Separately, one of the repositioned Russian spacecraft is now "
            "inside 30 km of a Western asset and station-keeping there. The two facts are "
            "not known to be connected.",
            conf,
            "space surveillance network, flash report",
            "knife_inject",
            source_class="internal",
            knife=True,
        )
    )

    hacktivist_claim_true = hostile and rng.random() < 0.4
    injects.append(
        _inject(
            20.0 * HOUR,
            ["all"],
            "A group with no established track record has claimed responsibility for "
            "'switching off the Arctic', posting a screenshot it says is from a satellite "
            "gateway. Nothing in the screenshot has been verified.",
            0.25,
            "social media",
            "hacktivist_claim",
            feed="osint",
            source_class="osint",
            truthful=hacktivist_claim_true,
        )
    )

    injects.append(
        _inject(
            24.0 * HOUR,
            ["all"],
            "Wire report: Moscow says Western states are 'manufacturing an incident out of "
            "the weather' and repeats its standing position on the archipelago. It denies "
            "any activity beyond a scheduled exercise.",
            0.9,
            "international wire service",
            "kremlin_statement",
            feed="adversary_public_statements",
            source_class="media",
        )
    )

    injects.append(
        _inject(
            28.0 * HOUR,
            ["all"],
            "Beijing offers, publicly, to share its own tracking data on the objects in "
            "question 'in the interest of all spacefaring states'.",
            0.8,
            "international wire service",
            "china_offer",
            feed="media",
            source_class="media",
        )
    )

    injects.append(
        _inject(
            30.0 * HOUR,
            ["starlink", "iridium"],
            "Underwriter notice: the war-risk exclusion is under review for this event. A "
            "public finding of deliberate interference would move the claim into the "
            "excluded class. No coverage decision has been taken.",
            0.9,
            "lead underwriter",
            "insurer_notice",
            feed="insurer",
            source_class="internal",
        )
    )

    injects.append(
        _inject(
            36.0 * HOUR,
            ["all"],
            "Press: two national outlets are running the outage tonight. Both have the "
            "question 'was this an attack' in the headline. One has a quote from a former "
            "official saying the pattern is 'not consistent with weather alone'.",
            0.7,
            "media monitoring",
            "media_pressure",
            feed="media",
            source_class="media",
        )
    )

    injects.append(
        _inject(
            42.0 * HOUR,
            ["norway", "northcom"],
            "Civil authorities on the archipelago report that two research stations and the "
            "settlement clinic are operating without a reliable link. The governor has "
            "asked when service will be restored and has been told nobody knows.",
            0.9,
            "civil liaison",
            "civilian_pressure",
            source_class="liaison",
        )
    )

    injects.append(
        _inject(
            48.0 * HOUR,
            ["all"],
            "Open-source update: the close-approach geometry has held for 30 hours. "
            "Analysts are split on whether it is inspection or shadowing. The storm index "
            "is falling.",
            min(0.75, conf + 0.15),
            "social media, orbital analyst",
            "osint_followup",
            feed="osint",
            source_class="osint",
        )
    )

    injects.append(
        _inject(
            60.0 * HOUR,
            ["all"],
            "Space weather bulletin: the storm has passed. Conditions returning to nominal. "
            "Any outage persisting from here is not the weather.",
            0.95,
            "NOAA SWPC bulletin",
            "storm_over",
            feed="space_weather",
            source_class="space_weather",
        )
    )

    injects.sort(key=lambda i: (i["sim_time_s"], i["inject_id"]))
    scenario = Scenario(
        scenario_id=scenario_id_for(cell),
        injects=injects,
        duration_s=STANDARD_DURATION_S,
        knife_sim_time_s=18.0 * HOUR,
        ground_truth={
            "cause": (
                "hostile_jam"
                if red_type == "action_under_cover"
                else ("multiple" if red_type == "opportunistic_isr" else "natural_space_weather")
            ),
            "responsible_actor": "northern_fleet" if hostile else "none",
            "red_private_type": red_type,
            "hacktivist_claim_truthful": hacktivist_claim_true,
        },
    )
    validate(scenario)
    return scenario


def validate(scenario: Scenario) -> None:
    """Every inject valid against the contract, and free of quarantined material."""
    v = subschema_validator("inject_schema.json", "inject")
    knives = 0
    for inject in scenario.injects:
        errors = validation_errors(v, inject)
        if errors:
            raise ValueError(f"{scenario.scenario_id}/{inject.get('inject_id')}: {errors[:2]}")
        knives += bool(inject.get("is_knife_inject"))
        assert_clean(
            inject["content"] + " " + inject["source"],
            where=f"scenario {scenario.scenario_id} inject {inject.get('inject_id')}",
        )
    if knives > 1:
        raise ValueError(f"{scenario.scenario_id}: {knives} knife injects, at most one allowed")


def load_scenario_file(path: Path) -> Scenario:
    """A human-authored scenario from `specs/devset/` or `specs/scenarios/`."""
    data = json.loads(path.read_text())
    kind = data.get("kind")
    if kind in ("real_replay", "control"):
        raise ValueError(
            f"{path} is {kind}: quarantine material for Agent 6 only "
            "(contracts/inject_schema.json, docs/quarantine.md). Generation must not read it."
        )
    injects = data.get("injects", [])
    knife = next((i["sim_time_s"] for i in injects if i.get("is_knife_inject")), None)
    scenario = Scenario(
        scenario_id=data["replay_id"],
        injects=sorted(injects, key=lambda i: i["sim_time_s"]),
        duration_s=float(data.get("duration_s", STANDARD_DURATION_S)),
        knife_sim_time_s=knife,
        ground_truth=data.get("ground_truth", {}),
    )
    validate(scenario)
    return scenario


def load_or_build(config: GenConfig, cell: dict[str, Any], seed: int) -> Scenario:
    """A human-authored scenario for this cell if one exists, else a synthetic one."""
    scenario_id = scenario_id_for(cell)
    for subdir in ("scenarios", "devset"):
        candidate = config.specs_root / subdir / f"{scenario_id}.json"
        if candidate.exists():
            return load_scenario_file(candidate)
    return build(cell, seed)
