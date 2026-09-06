"""Thin adapter over `infra.storage`, which is the project's one bucket helper.

agent8-infra published `infra/storage.py` as the single writer that
`contracts/s3_layout.md` §6 asks for, and it enforces the §4 metadata block. This
module used to be a second, independent implementation of the same thing; it now
delegates every byte to `infra.storage.Storage` so there is exactly one code path
to S3 and one place that can get the metadata wrong.

What is left here is the part `infra.storage` deliberately does not do: it accepts
any version string, while `contracts/s3_layout.md` §2 fixes patterns
(`^filter_v[0-9]+$` and friends). `train/versions.py` validates those, and this
module converts a validated `Versions` into the `infra.storage.Versions` the
writer wants. The function-level API is kept so call sites read the same as
before.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from typing import Any

from infra.storage import Storage
from infra.storage import Versions as InfraVersions

_CONTENT_TYPES = {"markdown": "text/markdown"}


def _store() -> Storage:
    """`infra.storage.Storage`, honouring whichever env convention is in play.

    `train/` used `WARGAME_LOCAL=1` before `infra.storage` existed;
    `infra.storage` uses `WARGAME_STORAGE=local`. agent8 has since taught
    `resolve_backend()` to read both (and to raise if they disagree), so prefer
    it when present and fall back to the local check only on the older version
    that is currently on main. Once agent8 merges, this collapses to
    `Storage.from_env()`.
    """
    try:
        from infra.storage import resolve_backend

        return Storage.from_env() if resolve_backend() != "local" else _local_store()
    except ImportError:
        pass
    if os.environ.get("WARGAME_LOCAL", "").strip() not in ("", "0", "false"):
        return _local_store()
    return Storage.from_env()


def _local_store() -> Storage:
    return Storage(local_root=os.environ.get("WARGAME_LOCAL_ROOT", ".wargame-local"))


def _versions(metadata: dict[str, str]) -> InfraVersions:
    """Rebuild `infra.storage.Versions` from the metadata dict this module is passed."""
    from train.versions import REQUIRED_METADATA_KEYS

    missing = REQUIRED_METADATA_KEYS - set(metadata)
    if missing:
        raise ValueError(
            f"object metadata is missing {sorted(missing)}; see contracts/s3_layout.md §4"
        )
    return InfraVersions(
        env_version=metadata.get("env-version", ""),
        spec_version=metadata.get("spec-version", ""),
        lake_version=metadata.get("lake-version", ""),
        filter_version=metadata.get("filter-version", ""),
        judge_version=metadata.get("judge-version", ""),
        seed=metadata.get("seed", ""),
        episode_id=metadata.get("episode-id", ""),
        commit=metadata.get("git-commit") or None,
    )


def use_local() -> bool:
    return _store().is_local


def uri(key: str) -> str:
    return _store().uri(key)


def bucket() -> str:
    # KeyError is the correct failure (s3_layout.md §1).
    return os.environ["WARGAME_BUCKET"]


def put_text(key: str, body: str, metadata: dict[str, str], content_type: str | None = None) -> str:
    """Write a text object with the full §4 metadata block. Returns the URI written."""
    return _store().put_text(key, body, versions=_versions(metadata), content_type=content_type)


def put_jsonl(key: str, rows: list[dict], metadata: dict[str, str]) -> str:
    return _store().put_jsonl(key, rows, versions=_versions(metadata))


def put_json(key: str, obj: dict, metadata: dict[str, str]) -> str:
    return _store().put_json(key, obj, versions=_versions(metadata))


def put_markdown(key: str, body: str, metadata: dict[str, str]) -> str:
    return put_text(key, body, metadata, _CONTENT_TYPES["markdown"])


def get_text(key: str) -> str:
    return _store().get_text(key)


def read_jsonl(key: str) -> Iterator[dict]:
    yield from _store().get_jsonl(key)


def list_keys(prefix: str) -> list[str]:
    return sorted(_store().list(prefix))


def head(key: str) -> dict[str, str]:
    return _store().head(key)


def check_metadata(metadata: dict[str, str]) -> None:
    """Refuse a write that is missing a required metadata key, before it happens."""
    _versions(metadata)


def get_json(key: str) -> Any:
    return json.loads(get_text(key))
