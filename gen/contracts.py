"""Load `contracts/`, validate against it, and project it into strict mode.

Two jobs.

1. **Validation.** The contract schemas `$ref` each other by bare filename, so a
   validator needs a `referencing` registry. The recipe is `contracts/README.md`.

2. **Projection.** OpenAI structured outputs run in *strict* mode, which accepts only a
   subset of JSON Schema: no `oneOf`, no `if`/`then`, no `pattern`, no numeric bounds,
   no `propertyNames`, no open `additionalProperties`, and every declared property must
   appear in `required`. `action_schema.json#/$defs/decision` uses all of those. So we
   generate an equivalent-shaped strict schema *from* the contract — enums and
   descriptions are read out of the contract, never retyped — send that to the API, then
   denormalise the completion and validate it against the real contract schema.

   The strict projection is a wire format. The contract is the source of truth: a
   completion that denormalises into something the contract rejects is a schema failure
   and `gen/llm.py` retries it.

Two shape changes the projection makes, both reversed by `from_strict`:

* `beliefs.per_actor` is a contract *object* keyed by actor. Strict mode has no
  `propertyNames`, so on the wire it is a list of `{actor, probability}` pairs.
* `action.params` is a contract *open* object whose required keys depend on the action
  type. Strict mode has neither, so on the wire every documented param key is present
  and nullable; `from_strict` drops the nulls.
"""

from __future__ import annotations

import json
from functools import cache, lru_cache
from typing import Any

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from gen.config import REPO_ROOT

CONTRACTS_DIR = REPO_ROOT / "contracts"

SCHEMA_NAMES = (
    "spec_schema.json",
    "action_schema.json",
    "event_log_schema.json",
    "inject_schema.json",
    "lake_record_schema.json",
    "env_config_schema.json",
)


@cache
def load_schema(name: str) -> dict[str, Any]:
    return json.loads((CONTRACTS_DIR / name).read_text())


@lru_cache(maxsize=1)
def _registry() -> Registry:
    registry = Registry()
    for name in SCHEMA_NAMES:
        schema = load_schema(name)
        resource = Resource.from_contents(schema)
        registry = registry.with_resource(name, resource)
        registry = registry.with_resource(schema["$id"], resource)
    return registry


@cache
def validator(name: str) -> Draft202012Validator:
    """A validator for one contract schema, with the cross-file registry attached."""
    return Draft202012Validator(load_schema(name), registry=_registry())


@cache
def subschema_validator(name: str, pointer: str) -> Draft202012Validator:
    """A validator for a `$defs` member, e.g. `("action_schema.json", "decision")`."""
    schema = {"$ref": f"{name}#/$defs/{pointer}"}
    return Draft202012Validator(schema, registry=_registry())


def validation_errors(v: Draft202012Validator, instance: Any) -> list[str]:
    return [
        f"{'/'.join(str(p) for p in e.absolute_path) or '<root>'}: {e.message}"
        for e in v.iter_errors(instance)
    ]


# --------------------------------------------------------------------------
# The action ladder. Data, not schema — contracts/README.md "Reading the ladder".
# --------------------------------------------------------------------------


@lru_cache(maxsize=1)
def ladder() -> list[dict[str, Any]]:
    return load_schema("action_schema.json")["x-action-ladder"]


@lru_cache(maxsize=1)
def allowed_seats() -> dict[str, frozenset[str]]:
    return {e["type"]: frozenset(e["allowed_seats"]) for e in ladder()}


@lru_cache(maxsize=1)
def rung() -> dict[str, int]:
    return {e["type"]: e["rung"] for e in ladder()}


@lru_cache(maxsize=1)
def irreversible() -> frozenset[str]:
    return frozenset(e["type"] for e in ladder() if e["irreversible"])


@lru_cache(maxsize=1)
def action_types() -> tuple[str, ...]:
    return tuple(load_schema("action_schema.json")["$defs"]["action_type"]["enum"])


