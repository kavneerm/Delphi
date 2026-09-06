"""World state: what is up there, what is on the ground, and what condition it is in.

Three asset classes, per `docs/agent_workstreams.md`:

* **persistent HEO nodes** — individually propagated Molniya-type satellites that
  hold the Arctic picture, including the Norwegian ASBM pair that hosts EPS-R;
* **constellations** — aggregated, because propagating four thousand satellites
  to draw one degraded-service number is a waste; a representative plane carries
  the ground track and a member count carries the capacity;
* **pass-based sensors** — radars and inspectors that only see a target when a
  pass is open, which is what makes a picture arrive in lumps rather than
  continuously.

Plus the ground segment (stations, cables), protected-comms capacity, propellant
budgets, and a reputation score per actor.

Everything lives in plain dicts under `World.state`, addressed by the dotted
paths `contracts/event_log_schema.json` uses for `state_change.what`. Mutating
through `World.set()` is what makes a change replayable: the write and the log
line are the same call.
"""

from __future__ import annotations

import copy
from collections.abc import Callable
from typing import Any

from engine import orbits

__all__ = ["World", "initial_state"]

ChangeHook = Callable[[str, Any, Any, str], None]


def _heo(a_km: float, e: float, raan: float, argp: float, m0: float) -> dict[str, Any]:
    return {
        "a_km": a_km,
        "e": e,
        "inc_deg": 63.4,
        "raan_deg": raan,
        "argp_deg": argp,
        "m0_deg": m0,
        "epoch_s": 0.0,
    }


def _polar(a_km: float, raan: float, m0: float, inc: float = 87.9) -> dict[str, Any]:
    return {
        "a_km": a_km,
        "e": 0.0012,
        "inc_deg": inc,
        "raan_deg": raan,
        "argp_deg": 0.0,
        "m0_deg": m0,
        "epoch_s": 0.0,
    }


