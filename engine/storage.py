"""Storage for the engine — a thin shim over `infra.storage`.

`contracts/s3_layout.md` §6 asks for **one** helper, and for a while there were
three: this module, `infra/storage.py` and `gen/storage.py`. Two of them read
`WARGAME_STORAGE` with *opposite* defaults, which is worse than two helpers,
because with the repo `.env` (neither switch set) the engine wrote `logs/` to a
worktree-private `.wargame-local` while infra wrote to the bucket. `episode_id`
is the join key between `logs/` and `lake/`, so that quietly broke the join —
and `.wargame-local` is per worktree, so "local" was not one shared mirror but
eight private ones.

`agent8-infra` adjudicated it (`docs/HANDOFFS.md`, `infra/QUESTIONS.md` Q1) and
the verdict is right: **`infra.storage` is the implementation, S3 is the unset
default, and the engine keeps its function names as a shim.** That is this file.
`engine/log.py` did not change.

If `infra` is unavailable — someone running the engine out of tree, which the
tests do — this falls back to a local-only implementation with the *same* S3
default, so the two paths cannot disagree about where an object goes.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

__all__ = ["git_commit", "local_root", "object_metadata", "put_text", "read_text", "use_s3"]

DEFAULT_LOCAL_ROOT = ".wargame-local"


def _infra() -> Any | None:
    """`infra.storage` if it is importable, else None."""
    try:
        from infra import storage as infra_storage
    except ImportError:
        return None
    return infra_storage


def use_s3() -> bool:
    """S3 unless `WARGAME_STORAGE=local`.

    S3 is the default deliberately: an unset environment must not scatter
    `logs/` and `lake/` into different places, because `episode_id` joins them.
    """
    return os.environ.get("WARGAME_STORAGE", "s3").lower() != "local"


def local_root() -> Path:
    return Path(os.environ.get("WARGAME_LOCAL_ROOT", DEFAULT_LOCAL_ROOT))


def git_commit() -> str:
    """Short SHA of the code that wrote the object. Debuggability, cheaply."""
    infra = _infra()
    if infra is not None:
        return str(infra.git_commit())
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
    """The nine metadata keys `contracts/s3_layout.md` §4 requires."""
    infra = _infra()
    if infra is not None:
        return dict(
            infra.Versions(
                env_version=env_version,
                spec_version=spec_version,
                lake_version=lake_version,
                filter_version=filter_version,
                judge_version=judge_version,
                seed=seed,
                episode_id=episode_id,
                contracts_version=contracts_version,
            ).to_metadata()
        )
    return {
        "env-version": env_version,
        "spec-version": spec_version,
        "lake-version": lake_version,
        "filter-version": filter_version,
        "judge-version": judge_version,
        "contracts-version": contracts_version,
        "seed": "" if seed == "" else str(seed),
        "episode-id": episode_id,
        "git-commit": git_commit(),
    }


def put_text(
    key: str,
    body: str,
    *,
    env_version: str,
    spec_version: str = "",
    lake_version: str = "",
    filter_version: str = "",
    judge_version: str = "",
    seed: int | str = "",
    episode_id: str = "",
    contracts_version: str = "contracts_v1",
    content_type: str = "application/x-ndjson",
    require: tuple[str, ...] = (),
) -> str:
    """Write one object with its provenance. Returns the URI actually written.

    Takes the version *fields* rather than a prebuilt metadata dict, because
    that is what `infra.storage.Versions` wants and it lets `require=` turn "this
    object cannot be traced back to a run" into a stack trace at the write
    rather than a discovery the next day.
    """
    fields: dict[str, Any] = {
        "env_version": env_version,
        "spec_version": spec_version,
        "lake_version": lake_version,
        "filter_version": filter_version,
        "judge_version": judge_version,
        "seed": seed,
        "episode_id": episode_id,
        "contracts_version": contracts_version,
    }
    infra = _infra()
    if infra is not None:
        store = infra.Storage.from_env()
        return str(
            store.put_bytes(
                key,
                body.encode("utf-8"),
                versions=infra.Versions(**fields),
                require=require,
                content_type=content_type,
            )
        )
    missing = [name for name in require if not str(fields.get(name) or "")]
    if missing:
        raise ValueError(
            f"these version strings are required for this object and are empty: {missing}. "
            "contracts/s3_layout.md §2: a result whose versions cannot be recovered "
            "is not a result."
        )
    return _local_put(key, body, object_metadata(**fields))


def read_text(key_or_path: str) -> str:
    """Read an object by key, S3 URI, or plain local path."""
    path = Path(key_or_path)
    if path.is_file():
        return path.read_text()
    infra = _infra()
    if infra is not None and not key_or_path.startswith("s3://"):
        store = infra.Storage.from_env()
        try:
            return str(store.get_text(key_or_path))
        except Exception:  # noqa: BLE001 - fall through to the local mirror
            pass
    if key_or_path.startswith("s3://"):
        import boto3

        _, _, rest = key_or_path.partition("s3://")
        name, _, key = rest.partition("/")
        body: Any = boto3.client("s3").get_object(Bucket=name, Key=key)["Body"]
        return str(body.read().decode("utf-8"))
    candidate = local_root() / key_or_path
    if candidate.is_file():
        return candidate.read_text()
    raise FileNotFoundError(key_or_path)


def _local_put(key: str, body: str, metadata: dict[str, str] | None) -> str:
    """Local-mirror write, for a checkout with no `infra` on the path."""
    path = local_root() / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body)
    if metadata:
        sidecar = path.with_suffix(path.suffix + ".meta.json")
        sidecar.write_text(json.dumps(metadata, indent=2, sort_keys=True) + "\n")
    return str(path)
