"""Validate the frozen interfaces in contracts/.

Run: pytest tests/agent0-contracts -q

Covers three things a JSON Schema cannot check on its own:
  * every schema is itself a valid draft 2020-12 schema, and cross-file $refs resolve;
  * the committed examples validate against the schemas they claim to;
  * the invariants stated in prose in the schema descriptions actually hold
    (ladder ordering, authority subset rules, irreversible set from targets.md).
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"
EXAMPLES = CONTRACTS / "examples"

SCHEMA_FILES = [
    "spec_schema.json",
    "action_schema.json",
    "event_log_schema.json",
    "inject_schema.json",
    "lake_record_schema.json",
    "env_config_schema.json",
]

#: The nine LLM personas, after the twelve-seat fold. See contracts/seats.md.
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

#: Folded away: nato and ksat into utility terms and Norway's ground segment,
#: hacktivist into the hacktivist_injects rule actor.
DROPPED_SEATS = ["nato", "ksat", "hacktivist"]

#: Actions contracts/targets.md counts under irreversible_action_rate_replays.
TARGETS_IRREVERSIBLE = {"kinetic", "terrestrial_response", "counter_rpo"}


def _load(name: str) -> dict[str, Any]:
    return json.loads((CONTRACTS / name).read_text())


@pytest.fixture(scope="session")
def registry() -> Registry:
    """A registry that resolves cross-file $refs by bare filename and by $id."""
    registry = Registry()
    for name in SCHEMA_FILES:
        schema = _load(name)
        resource = Resource.from_contents(schema)
        # Register under both the bare filename (how the schemas $ref each other)
        # and the canonical $id (how a consumer resolving by URI will ask).
        registry = registry.with_resource(name, resource)
        registry = registry.with_resource(schema["$id"], resource)
    return registry


def validator_for(name: str, registry: Registry) -> Draft202012Validator:
    return Draft202012Validator(_load(name), registry=registry)


# --------------------------------------------------------------------------- #
# The schemas themselves
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("name", SCHEMA_FILES)
def test_schema_is_valid_draft_2020_12(name: str) -> None:
    Draft202012Validator.check_schema(_load(name))


@pytest.mark.parametrize("name", SCHEMA_FILES)
def test_schema_has_id_and_draft(name: str) -> None:
    schema = _load(name)
    assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    assert schema["$id"].endswith(name)


@pytest.mark.parametrize("name", SCHEMA_FILES)
def test_cross_file_refs_resolve(name: str, registry: Registry) -> None:
    """Walk every $ref in the schema and resolve it through the registry."""
    schema = _load(name)
    resolver = registry.resolver(base_uri=schema["$id"])

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            ref = node.get("$ref")
            if isinstance(ref, str):
                resolver.lookup(ref)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(schema)


# --------------------------------------------------------------------------- #
# Committed examples
# --------------------------------------------------------------------------- #


def test_example_spec_validates(registry: Registry) -> None:
    spec = json.loads((EXAMPLES / "spec_northern_fleet_cautious.json").read_text())
    validator_for("spec_schema.json", registry).validate(spec)


def test_example_decision_validates(registry: Registry) -> None:
    decision = json.loads(
        (EXAMPLES / "decision_usspacecom_knife_inject.json").read_text()
    )
    validator_for("action_schema.json", registry).validate(decision)


def test_example_spec_priors_sum_to_one() -> None:
    spec = json.loads((EXAMPLES / "spec_northern_fleet_cautious.json").read_text())
    priors = spec["priors"]
    total = (
        priors["p_hostile_prior"]
        + priors["p_natural_prior"]
        + priors["p_unknown_prior"]
    )
    assert abs(total - 1.0) < 0.01


def test_example_decision_beliefs_sum_to_one() -> None:
    decision = json.loads(
        (EXAMPLES / "decision_usspacecom_knife_inject.json").read_text()
    )
    b = decision["beliefs"]
    assert abs(b["hostile"] + b["natural"] + b["unknown"] - 1.0) < 0.01
    assert sum(b["per_actor"].values()) <= 1.0 + 1e-9


# --------------------------------------------------------------------------- #
# Ladder invariants
# --------------------------------------------------------------------------- #


def test_ladder_matches_action_type_enum() -> None:
    action = _load("action_schema.json")
    ladder = action["x-action-ladder"]
    enum = action["$defs"]["action_type"]["enum"]
    assert [entry["type"] for entry in ladder] == enum, (
        "ladder order must match the enum order"
    )


def test_ladder_rungs_are_dense_and_ordered() -> None:
    ladder = _load("action_schema.json")["x-action-ladder"]
    assert [entry["rung"] for entry in ladder] == list(range(len(ladder)))


def test_ladder_entries_validate_against_entry_schema(registry: Registry) -> None:
    # Point at the entry schema through the registered document, so that the
    # relative $refs inside it resolve against action_schema.json's own $id.
    validator = Draft202012Validator(
        {"$ref": "action_schema.json#/x-ladder-entry-schema"}, registry=registry
    )
    for entry in _load("action_schema.json")["x-action-ladder"]:
        validator.validate(entry)


def test_irreversible_set_matches_targets() -> None:
    ladder = _load("action_schema.json")["x-action-ladder"]
    marked = {entry["type"] for entry in ladder if entry["irreversible"]}
    assert marked == TARGETS_IRREVERSIBLE


def test_only_kinetic_creates_meaningful_debris() -> None:
    ladder = _load("action_schema.json")["x-action-ladder"]
    debris = {entry["type"]: entry["costs"]["debris"] for entry in ladder}
    assert debris["kinetic"] == 1.0
    assert all(v < 0.2 for k, v in debris.items() if k != "kinetic")


def test_hold_is_available_to_every_seat() -> None:
    action = _load("action_schema.json")
    seats = set(_load("spec_schema.json")["$defs"]["seat"]["enum"])
    hold = next(e for e in action["x-action-ladder"] if e["type"] == "hold")
    assert set(hold["allowed_seats"]) == seats


def test_every_seat_has_at_least_two_actions() -> None:
    """A seat with only `hold` cannot play; catch a seat dropped from the menu."""
    ladder = _load("action_schema.json")["x-action-ladder"]
    seats = _load("spec_schema.json")["$defs"]["seat"]["enum"]
    for seat in seats:
        available = [e["type"] for e in ladder if seat in e["allowed_seats"]]
        assert len(available) >= 2, f"{seat} has only {available}"


def test_blue_irreversible_authority_is_nsc_only() -> None:
    """contracts/seats.md: NSC is the only Blue seat that can act irreversibly."""
    ladder = _load("action_schema.json")["x-action-ladder"]
    blue = {"northcom", "usspacecom", "nsc"}
    for entry in ladder:
        if entry["type"] in {"kinetic", "terrestrial_response"}:
            assert blue & set(entry["allowed_seats"]) == {"nsc"}


# --------------------------------------------------------------------------- #
# Spec / ladder consistency
# --------------------------------------------------------------------------- #


def _allowed_by_seat() -> dict[str, set[str]]:
    ladder = _load("action_schema.json")["x-action-ladder"]
    out: dict[str, set[str]] = {}
    for entry in ladder:
        for seat in entry["allowed_seats"]:
            out.setdefault(seat, set()).add(entry["type"])
    return out


def test_example_spec_authority_is_disjoint_and_within_menu() -> None:
    spec = json.loads((EXAMPLES / "spec_northern_fleet_cautious.json").read_text())
    authority = spec["authority"]
    uni = set(authority["unilateral"])
    rel = set(authority["requires_release"])
    rec = set(authority["recommend_only"])

    assert not (uni & rel) and not (uni & rec) and not (rel & rec), (
        "authority lists overlap"
    )

    allowed = _allowed_by_seat()[spec["seat"]]
    assert (uni | rel) <= allowed, (
        f"executable authority outside menu: {(uni | rel) - allowed}"
    )
    # recommend_only is deliberately unconstrained: a seat may recommend what it cannot do.


def test_seat_enum_matches_seats_md() -> None:
    """The 9 seats in the schema are the 9 rows of contracts/seats.md."""
    text = (CONTRACTS / "seats.md").read_text()
    seats = _load("spec_schema.json")["$defs"]["seat"]["enum"]
    assert seats == SEATS
    for seat in seats:
        assert f"| {seat} |" in text, f"{seat} not in seats.md"


def test_folded_seats_appear_nowhere_in_the_schemas() -> None:
    """nato, ksat and hacktivist are not seats, actors, or allowed_seats entries."""
    for name in SCHEMA_FILES:
        blob = (CONTRACTS / name).read_text()
        for dropped in DROPPED_SEATS:
            # `hacktivist_injects` is a rule actor and is allowed; the bare id is not.
            hits = re.findall(rf'"{dropped}(?!_injects)"', blob)
            assert not hits, f"{name} still references the folded seat {dropped}"


def test_rule_actors_match_seats_md() -> None:
    text = (CONTRACTS / "seats.md").read_text()
    rule_actors = _load("spec_schema.json")["$defs"]["rule_actor"]["enum"]
    assert "hacktivist_injects" in rule_actors, (
        "the hacktivist folded into an inject stream"
    )
    for actor in rule_actors:
        assert f"| {actor} |" in text, f"{actor} not in seats.md"


def test_nsc_is_marked_human_playable() -> None:
    """contracts/seats.md must say which seat a person sits in."""
    text = (CONTRACTS / "seats.md").read_text().lower()
    assert "human-playable" in text
    assert "release_policy" in text


def test_actor_enum_covers_seats_and_rule_actors() -> None:
    defs = _load("spec_schema.json")["$defs"]
    actors = set(defs["actor"]["enum"])
    assert set(defs["seat"]["enum"]) <= actors
    assert set(defs["rule_actor"]["enum"]) <= actors
    assert {"environment", "system"} <= actors


# --------------------------------------------------------------------------- #
# Negative cases: the schemas must reject what they promise to reject
# --------------------------------------------------------------------------- #


def _valid_spec() -> dict[str, Any]:
    return json.loads((EXAMPLES / "spec_northern_fleet_cautious.json").read_text())


def test_private_type_enum_is_seat_dependent(registry: Registry) -> None:
    validator = validator_for("spec_schema.json", registry)
    spec = _valid_spec()
    spec["private_type"] = "honest_broker"  # a China type on the Northern Fleet seat
    assert not validator.is_valid(spec)


def test_non_red_seat_may_not_carry_psyche(registry: Registry) -> None:
    validator = validator_for("spec_schema.json", registry)
    spec = _valid_spec()
    spec["seat"] = "norway"
    del spec["private_type"]
    assert not validator.is_valid(spec), "psyche must be Red-only"
    del spec["psyche"]
    assert validator.is_valid(spec)


def test_blue_seat_may_not_carry_private_type(registry: Registry) -> None:
    validator = validator_for("spec_schema.json", registry)
    spec = _valid_spec()
    spec["seat"] = "nsc"
    del spec["psyche"]
    assert not validator.is_valid(spec), (
        "private_type is northern_fleet/china/hacktivist only"
    )


def test_unknown_spec_field_is_rejected(registry: Registry) -> None:
    validator = validator_for("spec_schema.json", registry)
    spec = _valid_spec()
    spec["favourite_colour"] = "blue"
    assert not validator.is_valid(spec)


def _valid_decision() -> dict[str, Any]:
    return json.loads((EXAMPLES / "decision_usspacecom_knife_inject.json").read_text())


@pytest.mark.parametrize(
    ("action_type", "params"),
    [
        ("maneuver", {"asset_id": "usa_326"}),  # missing delta_v_mps
        (
            "public_attribution",
            {"attributed_actor": "kremlin"},
        ),  # missing confidence_stated
        ("kinetic", {"weapon_class": "co_orbital"}),  # missing target_asset_id
        ("ground_cyber", {"target_system": "gateway_tromso"}),  # missing effect
    ],
)
def test_action_params_required_per_type(
    action_type: str, params: dict[str, Any], registry: Registry
) -> None:
    validator = validator_for("action_schema.json", registry)
    decision = _valid_decision()
    decision["action"] = {"type": action_type, "params": params}
    assert not validator.is_valid(decision)


def test_unknown_action_type_is_rejected(registry: Registry) -> None:
    validator = validator_for("action_schema.json", registry)
    decision = _valid_decision()
    decision["action"] = {"type": "nuke_the_moon", "params": {}}
    assert not validator.is_valid(decision)


def test_hold_needs_no_params(registry: Registry) -> None:
    validator = validator_for("action_schema.json", registry)
    decision = _valid_decision()
    decision["action"] = {"type": "hold", "params": {}}
    validator.validate(decision)


# --------------------------------------------------------------------------- #
# Clock mode, release policy, and the event types they add
# --------------------------------------------------------------------------- #

NEW_EVENT_TYPES = [
    "checkpoint",
    "release_requested",
    "release_granted",
    "release_denied",
    "human_action",
]


def test_event_log_carries_the_new_event_types() -> None:
    types = _load("event_log_schema.json")["properties"]["type"]["enum"]
    assert set(NEW_EVENT_TYPES) <= set(types)
    # The original eight survive: both clock modes emit the same log format.
    assert {
        "inject",
        "action",
        "message_sent",
        "message_delivered",
        "state_change",
        "storm_update",
        "attribution_revealed",
        "episode_end",
    } <= set(types)


def _event(event_type: str, payload: dict[str, Any], **extra: Any) -> dict[str, Any]:
    line = {
        "sim_time_s": 43200.0,
        "wall_time": "2026-09-06T04:00:00Z",
        "type": event_type,
        "seat": "usspacecom",
        "payload": payload,
        "seed": 1041,
        "env_version": "env_v1",
        "episode_id": "g4_ambig-1041-3f9a2b71",
    }
    line.update(extra)
    return line


def test_checkpoint_event_validates(registry: Registry) -> None:
    validator = validator_for("event_log_schema.json", registry)
    validator.validate(
        _event(
            "checkpoint",
            {
                "checkpoint_index": 4,
                "seats_woken": SEATS,
                "schedule_type": "adaptive",
                "next_checkpoint_sim_time_s": 46800.0,
                "trigger": "inject",
                "decisions_collected": 9,
            },
            seat=None,
        )
    )


def test_checkpoint_event_requires_its_payload(registry: Registry) -> None:
    validator = validator_for("event_log_schema.json", registry)
    assert not validator.is_valid(
        _event("checkpoint", {"checkpoint_index": 4}, seat=None)
    )


def test_release_cycle_events_validate(registry: Registry) -> None:
    validator = validator_for("event_log_schema.json", registry)
    validator.validate(
        _event(
            "release_requested",
            {
                "release_id": "rel-0007",
                "action": {
                    "type": "counter_rpo",
                    "params": {
                        "asset_id": "usa_326",
                        "target_asset_id": "kosmos_unknown_a",
                        "standoff_km": 40,
                    },
                },
                "releasing_seat": "nsc",
                "justification": "Close approach to resolve intent before the window shuts.",
            },
        )
    )
    for outcome in ("release_granted", "release_denied"):
        validator.validate(
            _event(
                outcome,
                {
                    "release_id": "rel-0007",
                    "decided_by": "human",
                    "wait_sim_time_s": 0.0,
                    "rationale": "Not on this evidence.",
                },
                seat="nsc",
            )
        )


def test_release_decided_by_is_constrained(registry: Registry) -> None:
    validator = validator_for("event_log_schema.json", registry)
    assert not validator.is_valid(
        _event(
            "release_granted",
            {"release_id": "rel-0007", "decided_by": "vibes"},
            seat="nsc",
        )
    )


def test_human_action_event_validates(registry: Registry) -> None:
    validator = validator_for("event_log_schema.json", registry)
    validator.validate(
        _event(
            "human_action",
            {
                "action": {"type": "hold", "params": {}},
                "decision_id": "d-0031",
                "operator": "operator_a",
                "wall_time_to_decide_s": 44.0,
            },
            seat="nsc",
        )
    )


def test_episode_end_records_clock_mode_and_release_policy(registry: Registry) -> None:
    validator = validator_for("event_log_schema.json", registry)
    payload = {
        "reason": "time_limit",
        "utilities": {seat: 0.0 for seat in SEATS},
        "seats": {seat: f"{seat}_default" for seat in SEATS},
        "decision_count": 81,
    }
    line = _event("episode_end", payload, seat=None, spec_version="spec_v1")
    assert not validator.is_valid(line), (
        "episode_end must record how the episode was run"
    )
    line["clock_mode"] = "checkpoint"
    line["release_policy"] = "human"
    validator.validate(line)


@pytest.mark.parametrize(
    "name",
    ["env_config_demo_checkpoint_human.json", "env_config_sweep_continuous_auto.json"],
)
def test_example_env_configs_validate(name: str, registry: Registry) -> None:
    config = json.loads((EXAMPLES / name).read_text())
    validator_for("env_config_schema.json", registry).validate(config)


def _config(
    clock_mode: dict[str, Any], release_policy: dict[str, Any]
) -> dict[str, Any]:
    return {
        "env_version": "env_v1",
        "duration_s": 259200,
        "seed": 1041,
        "clock_mode": clock_mode,
        "release_policy": release_policy,
    }


AUTO = {"policy": "auto", "approval_probability": 0.5}
CONTINUOUS = {"mode": "continuous"}


@pytest.mark.parametrize(
    "clock_mode",
    [
        {"mode": "continuous", "tick_s": 60},
        {"mode": "checkpoint", "schedule_type": "fixed", "interval_s": 10800},
        {
            "mode": "checkpoint",
            "schedule_type": "variable_tempo",
            "checkpoints_s": [0, 3600, 7200],
        },
        {
            "mode": "checkpoint",
            "schedule_type": "adaptive",
            "adaptive_triggers": ["inject", "non_hold_action"],
            "min_interval_s": 1800,
            "max_interval_s": 21600,
        },
    ],
)
def test_valid_clock_modes(clock_mode: dict[str, Any], registry: Registry) -> None:
    validator_for("env_config_schema.json", registry).validate(
        _config(clock_mode, AUTO)
    )


@pytest.mark.parametrize(
    "clock_mode",
    [
        {"mode": "checkpoint", "schedule_type": "fixed"},  # no interval_s
        {"mode": "checkpoint", "schedule_type": "variable_tempo"},  # no checkpoints_s
        {
            "mode": "checkpoint",
            "schedule_type": "adaptive",
            "min_interval_s": 60,
        },  # no triggers
        {"mode": "checkpoint"},  # no schedule_type
        {"mode": "turn_based"},  # not a mode
        {
            "mode": "continuous",
            "schedule_type": "fixed",
        },  # continuous takes no schedule
    ],
)
def test_invalid_clock_modes(clock_mode: dict[str, Any], registry: Registry) -> None:
    validator = validator_for("env_config_schema.json", registry)
    assert not validator.is_valid(_config(clock_mode, AUTO))


@pytest.mark.parametrize(
    "release_policy",
    [
        {"policy": "human"},
        {
            "policy": "human",
            "pause_clock": True,
            "timeout_s": 180,
            "on_timeout": "deny",
        },
        {"policy": "auto", "approval_probability": 0.0},
        {
            "policy": "auto",
            "approval_probability": 1.0,
            "per_action_probability": {"kinetic": 0.01},
        },
    ],
)
def test_valid_release_policies(
    release_policy: dict[str, Any], registry: Registry
) -> None:
    validator_for("env_config_schema.json", registry).validate(
        _config(CONTINUOUS, release_policy)
    )


@pytest.mark.parametrize(
    "release_policy",
    [
        {"policy": "auto"},  # approval_probability is the whole point
        {"policy": "auto", "approval_probability": 1.5},
        {"policy": "human", "on_timeout": "shrug"},
        {"policy": "human", "approval_probability": 0.5},  # not a human field
        {"policy": "committee"},
        {
            "policy": "auto",
            "approval_probability": 0.5,
            "per_action_probability": {"surrender": 0.5},
        },
    ],
)
def test_invalid_release_policies(
    release_policy: dict[str, Any], registry: Registry
) -> None:
    validator = validator_for("env_config_schema.json", registry)
    assert not validator.is_valid(_config(CONTINUOUS, release_policy))


def test_human_release_routes_to_nsc_by_default() -> None:
    """The human-playable seat is nsc; the schema should say so, not just seats.md."""
    schema = _load("env_config_schema.json")
    human = next(
        branch
        for branch in schema["properties"]["release_policy"]["oneOf"]
        if branch["properties"]["policy"]["const"] == "human"
    )
    assert human["properties"]["route_to_seat"]["default"] == "nsc"


def test_only_northern_fleet_and_china_have_private_types() -> None:
    """The hacktivist's three types moved to the hacktivist_injects per-run draw."""
    private_types = set(_load("spec_schema.json")["$defs"]["private_type"]["enum"])
    assert private_types == {
        "storm_reposition",
        "opportunistic_isr",
        "action_under_cover",
        "honest_broker",
        "opportunistic_amplifier",
        "coordinated_with_russia",
    }
    affiliations = _load("env_config_schema.json")["properties"]["hacktivist_injects"][
        "properties"
    ]["affiliation_weights"]["properties"]
    assert set(affiliations) == {"russian_directed", "freelance", "opportunistic"}
