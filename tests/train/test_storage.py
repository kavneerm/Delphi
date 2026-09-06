"""storage.py + versions.py: the object-metadata contract, on the local mirror.

`contracts/s3_layout.md` §4 fixes what every object carries. A missing key means
the writer is out of contract, and an object in the bucket whose provenance
cannot be recovered is a discarded run (§2) — so these are cheap tests guarding
an expensive failure. Nothing here touches S3; the local mirror is the same key
space by §6.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from train import storage
from train.versions import REQUIRED_METADATA_KEYS, Versions


@pytest.fixture
def local(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("WARGAME_LOCAL", "1")
    monkeypatch.setenv("WARGAME_LOCAL_ROOT", str(tmp_path))
    return tmp_path


@pytest.fixture
def versions() -> Versions:
    return Versions("env_v1", "spec_v1", "lake_v1", "filter_v1", "judge_v1")


def test_metadata_carries_every_required_key(versions: Versions) -> None:
    assert not REQUIRED_METADATA_KEYS - set(versions.as_metadata())


def test_seed_and_episode_are_present_but_empty_when_not_applicable(
    versions: Versions,
) -> None:
    """§4: empty string means not applicable; a MISSING key means out of contract."""
    meta = versions.as_metadata()
    assert meta["seed"] == ""
    assert meta["episode-id"] == ""


def test_seed_and_episode_are_stringified(versions: Versions) -> None:
    meta = versions.as_metadata(seed=41, episode_id="ep-1")
    assert meta["seed"] == "41"
    assert meta["episode-id"] == "ep-1"


def test_metadata_keys_are_hyphenated_not_underscored(versions: Versions) -> None:
    assert all("_" not in k for k in versions.as_metadata())


def test_an_incomplete_metadata_block_is_refused(local: Path) -> None:
    """One failed write beats a bucket full of untraceable objects."""
    with pytest.raises(ValueError, match="s3_layout"):
        storage.put_json("runs/x/y.json", {"a": 1}, {"env-version": "env_v1"})


def test_version_patterns_are_enforced() -> None:
    with pytest.raises(ValueError, match="filter_version"):
        Versions("env_v1", "spec_v1", "lake_v1", "filter_v1_smoke", "judge_v1").validate()
    with pytest.raises(ValueError, match="env_version"):
        Versions("v1", "spec_v1", "lake_v1", "filter_v1", "judge_v1").validate()


def test_perturbed_env_version_is_legal() -> None:
    """eval/perturb.py reruns under env_v1_perturbed; the pattern must allow it."""
    Versions("env_v1_perturbed", "spec_v1", "lake_v1", "filter_v1", "judge_v1").validate()


def test_round_trip_on_the_local_mirror(local: Path, versions: Versions) -> None:
    key = "runs/sweep-x/run-y/manifest.json"
    storage.put_json(key, {"run_id": "run-y"}, versions.as_metadata())
    assert json.loads(storage.get_text(key))["run_id"] == "run-y"
    assert key in storage.list_keys("runs/sweep-x/")


def test_metadata_reads_back_off_either_backend(local: Path, versions: Versions) -> None:
    """The mirror has no x-amz-meta, so provenance lives in an `_meta/` sidecar.
    `head()` is the backend-agnostic way to get it back, and is what a consumer
    should use rather than reaching for a path."""
    storage.put_json("runs/a/b.json", {"x": 1}, versions.as_metadata(seed=3))
    meta = storage.head("runs/a/b.json")
    assert meta["seed"] == "3"
    assert not REQUIRED_METADATA_KEYS - set(meta)


def test_the_metadata_sidecar_stays_out_of_prefix_listings(local: Path, versions: Versions) -> None:
    """A listing of the mirror must match a listing of the bucket exactly."""
    storage.put_json("runs/a/b.json", {"x": 1}, versions.as_metadata())
    assert storage.list_keys("runs/") == ["runs/a/b.json"]


def test_jsonl_round_trip(local: Path, versions: Versions) -> None:
    rows = [{"i": i} for i in range(3)]
    storage.put_jsonl("lake/lake_v1/x.jsonl", rows, versions.as_metadata())
    assert list(storage.read_jsonl("lake/lake_v1/x.jsonl")) == rows


def test_bucket_is_required_not_defaulted(monkeypatch: pytest.MonkeyPatch) -> None:
    """s3_layout.md §1: KeyError is the correct failure."""
    monkeypatch.delenv("WARGAME_BUCKET", raising=False)
    with pytest.raises(KeyError):
        storage.bucket()


def test_listing_an_absent_prefix_is_empty_not_an_error(local: Path) -> None:
    assert storage.list_keys("runs/nothing-here/") == []
