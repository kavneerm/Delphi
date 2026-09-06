"""Tests for infra/. None of them touch AWS.

The provisioning script is verified against AWS by running it twice and seeing zero
changes on the second run (recorded in infra/REPORT.md); what is worth testing here
is the part that is easy to get quietly wrong: the shape of the IAM policy, the
prefix list agreeing with the contract, and the object metadata every writer depends on.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import pytest

from infra import bootstrap
from infra.storage import (
    METADATA_KEYS,
    PROJECT_TAG,
    Storage,
    Versions,
    content_type_for,
    contract_prefix_of,
    resolve_backend,
)

REPO = Path(__file__).resolve().parents[2]
CONTRACT = REPO / "contracts" / "s3_layout.md"
INFRA = REPO / "infra"


# ------------------------------------------------------------------- prefixes


def contract_prefixes() -> set[str]:
    """The prefixes the contract's §1 table declares, read out of the contract itself."""
    text = CONTRACT.read_text()
    section = text.split("## 1. Prefixes", 1)[1].split("## 2.", 1)[0]
    return set(re.findall(r"^\| `([a-z_]+/)` \|", section, flags=re.MULTILINE))


def test_bootstrap_prefixes_match_the_contract() -> None:
    assert set(bootstrap.PREFIXES) == contract_prefixes()


def test_exactly_six_prefixes() -> None:
    # "Nothing else goes in the bucket. A seventh prefix is a contract change."
    assert len(bootstrap.PREFIXES) == 6


# ------------------------------------------------------------------------ iam


def test_policy_is_scoped_to_one_bucket() -> None:
    policy = bootstrap.s3_access_policy("svalbard-wargame")
    resources = {
        r
        for stmt in policy["Statement"]
        for r in ([stmt["Resource"]] if isinstance(stmt["Resource"], str) else stmt["Resource"])
    }
    assert resources == {"arn:aws:s3:::svalbard-wargame", "arn:aws:s3:::svalbard-wargame/*"}
    assert "*" not in resources


def test_policy_grants_nothing_outside_s3() -> None:
    policy = bootstrap.s3_access_policy("b")
    actions = {
        a
        for stmt in policy["Statement"]
        for a in ([stmt["Action"]] if isinstance(stmt["Action"], str) else stmt["Action"])
    }
    assert all(a.startswith("s3:") for a in actions), actions


def test_policy_denies_deleting_the_bucket() -> None:
    denies = [s for s in bootstrap.s3_access_policy("b")["Statement"] if s["Effect"] == "Deny"]
    assert denies, "a bucket-scoped role should still not be able to delete the bucket"
    assert "s3:DeleteBucket" in denies[0]["Action"]


def test_trust_policy_allows_ec2_and_the_account() -> None:
    trust = bootstrap.trust_policy("944002752544")
    principals = [s["Principal"] for s in trust["Statement"]]
    assert {"Service": "ec2.amazonaws.com"} in principals
    assert {"AWS": "arn:aws:iam::944002752544:root"} in principals


def test_iam_names_fit_the_pubdef_grant() -> None:
    # The panoptes identity may only write IAM on `pubdef-*` names; a rename that
    # forgets the prefix fails at 2 a.m. against AWS instead of here.
    assert bootstrap.ROLE_NAME.startswith("pubdef-")
    assert bootstrap.INSTANCE_PROFILE_NAME.startswith("pubdef-")


def test_arns_are_well_formed() -> None:
    assert bootstrap.bucket_arn("svalbard-wargame") == "arn:aws:s3:::svalbard-wargame"
    assert bootstrap.role_arn("944002752544").startswith("arn:aws:iam::944002752544:role/")


# ----------------------------------------------------------------------- plan


