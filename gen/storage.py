"""One writer for `s3://$WARGAME_BUCKET/...` and its local mirror.

`contracts/s3_layout.md` section 6 makes the local mirror a first-class path: the same
keys under `$WARGAME_LOCAL_ROOT`. Everything here goes through `Store`, so switching
between them is one environment variable and not a code path per module.
"""

from __future__ import annotations

import json
import os
import threading
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from gen.config import GenConfig, git_commit
from gen.version import CONTRACTS_VERSION

NDJSON = "application/x-ndjson"
JSON = "application/json"
MARKDOWN = "text/markdown"

_TAGGING = "project=svalbard"


@dataclass(frozen=True)
class VersionTags:
    """The object metadata every write carries, per s3_layout.md section 4."""

    env_version: str
    spec_version: str
    lake_version: str = ""
    filter_version: str = ""
    judge_version: str = ""
    seed: int | str = ""
    episode_id: str = ""

    def as_metadata(self) -> dict[str, str]:
        return {
            "env-version": self.env_version,
            "spec-version": self.spec_version,
            "lake-version": self.lake_version,
            "filter-version": self.filter_version,
            "judge-version": self.judge_version,
            "contracts-version": CONTRACTS_VERSION,
            "seed": str(self.seed),
            "episode-id": self.episode_id,
            "git-commit": git_commit(),
        }


class Store:
    """Key-addressed blob store. Same keys on S3 and on disk."""

    def __init__(self, config: GenConfig) -> None:
        self.config = config
        self.backend = config.backend
        self._client = None
        self._lock = threading.Lock()

    # -- backend plumbing ---------------------------------------------------

    @property
    def client(self):  # pragma: no cover - exercised only against real S3
        if self._client is None:
            with self._lock:
                if self._client is None:
                    import boto3

                    session = boto3.Session(profile_name=os.environ.get("AWS_PROFILE"))
                    self._client = session.client("s3")
        return self._client

    def _local_path(self, key: str) -> Path:
        return self.config.local_root / key

    def uri(self, key: str) -> str:
        if self.backend == "s3":
            return f"s3://{self.config.require_bucket()}/{key}"
        return str(self._local_path(key))

    # -- writes -------------------------------------------------------------

    def put_bytes(
        self, key: str, body: bytes, *, tags: VersionTags, content_type: str = JSON
    ) -> str:
        if self.backend == "s3":  # pragma: no cover - exercised only against real S3
            self.client.put_object(
                Bucket=self.config.require_bucket(),
                Key=key,
                Body=body,
                Metadata=tags.as_metadata(),
                Tagging=_TAGGING,
                ContentType=content_type,
            )
        else:
            path = self._local_path(key)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
            meta = path.with_suffix(path.suffix + ".meta.json")
            meta.write_text(
                json.dumps(
                    {
                        "Metadata": tags.as_metadata(),
                        "ContentType": content_type,
                        "Tagging": _TAGGING,
                    },
                    indent=2,
                )
            )
        return self.uri(key)

    def put_text(self, key: str, text: str, *, tags: VersionTags, content_type: str = JSON) -> str:
        return self.put_bytes(key, text.encode(), tags=tags, content_type=content_type)

    def put_json(self, key: str, obj: Any, *, tags: VersionTags) -> str:
        return self.put_text(key, json.dumps(obj, indent=2, sort_keys=True), tags=tags)

    def put_jsonl(self, key: str, rows: list[dict[str, Any]], *, tags: VersionTags) -> str:
        body = "".join(json.dumps(r, sort_keys=True) + "\n" for r in rows)
        return self.put_text(key, body, tags=tags, content_type=NDJSON)

    def delete(self, key: str) -> None:
        if self.backend == "s3":  # pragma: no cover
            self.client.delete_object(Bucket=self.config.require_bucket(), Key=key)
        else:
            path = self._local_path(key)
            path.unlink(missing_ok=True)
            path.with_suffix(path.suffix + ".meta.json").unlink(missing_ok=True)

    # -- reads --------------------------------------------------------------

    def exists(self, key: str) -> bool:
        if self.backend == "s3":  # pragma: no cover
            from botocore.exceptions import ClientError

            try:
                self.client.head_object(Bucket=self.config.require_bucket(), Key=key)
                return True
            except ClientError:
                return False
        return self._local_path(key).exists()

    def get_text(self, key: str) -> str:
        if self.backend == "s3":  # pragma: no cover
            obj = self.client.get_object(Bucket=self.config.require_bucket(), Key=key)
            return obj["Body"].read().decode()
        return self._local_path(key).read_text()

    def read_jsonl(self, key: str) -> Iterator[dict[str, Any]]:
        for line in self.get_text(key).splitlines():
            line = line.strip()
            if line:
                yield json.loads(line)

    def list_keys(self, prefix: str) -> list[str]:
        if self.backend == "s3":  # pragma: no cover
            keys: list[str] = []
            paginator = self.client.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=self.config.require_bucket(), Prefix=prefix):
                keys.extend(o["Key"] for o in page.get("Contents", []))
            return sorted(keys)
        root = self.config.local_root
        base = root / prefix
        search_root = base if base.is_dir() else base.parent
        if not search_root.exists():
            return []
        out = []
        for path in search_root.rglob("*"):
            if path.is_file() and not path.name.endswith(".meta.json"):
                key = str(path.relative_to(root))
                if key.startswith(prefix):
                    out.append(key)
        return sorted(out)


# --------------------------------------------------------------------------
# Key templates — s3_layout.md section 3. Never build a key by hand.
# --------------------------------------------------------------------------


def lake_key(
    lake_version: str,
    env_version: str,
    spec_version: str,
    scenario_id: str,
    seed: int,
    episode_id: str,
) -> str:
    return (
        f"lake/{lake_version}/{env_version}/{spec_version}/{scenario_id}/"
        f"seed={seed}/{episode_id}.jsonl"
    )


def lake_part_key(lake_version: str, episode_id: str, sequence: int, record_id: str) -> str:
    """One decision, written the moment it completes. Concatenated at episode close.

    Not in the s3_layout key table because it is transient: `_parts/` exists only
    between the first decision of an episode and that episode's close, and
    `LakeWriter.close()` deletes it. It is what makes "write as you go" literal — a
    crash costs the episode in flight and nothing else — while the durable object still
    lands on the contract key above.
    """
    return f"lake/{lake_version}/_parts/{episode_id}/{sequence:05d}-{record_id}.json"


def lake_index_key(lake_version: str, episode_id: str) -> str:
    return f"lake/{lake_version}/_index/{episode_id}.json"


def judge_key(lake_version: str, judge_version: str, episode_id: str) -> str:
    return f"lake/{lake_version}/_judge/{judge_version}/{episode_id}.jsonl"
