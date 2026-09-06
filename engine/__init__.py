"""Panoptes wargame engine.

A deterministic, replayable, single-threaded simulation of a 72-hour Arctic
counterspace crisis. Everything in here is driven by one master seed: given the
same `env_config` and the same agents, two runs produce byte-identical event
logs apart from `wall_time`.

Read `contracts/` before changing anything in this package. The engine owns the
shape of `filtered_state` and of `engine_params`; every other interface it
touches is frozen.
"""

from __future__ import annotations

ENV_VERSION = "env_v1"
CONTRACTS_VERSION = "contracts_v1"

__all__ = ["ENV_VERSION", "CONTRACTS_VERSION"]