def test_plan_separates_changed_from_unchanged() -> None:
    plan = bootstrap.Plan()
    plan.record(True, "made a thing")
    plan.record(False, "thing already there")
    assert plan.changed == ["made a thing"]
    assert plan.unchanged == ["thing already there"]
    assert "would change: made a thing" in plan.render(dry_run=True)
    assert "changed: made a thing" in plan.render(dry_run=False)


def test_bucket_name_prefers_the_argument_then_the_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WARGAME_BUCKET", "from-env")
    assert bootstrap.bucket_name("explicit") == "explicit"
    assert bootstrap.bucket_name() == "from-env"
    monkeypatch.delenv("WARGAME_BUCKET")
    with pytest.raises(KeyError):  # contracts/s3_layout.md §1: KeyError is correct
        bootstrap.bucket_name()


# -------------------------------------------------------------------- storage


def test_content_types_follow_the_contract() -> None:
    # §5: "JSONL is application/x-ndjson, not application/json".
    assert content_type_for("lake/l/e/s/sc/seed=1/ep.jsonl") == "application/x-ndjson"
    assert content_type_for("runs/s/r/manifest.json") == "application/json"
    assert content_type_for("runs/s/summary.md") == "text/markdown"
    assert content_type_for("validation/e/heatmap.csv") == "text/csv"
    assert content_type_for("validation/e/figures/x.png") == "image/png"


def test_every_contract_metadata_key_is_always_present() -> None:
    meta = Versions(env_version="env_v1", commit="abc1234").to_metadata()
    assert set(meta) == set(METADATA_KEYS)
    assert meta["contracts-version"] == "contracts_v1"
    assert meta["lake-version"] == ""  # "" means not applicable; the key still exists
    assert meta["git-commit"] == "abc1234"


def test_seed_is_stringified() -> None:
    assert Versions(seed=1041, commit="c").to_metadata()["seed"] == "1041"
    assert Versions(commit="c").to_metadata()["seed"] == ""


def test_require_rejects_an_untraceable_object() -> None:
    versions = Versions(env_version="env_v1", commit="c")
    versions.require("env_version")
    with pytest.raises(ValueError, match="lake_version"):
        versions.require("env_version", "lake_version")


def test_local_mirror_roundtrip(tmp_path: Path) -> None:
    store = Storage(local_root=tmp_path)
    key = "lake/lake_v1/env_v1/spec_v1/g5_lowconf_auc/seed=1041/ep-1041-3f9a2b71.jsonl"
    versions = Versions(
        env_version="env_v1",
        spec_version="spec_v1",
        lake_version="lake_v1",
        seed=1041,
        episode_id="g5_lowconf_auc-1041-3f9a2b71",
        commit="deadbee",
    )
    store.put_jsonl(key, [{"a": 1}, {"b": 2}], versions=versions, require=("lake_version",))

    assert store.exists(key)
    assert store.get_jsonl(key) == [{"a": 1}, {"b": 2}]
    assert store.head(key)["episode-id"] == "g5_lowconf_auc-1041-3f9a2b71"
    assert store.head(key)["git-commit"] == "deadbee"
    assert list(store.list("lake/")) == [key]
    assert list(store.list("runs/")) == []


def test_local_listing_hides_the_metadata_sidecar(tmp_path: Path) -> None:
    store = Storage(local_root=tmp_path)
    store.put_json("runs/sweep-20260906-01/summary.json", {"ok": True}, versions=Versions())
    assert list(store.list("")) == ["runs/sweep-20260906-01/summary.json"]


