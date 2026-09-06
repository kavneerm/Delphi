"""Contract-shaped fake lake records, for use until `gen/run.py` fills `lake/`.

`docs/COORDINATION.md` §3: mock, proceed, swap later. Every record here validates
against `contracts/lake_record_schema.json`, so `filter.py`, `gates.py` and the
smoke test exercise the real code path — only the content is invented. Nothing
here touches `docs/quarantine.md` material: the scenarios are synthetic grid
cells, not incidents.
"""

from __future__ import annotations

import hashlib
import random
from typing import Any

SEATS = [
    "northcom",
    "usspacecom",
    "nsc",
    "norway",
    "northern_fleet",
    "kremlin",
    "china",
    "starlink",
    "iridium",
]

LADDER = [
    "hold",
    "maneuver",
    "private_demarche",
    "public_attribution",
    "request_commercial_priority",
    "share_telemetry",
    "geofence_or_throttle",
    "disclose_incident",
]

_PARAMS: dict[str, dict[str, Any]] = {
    "hold": {},
    "maneuver": {"asset_id": "sv-heo-01", "delta_v_mps": 1.5},
    "private_demarche": {"recipient": "kremlin"},
    "public_attribution": {"attributed_actor": "unknown", "confidence_stated": 0.4},
    "request_commercial_priority": {"provider": "iridium", "capability": "arctic_bandwidth"},
    "share_telemetry": {"recipient": "norway", "data_class": "ssa_tracks"},
    "geofence_or_throttle": {"region": "svalbard", "mode": "throttle"},
    "disclose_incident": {"scope": "allies"},
}


def _episode_id(scenario: str, seed: int) -> str:
    digest = hashlib.sha1(f"{scenario}-{seed}".encode()).hexdigest()[:8]
    return f"{scenario}-{seed}-{digest}"


def _beliefs(rng: random.Random) -> dict[str, Any]:
    hostile = round(rng.uniform(0.05, 0.75), 2)
    natural = round(rng.uniform(0.05, 1.0 - hostile), 2)
    unknown = round(1.0 - hostile - natural, 2)
    per_actor = {"kremlin": round(hostile * 0.6, 2)} if hostile > 0.3 else {}
    return {
        "hostile": hostile,
        "natural": natural,
        "unknown": max(unknown, 0.0),
        "per_actor": per_actor,
    }


def _record(rng: random.Random, i: int, *, pair: tuple[str, str] | None) -> dict[str, Any]:
    seat = SEATS[i % len(SEATS)]
    scenario = ["g5_lowconf_auc", "g4_highconf_rpo", "quiet_baseline"][i % 3]
    seed = 1000 + (i % 17)
    episode_id = _episode_id(scenario, seed)
    sim_time = float(3600 * (1 + i % 20))
    rung = rng.randrange(len(LADDER))
    action_type = LADDER[rung]
    return {
        "record_id": f"{episode_id}-{seat}-{int(sim_time)}",
        "lake_version": "lake_v0",
        "spec_id": f"{seat}_v{i % 3}",
        "spec_version": "spec_v0",
        "env_version": "env_v0",
        "seed": seed,
        "episode_id": episode_id,
        "seat": seat,
        "sim_time_s": sim_time,
        "scenario_id": scenario,
        "filtered_state": {
            "own_assets": [{"asset_id": "sv-heo-01", "status": "nominal", "propellant_kg": 41.2}],
            "observed_effects": [
                {"effect": "uplink_degraded", "since_sim_time_s": sim_time - 1800}
            ],
            "space_weather": {"kp_reported": rng.choice([3, 5, 7, 8]), "feed_lag_s": 900},
            "ladder_state": {"highest_observed_rung": max(0, rung - 1)},
            "available_actions": LADDER,
            "clock": {"sim_time_s": sim_time, "hours_remaining": 72 - sim_time / 3600},
            "pending_releases": [],
        },
        "injects_seen": [],
        "messages_seen": [],
        "output": {
            "beliefs": _beliefs(rng),
            "messages": [],
            "action": {"type": action_type, "params": dict(_PARAMS[action_type])},
            "reasoning": (
                f"Uplink degradation at {sim_time / 3600:.0f}h with a reported Kp in the "
                f"storm band. Holding at rung {rung} until the next pass resolves whether "
                "this is weather or interference."
            ),
        },
        "outcome_utility": round(rng.uniform(-1.0, 1.0), 3),
        "judge_scores": {
            "authority": rng.randint(2, 5),
            "risk": rng.randint(2, 5),
            "private_info": rng.randint(2, 5),
            "voice": rng.randint(2, 5),
        },
        "judge_version": "judge_v0",
        "pair_id": pair[0] if pair else None,
        **({"pair_variant": pair[1], "pair_flipped_field": "risk_posture"} if pair else {}),
        "gen_model": "mock",
        "gen_source": "stub",
        "prompt_version": "mock_v0",
        "schema_retries": 0,
        "tokens": {"prompt": rng.randrange(800, 4000), "completion": rng.randrange(120, 600)},
    }


def records(n: int, *, seed: int = 7, pair_fraction: float = 0.3) -> list[dict[str, Any]]:
    """`n` schema-valid lake records, `pair_fraction` of them in counterfactual pairs."""
    rng = random.Random(seed)
    out: list[dict[str, Any]] = []
    i = 0
    n_paired = int(n * pair_fraction) // 2 * 2
    while len(out) < n:
        if len(out) < n_paired:
            pid = f"pair-{len(out) // 2:04d}"
            a = _record(rng, i, pair=(pid, "a"))
            b = _record(rng, i, pair=(pid, "b"))
            b["record_id"] = a["record_id"] + "-b"
            # Half the pairs are genuinely insensitive; filter.py must drop those.
            if len(out) % 4 == 0:
                b["output"] = a["output"]
            out.extend([a, b])
            i += 1
        else:
            out.append(_record(rng, i, pair=None))
            i += 1
    return out[:n]
