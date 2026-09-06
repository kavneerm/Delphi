"""launch.py: run-id shape, dataset sharing, and provenance discipline."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from train import filter as filt
from train import launch
from train.fireworks import BASE_MODELS


@pytest.fixture(scope="module")
def config() -> dict:
    return filt.load_config()


@pytest.fixture
def local(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("WARGAME_LOCAL", "1")
    monkeypatch.setenv("WARGAME_LOCAL_ROOT", str(tmp_path))
    return tmp_path


def test_variant_round_trips_through_its_string_form() -> None:
    v = launch.Variant.parse("qwen3_8b:32:3:filter_v1")
    assert (v.base, v.rank, v.epochs, v.filter_version) == ("qwen3_8b", 32, 3, "filter_v1")
    assert launch.Variant.parse(str(v)) == v


def test_bad_variant_string_says_what_it_wanted() -> None:
    with pytest.raises(ValueError, match="base:rank:epochs"):
        launch.Variant.parse("qwen3_8b:32")


def test_run_id_matches_the_s3_layout_convention() -> None:
    """s3_layout.md §3: <base>-r<rank>-e<epochs>-<filter_version>-<6 hex>."""
    import re

    run_id = launch.Variant("qwen3_8b", 32, 3, "filter_v2").run_id("sweep-20260906-01")
    assert re.match(r"^qwen3_8b-r32-e3-filter_v2-[0-9a-f]{6}$", run_id), run_id


def test_run_ids_are_deterministic_per_sweep_but_differ_across_sweeps() -> None:
    """Deterministic so a re-run overwrites rather than duplicating; per-sweep so
    two sweeps of the same grid do not collide in checkpoints/."""
    v = launch.Variant("qwen3_8b", 16, 2, "filter_v1")
    assert v.run_id("sweep-a") == v.run_id("sweep-a")
    assert v.run_id("sweep-a") != v.run_id("sweep-b")


def test_every_sweep_variant_has_a_distinct_run_id(config: dict) -> None:
    variants = launch.variants_from_config(config)
    ids = {v.run_id("sweep-20260906-01") for v in variants}
    assert len(ids) == len(variants)


def test_sweep_size_is_in_the_agreed_band(config: dict) -> None:
    """docs/agent_workstreams.md: a sweep of 8-12 runs."""
    assert 8 <= len(launch.variants_from_config(config)) <= 12


def test_sweep_covers_both_bases(config: dict) -> None:
    bases = {v.base for v in launch.variants_from_config(config)}
    assert bases == set(BASE_MODELS)


def test_sweep_id_matches_the_convention() -> None:
    import re

    assert re.match(r"^sweep-\d{8}-\d{2}$", launch.default_sweep_id())


def test_versions_for_rejects_an_unknown_filter(config: dict) -> None:
    with pytest.raises(KeyError):
        launch.versions_for(config, "filter_v99")


def test_datasets_are_shared_across_variants_using_one_filter(config: dict) -> None:
    """The sweep varies base/rank/epochs over few distinct filters; re-filtering
    per variant would be pure waste."""
    variants = launch.variants_from_config(config)
    distinct_filters = {v.filter_version for v in variants}
    assert len(distinct_filters) < len(variants)


def test_summary_table_lists_every_run_and_surfaces_failures(local: Path) -> None:
    results = [
        {
            "run_id": "qwen3_8b-r16-e2-filter_v1-aaaaaa",
            "variant": {"base": "qwen3_8b", "rank": 16, "epochs": 2, "filter_version": "filter_v1"},
            "state": "JOB_STATE_COMPLETED",
            "output_model": "accounts/a/models/m",
            "versions": {
                "env_version": "env_v1",
                "spec_version": "spec_v1",
                "lake_version": "lake_v1",
                "filter_version": "filter_v1",
                "judge_version": "judge_v1",
            },
        },
        {
            "run_id": "llama31_8b-r32-e3-filter_v2-bbbbbb",
            "variant": {
                "base": "llama31_8b",
                "rank": 32,
                "epochs": 3,
                "filter_version": "filter_v2",
            },
            "state": "CREATE_FAILED",
            "error": "quota exhausted",
            "versions": {
                "env_version": "env_v1",
                "spec_version": "spec_v1",
                "lake_version": "lake_v1",
                "filter_version": "filter_v2",
                "judge_version": "judge_v1",
            },
        },
    ]
    body = launch.write_summary("sweep-20260906-01", results, upload=False)
    assert "qwen3_8b-r16-e2-filter_v1-aaaaaa" in body
    assert "## Failures" in body and "quota exhausted" in body


def test_build_dataset_writes_a_manifest_with_the_filter_config(config: dict, local: Path) -> None:
    path, manifest = launch.build_dataset(
        filter_version="filter_v1",
        config=config,
        sweep_id="sweep-test-01",
        lake_prefix=None,
        mock=400,
        specs_dir=Path("specs/train"),
        upload_to_s3=False,
    )
    assert path.exists()
    assert manifest["filter_version"] == "filter_v1"
    assert manifest["filter_config"]["judge_min"]
    assert manifest["stats"]["kept"] > 0
    first = json.loads(path.read_text(encoding="utf-8").splitlines()[0])
    assert [m["role"] for m in first["messages"]] == ["system", "user", "assistant"]


def test_a_filter_that_keeps_nothing_fails_loudly(config: dict, local: Path) -> None:
    """Silently training on an empty dataset is the worst outcome available."""
    starved = json.loads(json.dumps(config))
    starved["filters"]["filter_v1"]["judge_min"] = dict.fromkeys(
        starved["filters"]["filter_v1"]["judge_min"], 5
    )
    starved["filters"]["filter_v1"]["judge_mean_min"] = 5.0
    with pytest.raises(SystemExit, match="0 examples"):
        launch.build_dataset(
            filter_version="filter_v1",
            config=starved,
            sweep_id="sweep-test-02",
            lake_prefix=None,
            mock=20,
            specs_dir=Path("specs/train"),
            upload_to_s3=False,
        )


def test_non_fireworks_backends_explain_the_quota() -> None:
    for backend in ("sagemaker", "ec2"):
        with pytest.raises(SystemExit, match="quota"):
            launch.launch_unavailable(backend)
