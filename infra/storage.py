"""One helper for reading and writing the wargame bucket.

`contracts/s3_layout.md` §6 asks for exactly one of these, so that switching the
whole project between S3 and a local directory is an environment variable rather
than a code path per module:

    s3://$WARGAME_BUCKET/<key>   <->   $WARGAME_LOCAL_ROOT/<key>

It also enforces §4: every object carries the five version strings, the contracts
version, the seed, the episode id and the git commit as object metadata, plus the
`project=svalbard` tag that `infra/teardown.sh` keys on. A writer that omits a
version string gets an exception here rather than an unattributable object in the
bucket six hours later.

    from infra.storage import Storage, Versions

    store = Storage.from_env()
    store.put_jsonl(
        f"lake/{lake_v}/{env_v}/{spec_v}/{scenario_id}/seed={seed}/{episode_id}.jsonl",
        records,
        versions=Versions(
            env_version=env_v, spec_version=spec_v, lake_version=lake_v,
            seed=seed, episode_id=episode_id,
        ),
    )
"""

from __future__ import annotations

import json
import os
import subprocess
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

CONTRACTS_VERSION = "contracts_v1"
PROJECT_TAG = "project=svalbard"

# contracts/s3_layout.md §4. Every key is always present; "" means not applicable,
# and a missing key means the writer is out of contract.
METADATA_KEYS = (
    "env-version",
    "spec-version",
    "lake-version",
    "filter-version",
    "judge-version",
    "contracts-version",
    "seed",
    "episode-id",
    "git-commit",
)

CONTENT_TYPES = {
    ".jsonl": "application/x-ndjson",  # not application/json: the UI stream-parses it
    ".ndjson": "application/x-ndjson",
    ".json": "application/json",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".png": "image/png",
    ".txt": "text/plain",
}

_DEFAULT_LOCAL_ROOT = ".wargame-local"


def content_type_for(key: str) -> str:
    """Content type from the key suffix; unknown suffixes fall back to octet-stream."""
    suffix = Path(key).suffix.lower()
    return CONTENT_TYPES.get(suffix, "binary/octet-stream")


def git_commit() -> str:
    """Short SHA of the code doing the writing — what makes a surprising number debuggable."""
    override = os.environ.get("WARGAME_GIT_COMMIT")
    if override:
        return override
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
            timeout=5,
        )
        return out.stdout.strip()
    except (subprocess.SubprocessError, OSError):
        return "unknown"


@dataclass(frozen=True)
class Versions:
    """The provenance every object carries. Empty string = not applicable to this object."""

    env_version: str = ""
    spec_version: str = ""
    lake_version: str = ""
    filter_version: str = ""
    judge_version: str = ""
    seed: int | str = ""
    episode_id: str = ""
    contracts_version: str = CONTRACTS_VERSION
    commit: str | None = None

    def to_metadata(self) -> dict[str, str]:
        meta = {
            "env-version": self.env_version,
            "spec-version": self.spec_version,
            "lake-version": self.lake_version,
            "filter-version": self.filter_version,
            "judge-version": self.judge_version,
            "contracts-version": self.contracts_version,
            "seed": "" if self.seed == "" else str(self.seed),
            "episode-id": self.episode_id,
            "git-commit": self.commit or git_commit(),
        }
        missing = [k for k in METADATA_KEYS if k not in meta]
        if missing:  # pragma: no cover - guards a future edit to METADATA_KEYS
            raise ValueError(f"metadata is missing contract keys: {missing}")
        return meta

    def require(self, *names: str) -> None:
        """Assert that the named fields are non-empty before a write.

        `store.put_*(..., require=("lake_version", "env_version"))` turns "this object
        cannot be traced back to a run" from a next-day discovery into a stack trace.
        """
        empty = [n for n in names if not str(getattr(self, n))]
        if empty:
            raise ValueError(
                f"these version strings are required for this object and are empty: {empty}. "
                "contracts/s3_layout.md §2: a result whose versions cannot be recovered "
                "is not a result."
            )


