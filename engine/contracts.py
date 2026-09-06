"""Read-only access to `contracts/`.

Nothing in the engine hardcodes a seat id, an action type or a ladder rung: it
all comes from here, so a contract change shows up as a test failure rather than
as a silent divergence between the engine and everyone else.

The schemas `$ref` each other by bare filename, so a validator needs a registry
that knows those filenames — the recipe is in `contracts/README.md` and the
reference implementation is `tests/agent0-contracts/test_contracts.py`.
"""

from __future__ import annotations

import json
import os
from functools import cache
from pathlib import Path
from typing import Any

SCHEMA_NAMES = (
    "spec_schema.json",
    "action_schema.json",
    "event_log_schema.json",
    "inject_schema.json",
    "lake_record_schema.json",
    "env_config_schema.json",
)


def contracts_dir() -> Path:
    """Locate `contracts/`, allowing an override for out-of-tree runs."""
    override = os.environ.get("PANOPTES_CONTRACTS_DIR")
    if override:
        return Path(override)
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "contracts"
        if (candidate / "action_schema.json").is_file():
            return candidate
    raise FileNotFoundError("contracts/ not found; set PANOPTES_CONTRACTS_DIR")


@cache
def schema(name: str) -> dict[str, Any]:
    return json.loads((contracts_dir() / name).read_text())


@cache
def _registry() -> Any:
    from referencing import Registry, Resource

    registry = Registry()
    for name in SCHEMA_NAMES:
        doc = schema(name)
        resource = Resource.from_contents(doc)
        registry = registry.with_resource(name, resource)
        registry = registry.with_resource(doc["$id"], resource)
    return registry


@cache
def validator(name: str) -> Any:
    """A Draft 2020-12 validator for one contract schema.

    Imported lazily: the engine runs without `jsonschema` installed, it just
    stops checking itself.
    """
    from jsonschema import Draft202012Validator

    return Draft202012Validator(schema(name), registry=_registry())


def validate(name: str, instance: Any) -> None:
    validator(name).validate(instance)


# --- enums and the ladder, read straight out of the contracts -----------------

SEATS: tuple[str, ...] = tuple(schema("spec_schema.json")["$defs"]["seat"]["enum"])
RULE_ACTORS: tuple[str, ...] = tuple(schema("spec_schema.json")["$defs"]["rule_actor"]["enum"])
ACTORS: tuple[str, ...] = tuple(schema("spec_schema.json")["$defs"]["actor"]["enum"])
ACTION_TYPES: tuple[str, ...] = tuple(schema("action_schema.json")["$defs"]["action_type"]["enum"])
EVENT_TYPES: tuple[str, ...] = tuple(schema("event_log_schema.json")["properties"]["type"]["enum"])
CHANNELS: tuple[str, ...] = tuple(
    schema("action_schema.json")["$defs"]["message"]["properties"]["channel"]["enum"]
)
SEVERITIES: tuple[str, ...] = tuple(
    schema("env_config_schema.json")["properties"]["storm"]["properties"]["severity"]["enum"]
)

LADDER: tuple[dict[str, Any], ...] = tuple(schema("action_schema.json")["x-action-ladder"])
RUNG: dict[str, int] = {e["type"]: e["rung"] for e in LADDER}
ALLOWED_SEATS: dict[str, tuple[str, ...]] = {e["type"]: tuple(e["allowed_seats"]) for e in LADDER}
IRREVERSIBLE: frozenset[str] = frozenset(e["type"] for e in LADDER if e["irreversible"])
COSTS: dict[str, dict[str, float]] = {e["type"]: dict(e["costs"]) for e in LADDER}

#: Seats that operate hardware and therefore see the natural-vs-interference
#: telemetry signature flag on an effect (`engine/attacks.py`). Every other seat
#: sees the effect but not the signature.
OPERATOR_SEATS: frozenset[str] = frozenset(
    {"usspacecom", "norway", "starlink", "iridium", "northern_fleet"}
)

#: Blue's release authority and Red's, per contracts/seats.md.
RELEASING_SEAT: dict[str, str] = {
    "northcom": "nsc",
    "usspacecom": "nsc",
    "nsc": "nsc",
    "norway": "nsc",
    "starlink": "nsc",
    "iridium": "nsc",
    "china": "nsc",
    "northern_fleet": "kremlin",
    "kremlin": "kremlin",
}


def seat_can(seat: str, action_type: str) -> bool:
    """Is this action on the menu for this seat at all (before authority)?"""
    return seat in ALLOWED_SEATS.get(action_type, ())


def menu_for(seat: str) -> tuple[str, ...]:
    return tuple(a for a in ACTION_TYPES if seat_can(seat, a))