def initial_state() -> dict[str, Any]:
    """The Arctic order of battle at t=0.

    Ids are engine-internal and appear in `filtered_state.own_assets`, in
    `action_params.asset_id`, and in `state_change.what`. They are deliberately
    generic: nothing here names a quarantined incident.
    """
    assets: dict[str, dict[str, Any]] = {
        # --- persistent HEO nodes ---------------------------------------------
        "asbm_1": {
            "name": "ASBM-1 (hosts EPS-R)",
            "owner": "norway",
            "asset_class": "heo_node",
            "orbit": _heo(26560.0, 0.72, 30.0, 270.0, 0.0),
            "delta_v_budget_mps": 180.0,
            "hosted_payload": "eps_r",
            "mission": "arctic_broadband",
        },
        "asbm_2": {
            "name": "ASBM-2 (hosts EPS-R)",
            "owner": "norway",
            "asset_class": "heo_node",
            "orbit": _heo(26560.0, 0.72, 210.0, 270.0, 180.0),
            "delta_v_budget_mps": 180.0,
            "hosted_payload": "eps_r",
            "mission": "arctic_broadband",
        },
        "rf_meridian_7": {
            "name": "Northern Fleet HEO comms node",
            "owner": "northern_fleet",
            "asset_class": "heo_node",
            "orbit": _heo(26560.0, 0.71, 95.0, 288.0, 40.0),
            "delta_v_budget_mps": 140.0,
            "mission": "fleet_comms",
        },
        "rf_inspector_1": {
            "name": "Northern Fleet co-orbital inspector",
            "owner": "northern_fleet",
            "asset_class": "heo_node",
            "orbit": _heo(25100.0, 0.68, 33.0, 271.0, 6.0),
            "delta_v_budget_mps": 320.0,
            "mission": "inspection",
        },
        "gssap_analog_1": {
            "name": "US neighbourhood-watch inspector",
            "owner": "usspacecom",
            "asset_class": "heo_node",
            "orbit": _heo(26000.0, 0.70, 28.0, 269.0, 3.0),
            "delta_v_budget_mps": 400.0,
            "mission": "ssa_inspection",
        },
        # --- constellations ----------------------------------------------------
        "starlink_arctic": {
            "name": "Starlink polar shell (Arctic service)",
            "owner": "starlink",
            "asset_class": "constellation",
            "orbit": _polar(6931.0, 12.0, 0.0),
            "members": 240,
            "members_active": 240,
            "members_safe_mode": 0,
            "members_lost": 0,
            "capacity_gbps": 46.0,
            "delta_v_budget_mps": 90.0,
            "mission": "broadband",
        },
        "starshield_arctic": {
            "name": "Starshield-analog government shell",
            "owner": "starlink",
            "asset_class": "constellation",
            "orbit": _polar(6931.0, 78.0, 40.0),
            "members": 36,
            "members_active": 36,
            "members_safe_mode": 0,
            "members_lost": 0,
            "capacity_gbps": 9.0,
            "delta_v_budget_mps": 90.0,
            "mission": "government_broadband",
            "government_tasked": True,
        },
        "iridium_next": {
            "name": "Iridium-analog cross-linked constellation",
            "owner": "iridium",
            "asset_class": "constellation",
            "orbit": _polar(7159.0, 141.0, 20.0, inc=86.4),
            "members": 66,
            "members_active": 66,
            "members_safe_mode": 0,
            "members_lost": 0,
            "capacity_gbps": 7.5,
            "delta_v_budget_mps": 60.0,
            "mission": "narrowband_safety_of_life",
        },
        # --- pass-based sensors ------------------------------------------------
        "vardo_radar": {
            "name": "Vardø phased-array radar",
            "owner": "norway",
            "asset_class": "pass_sensor",
            "site": {"lat_deg": 70.37, "lon_deg": 31.10},
            "pass_period_s": 5400,
            "pass_duration_s": 1200,
            "sensor_health": 1.0,
            "mission": "space_surveillance",
        },
        "ssn_arctic": {
            "name": "Northern space-surveillance site",
            "owner": "usspacecom",
            "asset_class": "pass_sensor",
            "site": {"lat_deg": 76.53, "lon_deg": -68.70},
            "pass_period_s": 7200,
            "pass_duration_s": 1500,
            "sensor_health": 1.0,
            "mission": "space_surveillance",
        },
        "cn_ssa_optical": {
            "name": "Chinese optical SSA site",
            "owner": "china",
            "asset_class": "pass_sensor",
            "site": {"lat_deg": 43.82, "lon_deg": 87.17},
            "pass_period_s": 10800,
            "pass_duration_s": 900,
            "sensor_health": 1.0,
            "mission": "space_surveillance",
        },
    }
    ground: dict[str, dict[str, Any]] = {
        "svalsat": {
            "name": "Svalbard satellite station",
            "owner": "norway",
            "kind": "ground_station",
            "status": "nominal",
            "downlink_slots": 24,
            "slots_available": 24,
            "serves": ["asbm_1", "asbm_2", "starlink_arctic", "iridium_next", "starshield_arctic"],
        },
        "andoya": {
            "name": "Andøya station",
            "owner": "norway",
            "kind": "ground_station",
            "status": "nominal",
            "downlink_slots": 12,
            "slots_available": 12,
            "serves": ["asbm_1", "asbm_2"],
        },
        "svalbard_cable_1": {
            "name": "Svalbard subsea cable, strand 1",
            "owner": "norway",
            "kind": "cable",
            "status": "nominal",
            "capacity_gbps": 20.0,
        },
        "svalbard_cable_2": {
            "name": "Svalbard subsea cable, strand 2",
            "owner": "norway",
            "kind": "cable",
            "status": "nominal",
            "capacity_gbps": 20.0,
        },
        "starlink_gateway_arctic": {
            "name": "Arctic gateway and modem fleet",
            "owner": "starlink",
            "kind": "gateway",
            "status": "nominal",
            "capacity_gbps": 30.0,
        },
        "iridium_teleport_north": {
            "name": "Northern teleport",
            "owner": "iridium",
            "kind": "gateway",
            "status": "nominal",
            "capacity_gbps": 6.0,
        },
        "rf_ew_severomorsk": {
            "name": "Northern Fleet electronic-warfare site",
            "owner": "northern_fleet",
            "kind": "emitter",
            "status": "nominal",
        },
    }
    return {
        "assets": assets,
        "ground": ground,
        "comms": {
            "protected_capacity_gbps": 12.0,
            "protected_allocated_gbps": 0.0,
            "arctic_service_level": 1.0,
            "priority_grants": {},
        },
        "reputation": {
            "northcom": 0.6,
            "usspacecom": 0.6,
            "nsc": 0.6,
            "norway": 0.65,
            "northern_fleet": 0.4,
            "kremlin": 0.35,
            "china": 0.5,
            "starlink": 0.55,
            "iridium": 0.6,
        },
        "debris_objects": 0,
        "escalation_rung": 0,
        "public_record": [],
        "effects": {},
        "ladder_events": [],
    }


