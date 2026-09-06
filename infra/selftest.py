"""Verify the live S3 write path end to end, and leave nothing behind.

Three agents have now checked that they can really write to the bucket, each with an
ad-hoc probe key of its own invention, and the version history shows what that costs:
`runs/_selftest/agent4-train/probe.json` is under no key template §3 allows, and every
one of the probes was removed with a plain delete, so a versioned bucket kept both a
noncurrent version and a delete marker for each.

This is that check, done once, properly:

    AWS_PROFILE=panoptes WARGAME_BUCKET=svalbard-wargame python -m infra.selftest

The probe key is deliberately a **contract-valid** one —
`logs/env_v0/lake_v0/selftest/seed=0/selftest-0-<8 hex>.jsonl` matches the §3 logs
template exactly — so it needs no exemption from `infra/audit.py` and no seventh
prefix. It is removed by version id rather than by a plain delete, so it leaves no
delete marker and no noncurrent version: run it as often as you like and
`aws s3 ls --recursive` is unchanged afterwards.

What it proves, which a local-mirror test cannot: credentials and region resolve, the
bucket policy admits a write, the nine metadata keys survive a round trip through
`x-amz-meta-*`, the content type is stored as sent, the `project=svalbard` tag is
attached (so `infra/teardown.sh` will find the object), the bytes come back
unchanged, and the delete path works.
"""

from __future__ import annotations

import argparse
import os
import sys
import uuid
from dataclasses import dataclass

from infra.storage import METADATA_KEYS, Storage, Versions, content_type_for

PROBE_ENV_VERSION = "env_v0"  # the scaffold placeholder: this is not a result
PROBE_LAKE_VERSION = "lake_v0"
PROBE_SCENARIO = "selftest"
PROBE_SEED = 0


def probe_episode_id(nonce: str | None = None) -> str:
    """`<scenario_id>-<seed>-<8 hex>`, the §3 episode id convention."""
    return f"{PROBE_SCENARIO}-{PROBE_SEED}-{nonce or uuid.uuid4().hex[:8]}"


def probe_key(episode_id: str) -> str:
    """A key that satisfies the §3 `logs/` template, so the probe is never a finding."""
    return (
        f"logs/{PROBE_ENV_VERSION}/{PROBE_LAKE_VERSION}/{PROBE_SCENARIO}/"
        f"seed={PROBE_SEED}/{episode_id}.jsonl"
    )


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""

    def __str__(self) -> str:
        mark = "ok  " if self.ok else "FAIL"
        return f"  {mark}  {self.name}{f'  — {self.detail}' if self.detail else ''}"


def run(store: Storage, *, keep: bool = False) -> list[Check]:
    episode_id = probe_episode_id()
    key = probe_key(episode_id)
    body = b'{"probe":true}\n'
    versions = Versions(
        env_version=PROBE_ENV_VERSION,
        lake_version=PROBE_LAKE_VERSION,
        seed=PROBE_SEED,
        episode_id=episode_id,
    )
    checks: list[Check] = []

    uri = store.put_bytes(key, body, versions=versions, require=("env_version",))
    checks.append(Check("write", True, uri))

    metadata = store.head(key)
    missing = [k for k in METADATA_KEYS if k not in metadata]
    checks.append(
        Check(
            "metadata round trip",
            not missing,
            f"all {len(METADATA_KEYS)} keys survived" if not missing else f"missing {missing}",
        )
    )
    checks.append(
        Check(
            "version tags",
            metadata.get("env-version") == PROBE_ENV_VERSION
            and metadata.get("contracts-version", "") != "",
            f"env-version={metadata.get('env-version')!r} "
            f"contracts-version={metadata.get('contracts-version')!r}",
        )
    )

    read_back = store.get_bytes(key)
    checks.append(Check("bytes round trip", read_back == body, f"{len(read_back)} bytes"))

    if not store.is_local:
        client = store.client
        head = client.head_object(Bucket=store.bucket, Key=key)
        expected_type = content_type_for(key)
        actual_type = str(head.get("ContentType", ""))
        checks.append(Check("content type", actual_type == expected_type, f"{actual_type!r} (§5)"))

        tags = {
            t["Key"]: t["Value"]
            for t in client.get_object_tagging(Bucket=store.bucket, Key=key).get("TagSet", [])
        }
        checks.append(
            Check(
                "cost tag",
                tags.get("project") == "svalbard",
                f"{tags or 'none'} — infra/teardown.sh keys on this",
            )
        )

    checks.append(Check("key is in contract", _key_is_in_contract(key), key))

    if keep:
        checks.append(Check("cleanup", True, "skipped (--keep); delete it yourself"))
        return checks

    checks += _cleanup(store, key)
    return checks


def _key_is_in_contract(key: str) -> bool:
    from infra.audit import key_findings

    return not key_findings(key)


def _cleanup(store: Storage, key: str) -> list[Check]:
    """Remove the probe without leaving a delete marker or a noncurrent version."""
    if store.is_local:
        from pathlib import Path

        assert store.local_root is not None
        for path in (Path(store.local_root) / key, store._meta_path(key)):
            if path.is_file():
                path.unlink()
        return [Check("cleanup", not store.exists(key), "probe removed from the mirror")]

    client = store.client
    listed = client.list_object_versions(Bucket=store.bucket, Prefix=key)
    version_ids = [v["VersionId"] for v in listed.get("Versions", [])]
    marker_ids = [m["VersionId"] for m in listed.get("DeleteMarkers", [])]
    for version_id in version_ids + marker_ids:
        client.delete_object(Bucket=store.bucket, Key=key, VersionId=version_id)

    after = client.list_object_versions(Bucket=store.bucket, Prefix=key)
    residue = len(after.get("Versions", [])) + len(after.get("DeleteMarkers", []))
    return [
        Check(
            "cleanup leaves no trace",
            residue == 0,
            f"purged {len(version_ids)} version(s) by id, no delete marker written",
        )
    ]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--bucket", default=None, help="default: $WARGAME_BUCKET")
    parser.add_argument("--profile", default=os.environ.get("AWS_PROFILE", "panoptes"))
    parser.add_argument("--region", default=os.environ.get("AWS_REGION", "us-east-1"))
    parser.add_argument("--local", action="store_true", help="probe the local mirror instead")
    parser.add_argument("--keep", action="store_true", help="leave the probe object behind")
    args = parser.parse_args(argv)

    if args.local:
        store: Storage = Storage(local_root=os.environ.get("WARGAME_LOCAL_ROOT", ".wargame-local"))
        where = str(store.local_root)
    else:
        bucket = args.bucket or os.environ["WARGAME_BUCKET"]
        import boto3

        store = Storage(
            bucket=bucket,
            session=boto3.Session(profile_name=args.profile, region_name=args.region),
            region=args.region,
        )
        where = f"s3://{bucket}"

    print(f"live write-path self test against {where}\n")
    checks = run(store, keep=args.keep)
    for check in checks:
        print(check)
    failed = [c for c in checks if not c.ok]
    print(f"\n{len(checks) - len(failed)}/{len(checks)} checks passed")
    if not failed and not args.keep:
        print("bucket is byte-for-byte unchanged: no object, no version, no delete marker.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
