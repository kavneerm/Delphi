"""Tests for the bucket auditor. No AWS: the S3 cases run against a fake client.

The good-key fixtures are the exact strings the other agents' key builders produce
(`engine/log.py:log_key`, `gen/storage.py:lake_key/_index/_judge`), so if the auditor
and a real writer ever disagree, this is where it shows.
"""

from __future__ import annotations

from typing import Any

import pytest

from infra import audit
from infra.storage import METADATA_KEYS

EPISODE = "g5_lowconf_auc-1041-3f9a2b71"
RUN = "qwen25_7b-r32-e3-filter_v2-a71c04"
SWEEP = "sweep-20260906-01"
EVAL = "eval-20260906-01"

GOOD_KEYS = [
    # engine/log.py: logs/<env>/<lake>/<scenario>/seed=<seed>/<episode>.jsonl
    f"logs/env_v1/lake_v1/g5_lowconf_auc/seed=1041/{EPISODE}.jsonl",
    f"logs/env_v1_perturbed/lake_v1/g5_lowconf_auc/seed=1041/{EPISODE}.jsonl",
    # gen/storage.py
    f"lake/lake_v1/env_v1/spec_v1/g5_lowconf_auc/seed=1041/{EPISODE}.jsonl",
    f"lake/lake_v1/_index/{EPISODE}.json",
    f"lake/lake_v1/_judge/judge_v2/{EPISODE}.jsonl",
    # specs
    "specs/spec_v1/train/northern_fleet_cautious.json",
    "specs/spec_v1/holdout/kremlin-escalatory.json",
    "specs/spec_v1/devset/storm_only_01.json",
    "specs/spec_v1/exemplars/petrov_1983.md",
    "specs/spec_v1/manifest.json",
    # runs, checkpoints, validation
    f"runs/{SWEEP}/{RUN}/dataset_filter_v2.jsonl",
    f"runs/{SWEEP}/{RUN}/manifest.json",
    f"runs/{SWEEP}/{RUN}/gates.json",
    f"runs/{SWEEP}/{RUN}/devset_table.md",
    f"runs/{SWEEP}/summary.md",
    f"checkpoints/{RUN}/provider.json",
    f"checkpoints/{RUN}/patches.md",
    f"checkpoints/{RUN}/adapter/adapter_model.safetensors",
    f"validation/{EVAL}/final_report.md",
    f"validation/{EVAL}/heatmap.csv",
    f"validation/{EVAL}/replay_kosmos_v2.json",
    f"validation/{EVAL}/holdout_mix_escalatory.json",
    f"validation/{EVAL}/perturbation.json",
    f"validation/{EVAL}/figures/action_mix.png",
]


@pytest.mark.parametrize("key", GOOD_KEYS)
def test_contract_keys_pass(key: str) -> None:
    assert audit.key_findings(key) == [], key


@pytest.mark.parametrize(
    "key,section",
    [
        ("smoke/qwen25_7b.json", "1"),  # already in the local mirror today
        ("tmp/smoke-llama31-8b-20260906t014309z.jsonl", "1"),
        ("lake_v1/whatever.jsonl", "1"),
        (f"lake/lake_v1/env_v1/spec_v1/g5/seed=1041/{EPISODE}.json", "3"),  # .json not .jsonl
        ("lake/lakev1/env_v1/spec_v1/g5/seed=1041/x.jsonl", "3"),  # malformed version
        (f"logs/env_v1/lake_v1/g5/1041/{EPISODE}.jsonl", "3"),  # missing seed= partition
        ("specs/spec_v1/train/spec.yaml", "3"),
        (f"runs/sweep-2026096-01/{RUN}/gates.json", "3"),  # 7-digit date
        (f"checkpoints/{RUN}/adapter", "3"),  # a prefix, not an object under it
        (f"validation/{EVAL}/figures/plot.svg", "3"),
    ],
)
def test_out_of_contract_keys_are_caught(key: str, section: str) -> None:
    findings = audit.key_findings(key)
    assert findings, f"{key} should have been flagged"
    assert findings[0].section == section


