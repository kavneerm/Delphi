"""Validate everything under specs/drafts/ before a human promotes it.

Three checks, one per draft family:

* ``specs/drafts/*.json`` and ``specs/drafts/holdout/*.json`` are persona specs and
  validate against ``contracts/spec_schema.json``, plus the authority invariants that
  the schema cannot express (pairwise-disjoint lists, subset of the action ladder's
  ``allowed_seats``), the priors sum warning from the schema description, and that every
  counterfactual arm gen/specs.py would derive from the spec still fits ``spec_id``'s
  64-character ceiling.
* ``specs/drafts/devset/<id>/{scenario,expected}.json`` validate against
  ``contracts/inject_schema.json``.
* ``specs/drafts/exemplars/*.json`` validate against the local
  ``exemplar_card_schema.json`` and are passed through ``scripts/check_quarantine.sh``,
  so the exemplar bank is checked at authoring time and not only at commit time. The
  quarantined strings themselves live in that script and are deliberately not repeated
  here — a copy of the list is a copy of the material.

Run from the repo root::

    python specs/drafts/validate_drafts.py
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

REPO_ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = REPO_ROOT / "contracts"
DRAFTS = REPO_ROOT / "specs" / "drafts"

# exemplar_card_schema.json declares an $id under this prefix, so its relative $refs into
# the contract schemas resolve against it rather than against contracts/. Register the
# contracts under this base too, so "spec_schema.json#/$defs/seat" resolves from either side.
DRAFTS_BASE = "https://panoptes.wargame/specs/drafts/"


def _registry() -> Registry:
    """Every contract schema, addressable by bare filename and by $id."""
    registry: Registry = Registry()
    for path in sorted(CONTRACTS.glob("*.json")):
        schema = json.loads(path.read_text())
        resource = Resource.from_contents(schema)
        registry = registry.with_resource(uri=path.name, resource=resource)
        registry = registry.with_resource(uri=DRAFTS_BASE + path.name, resource=resource)
        if "$id" in schema:
            registry = registry.with_resource(uri=schema["$id"], resource=resource)
    for path in sorted(DRAFTS.glob("*_schema.json")):
        schema = json.loads(path.read_text())
        registry = registry.with_resource(uri=path.name, resource=Resource.from_contents(schema))
    return registry


def _validator(schema_name: str, registry: Registry) -> Draft202012Validator:
    base = CONTRACTS / schema_name
    schema = json.loads((base if base.exists() else DRAFTS / schema_name).read_text())
    return Draft202012Validator(schema, registry=registry)


#: What gen/specs.py flips to build the B arm of a counterfactual pair, mirrored from
#: gen/specs.py::FLIP_TARGETS. Only the value lengths matter here — the arm's spec_id is
#: "<spec_id>_cf_<field>_<new_value>", and spec_schema caps spec_id at 64 characters, so a
#: long spec_id on a hidden-type seat silently breaks pair construction inside gen/sweep.py
#: rather than here. contracts/targets.md scores counterfactual_sensitivity on those pairs.
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

SPEC_ID_MAX = 64


def _check_counterfactual_arms(spec: dict[str, Any]) -> list[str]:
    """Every arm gen/specs.py could derive from this spec must be a legal spec_id."""
    problems: list[str] = []
    spec_id = spec.get("spec_id", "")
    for field, table in FLIP_TARGETS.items():
        value = spec.get(field)
        if value not in table:
            continue
        arm = f"{spec_id}_cf_{field}_{table[value]}"
        if len(arm) > SPEC_ID_MAX:
            problems.append(
                f"counterfactual arm for {field}={value} is {len(arm)} chars "
                f"(max {SPEC_ID_MAX}): {arm} — shorten spec_id by "
                f"{len(arm) - SPEC_ID_MAX}"
            )
    return problems


def _allowed_seats_by_action() -> dict[str, set[str]]:
    ladder = json.loads((CONTRACTS / "action_schema.json").read_text())
    return {e["type"]: set(e["allowed_seats"]) for e in ladder["x-action-ladder"]}


def _check_spec_invariants(spec: dict[str, Any], allowed: dict[str, set[str]]) -> list[str]:
    """The authority and priors rules spec_schema.json states in prose."""
    problems: list[str] = []
    seat = spec["seat"]
    auth = spec["authority"]
    uni, rel, rec = (set(auth[k]) for k in ("unilateral", "requires_release", "recommend_only"))

    for a, b, names in (
        (uni, rel, "unilateral/requires_release"),
        (uni, rec, "unilateral/recommend_only"),
        (rel, rec, "requires_release/recommend_only"),
    ):
        if a & b:
            problems.append(f"authority lists {names} overlap on {sorted(a & b)}")

    for action in sorted(uni | rel):
        if seat not in allowed.get(action, set()):
            problems.append(
                f"authority grants '{action}' but the ladder's allowed_seats excludes {seat}"
            )

    priors = spec["priors"]
    keys = ("p_hostile_prior", "p_natural_prior", "p_unknown_prior")
    if all(k in priors for k in keys):
        total = sum(priors[k] for k in keys)
        if abs(total - 1.0) > 0.01:
            problems.append(f"priors sum to {total:.3f}, not 1.0")

    problems += _check_counterfactual_arms(spec)
    return problems


def _check_quarantine(paths: list[Path]) -> list[str]:
    """Delegate to scripts/check_quarantine.sh — the single source of the banned list."""
    if not paths:
        return []
    result = subprocess.run(
        [str(REPO_ROOT / "scripts" / "check_quarantine.sh"), *(str(p) for p in paths)],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )
    if result.returncode == 0:
        return []
    return [ln.strip() for ln in result.stderr.splitlines() if ln.strip().startswith("specs/")]


def main() -> int:
    registry = _registry()
    spec_validator = _validator("spec_schema.json", registry)
    inject_validator = _validator("inject_schema.json", registry)
    card_validator = _validator("exemplar_card_schema.json", registry)
    allowed = _allowed_seats_by_action()

    failures: list[str] = []
    counts = {"spec": 0, "holdout": 0, "devset": 0, "exemplar": 0}
    spec_ids: dict[str, Path] = {}
    exemplar_paths: list[Path] = []

    spec_files = sorted(DRAFTS.glob("*.json")) + sorted((DRAFTS / "holdout").glob("*.json"))
    for path in spec_files:
        if path.name.endswith("_schema.json"):
            continue
        rel = path.relative_to(REPO_ROOT)
        spec = json.loads(path.read_text())
        errors = [e.message for e in spec_validator.iter_errors(spec)]
        errors += _check_spec_invariants(spec, allowed) if not errors else []
        if (prior := spec_ids.get(spec.get("spec_id", ""))) is not None:
            errors.append(f"duplicate spec_id, also used by {prior.relative_to(REPO_ROOT)}")
        spec_ids[spec.get("spec_id", "")] = path
        failures += [f"{rel}: {e}" for e in errors]
        counts["holdout" if path.parent.name == "holdout" else "spec"] += 1

    for path in sorted((DRAFTS / "devset").rglob("*.json")):
        rel = path.relative_to(REPO_ROOT)
        doc = json.loads(path.read_text())
        failures += [f"{rel}: {e.message}" for e in inject_validator.iter_errors(doc)]
        counts["devset"] += 1

    for path in sorted((DRAFTS / "exemplars").glob("*.json")):
        if path.name.endswith("_schema.json"):
            continue
        rel = path.relative_to(REPO_ROOT)
        card = json.loads(path.read_text())
        failures += [f"{rel}: {e.message}" for e in card_validator.iter_errors(card)]
        exemplar_paths.append(path.relative_to(REPO_ROOT))
        counts["exemplar"] += 1

    failures += [f"quarantined: {hit}" for hit in _check_quarantine(exemplar_paths)]

    print(
        f"specs {counts['spec']} | holdout {counts['holdout']} | "
        f"devset files {counts['devset']} | exemplars {counts['exemplar']}"
    )
    for line in failures:
        print(f"FAIL {line}", file=sys.stderr)
    print("OK" if not failures else f"{len(failures)} problem(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
