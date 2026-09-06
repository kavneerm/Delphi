"""One helper for S3 and the local mirror.

`contracts/s3_layout.md` §6: every key works unchanged against a local
directory, so the switch is one environment variable rather than a code path per
module. `WARGAME_BUCKET` is required for a real write and `KeyError` is the
correct failure; `WARGAME_LOCAL_ROOT` (default `./.wargame-local`) takes it
offline.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any

__all__ = ["git_commit", "local_root", "object_metadata", "put_text", "read_text", "use_s3"]


def use_s3() -> bool:
    """S3 only when asked for it explicitly. Offline is the default."""
    return os.environ.get("WARGAME_STORAGE", "local").lower() == "s3"


def local_root() -> Path:
    return Path(os.environ.get("WARGAME_LOCAL_ROOT", ".wargame-local"))


def bucket() -> str:
    return os.environ["WARGAME_BUCKET"]  # KeyError is the correct failure


def git_commit() -> str:
    """Short SHA of the code that wrote the object. Debuggability, cheaply."""
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
            cwd=Path(__file__).resolve().parent,
        )
        return out.stdout.strip() or "unknown"
    except (OSError, subprocess.SubprocessError):  # pragma: no cover
        return "unknown"


def object_metadata(
    *,
    env_version: str,
    spec_version: str = "",
    lake_version: str = "",
    filter_version: str = "",
    judge_version: str = "",
    seed: int | str = "",
    episode_id: str = "",
    contracts_version: str = "contracts_v1",
) -> dict[str, str]:
    """The metadata block `contracts/s3_layout.md` §4 requires on every object."""
    return {
        "env-version": env_version,
        "spec-version": spec_version,
        "lake-version": lake_version,
        "filter-version": filter_version,
        "judge-version": judge_version,
        "contracts-version": contracts_version,
        "seed": str(seed),
        "episode-id": episode_id,
        "git-commit": git_commit(),
    }


def put_text(
    key: str,
    body: str,
    *,
    metadata: dict[str, str] | None = None,
    content_type: str = "application/x-ndjson",
) -> str:
    """Write one object. Returns the URI actually written."""
    if use_s3():
        import boto3  # imported here so an offline run needs no AWS at all

        client = boto3.client("s3")
        client.put_object(
            Bucket=bucket(),
            Key=key,
            Body=body.encode("utf-8"),
            Metadata=metadata or {},
            Tagging="project=svalbard",
            ContentType=content_type,
        )
        return f"s3://{bucket()}/{key}"
    path = local_root() / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)
    if metadata:
        meta_path = path.with_suffix(path.suffix + ".meta.json")
        import json

        meta_path.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n")
    return str(path)


def read_text(key_or_path: str) -> str:
    """Read an object by key, S3 URI, or plain local path."""
    if key_or_path.startswith("s3://"):
        import boto3

        _, _, rest = key_or_path.partition("s3://")
        name, _, key = rest.partition("/")
        body: Any = boto3.client("s3").get_object(Bucket=name, Key=key)["Body"]
        return str(body.read().decode("utf-8"))
    path = Path(key_or_path)
    if path.is_file():
        return path.read_text()
    candidate = local_root() / key_or_path
    if candidate.is_file():
        return candidate.read_text()
    if use_s3():
        import boto3

        body = boto3.client("s3").get_object(Bucket=bucket(), Key=key_or_path)["Body"]
        return str(body.read().decode("utf-8"))
    raise FileNotFoundError(key_or_path)
