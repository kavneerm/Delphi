"""dpo.py: preference pairs must come from the SAME decision point."""

from __future__ import annotations

import json

import pytest

from train import dpo
from train.mocklake import records


def _pair_at_same_state(dim: str = "risk", high: int = 5, low: int = 2) -> list[dict]:
    """Two decisions by the same seat, same episode, same sim_time."""
    a, b = records(2)[0], records(2)[1]
    for r in (a, b):
        r["episode_id"] = "ep-1"
        r["seat"] = "norway"
        r["sim_time_s"] = 3600.0
    a["record_id"], b["record_id"] = "ep-1-norway-3600-a", "ep-1-norway-3600-b"
    a["judge_scores"] = dict(a["judge_scores"], **{dim: high})
    b["judge_scores"] = dict(b["judge_scores"], **{dim: low})
    return [a, b]


def test_a_pair_needs_the_same_decision_point() -> None:
    """Two decisions from different situations teach which SITUATION the model
    prefers, not which behaviour. That is the whole point of the grouping."""
    a, b = _pair_at_same_state()
    b["sim_time_s"] = 7200.0  # different moment
    assert dpo.build_preference_pairs([a, b], dimension="risk", min_gap=2) == []


def test_different_seats_are_not_a_pair() -> None:
    a, b = _pair_at_same_state()
    b["seat"] = "kremlin"
    assert dpo.build_preference_pairs([a, b], dimension="risk", min_gap=2) == []


def test_different_episodes_are_not_a_pair() -> None:
    a, b = _pair_at_same_state()
    b["episode_id"] = "ep-2"
    assert dpo.build_preference_pairs([a, b], dimension="risk", min_gap=2) == []


def test_a_real_pair_produces_chosen_and_rejected() -> None:
    pairs = dpo.build_preference_pairs(_pair_at_same_state(), dimension="risk", min_gap=2)
    assert len(pairs) == 1
    pair = pairs[0]
    assert [m["role"] for m in pair["messages"]] == ["system", "user"]
    assert json.loads(pair["chosen"])["action"]
    assert pair["chosen"] != pair["rejected"]


def test_the_gap_threshold_is_enforced() -> None:
    rows = _pair_at_same_state(high=4, low=3)
    assert dpo.build_preference_pairs(rows, dimension="risk", min_gap=2) == []
    assert len(dpo.build_preference_pairs(rows, dimension="risk", min_gap=1)) == 1


def test_the_gap_is_measured_on_the_chosen_dimension_only() -> None:
    """A big gap on `voice` must not create a pair when patching `risk`."""
    a, b = _pair_at_same_state(dim="voice", high=5, low=1)
    a["judge_scores"]["risk"] = b["judge_scores"]["risk"] = 3
    assert dpo.build_preference_pairs([a, b], dimension="risk", min_gap=2) == []
    assert len(dpo.build_preference_pairs([a, b], dimension="voice", min_gap=2)) == 1


def test_unknown_dimension_is_refused() -> None:
    with pytest.raises(ValueError, match="unknown judge dimension"):
        dpo.build_preference_pairs(records(4), dimension="vibes", min_gap=1)


def test_unjudged_records_cannot_form_pairs() -> None:
    rows = _pair_at_same_state()
    for r in rows:
        r["judge_scores"] = None
    assert dpo.build_preference_pairs(rows, dimension="risk", min_gap=1) == []


def test_state_key_is_the_decision_point() -> None:
    a = _pair_at_same_state()[0]
    assert dpo.state_key(a) == ("ep-1", "norway", 3600)


def test_the_patch_note_records_what_a_reader_needs() -> None:
    note = dpo.patch_note(
        run_id="r-dpo-risk",
        source_run_id="r",
        dimension="risk",
        pairs=412,
        lake_source="lake/lake_v1/_judge/judge_v1/",
        job="accounts/a/dpoJobs/j",
        min_gap=2,
    )
    for needle in ("risk", "412", "r-dpo-risk", "lake_v1", "re-run"):
        assert needle in note
