"""The persona pool for a generation run, and the counterfactual arms built from it.

`engine.specs.load_pool` is the loader: it reads `specs/train/*.json` and falls back to
its own placeholders per seat, so the engine runs before the pool exists. This module
adds the three things generation needs on top of it:

* a hard wall in front of `specs/holdout/`;
* a full-pool read (the engine's loader returns one spec per *seat*, but the sweep
  samples across all ~25 specs);
* `flipped()`, which builds the B arm of a counterfactual pair.

`specs/holdout/` is the held-out-persona set behind `train/gates.py`. A generation run
that reads one invalidates that gate and leaves no trace of having done it, so the guard
raises rather than warns, and `tests/agent3-gen` asserts it.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from engine.specs import load_pool as engine_load_pool
from engine.specs import placeholder_specs, specs_dir
from gen.contracts import validation_errors, validator
from gen.quarantine import assert_clean

FORBIDDEN_SPEC_DIRS = ("specs/holdout",)

#: `engine.specs.placeholder_specs()` are stand-ins for the human-authored pool. A cost
#: check may run on them; the full lake may not.
PLACEHOLDER_IDS = frozenset(spec["spec_id"] for spec in placeholder_specs().values())


class HoldoutAccessError(RuntimeError):
    """Something tried to read `specs/holdout/`."""


def assert_not_holdout(path: Path | str) -> None:
    text = str(path).replace("\\", "/")
    for forbidden in FORBIDDEN_SPEC_DIRS:
        if forbidden in text:
            raise HoldoutAccessError(
                f"{path} is under {forbidden}; generation must never read it "
                "(docs/agent_workstreams.md, Agent 3 'Do not'). It is train/gates.py's "
                "and eval/'s input, and reading it here would invalidate the held-out "
                "persona coherence gate without leaving a trace."
            )


def load_spec_file(path: Path) -> dict[str, Any]:
    assert_not_holdout(path)
    spec = json.loads(path.read_text())
    errors = validation_errors(validator("spec_schema.json"), spec)
    if errors:
        raise ValueError(f"{path} is not a valid spec: {errors[:3]}")
    assert_clean(
        f"{spec.get('voice', '')}\n{spec.get('backstory', '')}\n{spec.get('notes', '')}",
        where=f"spec {spec.get('spec_id')} ({path})",
    )
    return spec


def train_pool(root: Path | None = None) -> list[dict[str, Any]]:
    """Every spec in `specs/train/`, or the engine's placeholders if there are none.

    Sorted by `spec_id`, so a seeded sample of the pool is reproducible.
    """
    directory = (root or specs_dir()) / "train"
    assert_not_holdout(directory)
    specs: list[dict[str, Any]] = []
    if directory.is_dir():
        specs = [load_spec_file(path) for path in sorted(directory.glob("*.json"))]
    if not specs:
        specs = list(placeholder_specs().values())
    return sorted(specs, key=lambda spec: spec["spec_id"])


def seat_assignment_pool(root: Path | None = None) -> dict[str, list[dict[str, Any]]]:
    """The pool grouped by seat, which is how the sweep assigns seats."""
    grouped: dict[str, list[dict[str, Any]]] = {}
    for spec in train_pool(root):
        grouped.setdefault(spec["seat"], []).append(spec)
    return grouped


def engine_pool(assignment: dict[str, str]) -> dict[str, dict[str, Any]]:
    """What the engine will actually seat, for a given seat -> spec_id assignment.

    Thin wrapper so every read of the spec tree in this workstream goes past the
    holdout guard, including the engine's own.
    """
    assert_not_holdout(specs_dir() / "train")
    return engine_load_pool(assignment)


def is_placeholder(spec: dict[str, Any]) -> bool:
    return str(spec.get("spec_id")) in PLACEHOLDER_IDS


def pool_is_placeholder(specs: list[dict[str, Any]]) -> bool:
    return bool(specs) and all(is_placeholder(spec) for spec in specs)


# --------------------------------------------------------------------------
# Counterfactual arms
# --------------------------------------------------------------------------

#: The fields a pair may flip and what each flips to. Constrained to
#: `lake_record_schema.json#/properties/pair_flipped_field`; `contracts/targets.md`
#: measures counterfactual sensitivity on `risk_posture` and `psyche`.
FLIP_TARGETS: dict[str, dict[str, str]] = {
    "risk_posture": {
        "risk_averse": "assertive",
        "cautious": "assertive",
        "balanced": "risk_acceptant",
        "assertive": "cautious",
        "risk_acceptant": "risk_averse",
    },
    "psyche": {
        "revisionist": "regime_survival",
        "revanchist": "opportunistic_cautious",
        "opportunistic_cautious": "revanchist",
        "regime_survival": "revisionist",
    },
    "private_type": {
        "storm_reposition": "action_under_cover",
        "opportunistic_isr": "action_under_cover",
        "action_under_cover": "storm_reposition",
        "honest_broker": "coordinated_with_russia",
        "opportunistic_amplifier": "honest_broker",
        "coordinated_with_russia": "honest_broker",
    },
    "time_horizon": {
        "immediate": "years",
        "days": "months",
        "weeks": "immediate",
        "months": "days",
        "years": "immediate",
    },
}


def can_flip(spec: dict[str, Any], field: str) -> bool:
    return spec.get(field) in FLIP_TARGETS.get(field, {})


def flipped(spec: dict[str, Any], field: str) -> dict[str, Any]:
    """The B arm of a counterfactual pair: this persona, one field changed.

    The arm gets its own `spec_id` so the lake can tell the two apart, and is
    re-validated — which is why `psyche` and `private_type` only flip within their
    seat-legal enums.
    """
    if not can_flip(spec, field):
        raise ValueError(f"{spec['spec_id']} cannot flip {field}={spec.get(field)!r}")
    new_value = FLIP_TARGETS[field][spec[field]]
    arm = json.loads(json.dumps(spec))
    arm[field] = new_value
    arm["spec_id"] = f"{spec['spec_id']}_cf_{field}_{new_value}"
    errors = validation_errors(validator("spec_schema.json"), arm)
    if errors:
        raise ValueError(f"flipping {field} on {spec['spec_id']} broke the spec: {errors[:2]}")
    return arm
