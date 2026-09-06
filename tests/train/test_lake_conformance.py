"""The filter against contract-legal but awkward lake records.

`train/mocklake.py` produces tidy records. The real lake will not: a decision is
written the moment it completes, so `outcome_utility` and `judge_scores` are
`null` until the episode ends and the judge pass runs, and a crash mid-episode
can leave one arm of a counterfactual pair without its partner. These are the
shapes `contracts/lake_record_schema.json` explicitly allows, and every one of
them has to survive `filter.py` rather than raise on the night the real lake
lands.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from train import filter as filt
from train.fireworks import MIN_CONTEXT_LENGTH
from train.mocklake import records


@pytest.fixture(scope="module")
def config() -> dict:
    return filt.load_config()


@pytest.fixture(scope="module")
def lake_validator() -> Draft202012Validator:
    resources = []
    for path in sorted(Path("contracts").glob("*.json")):
        contents = json.loads(path.read_text(encoding="utf-8"))
        resource = Resource.from_contents(contents)
        resources.append((path.name, resource))
        if "$id" in contents:
            resources.append((contents["$id"], resource))
    schema = json.loads(Path("contracts/lake_record_schema.json").read_text(encoding="utf-8"))
    return Draft202012Validator(schema, registry=Registry().with_resources(resources))


def test_the_mock_lake_cannot_drift_from_the_contract(
    lake_validator: Draft202012Validator,
) -> None:
    """If the mock stops being contract-valid, every test built on it is fiction."""
    errors = [
        (r["record_id"], e.message) for r in records(200) for e in lake_validator.iter_errors(r)
    ]
    assert errors == []


def _mutate(**changes: Any) -> list[dict[str, Any]]:
    rows = records(60)
    for row in rows:
        row.update(changes)
    return rows


def test_an_unjudged_lake_survives(config: dict) -> None:
    """Records exist before gen/judge.py runs. filter_v0 does not require a judge."""
    rows = _mutate(judge_scores=None, judge_version=None)
    kept, stats = filt.filter_records(rows, filter_version="filter_v0", config=config)
    assert kept
    assert stats.dropped.get("judge_threshold", 0) == 0


def test_a_filter_that_requires_judging_drops_unjudged_records(config: dict) -> None:
    rows = _mutate(judge_scores=None, judge_version=None)
    kept, stats = filt.filter_records(rows, filter_version="filter_v1", config=config)
    assert kept == []
    # Identical counterfactual pairs are dropped before the judge check, so the
    # two reasons partition the input rather than judge_threshold taking all of it.
    assert sum(stats.dropped.values()) == len(rows)
    assert stats.dropped["judge_threshold"] > 0


def test_records_written_before_the_episode_ended_survive(config: dict) -> None:
    """outcome_utility is null until the episode closes; a percentile cut must not
    crash on it, and must not treat null as a low score."""
    rows = _mutate(outcome_utility=None)
    kept, stats = filt.filter_records(rows, filter_version="filter_v1", config=config)
    assert stats.dropped.get("unscored_utility", 0) + len(kept) > 0
    for row in rows:
        assert row["outcome_utility"] is None  # not mutated in place


def test_utility_cutoffs_ignore_null_utilities() -> None:
    rows = records(40)
    for i, row in enumerate(rows):
        if i % 2:
            row["outcome_utility"] = None
    cutoffs = filt.utility_cutoffs(rows, 50)
    assert all(isinstance(v, float) for v in cutoffs.values())


def test_an_orphaned_pair_arm_is_not_treated_as_identical(config: dict) -> None:
    """A crash can leave one arm without its partner. One arm is not a pair, and
    dropping it as 'identical' would silently bin good data."""
    rows = records(20, pair_fraction=1.0)
    seen: set[str] = set()
    orphans = [r for r in rows if not (r["pair_id"] in seen or seen.add(r["pair_id"]))]
    assert filt.identical_pair_ids(orphans) == set()


def test_empty_injects_and_messages_render(config: dict) -> None:
    rows = _mutate(injects_seen=[], messages_seen=[])
    kept, _ = filt.filter_records(rows, filter_version="filter_v0", config=config)
    assert "(none)" in kept[0]["messages"][1]["content"]


def test_a_record_with_no_recorded_token_count_is_measured(config: dict) -> None:
    """gen populates tokens.prompt, but a hand-written or older record may not."""
    rows = _mutate(tokens={})
    kept, stats = filt.filter_records(rows, filter_version="filter_v0", config=config)
    assert kept
    assert stats.max_prompt_tokens > 0


def test_the_recorded_token_count_is_preferred_over_re_measuring(config: dict) -> None:
    rows = _mutate(tokens={"prompt": 31337})
    _, stats = filt.filter_records(rows, filter_version="filter_v0", config=config)
    assert stats.max_prompt_tokens == 31337


def test_a_prompt_over_the_floor_is_dropped_not_truncated(config: dict) -> None:
    """The whole reason the check exists: silent truncation on the smaller base."""
    rows = _mutate(tokens={"prompt": MIN_CONTEXT_LENGTH * 2}, pair_id=None)
    kept, stats = filt.filter_records(rows, filter_version="filter_v0", config=config)
    assert kept == []
    assert stats.dropped["over_min_context"] == len(rows)


def test_an_empty_lake_is_an_empty_dataset_not_a_crash(config: dict) -> None:
    kept, stats = filt.filter_records([], filter_version="filter_v1", config=config)
    assert kept == []
    assert stats.seen == 0


def test_selfplay_records_are_distinguishable_from_round_one(config: dict) -> None:
    """lake_record_schema marks gen_source so round-2 data can be filtered apart."""
    rows = _mutate(gen_source="selfplay")
    kept, _ = filt.filter_records(rows, filter_version="filter_v0", config=config)
    assert kept
    assert all(r["gen_source"] == "selfplay" for r in rows)