@lru_cache(maxsize=1)
def seats() -> tuple[str, ...]:
    return tuple(load_schema("spec_schema.json")["$defs"]["seat"]["enum"])


@lru_cache(maxsize=1)
def actors() -> tuple[str, ...]:
    return tuple(load_schema("spec_schema.json")["$defs"]["actor"]["enum"])


def menu_for_seat(seat: str, authority: dict[str, list[str]] | None = None) -> list[str]:
    """What the engine will accept from this seat: ladder menu ∩ spec authority.

    `recommend_only` is deliberately excluded — the seat may name those actions in a
    message but never execute them, per contracts/README.md rule 1.
    """
    on_menu = [a for a in action_types() if seat in allowed_seats()[a]]
    if authority is None:
        return on_menu
    envelope = set(authority.get("unilateral", [])) | set(authority.get("requires_release", []))
    return [a for a in on_menu if a in envelope]


# --------------------------------------------------------------------------
# Strict-mode projection of action_schema.json#/$defs/decision
# --------------------------------------------------------------------------

# Params the contract types as an enum are projected as that enum; the rest fall back
# to their JSON primitive. Every key is nullable, because strict mode requires every
# declared property to be required and the contract makes them conditional.
_PARAM_PRIMITIVE = {"string": "string", "number": "number", "integer": "integer"}


def _strict_param(spec: dict[str, Any]) -> dict[str, Any]:
    """One entry of `action_params.properties`, projected into strict mode."""
    description = spec.get("description", "")
    if "enum" in spec:
        return {
            "type": ["string", "null"],
            "enum": [*spec["enum"], None],
            "description": description,
        }
    if "oneOf" in spec:
        # The actor-or-literal unions: recipient, attributed_actor, target_actor.
        choices: list[str] = []
        for branch in spec["oneOf"]:
            if "enum" in branch:
                choices.extend(branch["enum"])
            elif "$ref" in branch and branch["$ref"].endswith("actor"):
                choices.extend(actors())
        return {"type": ["string", "null"], "enum": [*choices, None], "description": description}
    if "$ref" in spec:
        ref = spec["$ref"]
        if ref.endswith("actor"):
            return {
                "type": ["string", "null"],
                "enum": [*actors(), None],
                "description": description,
            }
        # #/$defs/probability
        return {"type": ["number", "null"], "description": description}
    primitive = _PARAM_PRIMITIVE.get(spec.get("type", "string"), "string")
    return {"type": [primitive, "null"], "description": description}


