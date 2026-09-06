"""One helper for both S3 and the local mirror, per `contracts/s3_layout.md` §6.

`s3://$WARGAME_BUCKET/<key>` and `$WARGAME_LOCAL_ROOT/<key>` are the same key
space; which one is live is a single environment variable, not a code path per
module. Set `WARGAME_LOCAL=1` to stay offline.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from pathlib import Path

LOCAL_ROOT_DEFAULT = ".wargame-local"
_TAGGING = "project=svalbard"


def use_local() -> bool:
    return os.environ.get("WARGAME_LOCAL", "").strip() not in ("", "0", "false")


def local_root() -> Path:
    return Path(os.environ.get("WARGAME_LOCAL_ROOT", LOCAL_ROOT_DEFAULT))


def bucket() -> str:
    # KeyError is the correct failure (s3_layout.md §1).
    return os.environ["WARGAME_BUCKET"]


def uri(key: str) -> str:
    return str(local_root() / key) if use_local() else f"s3://{bucket()}/{key}"


def _client():
    import boto3

    profile = os.environ.get("AWS_PROFILE")
    session = boto3.Session(profile_name=profile) if profile else boto3.Session()
    return session.client("s3")


def check_metadata(metadata: dict[str, str]) -> None:
    """Refuse a write that is missing a required metadata key.

    `contracts/s3_layout.md` §4: an empty value means not applicable, a missing
    key means the writer is out of contract. Catching it here is the difference
    between one failed write and a bucket full of untraceable objects.
    """
    from train.versions import REQUIRED_METADATA_KEYS

    missing = REQUIRED_METADATA_KEYS - set(metadata)
    if missing:
        raise ValueError(
            f"object metadata is missing {sorted(missing)}; see contracts/s3_layout.md §4"
        )


def put_text(key: str, body: str, metadata: dict[str, str], content_type: str) -> str:
    """Write a text object with the full metadata block. Returns the URI written."""
    check_metadata(metadata)
    if use_local():
        path = local_root() / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")
        meta_path = path.with_suffix(path.suffix + ".meta.json")
        meta_path.write_text(json.dumps(metadata, indent=2, sort_keys=True), encoding="utf-8")
        return str(path)
    _client().put_object(
        Bucket=bucket(),
        Key=key,
        Body=body.encode("utf-8"),
        Metadata=metadata,
        Tagging=_TAGGING,
        ContentType=content_type,
    )
    return f"s3://{bucket()}/{key}"


def put_jsonl(key: str, rows: list[dict], metadata: dict[str, str]) -> str:
    body = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)
    return put_text(key, body, metadata, "application/x-ndjson")


def put_json(key: str, obj: dict, metadata: dict[str, str]) -> str:
    return put_text(key, json.dumps(obj, indent=2, sort_keys=True), metadata, "application/json")


def put_markdown(key: str, body: str, metadata: dict[str, str]) -> str:
    return put_text(key, body, metadata, "text/markdown")


def get_text(key: str) -> str:
    if use_local():
        return (local_root() / key).read_text(encoding="utf-8")
    return _client().get_object(Bucket=bucket(), Key=key)["Body"].read().decode("utf-8")


def read_jsonl(key: str) -> Iterator[dict]:
    for line in get_text(key).splitlines():
        line = line.strip()
        if line:
            yield json.loads(line)


def list_keys(prefix: str) -> list[str]:
    if use_local():
        root = local_root()
        base = root / prefix
        if not base.exists():
            return []
        return sorted(str(p.relative_to(root)) for p in base.rglob("*") if p.is_file())
    client = _client()
    keys: list[str] = []
    token: str | None = None
    while True:
        kwargs = {"Bucket": bucket(), "Prefix": prefix}
        if token:
            kwargs["ContinuationToken"] = token
        page = client.list_objects_v2(**kwargs)
        keys.extend(o["Key"] for o in page.get("Contents", []))
        if not page.get("IsTruncated"):
            return sorted(keys)
        token = page["NextContinuationToken"]