def test_prefix_markers_are_exempt() -> None:
    for prefix in ("specs", "lake", "runs", "checkpoints", "validation", "logs"):
        assert audit.key_findings(f"{prefix}/.keep") == []


def test_transient_parts_are_recognised_not_flagged() -> None:
    # gen/storage.py writes one object per decision and deletes them at episode close.
    key = f"lake/lake_v1/_parts/{EPISODE}/00007-rec-abc123.json"
    assert audit.TRANSIENT.match(key)


def test_a_local_sidecar_in_the_bucket_is_a_finding() -> None:
    # engine/ and gen/ write <key>.meta.json beside the object in the local mirror.
    key = f"lake/lake_v1/env_v1/spec_v1/g5/seed=1041/{EPISODE}.jsonl.meta.json"
    findings = audit.key_findings(key)
    assert findings and "sidecar" in findings[0].problem


# --------------------------------------------------------------------- metadata


def full_metadata(**over: str) -> dict[str, str]:
    meta = dict.fromkeys(METADATA_KEYS, "")
    meta["contracts-version"] = "contracts_v1"
    meta.update(over)
    return meta


def test_complete_metadata_passes() -> None:
    key = f"lake/lake_v1/env_v1/spec_v1/g5/seed=1041/{EPISODE}.jsonl"
    meta = full_metadata(env_version="", lake_version="lake_v1", spec_version="spec_v1")
    assert audit.metadata_findings(key, meta) == []


def test_missing_metadata_keys_are_caught() -> None:
    # engine/storage.py's put_text permits metadata=None; §4 calls that out of contract.
    findings = audit.metadata_findings("specs/spec_v1/manifest.json", {})
    assert findings
    assert "missing" in findings[0].problem


def test_a_malformed_version_string_is_caught() -> None:
    meta = full_metadata(**{"lake-version": "lakev1"})
    findings = audit.metadata_findings("specs/spec_v1/manifest.json", meta)
    assert any(f.section == "2" for f in findings)


def test_metadata_that_contradicts_the_key_is_caught() -> None:
    key = f"lake/lake_v1/env_v1/spec_v1/g5/seed=1041/{EPISODE}.jsonl"
    meta = full_metadata(**{"lake-version": "lake_v9"})
    findings = audit.metadata_findings(key, meta)
    assert any("disagrees" in f.problem for f in findings)


def test_content_type_mismatch_is_caught() -> None:
    key = f"lake/lake_v1/env_v1/spec_v1/g5/seed=1041/{EPISODE}.jsonl"
    assert audit.content_type_findings(key, "application/x-ndjson") == []
    findings = audit.content_type_findings(key, "application/json")
    assert findings and findings[0].section == "5"


def test_content_type_ignores_parameters() -> None:
    key = "runs/sweep-20260906-01/summary.md"
    assert audit.content_type_findings(key, "text/markdown; charset=utf-8") == []


def test_untagged_object_is_caught() -> None:
    assert audit.tag_findings("specs/spec_v1/manifest.json", {"project": "svalbard"}) == []
    assert audit.tag_findings("specs/spec_v1/manifest.json", {})


# ----------------------------------------------------------------- fake client


class FakeS3:
    """Just enough S3 for audit_s3: a paginator, head_object and get_object_tagging."""

    def __init__(self, objects: dict[str, dict[str, Any]]) -> None:
        self.objects = objects

    def get_paginator(self, _name: str) -> Any:
        objects = self.objects

        class Paginator:
            def paginate(self, **kwargs: Any):
                prefix = kwargs.get("Prefix", "")
                yield {"Contents": [{"Key": k} for k in sorted(objects) if k.startswith(prefix)]}

        return Paginator()

    def head_object(self, Bucket: str, Key: str) -> dict[str, Any]:  # noqa: N803
        obj = self.objects[Key]
        return {"Metadata": obj.get("metadata", {}), "ContentType": obj.get("content_type", "")}

    def get_object_tagging(self, Bucket: str, Key: str) -> dict[str, Any]:  # noqa: N803
        tags = self.objects[Key].get("tags", {})
        return {"TagSet": [{"Key": k, "Value": v} for k, v in tags.items()]}


