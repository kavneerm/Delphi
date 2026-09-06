"""Idempotent provisioning of the svalbard-wargame S3 bucket and its IAM role.

Run it as often as you like: every step is a converge-to-desired-state step, so a
second run makes no changes and exits 0.

    AWS_PROFILE=panoptes python -m infra.bootstrap            # converge
    AWS_PROFILE=panoptes python -m infra.bootstrap --dry-run  # show the plan only
    AWS_PROFILE=panoptes python -m infra.bootstrap --verify   # report state, change nothing

The bucket name comes from WARGAME_BUCKET (contracts/s3_layout.md §1); there is no
hardcoded default anywhere in the module body.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import dataclass, field
from typing import Any

import boto3
from botocore.exceptions import ClientError

PROJECT_TAG_KEY = "project"
PROJECT_TAG_VALUE = "svalbard"

# The six prefixes of contracts/s3_layout.md §1. A seventh is a contract change.
PREFIXES: tuple[str, ...] = (
    "specs/",
    "lake/",
    "runs/",
    "checkpoints/",
    "validation/",
    "logs/",
)

# The `panoptes` identity carries PowerUserAccess plus `pubdef-iam-scoped`, which
# allows IAM writes only on roles and instance profiles named `pubdef-*`, and allows
# inline role policies (iam:PutRolePolicy) but not managed ones (no iam:CreatePolicy).
# Hence the prefix and the inline policy; see infra/REPORT.md.
ROLE_NAME = "pubdef-svalbard-wargame-node"
POLICY_NAME = "svalbard-wargame-s3-rw"  # inline, on the role above
INSTANCE_PROFILE_NAME = "pubdef-svalbard-wargame-node"

# Multipart uploads that never completed are invisible in `s3 ls` but still billed.
LIFECYCLE_RULES: list[dict[str, Any]] = [
    {
        "ID": "abort-incomplete-multipart-7d",
        "Status": "Enabled",
        "Filter": {"Prefix": ""},
        "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 7},
    },
    {
        # Versioning is on so an accidental overwrite is recoverable; the old
        # versions are cost, not data, after a month.
        "ID": "expire-noncurrent-30d",
        "Status": "Enabled",
        "Filter": {"Prefix": ""},
        "NoncurrentVersionExpiration": {"NoncurrentDays": 30},
    },
]


class BootstrapError(RuntimeError):
    """Provisioning could not converge (permissions, or a conflicting resource)."""


@dataclass
class Plan:
    """What a run did or would do, in order."""

    changed: list[str] = field(default_factory=list)
    unchanged: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)

    def record(self, did_change: bool, what: str) -> None:
        (self.changed if did_change else self.unchanged).append(what)

    def render(self, *, dry_run: bool) -> str:
        verb = "would change" if dry_run else "changed"
        lines = [f"{verb}: {item}" for item in self.changed]
        lines += [f"ok:      {item}" for item in self.unchanged]
        lines += [f"skipped: {item}" for item in self.skipped]
        return "\n".join(lines) if lines else "nothing to do"


def bucket_name(explicit: str | None = None) -> str:
    """The bucket from --bucket or WARGAME_BUCKET. KeyError is the correct failure."""
    if explicit:
        return explicit
    return os.environ["WARGAME_BUCKET"]


def account_id(session: boto3.Session) -> str:
    return str(session.client("sts").get_caller_identity()["Account"])


def bucket_arn(bucket: str) -> str:
    return f"arn:aws:s3:::{bucket}"


def role_arn(account: str, role_name: str = ROLE_NAME) -> str:
    return f"arn:aws:iam::{account}:role/{role_name}"


def s3_access_policy(bucket: str) -> dict[str, Any]:
    """Read/write on exactly one bucket, and nothing else in the account."""
    arn = bucket_arn(bucket)
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "ListTheBucket",
                "Effect": "Allow",
                "Action": ["s3:ListBucket", "s3:GetBucketLocation", "s3:ListBucketVersions"],
                "Resource": arn,
            },
            {
                "Sid": "ReadWriteObjects",
                "Effect": "Allow",
                "Action": [
                    "s3:GetObject",
                    "s3:GetObjectVersion",
                    "s3:GetObjectTagging",
                    "s3:PutObject",
                    "s3:PutObjectTagging",
                    "s3:AbortMultipartUpload",
                    "s3:ListMultipartUploadParts",
                    "s3:DeleteObject",
                ],
                "Resource": f"{arn}/*",
            },
            {
                "Sid": "NeverDeleteTheBucketItself",
                "Effect": "Deny",
                "Action": [
                    "s3:DeleteBucket",
                    "s3:PutBucketPolicy",
                    "s3:PutBucketPublicAccessBlock",
                ],
                "Resource": arn,
            },
        ],
    }


def trust_policy(account: str) -> dict[str, Any]:
    """Assumable by EC2 (the GPU/engine nodes) and by principals in this account."""
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "Ec2Nodes",
                "Effect": "Allow",
                "Principal": {"Service": "ec2.amazonaws.com"},
                "Action": "sts:AssumeRole",
            },
            {
                "Sid": "AccountPrincipals",
                "Effect": "Allow",
                "Principal": {"AWS": f"arn:aws:iam::{account}:root"},
                "Action": "sts:AssumeRole",
            },
        ],
    }


def _same_policy(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


# --------------------------------------------------------------------------- S3


def _bucket_exists(s3: Any, bucket: str) -> bool:
    try:
        s3.head_bucket(Bucket=bucket)
        return True
    except ClientError as exc:
        code = exc.response["Error"]["Code"]
        if code in ("404", "NoSuchBucket"):
            return False
        if code == "403":
            raise BootstrapError(
                f"bucket {bucket} exists but this identity cannot see it (403). "
                "Wrong account, or the name is taken globally."
            ) from exc
        raise


def ensure_bucket(s3: Any, bucket: str, region: str, plan: Plan, *, dry_run: bool) -> None:
    if _bucket_exists(s3, bucket):
        plan.record(False, f"s3 bucket {bucket} exists")
        return
    if not dry_run:
        # us-east-1 is the one region that rejects an explicit LocationConstraint.
        kwargs: dict[str, Any] = {"Bucket": bucket}
        if region != "us-east-1":
            kwargs["CreateBucketConfiguration"] = {"LocationConstraint": region}
        s3.create_bucket(**kwargs)
        s3.get_waiter("bucket_exists").wait(Bucket=bucket)
    plan.record(True, f"s3 bucket {bucket} created in {region}")


def ensure_public_access_block(s3: Any, bucket: str, plan: Plan, *, dry_run: bool) -> None:
    desired = {
        "BlockPublicAcls": True,
        "IgnorePublicAcls": True,
        "BlockPublicPolicy": True,
        "RestrictPublicBuckets": True,
    }
    try:
        current = s3.get_public_access_block(Bucket=bucket)["PublicAccessBlockConfiguration"]
    except ClientError:
        current = {}
    if current == desired:
        plan.record(False, "public access block (all four on)")
        return
    if not dry_run:
        s3.put_public_access_block(Bucket=bucket, PublicAccessBlockConfiguration=desired)
    plan.record(True, "public access block (all four on)")


def ensure_encryption(s3: Any, bucket: str, plan: Plan, *, dry_run: bool) -> None:
    try:
        rules = s3.get_bucket_encryption(Bucket=bucket)["ServerSideEncryptionConfiguration"][
            "Rules"
        ]
        algos = {r.get("ApplyServerSideEncryptionByDefault", {}).get("SSEAlgorithm") for r in rules}
    except ClientError:
        algos = set()
    if algos & {"AES256", "aws:kms"}:
        plan.record(False, f"default encryption ({sorted(a for a in algos if a)})")
        return
    if not dry_run:
        s3.put_bucket_encryption(
            Bucket=bucket,
            ServerSideEncryptionConfiguration={
                "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]
            },
        )
    plan.record(True, "default encryption (AES256)")


def ensure_versioning(s3: Any, bucket: str, plan: Plan, *, dry_run: bool) -> None:
    status = s3.get_bucket_versioning(Bucket=bucket).get("Status")
    if status == "Enabled":
        plan.record(False, "versioning enabled")
        return
    if not dry_run:
        s3.put_bucket_versioning(Bucket=bucket, VersioningConfiguration={"Status": "Enabled"})
    plan.record(True, "versioning enabled")


def ensure_bucket_tags(s3: Any, bucket: str, plan: Plan, *, dry_run: bool) -> None:
    try:
        current = {t["Key"]: t["Value"] for t in s3.get_bucket_tagging(Bucket=bucket)["TagSet"]}
    except ClientError:
        current = {}
    desired = dict(current)
    desired[PROJECT_TAG_KEY] = PROJECT_TAG_VALUE
    desired.setdefault("managed-by", "infra/bootstrap.py")
    if current == desired:
        plan.record(False, f"bucket tags {PROJECT_TAG_KEY}={PROJECT_TAG_VALUE}")
        return
    if not dry_run:
        s3.put_bucket_tagging(
            Bucket=bucket,
            Tagging={"TagSet": [{"Key": k, "Value": v} for k, v in sorted(desired.items())]},
        )
    plan.record(True, f"bucket tags {PROJECT_TAG_KEY}={PROJECT_TAG_VALUE}")


def ensure_lifecycle(s3: Any, bucket: str, plan: Plan, *, dry_run: bool) -> None:
    try:
        current = s3.get_bucket_lifecycle_configuration(Bucket=bucket)["Rules"]
    except ClientError:
        current = []
    have = {r["ID"] for r in current}
    want = {r["ID"] for r in LIFECYCLE_RULES}
    if want <= have:
        plan.record(False, f"lifecycle rules {sorted(want)}")
        return
    merged = [r for r in current if r["ID"] not in want] + LIFECYCLE_RULES
    if not dry_run:
        s3.put_bucket_lifecycle_configuration(
            Bucket=bucket, LifecycleConfiguration={"Rules": merged}
        )
    plan.record(True, f"lifecycle rules {sorted(want)}")


def ensure_prefix_markers(s3: Any, bucket: str, plan: Plan, *, dry_run: bool) -> None:
    """A zero-byte `<prefix>.keep` per contract prefix, so the layout is discoverable.

    S3 prefixes are virtual, so this is documentation rather than structure; it makes
    `aws s3 ls s3://$WARGAME_BUCKET/` show the six-prefix contract on an empty bucket.
    """
    for prefix in PREFIXES:
        key = f"{prefix}.keep"
        try:
            s3.head_object(Bucket=bucket, Key=key)
            plan.record(False, f"prefix marker {key}")
            continue
        except ClientError as exc:
            if exc.response["Error"]["Code"] not in ("404", "NoSuchKey"):
                raise
        if not dry_run:
            s3.put_object(
                Bucket=bucket,
                Key=key,
                Body=b"",
                ContentType="text/plain",
                Tagging=f"{PROJECT_TAG_KEY}={PROJECT_TAG_VALUE}",
            )
        plan.record(True, f"prefix marker {key}")


# -------------------------------------------------------------------------- IAM


def ensure_role(iam: Any, account: str, plan: Plan, *, dry_run: bool) -> str:
    desired_trust = trust_policy(account)
    try:
        role = iam.get_role(RoleName=ROLE_NAME)["Role"]
        if _same_policy(role["AssumeRolePolicyDocument"], desired_trust):
            plan.record(False, f"iam role {ROLE_NAME} trust policy")
        else:
            if not dry_run:
                iam.update_assume_role_policy(
                    RoleName=ROLE_NAME, PolicyDocument=json.dumps(desired_trust)
                )
            plan.record(True, f"iam role {ROLE_NAME} trust policy updated")
    except ClientError as exc:
        if exc.response["Error"]["Code"] != "NoSuchEntity":
            raise
        if not dry_run:
            iam.create_role(
                RoleName=ROLE_NAME,
                AssumeRolePolicyDocument=json.dumps(desired_trust),
                Description="Svalbard wargame compute: S3 read/write scoped to one bucket.",
                MaxSessionDuration=43200,
                Tags=[{"Key": PROJECT_TAG_KEY, "Value": PROJECT_TAG_VALUE}],
            )
            iam.get_waiter("role_exists").wait(RoleName=ROLE_NAME)
        plan.record(True, f"iam role {ROLE_NAME} created")
    return role_arn(account)


def ensure_role_policy(iam: Any, bucket: str, plan: Plan, *, dry_run: bool) -> None:
    """The bucket-scoped grant, inline on the role."""
    desired = s3_access_policy(bucket)
    try:
        live = iam.get_role_policy(RoleName=ROLE_NAME, PolicyName=POLICY_NAME)["PolicyDocument"]
        if _same_policy(live, desired):
            plan.record(False, f"inline policy {POLICY_NAME} on {ROLE_NAME}")
            return
    except ClientError as exc:
        if exc.response["Error"]["Code"] != "NoSuchEntity":
            raise
    if not dry_run:
        iam.put_role_policy(
            RoleName=ROLE_NAME, PolicyName=POLICY_NAME, PolicyDocument=json.dumps(desired)
        )
    plan.record(True, f"inline policy {POLICY_NAME} on {ROLE_NAME}")


def ensure_instance_profile(iam: Any, plan: Plan, *, dry_run: bool) -> None:
    """EC2 hands a role to an instance only through an instance profile."""
    try:
        profile = iam.get_instance_profile(InstanceProfileName=INSTANCE_PROFILE_NAME)[
            "InstanceProfile"
        ]
    except ClientError as exc:
        if exc.response["Error"]["Code"] != "NoSuchEntity":
            raise
        if not dry_run:
            iam.create_instance_profile(
                InstanceProfileName=INSTANCE_PROFILE_NAME,
                Tags=[{"Key": PROJECT_TAG_KEY, "Value": PROJECT_TAG_VALUE}],
            )
            iam.get_waiter("instance_profile_exists").wait(
                InstanceProfileName=INSTANCE_PROFILE_NAME
            )
            iam.add_role_to_instance_profile(
                InstanceProfileName=INSTANCE_PROFILE_NAME, RoleName=ROLE_NAME
            )
        plan.record(True, f"instance profile {INSTANCE_PROFILE_NAME}")
        return
    if any(r["RoleName"] == ROLE_NAME for r in profile.get("Roles", [])):
        plan.record(False, f"instance profile {INSTANCE_PROFILE_NAME}")
        return
    if not dry_run:
        iam.add_role_to_instance_profile(
            InstanceProfileName=INSTANCE_PROFILE_NAME, RoleName=ROLE_NAME
        )
    plan.record(True, f"instance profile {INSTANCE_PROFILE_NAME} role attached")


# ------------------------------------------------------------------------- main


def converge(
    session: boto3.Session,
    bucket: str,
    region: str,
    *,
    dry_run: bool = False,
    with_iam: bool = True,
    with_markers: bool = True,
) -> Plan:
    plan = Plan()
    s3 = session.client("s3", region_name=region)

    ensure_bucket(s3, bucket, region, plan, dry_run=dry_run)
    if dry_run and not _bucket_exists(s3, bucket):
        # Nothing downstream can be inspected against a bucket that does not exist yet.
        plan.skipped.append("bucket settings, markers (bucket does not exist yet)")
        return plan

    ensure_public_access_block(s3, bucket, plan, dry_run=dry_run)
    ensure_encryption(s3, bucket, plan, dry_run=dry_run)
    ensure_versioning(s3, bucket, plan, dry_run=dry_run)
    ensure_bucket_tags(s3, bucket, plan, dry_run=dry_run)
    ensure_lifecycle(s3, bucket, plan, dry_run=dry_run)
    if with_markers:
        ensure_prefix_markers(s3, bucket, plan, dry_run=dry_run)
    else:
        plan.skipped.append("prefix markers (--no-markers)")

    if not with_iam:
        plan.skipped.append("iam role and policy (--no-iam)")
        return plan

    iam = session.client("iam")
    account = account_id(session)
    try:
        ensure_role(iam, account, plan, dry_run=dry_run)
        ensure_role_policy(iam, bucket, plan, dry_run=dry_run)
        ensure_instance_profile(iam, plan, dry_run=dry_run)
    except ClientError as exc:
        if exc.response["Error"]["Code"] in ("AccessDenied", "AccessDeniedException"):
            plan.skipped.append(f"iam (access denied for this identity: {exc.response['Error']})")
        else:
            raise
    return plan


def describe(session: boto3.Session, bucket: str, region: str) -> dict[str, Any]:
    """Everything REPORT.md needs, read back from AWS rather than from this file."""
    s3 = session.client("s3", region_name=region)
    account = account_id(session)
    out: dict[str, Any] = {
        "account": account,
        "region": region,
        "bucket": bucket,
        "bucket_arn": bucket_arn(bucket),
        "bucket_exists": _bucket_exists(s3, bucket),
        "role_arn": role_arn(account),
        "instance_profile": INSTANCE_PROFILE_NAME,
        "prefixes": list(PREFIXES),
    }
    if out["bucket_exists"]:
        out["versioning"] = s3.get_bucket_versioning(Bucket=bucket).get("Status", "Disabled")
        try:
            out["tags"] = {
                t["Key"]: t["Value"] for t in s3.get_bucket_tagging(Bucket=bucket)["TagSet"]
            }
        except ClientError:
            out["tags"] = {}
        try:
            out["lifecycle"] = [
                r["ID"] for r in s3.get_bucket_lifecycle_configuration(Bucket=bucket)["Rules"]
            ]
        except ClientError:
            out["lifecycle"] = []
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--bucket", default=None, help="default: $WARGAME_BUCKET")
    parser.add_argument("--region", default=os.environ.get("AWS_REGION", "us-east-1"))
    parser.add_argument("--profile", default=os.environ.get("AWS_PROFILE", "panoptes"))
    parser.add_argument("--dry-run", action="store_true", help="print the plan, change nothing")
    parser.add_argument(
        "--verify", action="store_true", help="print current state as JSON, change nothing"
    )
    parser.add_argument("--no-iam", action="store_true", help="skip the role and policy")
    parser.add_argument("--no-markers", action="store_true", help="skip the .keep prefix markers")
    args = parser.parse_args(argv)

    try:
        bucket = bucket_name(args.bucket)
    except KeyError:
        parser.error("WARGAME_BUCKET is unset and --bucket was not given")

    session = boto3.Session(profile_name=args.profile, region_name=args.region)

    if args.verify:
        print(json.dumps(describe(session, bucket, args.region), indent=2, default=str))
        return 0

    plan = converge(
        session,
        bucket,
        args.region,
        dry_run=args.dry_run,
        with_iam=not args.no_iam,
        with_markers=not args.no_markers,
    )
    print(plan.render(dry_run=args.dry_run))
    print(f"\nbucket_arn = {bucket_arn(bucket)}")
    if not args.no_iam:
        print(f"role_arn   = {role_arn(account_id(session))}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
