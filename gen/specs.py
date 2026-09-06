"""Loading the persona pool, with a hard wall in front of `specs/holdout/`.

`specs/holdout/` is the held-out-persona set. `train/gates.py` scores a checkpoint on
personas it has never seen; a generation run that reads one silently invalidates that
gate, and the invalidation is undetectable afterwards. So the guard is a raised
exception, not a warning, and there is a test for it.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from gen.config import FORBIDDEN_SPEC_DIRS, GenConfig
from gen.contracts import validation_errors, validator
from gen.placeholder_specs import is_placeholder, placeholder_pool
from gen.quarantine import assert_clean


class HoldoutAccessError(RuntimeError):
    """Something tried to read `specs/holdout/`."""


def assert_not_holdout(path: Path | str) -> None:
    text = str(path).replace("\\", "/")
    for forbidden in FORBIDDEN_SPEC_DIRS:
        if forbidden in text:
            raise HoldoutAccessError(
                f"{path} is under {forbidden}; generation must never read it "
                "(docs/agent_workstreams.md, Agent 3 'Do not'). "
                "It is train/gates.py's and eval/'s input, and reading it here would "
                "invalidate the held-out-persona coherence gate without leaving a trace."
            )


def load_spec_file(path: Path) -> dict[str, Any]:
    assert_not_holdout(path)
    spec = json.loads(path.read_text())
    errors = validation_errors(validator("spec_schema.json"), spec)
    if errors:
        raise ValueError(f"{path} is not a valid spec: {errors[:3]}")
    assert_clean(
        spec.get("voice", "") + "\n" + spec.get("backstory", ""),
        where=f"spec {spec.get('spec_id')} ({path})",
    )
    return spec


def load_pool(config: GenConfig, subdir: str = "train") -> list[dict[str, Any]]:
    """Every spec in `specs/<subdir>/`, or the placeholder pool if that is empty.

    Sorted by `spec_id` so a pool is a deterministic list and a seeded sample of it is
    reproducible.
    """
    root = config.specs_root / subdir
    assert_not_holdout(root)
    specs: list[dict[str, Any]] = []
    if root.is_dir():
        specs = [load_spec_file(p) for p in sorted(root.glob("*.json"))]
    if not specs:
        specs = placeholder_pool()
    return sorted(specs, key=lambda s: s["spec_id"])


def pool_is_placeholder(specs: list[dict[str, Any]]) -> bool:
    return bool(specs) and all(is_placeholder(s) for s in specs)


def by_seat(specs: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for spec in specs:
        out.setdefault(spec["seat"], []).append(spec)
    return out


# --------------------------------------------------------------------------
# Counterfactual arms
# --------------------------------------------------------------------------

#: The fields a counterfactual pair may flip, and the value each flips to. Constrained
#: to `lake_record_schema.json#/properties/pair_flipped_field`; targets.md measures
#: sensitivity on `risk_posture` and `psyche`.
FLIP_TARGETS: dict[str, dict[str, str]] = {
    "risk_posture": {
        "risk_averse": "assertive",
        "cautious": "assertive",
        "balanced": "assertive",
        "assertive": "cautious",
        "risk_acceptant": "cautious",
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
    value = spec.get(field)
    return value is not None and value in FLIP_TARGETS.get(field, {})


def flipped(spec: dict[str, Any], field: str) -> dict[str, Any]:
    """The B arm of a counterfactual pair: the same persona, one field changed.

    The derived spec gets its own `spec_id` so the lake can tell the arms apart, and
    stays valid against `spec_schema.json` — which is why `psyche` and `private_type`
    only flip within their seat-legal enums.
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
