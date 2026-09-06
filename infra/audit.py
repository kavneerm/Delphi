"""Audit the bucket against contracts/s3_layout.md. Read-only.

Three modules write to this bucket and they do not agree on how (see
infra/QUESTIONS.md Q1), so an object that is out of contract — a key under no
prefix, a missing version tag, `application/json` on a JSONL file — will land
quietly and be discovered by Eval on Sunday morning. This finds it on Saturday.

    AWS_PROFILE=panoptes WARGAME_BUCKET=svalbard-wargame python -m infra.audit
    python -m infra.audit --prefix lake/          # one prefix
    python -m infra.audit --local                 # audit the local mirror instead
    python -m infra.audit --quiet                 # only the failures

Exit code is 0 when every object is in contract and 1 when any is not, so it works
as a pre-flight check before a training run or a report.

What it checks, per object, against the section of the contract named in the finding:
  §1  the key is under one of the six prefixes
  §3  the key matches one of that prefix's key templates
  §2  every version string in the key matches its pattern
  §4  object metadata carries all nine keys, and the versions in the metadata agree
      with the versions in the key
  §4  the object is tagged project=svalbard
  §5  the content type matches the suffix

Two kinds of key are not findings: the zero-byte `<prefix>/.keep` markers
infra/bootstrap.py writes, and gen/storage.py's transient `lake/<lake_v>/_parts/`
objects, which are counted and reported separately because a leftover one means an
episode never closed.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from dataclasses import dataclass, field
from typing import Any

from infra.storage import (
    CONTRACT_PREFIXES,
    METADATA_KEYS,
    content_type_for,
    contract_prefix_of,
)

# --- §2 version patterns -----------------------------------------------------
ENV_V = r"env_v[0-9]+(?:_perturbed)?"
SPEC_V = r"spec_v[0-9]+"
LAKE_V = r"lake_v[0-9]+"
FILTER_V = r"filter_v[0-9]+"
JUDGE_V = r"judge_v[0-9]+"

VERSION_PATTERNS = {
    "env-version": re.compile(rf"^{ENV_V}$"),
    "spec-version": re.compile(rf"^{SPEC_V}$"),
    "lake-version": re.compile(rf"^{LAKE_V}$"),
    "filter-version": re.compile(rf"^{FILTER_V}$"),
    "judge-version": re.compile(rf"^{JUDGE_V}$"),
}

# --- §3 id conventions -------------------------------------------------------
SEG = r"[a-z0-9_]+"  # lowercase snake_case segment
ID = r"[A-Za-z0-9_.-]+"  # ids may carry hyphens
SEED = r"seed=-?[0-9]+"
EPISODE = r"[A-Za-z0-9_.-]+-[0-9]+-[0-9a-f]{8}"
RUN = r"[A-Za-z0-9_.-]+-r[0-9]+-e[0-9]+-filter_v[0-9]+-[0-9a-f]{6}"
SWEEP = r"sweep-[0-9]{8}-[0-9]{2}"
EVAL = r"eval-[0-9]{8}-[0-9]{2}"

# §3 key templates, one regex per line of the contract.
KEY_TEMPLATES: dict[str, list[tuple[str, re.Pattern[str]]]] = {
    "specs/": [
        (
            "specs/<spec_version>/train/<spec_id>.json",
            re.compile(rf"^specs/{SPEC_V}/train/{ID}\.json$"),
        ),
        (
            "specs/<spec_version>/holdout/<spec_id>.json",
            re.compile(rf"^specs/{SPEC_V}/holdout/{ID}\.json$"),
        ),
        (
            "specs/<spec_version>/devset/<replay_id>.json",
            re.compile(rf"^specs/{SPEC_V}/devset/{ID}\.json$"),
        ),
        (
            "specs/<spec_version>/exemplars/<exemplar_id>.md",
            re.compile(rf"^specs/{SPEC_V}/exemplars/{ID}\.md$"),
        ),
        ("specs/<spec_version>/manifest.json", re.compile(rf"^specs/{SPEC_V}/manifest\.json$")),
    ],
    "lake/": [
        (
            "lake/<lake_v>/<env_v>/<spec_v>/<scenario_id>/seed=<seed>/<episode_id>.jsonl",
            re.compile(rf"^lake/{LAKE_V}/{ENV_V}/{SPEC_V}/{SEG}/{SEED}/{EPISODE}\.jsonl$"),
        ),
        (
            "lake/<lake_v>/_index/<episode_id>.json",
            re.compile(rf"^lake/{LAKE_V}/_index/{EPISODE}\.json$"),
        ),
        (
            "lake/<lake_v>/_judge/<judge_v>/<episode_id>.jsonl",
            re.compile(rf"^lake/{LAKE_V}/_judge/{JUDGE_V}/{EPISODE}\.jsonl$"),
        ),
    ],
    "runs/": [
        (
            "runs/<sweep_id>/<run_id>/dataset_<filter_version>.jsonl",
            re.compile(rf"^runs/{SWEEP}/{RUN}/dataset_{FILTER_V}\.jsonl$"),
        ),
        (
            "runs/<sweep_id>/<run_id>/manifest.json",
            re.compile(rf"^runs/{SWEEP}/{RUN}/manifest\.json$"),
        ),
        ("runs/<sweep_id>/<run_id>/gates.json", re.compile(rf"^runs/{SWEEP}/{RUN}/gates\.json$")),
        (
            "runs/<sweep_id>/<run_id>/devset_table.md",
            re.compile(rf"^runs/{SWEEP}/{RUN}/devset_table\.md$"),
        ),
        ("runs/<sweep_id>/summary.md", re.compile(rf"^runs/{SWEEP}/summary\.md$")),
    ],
    "checkpoints/": [
        ("checkpoints/<run_id>/adapter/...", re.compile(rf"^checkpoints/{RUN}/adapter/.+$")),
        ("checkpoints/<run_id>/provider.json", re.compile(rf"^checkpoints/{RUN}/provider\.json$")),
        ("checkpoints/<run_id>/patches.md", re.compile(rf"^checkpoints/{RUN}/patches\.md$")),
    ],
    "validation/": [
        (
            "validation/<eval_id>/final_report.md",
            re.compile(rf"^validation/{EVAL}/final_report\.md$"),
        ),
        ("validation/<eval_id>/heatmap.csv", re.compile(rf"^validation/{EVAL}/heatmap\.csv$")),
        (
            "validation/<eval_id>/replay_<replay_id>_v<replay_version>.json",
            re.compile(rf"^validation/{EVAL}/replay_{ID}_v[0-9]+\.json$"),
        ),
        (
            "validation/<eval_id>/holdout_mix_<psyche>.json",
            re.compile(rf"^validation/{EVAL}/holdout_mix_{SEG}\.json$"),
        ),
        (
            "validation/<eval_id>/perturbation.json",
            re.compile(rf"^validation/{EVAL}/perturbation\.json$"),
        ),
        (
            "validation/<eval_id>/figures/<name>.png",
            re.compile(rf"^validation/{EVAL}/figures/{ID}\.png$"),
        ),
    ],
    "logs/": [
        (
            "logs/<env_v>/<lake_v>/<scenario_id>/seed=<seed>/<episode_id>.jsonl",
            re.compile(rf"^logs/{ENV_V}/{LAKE_V}/{SEG}/{SEED}/{EPISODE}\.jsonl$"),
        ),
    ],
}

# The zero-byte markers infra/bootstrap.py writes so the six prefixes are visible on
# an empty bucket. They are infrastructure, not artefacts, and are exempt.
MARKER = re.compile(r"^(?:[a-z]+)/\.keep$")

# Local sidecars written by engine/storage.py and gen/storage.py. Harmless on disk,
# but they are not in §3, so if they ever reach the bucket they are findings.
SIDECAR = re.compile(r"\.meta\.json$")

# gen/storage.py writes one object per decision the moment it completes — §5's
# "write as you go" taken literally — and concatenates them onto the contract key
# when the episode closes. `_parts/` is deliberately not in §3 because it exists only
# between an episode's first decision and its close. Not a finding while a run is in
# flight; a leftover after one is an episode that never closed, so it is counted and
# reported rather than ignored.
TRANSIENT = re.compile(rf"^lake/{LAKE_V}/_parts/.+$")


@dataclass
class Finding:
    key: str
    section: str
    problem: str

    def __str__(self) -> str:
        return f"{self.key}\n    §{self.section}  {self.problem}"


@dataclass
class Audit:
    checked: int = 0
    exempt: int = 0
    transient: int = 0
    findings: list[Finding] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.findings

    def render(self, *, quiet: bool = False) -> str:
        lines: list[str] = []
        if self.findings:
            lines.append(f"{len(self.findings)} finding(s):\n")
            lines += [str(f) for f in self.findings]
            lines.append("")
        if self.transient:
            lines.append(
                f"note: {self.transient} transient lake/*/_parts/ object(s). Normal during a "
                "generation run; after one, they are episodes that never closed."
            )
        if not quiet or self.findings:
            lines.append(
                f"{self.checked} object(s) checked, {self.exempt} exempt, "
                f"{self.transient} transient, {len(self.findings)} out of contract"
            )
        return "\n".join(lines)


def key_findings(key: str) -> list[Finding]:
    """§1 and §3: is this key one the contract describes?"""
    if MARKER.match(key):
        return []
    prefix = contract_prefix_of(key)
    if prefix is None:
        return [Finding(key, "1", f"under none of the six prefixes {CONTRACT_PREFIXES}")]
    if SIDECAR.search(key):
        return [
            Finding(
                key,
                "3",
                "a local-mirror .meta.json sidecar reached the bucket; it is not in the "
                "key templates and train/filter.py would read it as an artefact",
            )
        ]
    templates = KEY_TEMPLATES[prefix]
    if any(pattern.match(key) for _, pattern in templates):
        return []
    shapes = "\n              ".join(name for name, _ in templates)
    return [Finding(key, "3", f"matches no key template for {prefix}\n              {shapes}")]


def metadata_findings(key: str, metadata: dict[str, str]) -> list[Finding]:
    """§2 and §4: are the version strings present, well formed, and consistent with the key?"""
    if MARKER.match(key):
        return []
    out: list[Finding] = []
    missing = [k for k in METADATA_KEYS if k not in metadata]
    if missing:
        out.append(
            Finding(key, "4", f"metadata is missing {missing}; the writer is out of contract")
        )
    if metadata.get("contracts-version", "") == "":
        out.append(Finding(key, "4", "contracts-version is empty"))

    for name, pattern in VERSION_PATTERNS.items():
        value = metadata.get(name, "")
        if value and not pattern.match(value):
            out.append(Finding(key, "2", f"{name}={value!r} does not match {pattern.pattern}"))

    # The versions in the key are the ones that decide what the object contains; the
    # metadata must not claim something different.
    segments = set(key.split("/"))
    for name in ("env-version", "spec-version", "lake-version"):
        value = metadata.get(name, "")
        if not value:
            continue
        in_key = {s for s in segments if VERSION_PATTERNS[name].match(s)}
        if in_key and value not in in_key:
            out.append(
                Finding(
                    key, "4", f"metadata {name}={value!r} disagrees with the key's {sorted(in_key)}"
                )
            )
    return out


def content_type_findings(key: str, content_type: str) -> list[Finding]:
    """§5: a wrong content type breaks the UI's streaming parse."""
    if MARKER.match(key) or not content_type:
        return []
    expected = content_type_for(key)
    if expected == "binary/octet-stream":
        return []
    actual = content_type.split(";")[0].strip()
    if actual != expected:
        return [Finding(key, "5", f"content type is {actual!r}, expected {expected!r}")]
    return []


