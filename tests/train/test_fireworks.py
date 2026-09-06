"""fireworks.py: id hygiene, the tunability trap, and the cost-safety defaults."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from train import fireworks as fw


def test_min_context_is_the_smallest_base() -> None:
    assert fw.MIN_CONTEXT_LENGTH == min(m["context_length"] for m in fw.BASE_MODELS.values())


def test_every_base_declares_what_the_length_check_needs() -> None:
    for key, base in fw.BASE_MODELS.items():
        assert base["id"].startswith("accounts/"), key
        assert isinstance(base["context_length"], int), key


def test_rejected_bases_are_not_also_live_bases() -> None:
    """A base cannot be both in the sweep and known-untrainable."""
    assert not set(fw.REJECTED_BASES) & set(fw.BASE_MODELS)


def test_rejected_bases_explain_themselves() -> None:
    for key, note in fw.REJECTED_BASES.items():
        assert len(note) > 40, f"{key} needs a reason a human can act on"


def test_resource_id_coerces_run_ids() -> None:
    """Run ids carry underscores per s3_layout.md; Fireworks ids may not."""
    assert fw.resource_id("qwen3_8b-r32-e3-filter_v2-a71c04") == "qwen3-8b-r32-e3-filter-v2-a71c04"
    assert fw.resource_id("SMOKE_Llama31") == "smoke-llama31"


def test_resource_id_rejects_the_unsalvageable() -> None:
    with pytest.raises(ValueError):
        fw.resource_id("!!!")


def test_default_accelerator_is_set() -> None:
    """Fireworks 400s a non-embeddings deployment with no acceleratorType."""
    assert fw.DEFAULT_ACCELERATOR


def test_api_key_missing_is_a_clear_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("FIREWORKS_API_KEY", raising=False)
    with pytest.raises(fw.FireworksError, match="env only"):
        fw.api_key()


def test_sft_job_needs_exactly_one_starting_point() -> None:
    client = fw.Client(account="acct", key="fw_test", dry_run=True)
    with pytest.raises(ValueError):
        client.create_sft_job(job_id="j", dataset_id="d", output_model_id="m")
    with pytest.raises(ValueError):
        client.create_sft_job(
            job_id="j",
            dataset_id="d",
            output_model_id="m",
            base_model="accounts/fireworks/models/x",
            warm_start_from="accounts/a/models/y",
        )


def test_dry_run_never_calls_out() -> None:
    client = fw.Client(account="acct", key="fw_test", dry_run=True)
    out = client.create_sft_job(
        job_id="j",
        dataset_id="d",
        output_model_id="m",
        base_model="accounts/fireworks/models/x",
        lora_rank=32,
        epochs=3,
    )
    assert out["dry_run"] is True
    assert out["body"]["loraRank"] == 32
    assert out["body"]["epochs"] == 3


def test_deployment_body_always_names_an_accelerator() -> None:
    client = fw.Client(account="acct", key="fw_test", dry_run=True)
    out = client.create_deployment(deployment_id="dep", base_model="accounts/fireworks/models/x")
    assert out["body"]["acceleratorType"] == fw.DEFAULT_ACCELERATOR
    assert out["body"]["enableAddons"] is True, "multi-LoRA needs addons enabled"


def test_empty_dataset_is_refused(tmp_path: Path) -> None:
    client = fw.Client(account="acct", key="fw_test", dry_run=True)
    empty = tmp_path / "empty.jsonl"
    empty.write_text("\n\n", encoding="utf-8")
    with pytest.raises(fw.FireworksError, match="empty"):
        client.create_dataset("ds", empty)


def test_dataset_example_count_ignores_blank_lines(tmp_path: Path) -> None:
    client = fw.Client(account="acct", key="fw_test", dry_run=True)
    path = tmp_path / "d.jsonl"
    path.write_text(json.dumps({"messages": []}) + "\n\n" + json.dumps({"messages": []}) + "\n")
    assert client.create_dataset("ds", path).endswith("/datasets/ds")


def test_wait_raises_on_a_terminal_failure() -> None:
    client = fw.Client(account="acct", key="fw_test")
    with pytest.raises(fw.FireworksError, match="JOB_STATE_FAILED"):
        client.wait(lambda: {"state": "JOB_STATE_FAILED"}, interval=0, timeout=5)


def test_wait_returns_on_success() -> None:
    client = fw.Client(account="acct", key="fw_test")
    assert client.wait(lambda: {"state": "JOB_STATE_COMPLETED"}, interval=0)["state"]
