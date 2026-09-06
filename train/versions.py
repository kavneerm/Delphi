"""Version strings and provenance helpers.

Every artefact this workstream writes carries the five version strings from
`docs/COORDINATION.md` §8 plus the git SHA of the code that produced it, so a
surprising number stays a debuggable number (`contracts/s3_layout.md` §4).
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import asdict, dataclass

CONTRACTS_VERSION = "contracts_v1"

_PATTERNS: dict[str, re.Pattern[str]] = {
    "env_version": re.compile(r"^env_v[0-9]+(_perturbed)?$"),
    "spec_version": re.compile(r"^spec_v[0-9]+$"),
    "lake_version": re.compile(r"^lake_v[0-9]+$"),
    "filter_version": re.compile(r"^filter_v[0-9]+$"),
    "judge_version": re.compile(r"^judge_v[0-9]+$"),
}


@dataclass(frozen=True)
class Versions:
    """The version tuple an artefact was produced under."""

    env_version: str
    spec_version: str
    lake_version: str
    filter_version: str
    judge_version: str
    contracts_version: str = CONTRACTS_VERSION

    def validate(self) -> None:
        for field, pattern in _PATTERNS.items():
            value = getattr(self, field)
            if not pattern.match(value):
                raise ValueError(f"{field}={value!r} does not match {pattern.pattern}")

    def as_metadata(self, *, seed: int | str = "", episode_id: str = "") -> dict[str, str]:
        """S3 object metadata keys, lowercase-with-hyphens per s3_layout.md §4.

        All nine keys are always present. The contract is explicit that an empty
        string means "not applicable" and a *missing* key means the writer is out
        of contract, so `seed` and `episode-id` are emitted empty rather than
        omitted on the sweep artefacts that have no single episode behind them.
        """
        out = {k.replace("_", "-"): v for k, v in asdict(self).items()}
        out["seed"] = str(seed)
        out["episode-id"] = episode_id
        out["git-commit"] = git_sha()
        return out


#: Every metadata key `contracts/s3_layout.md` §4 requires on every object.
REQUIRED_METADATA_KEYS = frozenset(
    {
        "env-version",
        "spec-version",
        "lake-version",
        "filter-version",
        "judge-version",
        "contracts-version",
        "seed",
        "episode-id",
        "git-commit",
    }
)


def git_sha() -> str:
    """Short SHA of the working tree's HEAD, or 'unknown' outside a repo."""
    try:
        return subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "unknown"