def tag_findings(key: str, tags: dict[str, str]) -> list[Finding]:
    if MARKER.match(key):
        return []
    if tags.get("project") != "svalbard":
        return [Finding(key, "4", f"not tagged project=svalbard (tags: {tags or 'none'})")]
    return []


def audit_s3(client: Any, bucket: str, prefix: str = "", *, check_tags: bool = True) -> Audit:
    audit = Audit()
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            key = str(obj["Key"])
            if MARKER.match(key):
                audit.exempt += 1
                continue
            if TRANSIENT.match(key):
                audit.transient += 1
                continue
            audit.checked += 1
            audit.findings += key_findings(key)

            head = client.head_object(Bucket=bucket, Key=key)
            audit.findings += metadata_findings(key, dict(head.get("Metadata", {})))
            audit.findings += content_type_findings(key, str(head.get("ContentType", "")))

            if check_tags:
                tagging = client.get_object_tagging(Bucket=bucket, Key=key)
                tags = {t["Key"]: t["Value"] for t in tagging.get("TagSet", [])}
                audit.findings += tag_findings(key, tags)
    return audit


def audit_local(root: str, prefix: str = "") -> Audit:
    """The same key checks against the local mirror. Metadata lives in sidecars there,
    so only §1 and §3 are meaningful; that is still the check that catches smoke/ and tmp/."""
    from pathlib import Path

    base = Path(root)
    audit = Audit()
    for path in sorted(base.rglob("*")):
        if not path.is_file():
            continue
        key = path.relative_to(base).as_posix()
        if key.startswith("_meta/"):
            continue
        if not key.startswith(prefix):
            continue
        if MARKER.match(key):
            audit.exempt += 1
            continue
        if TRANSIENT.match(key):
            audit.transient += 1
            continue
        audit.checked += 1
        audit.findings += key_findings(key)
    return audit


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--bucket", default=None, help="default: $WARGAME_BUCKET")
    parser.add_argument("--prefix", default="", help="audit one prefix only")
    parser.add_argument("--profile", default=os.environ.get("AWS_PROFILE", "panoptes"))
    parser.add_argument("--region", default=os.environ.get("AWS_REGION", "us-east-1"))
    parser.add_argument("--local", action="store_true", help="audit $WARGAME_LOCAL_ROOT instead")
    parser.add_argument("--no-tags", action="store_true", help="skip the per-object tag call")
    parser.add_argument("--quiet", action="store_true", help="print only findings")
    args = parser.parse_args(argv)

    if args.local:
        root = os.environ.get("WARGAME_LOCAL_ROOT", ".wargame-local")
        audit = audit_local(root, args.prefix)
        where = root
    else:
        import boto3

        bucket = args.bucket or os.environ["WARGAME_BUCKET"]
        session = boto3.Session(profile_name=args.profile, region_name=args.region)
        audit = audit_s3(
            session.client("s3", region_name=args.region),
            bucket,
            args.prefix,
            check_tags=not args.no_tags,
        )
        where = f"s3://{bucket}"

    if not args.quiet:
        print(f"auditing {where}{args.prefix} against contracts/s3_layout.md\n")
    print(audit.render(quiet=args.quiet))
    if args.local and audit.findings:
        print(
            "\nThe local mirror is dev scratch, so a key under no contract prefix is only a "
            "problem if that mirror is ever synced to the bucket — which is exactly what "
            "these findings would become."
        )
    return 0 if audit.ok else 1


if __name__ == "__main__":
    sys.exit(main())