class Storage:
    """S3 or a local mirror, behind one interface. Keys are identical either way."""

    def __init__(
        self,
        bucket: str | None = None,
        local_root: str | Path | None = None,
        session: Any | None = None,
        region: str = "us-east-1",
    ) -> None:
        if (bucket is None) == (local_root is None):
            raise ValueError("pass exactly one of bucket= or local_root=")
        self.bucket = bucket
        self.local_root = Path(local_root) if local_root is not None else None
        self._session = session
        self._region = region
        self._client: Any | None = None

    # ------------------------------------------------------------------ setup

    @classmethod
    def from_env(cls) -> Storage:
        """S3 by default; local when WARGAME_STORAGE=local.

        WARGAME_LOCAL_ROOT overrides the local directory and defaults to
        ./.wargame-local, per contracts/s3_layout.md §6.
        """
        if os.environ.get("WARGAME_STORAGE", "s3").lower() == "local":
            root = os.environ.get("WARGAME_LOCAL_ROOT", _DEFAULT_LOCAL_ROOT)
            return cls(local_root=root)
        return cls(
            bucket=os.environ["WARGAME_BUCKET"],  # KeyError is the correct failure
            region=os.environ.get("AWS_REGION", "us-east-1"),
        )

    @property
    def is_local(self) -> bool:
        return self.local_root is not None

    @property
    def client(self) -> Any:
        if self._client is None:
            import boto3

            session = self._session or boto3.Session(
                profile_name=os.environ.get("AWS_PROFILE", "panoptes"),
                region_name=self._region,
            )
            self._client = session.client("s3", region_name=self._region)
        return self._client

    def uri(self, key: str) -> str:
        return f"{self.local_root / key}" if self.is_local else f"s3://{self.bucket}/{key}"

    def _path(self, key: str) -> Path:
        assert self.local_root is not None
        return self.local_root / key

    def _meta_path(self, key: str) -> Path:
        # Sidecar, kept out of the mirrored tree so `ls` of a prefix matches S3 exactly.
        assert self.local_root is not None
        return self.local_root / "_meta" / f"{key}.json"

    # ------------------------------------------------------------------ write

    def put_bytes(
        self,
        key: str,
        body: bytes,
        *,
        versions: Versions,
        require: Iterable[str] = (),
        content_type: str | None = None,
    ) -> str:
        versions.require(*require)
        metadata = versions.to_metadata()
        ctype = content_type or content_type_for(key)

        if self.is_local:
            path = self._path(key)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
            meta_path = self._meta_path(key)
            meta_path.parent.mkdir(parents=True, exist_ok=True)
            meta_path.write_text(
                json.dumps({"metadata": metadata, "content_type": ctype, "tagging": PROJECT_TAG})
            )
        else:
            self.client.put_object(
                Bucket=self.bucket,
                Key=key,
                Body=body,
                Metadata=metadata,
                Tagging=PROJECT_TAG,
                ContentType=ctype,
            )
        return self.uri(key)

    def put_text(self, key: str, text: str, **kwargs: Any) -> str:
        return self.put_bytes(key, text.encode("utf-8"), **kwargs)

    def put_json(self, key: str, obj: Any, **kwargs: Any) -> str:
        return self.put_bytes(key, json.dumps(obj, indent=2).encode("utf-8"), **kwargs)

    def put_jsonl(self, key: str, records: Iterable[Any], **kwargs: Any) -> str:
        body = "".join(json.dumps(r) + "\n" for r in records).encode("utf-8")
        return self.put_bytes(key, body, **kwargs)

    # ------------------------------------------------------------------- read

    def exists(self, key: str) -> bool:
        if self.is_local:
            return self._path(key).is_file()
        from botocore.exceptions import ClientError

        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError as exc:
            if exc.response["Error"]["Code"] in ("404", "NoSuchKey"):
                return False
            raise

    def get_bytes(self, key: str) -> bytes:
        if self.is_local:
            return self._path(key).read_bytes()
        return bytes(self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read())

    def get_text(self, key: str) -> str:
        return self.get_bytes(key).decode("utf-8")

    def get_json(self, key: str) -> Any:
        return json.loads(self.get_text(key))

    def get_jsonl(self, key: str) -> list[Any]:
        return [json.loads(line) for line in self.get_text(key).splitlines() if line.strip()]

    def head(self, key: str) -> dict[str, str]:
        """The object's contract metadata, whichever backend it lives on."""
        if self.is_local:
            meta_path = self._meta_path(key)
            if not meta_path.is_file():
                if not self._path(key).is_file():
                    raise FileNotFoundError(self.uri(key))
                return {}
            return dict(json.loads(meta_path.read_text())["metadata"])
        return dict(self.client.head_object(Bucket=self.bucket, Key=key).get("Metadata", {}))

    def list(self, prefix: str) -> Iterator[str]:
        """Keys under a prefix, in lexical order, on either backend."""
        if self.is_local:
            assert self.local_root is not None
            base = self.local_root
            for path in sorted(base.rglob("*")):
                if not path.is_file():
                    continue
                key = path.relative_to(base).as_posix()
                if key.startswith("_meta/"):
                    continue
                if key.startswith(prefix):
                    yield key
            return
        paginator = self.client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                yield str(obj["Key"])
