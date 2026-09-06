"""`env_config` — the environment one episode runs under.

Thin wrapper over `contracts/env_config_schema.json`: it validates, fills the
schema defaults the engine relies on, and exposes the two fields that decide the
shape of the whole run — `clock_mode` and `release_policy` — as typed accessors.

`engine_params` is deliberately open in the contract, so its defaults live here
and are documented as engine knobs. Everything in it is covered by
`env_version`: changing a default bumps the version like anything else.
"""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from engine import ENV_VERSION
from engine.contracts import SEATS, validate

STANDARD_EPISODE_S = 259_200  # 72 sim hours

#: Engine knobs. Not in the contract — `engine_params` is open by design — but
#: frozen under `env_version` all the same.
DEFAULT_ENGINE_PARAMS: dict[str, Any] = {
    # --- propagation ---------------------------------------------------------
    "propagation_step_s": 600,  # how often orbits are advanced and ground tracks logged
    "mu_earth_km3_s2": 398600.4418,
    "earth_radius_km": 6378.137,
    # --- storm ---------------------------------------------------------------
    "storm_update_interval_s": 3600,
    "safe_mode_recovery_hours": {"heo_node": 6.0, "constellation": 3.0, "pass_sensor": 2.0},
    # --- attacks -------------------------------------------------------------
    "dazzle_permanent_damage_probability": 0.06,
    "attack_effect_step_s": 1800,
    # --- world ---------------------------------------------------------------
    "reputation_decay_per_hour": 0.01,
    "protected_comms_capacity_gbps": 12.0,
    # --- rule actors ---------------------------------------------------------
    "media_clock_interval_s": 21600,
    "osint_clock_interval_s": 28800,
    "swpc_bulletin_interval_s": 10800,
    "swpc_accuracy_range": [0.55, 0.95],
    "civilians_interval_s": 43200,
    "insurer_delay_s": 7200,
    # --- messaging -----------------------------------------------------------
    "channel_delay_minutes": {
        "hotline": 5,
        "back_channel": 20,
        "mil_to_mil": 30,
        "liaison": 45,
        "internal": 10,
        "commercial": 30,
        "diplomatic": 120,
        "press": 60,
    },
    "clearance_order": [
        "open",
        "commercial_proprietary",
        "restricted",
        "secret",
        "top_secret_sci",
    ],
}

DEFAULT_CLOCK_MODE: dict[str, Any] = {"mode": "continuous", "tick_s": 60}
DEFAULT_RELEASE_POLICY: dict[str, Any] = {"policy": "auto", "approval_probability": 0.6}
DEFAULT_HACKTIVIST: dict[str, Any] = {
    "enabled": True,
    "affiliation_weights": {"russian_directed": 0.3, "freelance": 0.5, "opportunistic": 0.2},
    "claim_rate_per_hour": 0.08,
    "true_claim_probability": 0.35,
}


@dataclass(frozen=True)
class EnvConfig:
    """One episode's configuration, already validated against the contract."""

    raw: dict[str, Any] = field(repr=False)

    # --- construction --------------------------------------------------------

    @staticmethod
    def from_dict(data: dict[str, Any], *, check: bool = True) -> EnvConfig:
        cfg = copy.deepcopy(data)
        cfg.setdefault("env_version", ENV_VERSION)
        cfg.setdefault("duration_s", STANDARD_EPISODE_S)
        cfg.setdefault("seed", 0)
        cfg.setdefault("clock_mode", copy.deepcopy(DEFAULT_CLOCK_MODE))
        cfg.setdefault("release_policy", copy.deepcopy(DEFAULT_RELEASE_POLICY))
        cfg.setdefault("hacktivist_injects", copy.deepcopy(DEFAULT_HACKTIVIST))
        if cfg["clock_mode"].get("mode") == "continuous":
            cfg["clock_mode"].setdefault("tick_s", 60)
        else:
            cfg["clock_mode"].setdefault("seal_decisions", True)
        if check:
            validate("env_config_schema.json", cfg)
        params = copy.deepcopy(DEFAULT_ENGINE_PARAMS)
        params.update(cfg.get("engine_params") or {})
        cfg["engine_params"] = params
        return EnvConfig(raw=cfg)

    @staticmethod
    def load(path: str | Path) -> EnvConfig:
        return EnvConfig.from_dict(json.loads(Path(path).read_text()))

    # --- accessors -----------------------------------------------------------

    @property
    def env_version(self) -> str:
        return str(self.raw["env_version"])

    @property
    def seed(self) -> int:
        return int(self.raw["seed"])

    @property
    def duration_s(self) -> int:
        return int(self.raw["duration_s"])

    @property
    def scenario_id(self) -> str:
        return str(self.raw.get("scenario_id") or "adhoc")

    @property
    def spec_version(self) -> str:
        return str(self.raw.get("spec_version") or "spec_v0")

    @property
    def clock_mode(self) -> dict[str, Any]:
        return self.raw["clock_mode"]

    @property
    def mode(self) -> str:
        return str(self.clock_mode["mode"])

    @property
    def tick_s(self) -> int:
        """Sim-clock resolution. Every scheduled time is quantised onto it."""
        if self.mode == "continuous":
            return int(self.clock_mode.get("tick_s", 60))
        return 60

    @property
    def release_policy(self) -> dict[str, Any]:
        return self.raw["release_policy"]

    @property
    def policy(self) -> str:
        return str(self.release_policy["policy"])

    @property
    def storm(self) -> dict[str, Any]:
        return self.raw.get("storm") or {}

    @property
    def hacktivist(self) -> dict[str, Any]:
        return self.raw.get("hacktivist_injects") or {"enabled": False}

    @property
    def seats(self) -> dict[str, str]:
        assigned = self.raw.get("seats") or {}
        return {seat: assigned[seat] for seat in SEATS if seat in assigned}

    @property
    def replay_file(self) -> str | None:
        value = self.raw.get("replay_file")
        return str(value) if value else None

    @property
    def params(self) -> dict[str, Any]:
        return self.raw["engine_params"]

    def param(self, name: str, default: Any = None) -> Any:
        return self.params.get(name, default)

    def to_dict(self) -> dict[str, Any]:
        return copy.deepcopy(self.raw)