class World:
    """Mutable world state with replayable writes."""

    def __init__(self, params: dict[str, Any] | None = None) -> None:
        self.params: dict[str, Any] = dict(params or {})
        self.state: dict[str, Any] = initial_state()
        self.state["comms"]["protected_capacity_gbps"] = float(
            self.params.get("protected_comms_capacity_gbps", 12.0)
        )
        self._hook: ChangeHook | None = None

    def on_change(self, hook: ChangeHook | None) -> None:
        """Register the callback that turns a write into a `state_change` line."""
        self._hook = hook

    # --- addressing ----------------------------------------------------------

    def get(self, path: str, default: Any = None) -> Any:
        node: Any = self.state
        for part in path.split("."):
            if isinstance(node, dict) and part in node:
                node = node[part]
            else:
                return default
        return node

    def set(self, path: str, value: Any, reason: str = "") -> None:
        parts = path.split(".")
        node: Any = self.state
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        previous = node.get(parts[-1])
        if previous == value:
            return
        node[parts[-1]] = value
        if self._hook is not None:
            self._hook(path, value, previous, reason)

    def bump(
        self, path: str, delta: float, reason: str = "", lo: float = 0.0, hi: float = 1.0
    ) -> None:
        current = float(self.get(path, 0.0) or 0.0)
        self.set(path, round(max(lo, min(hi, current + delta)), 6), reason)

    # --- queries -------------------------------------------------------------

    def assets_of(self, owner: str) -> dict[str, dict[str, Any]]:
        return {
            aid: asset
            for aid, asset in sorted(self.state["assets"].items())
            if asset["owner"] == owner
        }

    def ground_of(self, owner: str) -> dict[str, dict[str, Any]]:
        return {
            gid: node
            for gid, node in sorted(self.state["ground"].items())
            if node["owner"] == owner
        }

    def asset(self, asset_id: str) -> dict[str, Any] | None:
        return self.state["assets"].get(asset_id)

    def owner_of(self, asset_id: str) -> str | None:
        node = self.state["assets"].get(asset_id) or self.state["ground"].get(asset_id)
        return node["owner"] if node else None

    def all_asset_ids(self) -> list[str]:
        return sorted(self.state["assets"])

    # --- physics -------------------------------------------------------------

    def propagate_to(self, sim_time_s: int) -> None:
        """Advance every orbit to `sim_time_s`. Pure two-body, no perturbations."""
        for _aid, asset in sorted(self.state["assets"].items()):
            orbit = asset.get("orbit")
            if orbit:
                asset["orbit"] = orbits.propagate(orbit, float(sim_time_s))

    def maneuver(
        self, asset_id: str, delta_v_mps: float, sim_time_s: int, direction: str
    ) -> dict[str, Any]:
        """Impulsive burn. Spends propellant whether or not it achieved anything."""
        asset = self.state["assets"].get(asset_id)
        if asset is None or not asset.get("orbit"):
            return {"ok": False, "reason": "no_such_asset"}
        budget = float(asset.get("delta_v_budget_mps", 0.0))
        spend = min(float(delta_v_mps), budget)
        if spend <= 0:
            return {"ok": False, "reason": "no_propellant"}
        asset["orbit"] = orbits.apply_impulse(asset["orbit"], float(sim_time_s), spend, direction)
        self.set(
            f"assets.{asset_id}.delta_v_budget_mps",
            round(budget - spend, 3),
            reason="maneuver",
        )
        return {"ok": True, "delta_v_mps": spend, "remaining_mps": round(budget - spend, 3)}

    def track(self, asset_id: str, sim_time_s: int) -> dict[str, float] | None:
        asset = self.state["assets"].get(asset_id)
        if not asset or not asset.get("orbit"):
            return None
        return orbits.ground_track(asset["orbit"], float(sim_time_s))

    def pass_open(self, sensor_id: str, sim_time_s: int) -> bool:
        """Is this pass-based sensor looking right now?

        A square wave, not an ephemeris: what matters downstream is that a
        sensor's picture arrives in lumps and that the lumps are the same on
        every replay.
        """
        sensor = self.state["assets"].get(sensor_id)
        if not sensor or sensor.get("asset_class") != "pass_sensor":
            return True
        period = int(sensor.get("pass_period_s", 5400))
        duration = int(sensor.get("pass_duration_s", 1200))
        return (int(sim_time_s) % period) < duration

    # --- capacity ------------------------------------------------------------

    def arctic_capacity_gbps(self) -> float:
        """Total Arctic service capacity actually available right now."""
        total = 0.0
        for _aid, asset in sorted(self.state["assets"].items()):
            if asset.get("asset_class") != "constellation":
                continue
            members = max(1, int(asset.get("members", 1)))
            active = int(asset.get("members_active", members))
            degrade = float(asset.get("service_multiplier", 1.0))
            total += float(asset.get("capacity_gbps", 0.0)) * (active / members) * degrade
        for _gid, node in sorted(self.state["ground"].items()):
            if node.get("kind") == "cable" and node.get("status") != "nominal":
                total -= float(node.get("capacity_gbps", 0.0)) * 0.25
        return round(max(0.0, total), 3)

    # --- snapshot ------------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        return copy.deepcopy(self.state)

    def restore(self, snap: dict[str, Any]) -> None:
        self.state = copy.deepcopy(snap)
