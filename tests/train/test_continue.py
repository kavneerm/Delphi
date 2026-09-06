"""continue_run.py: round 2 continues from an adapter, never from base."""

from __future__ import annotations

from pathlib import Path

import pytest

from train import continue_run
from train import filter as filt
from train.fireworks import Client


@pytest.fixture(scope="module")
def config() -> dict:
    return filt.load_config()


@pytest.fixture
def local(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("WARGAME_LOCAL", "1")
    monkeypatch.setenv("WARGAME_LOCAL_ROOT", str(tmp_path))
    monkeypatch.setenv("WARGAME_SCRATCH", str(tmp_path / "scratch"))
    return tmp_path


ROUND1 = {
    "run_id": "llama31_8b-r32-e3-filter_v1-abc123",
    "output_model": "accounts/a/models/llama31-8b-r32-e3-filter-v1-abc123",
    "base_model": "accounts/fireworks/models/llama-v3p1-8b-instruct",
    "variant": {"base": "llama31_8b", "rank": 32, "epochs": 3, "filter_version": "filter_v1"},
}


def test_a_finished_run_warm_starts_from_its_adapter(config: dict, local: Path) -> None:
    client = Client(account="acct", key="fw_test", dry_run=True)
    record = continue_run.continue_from(
        source=ROUND1,
        sweep_id="sweep-20260906-02",
        filter_version="filter_v1",
        config=config,
        client=client,
        lake_prefix=None,
        mock=400,
        specs_dir=Path("specs/train"),
        upload_to_s3=False,
    )
    assert record["warm_start_from"] == ROUND1["output_model"]
    assert record["round"] == 2
    assert record["continued_from_run_id"] == ROUND1["run_id"]


def test_an_unfinished_run_cannot_be_continued(config: dict, local: Path) -> None:
    """No output model means the job never produced an adapter to build on."""
    client = Client(account="acct", key="fw_test", dry_run=True)
    with pytest.raises(SystemExit, match="nothing to continue"):
        continue_run.continue_from(
            source={**ROUND1, "output_model": None},
            sweep_id="s",
            filter_version="filter_v1",
            config=config,
            client=client,
            lake_prefix=None,
            mock=40,
            specs_dir=Path("specs/train"),
            upload_to_s3=False,
        )


def test_round_two_run_ids_do_not_collide_with_round_one(config: dict, local: Path) -> None:
    client = Client(account="acct", key="fw_test", dry_run=True)
    record = continue_run.continue_from(
        source=ROUND1,
        sweep_id="sweep-20260906-02",
        filter_version="filter_v1",
        config=config,
        client=client,
        lake_prefix=None,
        mock=400,
        specs_dir=Path("specs/train"),
        upload_to_s3=False,
    )
    assert record["run_id"] != ROUND1["run_id"]


def test_rank_and_epochs_inherit_but_can_be_overridden(config: dict, local: Path) -> None:
    client = Client(account="acct", key="fw_test", dry_run=True)
    inherited = continue_run.continue_from(
        source=ROUND1,
        sweep_id="s2",
        filter_version="filter_v1",
        config=config,
        client=client,
        lake_prefix=None,
        mock=400,
        specs_dir=Path("specs/train"),
        upload_to_s3=False,
    )
    assert inherited["variant"]["rank"] == 32
    overridden = continue_run.continue_from(
        source=ROUND1,
        sweep_id="s2",
        filter_version="filter_v1",
        config=config,
        client=client,
        lake_prefix=None,
        mock=400,
        specs_dir=Path("specs/train"),
        rank=16,
        epochs=1,
        upload_to_s3=False,
    )
    assert overridden["variant"]["rank"] == 16
    assert overridden["variant"]["epochs"] == 1