def test_storage_needs_exactly_one_backend(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        Storage()
    with pytest.raises(ValueError):
        Storage(bucket="b", local_root=tmp_path)


def test_from_env_switches_on_one_variable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WARGAME_BUCKET", "svalbard-wargame")
    monkeypatch.delenv("WARGAME_STORAGE", raising=False)
    assert Storage.from_env().is_local is False

    monkeypatch.setenv("WARGAME_STORAGE", "local")
    monkeypatch.setenv("WARGAME_LOCAL_ROOT", "/tmp/mirror")
    local = Storage.from_env()
    assert local.is_local and str(local.local_root) == "/tmp/mirror"


def test_uris_are_identical_across_backends(monkeypatch: pytest.MonkeyPatch) -> None:
    key = "checkpoints/qwen25_7b-r32-e3-filter_v2-a71c04/provider.json"
    assert Storage(bucket="svalbard-wargame").uri(key) == f"s3://svalbard-wargame/{key}"
    assert Storage(local_root="/m").uri(key) == f"/m/{key}"


def test_the_project_tag_is_the_one_teardown_keys_on() -> None:
    assert PROJECT_TAG == "project=svalbard"
    assert f"{bootstrap.PROJECT_TAG_KEY}={bootstrap.PROJECT_TAG_VALUE}" == PROJECT_TAG


# ------------------------------------------------------------------- scripts


SCRIPTS = ["teardown.sh", "provision_gpu.sh", "gpu_setup.sh", "serve_vllm.sh"]


@pytest.mark.parametrize("name", SCRIPTS)
def test_scripts_are_executable_and_parse(name: str) -> None:
    path = INFRA / name
    assert path.stat().st_mode & 0o111, f"{name} is not executable"
    subprocess.run(["bash", "-n", str(path)], check=True)


@pytest.mark.parametrize("name", SCRIPTS)
def test_scripts_are_strict(name: str) -> None:
    assert "set -euo pipefail" in (INFRA / name).read_text()


def test_teardown_is_not_destructive_without_yes() -> None:
    text = (INFRA / "teardown.sh").read_text()
    assert "--yes" in text
    assert "CONFIRMED=0" in text  # opt-in, not opt-out
    assert "Name=tag:${TAG_KEY},Values=${TAG_VALUE}" in text  # tag-keyed, not blanket


def test_provision_gpu_gates_on_the_quota() -> None:
    text = (INFRA / "provision_gpu.sh").read_text()
    assert "L-DB2E81BA" in text
    assert "312f3b0f78754d25920d9b0f6482d2feWs3fPUjY" in text
    assert "--launch" in text  # even a satisfied quota needs an explicit flag


def test_no_secrets_or_hardcoded_bucket_defaults_in_module_bodies() -> None:
    # §1: the bucket comes from WARGAME_BUCKET; §5: no keys, ever.
    for path in [INFRA / "bootstrap.py", INFRA / "storage.py"]:
        text = path.read_text()
        assert "AKIA" not in text
        assert 'os.environ.get("WARGAME_BUCKET"' not in text, "a default would hide a misconfig"


def test_no_bucket_policy_is_written(tmp_path: Path) -> None:
    # Public access is blocked at the bucket; nothing in infra/ should add a policy.
    assert "put_bucket_policy" not in (INFRA / "bootstrap.py").read_text()


def test_lifecycle_rules_only_expire_old_versions_not_live_objects() -> None:
    for rule in bootstrap.LIFECYCLE_RULES:
        assert "Expiration" not in rule, f"{rule['ID']} would delete live objects"
        assert rule["Status"] == "Enabled"
    ids = {r["ID"] for r in bootstrap.LIFECYCLE_RULES}
    assert ids == {"abort-incomplete-multipart-7d", "expire-noncurrent-30d"}


def test_bootstrap_help_does_not_need_aws() -> None:
    proc = subprocess.run(
        [sys.executable, "-m", "infra.bootstrap", "--help"],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0
    assert "--dry-run" in proc.stdout


def test_report_records_the_arns() -> None:
    report = (INFRA / "REPORT.md").read_text()
    assert "arn:aws:s3:::svalbard-wargame" in report
    assert "312f3b0f78754d25920d9b0f6482d2feWs3fPUjY" in report


# ------------------------------------------------- the one-helper adjudication


def test_backend_defaults_to_s3_when_nothing_is_set() -> None:
    # Every agent has its own worktree and therefore its own ./.wargame-local; the
    # bucket is the only storage they share. Unset must not mean "private lake".
    assert resolve_backend({}) == "s3"


@pytest.mark.parametrize("name", ["WARGAME_STORAGE", "WARGAME_BACKEND"])
def test_either_spelling_selects_the_backend(name: str) -> None:
    # engine/storage.py reads WARGAME_STORAGE, gen/storage.py reads WARGAME_BACKEND.
    assert resolve_backend({name: "local"}) == "local"
    assert resolve_backend({name: "s3"}) == "s3"
    assert resolve_backend({name: "S3"}) == "s3"


def test_agreeing_spellings_are_fine() -> None:
    assert resolve_backend({"WARGAME_STORAGE": "local", "WARGAME_BACKEND": "local"}) == "local"


def test_disagreeing_spellings_refuse_to_guess() -> None:
    with pytest.raises(ValueError, match="ambiguous"):
        resolve_backend({"WARGAME_STORAGE": "s3", "WARGAME_BACKEND": "local"})


def test_an_unknown_backend_value_is_an_error() -> None:
    with pytest.raises(ValueError, match="WARGAME_STORAGE"):
        resolve_backend({"WARGAME_STORAGE": "bucket"})


def test_empty_string_counts_as_unset() -> None:
    assert resolve_backend({"WARGAME_STORAGE": "", "WARGAME_BACKEND": "local"}) == "local"


@pytest.mark.parametrize("prefix", list(bootstrap.PREFIXES))
def test_contract_prefixes_are_recognised(prefix: str) -> None:
    assert contract_prefix_of(f"{prefix}anything/at/all.json") == prefix


def test_a_seventh_prefix_is_refused_on_s3(monkeypatch: pytest.MonkeyPatch) -> None:
    # A local smoke run that writes smoke/ or tmp/ must not become a seventh bucket
    # prefix the day someone flips the backend.
    store = Storage(bucket="svalbard-wargame")
    with pytest.raises(ValueError, match="seventh prefix"):
        store.put_text("smoke/qwen25_7b.json", "{}", versions=Versions())
    assert contract_prefix_of("smoke/x.json") is None
    assert contract_prefix_of("tmp/x.jsonl") is None


def test_the_local_mirror_is_scratch_and_takes_any_key(tmp_path: Path) -> None:
    store = Storage(local_root=tmp_path)
    store.put_text("smoke/x.json", "{}", versions=Versions())
    assert store.exists("smoke/x.json")


def test_strict_prefixes_can_be_waived_for_an_approved_prefix() -> None:
    store = Storage(bucket="b", strict_prefixes=False)
    assert store.strict_prefixes is False


def test_the_boolean_local_flag_is_honoured() -> None:
    # train/storage.py used WARGAME_LOCAL=1 before the shared helper existed; a caller
    # with it set must not get S3 from from_env() while train/ gets the mirror.
    assert resolve_backend({"WARGAME_LOCAL": "1"}) == "local"
    assert resolve_backend({"WARGAME_LOCAL": "true"}) == "local"


@pytest.mark.parametrize("falsey", ["", "0", "false", "no", "off"])
def test_a_falsey_local_flag_is_not_a_vote(falsey: str) -> None:
    assert resolve_backend({"WARGAME_LOCAL": falsey}) == "s3"
    assert resolve_backend({"WARGAME_LOCAL": falsey, "WARGAME_BACKEND": "s3"}) == "s3"


def test_the_local_flag_can_also_disagree() -> None:
    with pytest.raises(ValueError, match="ambiguous"):
        resolve_backend({"WARGAME_LOCAL": "1", "WARGAME_STORAGE": "s3"})


def test_all_three_spellings_agreeing_is_fine() -> None:
    env = {"WARGAME_LOCAL": "1", "WARGAME_STORAGE": "local", "WARGAME_BACKEND": "local"}
    assert resolve_backend(env) == "local"