def conformant(key: str, **meta: str) -> dict[str, Any]:
    from infra.storage import content_type_for

    return {
        "metadata": full_metadata(**meta),
        "content_type": content_type_for(key),
        "tags": {"project": "svalbard"},
    }


def test_a_clean_bucket_audits_clean() -> None:
    keys = {
        "specs/.keep": conformant("specs/.keep"),
        "specs/spec_v1/manifest.json": conformant("specs/spec_v1/manifest.json"),
        f"lake/lake_v1/_parts/{EPISODE}/00001-r.json": conformant("x.json"),
    }
    result = audit.audit_s3(FakeS3(keys), "svalbard-wargame")
    assert result.ok
    assert result.checked == 1
    assert result.exempt == 1
    assert result.transient == 1
    assert "1 transient" in result.render()


def test_a_dirty_bucket_reports_every_problem() -> None:
    keys = {
        "smoke/x.json": {"metadata": {}, "content_type": "application/json", "tags": {}},
        "specs/spec_v1/manifest.json": {
            "metadata": full_metadata(),
            "content_type": "text/plain",
            "tags": {"project": "svalbard"},
        },
    }
    result = audit.audit_s3(FakeS3(keys), "svalbard-wargame")
    assert not result.ok
    sections = {f.section for f in result.findings}
    assert {"1", "4", "5"} <= sections
    assert "out of contract" in result.render()


def test_exit_code_follows_the_findings(monkeypatch: pytest.MonkeyPatch, tmp_path: Any) -> None:
    (tmp_path / "specs" / "spec_v1").mkdir(parents=True)
    (tmp_path / "specs" / "spec_v1" / "manifest.json").write_text("{}")
    monkeypatch.setenv("WARGAME_LOCAL_ROOT", str(tmp_path))
    assert audit.main(["--local"]) == 0

    (tmp_path / "smoke").mkdir()
    (tmp_path / "smoke" / "x.json").write_text("{}")
    assert audit.main(["--local"]) == 1


# ------------------------------------------------------------------- selftest


def test_the_probe_key_is_itself_in_contract() -> None:
    # The point of the probe key: it needs no exemption from the auditor, and no
    # seventh prefix, because it satisfies the §3 logs/ template exactly.
    from infra.selftest import probe_episode_id, probe_key

    key = probe_key(probe_episode_id("deadbeef"))
    assert key == "logs/env_v0/lake_v0/selftest/seed=0/selftest-0-deadbeef.jsonl"
    assert audit.key_findings(key) == []


def test_the_probe_key_is_unique_per_run() -> None:
    from infra.selftest import probe_episode_id

    assert probe_episode_id() != probe_episode_id()


def test_the_ad_hoc_probe_keys_other_agents_used_were_not_in_contract() -> None:
    # Recovered from the bucket's version history: both were written to live S3 and
    # then deleted. This is the regression the shared probe key exists to prevent.
    assert audit.key_findings("runs/_selftest/agent4-train/probe.json")
    # gen's probe went under _parts/, which is transient rather than a finding.
    assert audit.TRANSIENT.match(
        "lake/lake_v1/_parts/storage-selftest-0000/00000-storage-selftest-0000-nsc-0.json"
    )


def test_selftest_round_trips_on_the_local_mirror(tmp_path: Any) -> None:
    from infra.selftest import run
    from infra.storage import Storage

    store = Storage(local_root=tmp_path)
    checks = run(store)
    assert all(c.ok for c in checks), [str(c) for c in checks if not c.ok]
    assert list(store.list("logs/")) == [], "the probe should have been cleaned up"


def test_selftest_keep_leaves_the_probe(tmp_path: Any) -> None:
    from infra.selftest import run
    from infra.storage import Storage

    store = Storage(local_root=tmp_path)
    checks = run(store, keep=True)
    assert all(c.ok for c in checks)
    assert len(list(store.list("logs/"))) == 1