@lru_cache(maxsize=1)
def strict_decision_schema() -> dict[str, Any]:
    """The wire schema handed to `text.format`, derived from the contract."""
    action_schema = load_schema("action_schema.json")
    defs = action_schema["$defs"]
    message_props = defs["message"]["properties"]
    param_props = defs["action_params"]["properties"]
    beliefs_props = defs["beliefs"]["properties"]

    to_enum = [*actors(), "public", "all"]

    strict_params = {k: _strict_param(v) for k, v in param_props.items()}

    return {
        "type": "object",
        "additionalProperties": False,
        "description": defs["decision"]["description"],
        "required": ["beliefs", "messages", "action", "reasoning"],
        "properties": {
            "beliefs": {
                "type": "object",
                "additionalProperties": False,
                "description": defs["beliefs"]["description"],
                "required": ["hostile", "natural", "unknown", "per_actor"],
                "properties": {
                    "hostile": {
                        "type": "number",
                        "description": beliefs_props["hostile"]["description"],
                    },
                    "natural": {
                        "type": "number",
                        "description": beliefs_props["natural"]["description"],
                    },
                    "unknown": {
                        "type": "number",
                        "description": beliefs_props["unknown"]["description"],
                    },
                    "per_actor": {
                        "type": "array",
                        "description": (
                            beliefs_props["per_actor"]["description"]
                            + " Emit one entry per candidate actor you assign mass to; "
                            "an empty list is valid when hostile is low."
                        ),
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["actor", "probability"],
                            "properties": {
                                "actor": {"type": "string", "enum": list(actors())},
                                "probability": {"type": "number"},
                            },
                        },
                    },
                },
            },
            "messages": {
                "type": "array",
                "description": defs["decision"]["properties"]["messages"]["description"]
                + " At most 6.",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["to", "channel", "text", "classification"],
                    "properties": {
                        "to": {
                            "type": "string",
                            "enum": to_enum,
                            "description": message_props["to"]["description"],
                        },
                        "channel": {
                            "type": "string",
                            "enum": list(message_props["channel"]["enum"]),
                            "description": message_props["channel"]["description"],
                        },
                        "text": {"type": "string", "description": "At most 4000 characters."},
                        "classification": {
                            "type": ["string", "null"],
                            "enum": [*message_props["classification"]["enum"], None],
                            "description": message_props["classification"]["description"],
                        },
                    },
                },
            },
            "action": {
                "type": "object",
                "additionalProperties": False,
                "description": defs["action"]["description"],
                "required": ["type", "params"],
                "properties": {
                    "type": {
                        "type": "string",
                        "enum": list(action_types()),
                        "description": defs["action_type"]["description"],
                    },
                    "params": {
                        "type": "object",
                        "additionalProperties": False,
                        "description": (
                            "Parameters for the chosen action. Set exactly the keys that "
                            "action needs and null for every other key."
                        ),
                        "required": sorted(strict_params),
                        "properties": strict_params,
                    },
                },
            },
            "reasoning": {
                "type": "string",
                "description": defs["decision"]["properties"]["reasoning"]["description"]
                + " At most 4000 characters.",
            },
        },
    }


def from_strict(payload: dict[str, Any]) -> dict[str, Any]:
    """Denormalise a strict-mode completion into a contract `decision`."""
    beliefs_in = payload.get("beliefs") or {}
    per_actor_in = beliefs_in.get("per_actor") or []
    per_actor: dict[str, float] = {}
    if isinstance(per_actor_in, dict):  # a model that ignored the wire shape
        per_actor = {k: v for k, v in per_actor_in.items() if v is not None}
    else:
        for entry in per_actor_in:
            if isinstance(entry, dict) and entry.get("actor") is not None:
                per_actor[entry["actor"]] = entry.get("probability")

    messages = []
    for m in payload.get("messages") or []:
        message = {k: v for k, v in m.items() if v is not None}
        messages.append(message)

    action_in = payload.get("action") or {}
    params = {k: v for k, v in (action_in.get("params") or {}).items() if v is not None}

    return {
        "beliefs": {
            "hostile": beliefs_in.get("hostile"),
            "natural": beliefs_in.get("natural"),
            "unknown": beliefs_in.get("unknown"),
            "per_actor": per_actor,
        },
        "messages": messages,
        "action": {"type": action_in.get("type"), "params": params},
        "reasoning": payload.get("reasoning"),
    }


BELIEF_SUM_TOLERANCE = 0.01


def decision_errors(decision: dict[str, Any]) -> list[str]:
    """Contract validity plus the two invariants the schema cannot express."""
    errors = validation_errors(subschema_validator("action_schema.json", "decision"), decision)
    beliefs = decision.get("beliefs") or {}
    parts = [beliefs.get(k) for k in ("hostile", "natural", "unknown")]
    if all(isinstance(p, (int, float)) for p in parts):
        total = sum(parts)
        if abs(total - 1.0) > BELIEF_SUM_TOLERANCE:
            errors.append(
                f"beliefs: hostile + natural + unknown = {total:.3f}, must sum to 1.0 "
                f"within {BELIEF_SUM_TOLERANCE}"
            )
    per_actor = beliefs.get("per_actor") or {}
    if per_actor:
        mass = sum(v for v in per_actor.values() if isinstance(v, (int, float)))
        if mass > 1.0 + BELIEF_SUM_TOLERANCE:
            errors.append(f"beliefs/per_actor: total mass {mass:.3f} exceeds 1.0")
    return errors
