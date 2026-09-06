"""Run configuration. Secrets come from the environment and never from disk."""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from gen.version import (
    DEFAULT_ENV_VERSION,
    DEFAULT_SPEC_VERSION,
    JUDGE_VERSION,
    LAKE_VERSION,
    PROMPT_VERSION,
)

REPO_ROOT = Path(__file__).resolve().parent.parent

#: `gen/run.py --full` refuses to run until a human has touched this file. It is in
#: the repo's .gitignore on purpose: approval is a local human act, not a commit.
APPROVAL_FILE = REPO_ROOT / "gen" / "APPROVED"

#: Never read. `specs/holdout/` belongs to train/gates.py and eval/; a generation run
#: that touches it silently invalidates the held-out-persona coherence gate.
FORBIDDEN_SPEC_DIRS = ("specs/holdout",)


def git_commit() -> str:
    """Short SHA of the code writing an object, per s3_layout.md section 4."""
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
        )
        return out.stdout.strip()
    except (subprocess.SubprocessError, OSError):
        return "unknown"


def _int_env(name: str, default: int) -> int:
    raw = os.environ.get(name)
    return int(raw) if raw else default


def _float_env(name: str, default: float) -> float:
    raw = os.environ.get(name)
    return float(raw) if raw else default


@dataclass(frozen=True)
class GenConfig:
    """Everything a generation or judge pass needs, resolved once at startup."""

    # --- model -------------------------------------------------------------
    model: str = field(default_factory=lambda: os.environ.get("GEN_MODEL", "gpt-6-astra"))
    fallback_model: str = field(
        default_factory=lambda: os.environ.get("GEN_MODEL_FALLBACK", "gpt-5.5")
    )
    judge_model: str = field(
        default_factory=lambda: os.environ.get(
            "JUDGE_MODEL", os.environ.get("GEN_MODEL", "gpt-6-astra")
        )
    )
    max_output_tokens: int = field(default_factory=lambda: _int_env("GEN_MAX_OUTPUT_TOKENS", 4096))

    # --- concurrency and retry --------------------------------------------
    concurrency: int = field(default_factory=lambda: _int_env("GEN_CONCURRENCY", 64))
    max_schema_retries: int = field(default_factory=lambda: _int_env("GEN_SCHEMA_RETRIES", 3))
    max_transport_retries: int = field(default_factory=lambda: _int_env("GEN_TRANSPORT_RETRIES", 6))
    backoff_base_s: float = field(default_factory=lambda: _float_env("GEN_BACKOFF_BASE_S", 1.0))
    backoff_max_s: float = field(default_factory=lambda: _float_env("GEN_BACKOFF_MAX_S", 60.0))
    request_timeout_s: float = field(default_factory=lambda: _float_env("GEN_TIMEOUT_S", 180.0))

    # --- storage -----------------------------------------------------------
    bucket: str | None = field(default_factory=lambda: os.environ.get("WARGAME_BUCKET"))
    local_root: Path = field(
        default_factory=lambda: Path(os.environ.get("WARGAME_LOCAL_ROOT", ".wargame-local"))
    )
    #: "s3" writes to the bucket; "local" writes the identical key layout under
    #: local_root, per s3_layout.md section 6.
    backend: str = field(default_factory=lambda: os.environ.get("WARGAME_BACKEND", "local"))

    # --- versions ----------------------------------------------------------
    lake_version: str = LAKE_VERSION
    judge_version: str = JUDGE_VERSION
    prompt_version: str = PROMPT_VERSION
    env_version: str = field(
        default_factory=lambda: os.environ.get("ENV_VERSION", DEFAULT_ENV_VERSION)
    )
    spec_version: str = field(
        default_factory=lambda: os.environ.get("SPEC_VERSION", DEFAULT_SPEC_VERSION)
    )

    # --- inputs ------------------------------------------------------------
    specs_root: Path = field(
        default_factory=lambda: Path(os.environ.get("SPECS_ROOT", str(REPO_ROOT / "specs")))
    )
    grid_path: Path = field(
        default_factory=lambda: Path(
            os.environ.get("GEN_GRID", str(REPO_ROOT / "gen" / "grid.yaml"))
        )
    )

    # --- pricing, for cost_check only -------------------------------------
    # USD per 1M tokens. There is no public price for GEN_MODEL yet, so these are
    # overridable and cost_check prints them next to every dollar figure it reports.
    # See gen/QUESTIONS.md Q1.
    price_input_per_mtok: float = field(
        default_factory=lambda: _float_env("GEN_PRICE_INPUT_PER_MTOK", 1.25)
    )
    price_cached_input_per_mtok: float = field(
        default_factory=lambda: _float_env("GEN_PRICE_CACHED_INPUT_PER_MTOK", 0.125)
    )
    price_output_per_mtok: float = field(
        default_factory=lambda: _float_env("GEN_PRICE_OUTPUT_PER_MTOK", 10.0)
    )

    def require_bucket(self) -> str:
        """KeyError is the correct failure, per s3_layout.md section 1."""
        if self.backend == "s3":
            return os.environ["WARGAME_BUCKET"]
        return self.bucket or "svalbard-wargame"

    def approved(self) -> bool:
        return APPROVAL_FILE.exists()
