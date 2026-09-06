"""filter.py: the drops that matter, and the config discipline around them."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from train import filter as filt
from train.fireworks import BASE_MODELS, MIN_CONTEXT_LENGTH
from train.mocklake import records


@pytest.fixture(scope="module")
def config() -> dict:
    return filt.load_config()


def test_every_filter_block_has_a_contract_valid_version(config: dict) -> None:
    import re

    pattern = re.compile(r"^filter_v[0-9]+$")
    for name in config["filters"]:
        assert pattern.match(name), f"{name} violates contracts/s3_layout.md §2"


def test_config_yaml_has_no_duplicate_filter_versions() -> None:
    """A reused filter_vN silently grades two different configs as one run."""
    raw = Path("train/config.yaml").read_text(encoding="utf-8")
    names = [k for k in yaml.safe_load(raw)["filters"]]
    assert len(names) == len(set(names))


def test_sweep_variants_reference_real_filters_and_bases(config: dict) -> None:
    for variant in config["sweep"]["variants"]:
        assert variant["filter"] in config["filters"]
        assert variant["base"] in BASE_MODELS


def test_context_floor_is_the_smallest_base_not_the_largest(config: dict) -> None:
    """The whole point of the length check: Llama is 131072, Qwen is 32768, and
    an example sized for Llama truncates silently on Qwen."""
    assert config["context"]["min_context_tokens"] == MIN_CONTEXT_LENGTH
    assert MIN_CONTEXT_LENGTH < max(m["context_length"] for m in BASE_MODELS.values())


def test_identical_counterfactual_pairs_are_dropped(config: dict) -> None:
    rows = records(200)
    identical = filt.identical_pair_ids(rows)
    assert identical, "the mock lake should contain insensitive pairs to drop"

    kept, stats = filt.filter_records(rows, filter_version="filter_v0", config=config)
    assert stats.pairs_identical == len(identical)
    assert stats.dropped["identical_counterfactual_pair"] == sum(
        1 for r in rows if r.get("pair_id") in identical
    )
    assert kept


def test_a_pair_that_differs_only_in_prose_still_counts_as_identical() -> None:
    """Two arms that reason differently but act identically teach insensitivity."""
    a, b = records(2, pair_fraction=1.0)
    b["output"] = json.loads(json.dumps(a["output"]))
    b["output"]["reasoning"] = "Entirely different words, same decision."
    assert filt.identical_pair_ids([a, b]) == {a["pair_id"]}


def test_over_length_examples_are_dropped_against_the_floor(config: dict) -> None:
    rows = records(20)
    rows[0]["tokens"]["prompt"] = MIN_CONTEXT_LENGTH + 1
    rows[0]["pair_id"] = None
    _, stats = filt.filter_records(rows, filter_version="filter_v0", config=config)
    assert stats.dropped["over_min_context"] >= 1


def test_over_length_policy_flag_keeps_the_example(config: dict) -> None:
    cfg = json.loads(json.dumps(config))
    cfg["context"]["over_length_policy"] = "flag"
    rows = records(20)
    rows[0]["tokens"]["prompt"] = MIN_CONTEXT_LENGTH + 1
    rows[0]["pair_id"] = None
    kept, stats = filt.filter_records(rows, filter_version="filter_v0", config=cfg)
    assert stats.over_length_flagged >= 1
    assert any(ex.get("over_min_context") for ex in kept)
    assert "over_min_context" not in stats.dropped


def test_judge_threshold_actually_filters(config: dict) -> None:
    rows = records(300)
    loose, _ = filt.filter_records(rows, filter_version="filter_v3", config=config)
    strict, _ = filt.filter_records(rows, filter_version="filter_v2", config=config)
    assert len(strict) < len(loose)


def test_utility_percentile_is_taken_per_persona() -> None:
    """A seat whose utilities are structurally low must not be wiped out."""
    rows = records(120)
    for r in rows:
        r["outcome_utility"] = -5.0 if r["seat"] == "iridium" else 5.0
    cutoffs = filt.utility_cutoffs(rows, 50)
    iridium = [s for s in cutoffs if s.startswith("iridium")]
    assert iridium, "expected a per-spec cutoff for the low-utility seat"
    assert all(cutoffs[s] < 0 for s in iridium)


def test_chat_shape_is_system_user_assistant(config: dict) -> None:
    kept, _ = filt.filter_records(records(20), filter_version="filter_v0", config=config)
    roles = [m["role"] for m in kept[0]["messages"]]
    assert roles == ["system", "user", "assistant"]
    assert json.loads(kept[0]["messages"][2]["content"])["action"]["type"]


def test_user_turn_carries_state_injects_and_messages() -> None:
    turn = filt.user_turn(records(1)[0])
    for heading in ("FILTERED STATE", "INJECTS SEEN", "MESSAGES SEEN", "DECISION"):
        assert heading in turn


def test_manifest_records_every_version(config: dict) -> None:
    from train.versions import Versions

    _, stats = filt.filter_records(records(40), filter_version="filter_v1", config=config)
    versions = Versions(
        env_version="env_v1",
        spec_version="spec_v1",
        lake_version="lake_v1",
        filter_version="filter_v1",
        judge_version="judge_v1",
    )
    manifest = filt.build_manifest(
        filter_version="filter_v1",
        config=config,
        versions=versions,
        stats=stats,
        dataset_key="runs/x/y/dataset_filter_v1.jsonl",
        source="test",
    )
    assert set(manifest["versions"]) >= {
        "env_version",
        "spec_version",
        "lake_version",
        "filter_version",
        "judge_version",
        "contracts_version",
    }
    assert manifest["git_commit"]


# ------------------------------------------------- the lake double-read hazard
#
# agent3-gen's handoff: contracts/s3_layout.md §3 nests the judged tree inside the
# same version prefix as the base records, so `--lake-prefix lake/<lake_v>/`
# matches every decision twice — once unjudged, once scored.


def test_duplicate_record_ids_collapse_to_the_judged_copy() -> None:
    base = records(1)[0]
    base["judge_scores"] = None
    judged = json.loads(json.dumps(base))
    judged["judge_scores"] = {"authority": 5, "risk": 4, "private_info": 4, "voice": 5}

    deduped, duplicates = filt.dedupe_records([base, judged])
    assert duplicates == 1
    assert len(deduped) == 1
    assert deduped[0]["judge_scores"]["authority"] == 5


def test_dedupe_prefers_judged_regardless_of_read_order() -> None:
    base = records(1)[0]
    base["judge_scores"] = None
    judged = json.loads(json.dumps(base))
    judged["judge_scores"] = {"authority": 3, "risk": 3, "private_info": 3, "voice": 3}
    for order in ([base, judged], [judged, base]):
        deduped, _ = filt.dedupe_records(order)
        assert deduped[0]["judge_scores"] is not None


def test_dedupe_leaves_distinct_records_alone() -> None:
    rows = records(50)
    deduped, duplicates = filt.dedupe_records(rows)
    assert duplicates == 0
    assert len(deduped) == len(rows)


def test_records_without_an_id_are_not_collapsed_together() -> None:
    """Two anonymous records are two records, not one."""
    rows = [{"seat": "norway"}, {"seat": "kremlin"}]
    deduped, duplicates = filt.dedupe_records(rows)
    assert len(deduped) == 2
    assert duplicates == 0


def test_the_judged_prefix_is_the_one_the_contract_names() -> None:
    assert filt.judged_lake_prefix("lake_v1", "judge_v2") == "lake/lake_v1/_judge/judge_v2/"


def test_double_weighting_would_change_the_dataset(config: dict) -> None:
    """Why this matters: without the dedupe, a filter that does not require a judge
    score trains the judged copies at double weight and the manifest counts lie."""
    rows = records(40)
    doubled = rows + [json.loads(json.dumps(r)) for r in rows]
    once, _ = filt.filter_records(rows, filter_version="filter_v0", config=config)
    twice_raw, _ = filt.filter_records(doubled, filter_version="filter_v0", config=config)
    assert len(twice_raw) == 2 * len(once)

    deduped, duplicates = filt.dedupe_records(doubled)
    assert duplicates == len(rows)
    fixed, _ = filt.filter_records(deduped, filter_version="filter_v0", config=config)
    assert len(fixed) == len(once)
