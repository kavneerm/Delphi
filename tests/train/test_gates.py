"""gates.py: the three pre-eval gates, against the real contract schema."""

from __future__ import annotations

import pytest

from train import filter as filt
from train import gates
from train.mocklake import records


@pytest.fixture(scope="module")
def config() -> dict:
    return filt.load_config()


def _decision(action: str = "hold", hostile: float = 0.2, **params) -> dict:
    return {
        "beliefs": {
            "hostile": hostile,
            "natural": round(1.0 - hostile - 0.1, 2),
            "unknown": 0.1,
            "per_actor": {},
        },
        "messages": [],
        "action": {"type": action, "params": params},
        "reasoning": "Because.",
    }


def test_valid_decision_passes_the_contract() -> None:
    assert gates.validate_decision(_decision()) == []


def test_beliefs_that_do_not_sum_to_one_are_caught() -> None:
    bad = _decision()
    bad["beliefs"]["hostile"] = 0.9
    errors = gates.validate_decision(bad)
    assert any("1.0" in e for e in errors)


def test_unknown_action_type_is_caught() -> None:
    assert gates.validate_decision(_decision(action="nuke_everything"))


def test_non_object_decision_is_caught() -> None:
    assert gates.validate_decision("not a decision")


def test_schema_validity_gate_reports_the_fraction(config: dict) -> None:
    good = [_decision() for _ in range(9)]
    bad = [{"garbage": True}]
    result = gates.gate_schema_validity(good + bad, 0.95)
    assert result.n == 10
    assert result.value == pytest.approx(0.9)
    assert not result.passed
    assert result.detail["top_failures"]


def test_counterfactual_sensitivity_needs_a_real_move() -> None:
    same = [(_decision(), _decision()) for _ in range(10)]
    assert gates.gate_counterfactual_sensitivity(same, 0.9).value == 0.0

    moved = [(_decision("hold"), _decision("private_demarche", recipient="kremlin"))] * 10
    assert gates.gate_counterfactual_sensitivity(moved, 0.9).value == 1.0


def test_same_action_with_a_big_belief_shift_counts_as_sensitive() -> None:
    pairs = [(_decision("hold", hostile=0.1), _decision("hold", hostile=0.6))]
    assert gates.gate_counterfactual_sensitivity(pairs, 0.9).value == 1.0


def test_a_tiny_belief_shift_does_not_count() -> None:
    pairs = [(_decision("hold", hostile=0.30), _decision("hold", hostile=0.35))]
    assert gates.gate_counterfactual_sensitivity(pairs, 0.9).value == 0.0


def test_holdout_coherence_flags_out_of_envelope_actions() -> None:
    spec = {"seat": "starlink", "authority": {"unilateral": ["hold", "geofence_or_throttle"]}}
    inside = (spec, _decision("geofence_or_throttle", region="svalbard", mode="throttle"))
    outside = (spec, _decision("kinetic"))
    result = gates.gate_holdout_coherence([inside, outside], 0.8)
    assert result.value == pytest.approx(0.5)
    assert "starlink:kinetic" in result.detail["top_violations"]


def test_hold_is_always_coherent() -> None:
    spec = {"seat": "norway", "authority": {"unilateral": ["private_demarche"]}}
    assert gates.gate_holdout_coherence([(spec, _decision("hold"))], 0.8).value == 1.0


def test_empty_gate_never_passes() -> None:
    """Zero samples is not a pass; it is a gate that did not run."""
    assert not gates.gate_schema_validity([], 0.95).passed
    assert not gates.gate_counterfactual_sensitivity([], 0.9).passed


def test_offline_mode_runs_with_no_deployment(config: dict) -> None:
    results = gates.run_gates_offline(records(120), config)
    assert {r.name for r in results} == {
        "schema_validity",
        "counterfactual_sensitivity",
        "holdout_persona_coherence",
    }
    schema = next(r for r in results if r.name == "schema_validity")
    assert schema.value == 1.0, "mock lake outputs must be contract-valid"


def test_render_marks_failures(config: dict) -> None:
    results = gates.run_gates_offline(records(120), config)
    table = gates.render("run-x", results)
    assert "| gate |" in table and "run-x" in table
