"""S3 keys for everything generation writes. `contracts/s3_layout.md` section 3.

Nobody owns the key templates — `infra.storage` owns the *writing* and this module owns
the *addressing*, so a key is never built by hand at a call site.

The three underscore prefixes matter more than they look. `lake/<lake_v>/` holds the
episode records, and `_index/`, `_judge/` and `_parts/` all sit *inside* it. Anything
listing `lake/<lake_v>/` therefore sees all four. `train/filter.py` reads every `.jsonl`
under the prefix it is given, so:

* `_index/` and `_parts/` are deliberately `.json`, never `.jsonl`, and are skipped;
* `_judge/<judge_v>/` **is** `.jsonl` and is not skipped, so pointing a filter at
  `lake/<lake_v>/` reads every decision twice — once unjudged, once scored.

`records_prefix()` and `judged_prefix()` are the two prefixes to hand downstream, and
`is_record_key()` is the predicate that tells them apart. See docs/HANDOFFS.md.
"""

from __future__ import annotations

from pathlib import PurePosixPath

__all__ = [
    "episode_records_key",
    "index_key",
    "is_record_key",
    "judged_key",
    "judged_prefix",
    "part_key",
    "parts_prefix",
    "records_prefix",
    "run_summary_key",
    "sample_review_key",
]


def records_prefix(lake_version: str, env_version: str = "", spec_version: str = "") -> str:
    """Where the unjudged episode records live. Excludes `_index`, `_judge`, `_parts`."""
    parts = [f"lake/{lake_version}"]
    if env_version:
        parts.append(env_version)
        if spec_version:
            parts.append(spec_version)
    return "/".join(parts) + "/"


def episode_records_key(
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


def part_key(lake_version: str, episode_id: str, sequence: int, record_id: str) -> str:
    """One decision, written the instant it completes.

    Not in the s3_layout key table because it is transient: it exists between a decision
    completing and its episode closing, and `LakeWriter.close()` removes it. `.json`, so
    a consumer listing `.jsonl` never sees it.
    """
    return f"lake/{lake_version}/_parts/{episode_id}/{sequence:05d}-{record_id}.json"


def parts_prefix(lake_version: str, episode_id: str) -> str:
    return f"lake/{lake_version}/_parts/{episode_id}/"


def index_key(lake_version: str, episode_id: str) -> str:
    return f"lake/{lake_version}/_index/{episode_id}.json"


def judged_prefix(lake_version: str, judge_version: str) -> str:
    """The prefix `train/filter.py` should read. Self-sufficient: complete records."""
    return f"lake/{lake_version}/_judge/{judge_version}/"


def judged_key(lake_version: str, judge_version: str, episode_id: str) -> str:
    return f"lake/{lake_version}/_judge/{judge_version}/{episode_id}.jsonl"


def run_summary_key(lake_version: str, run_id: str) -> str:
    return f"lake/{lake_version}/_index/run_{run_id}.json"


def sample_review_key(lake_version: str, judge_version: str) -> str:
    return f"lake/{lake_version}/_judge/{judge_version}/sample_review.md"


def is_record_key(key: str) -> bool:
    """True for an unjudged episode-record object, false for index/judge/parts."""
    parts = PurePosixPath(key).parts
    if len(parts) < 3 or parts[0] != "lake" or not key.endswith(".jsonl"):
        return False
    return not any(part.startswith("_") for part in parts[2:])


def is_judged_key(key: str) -> bool:
    parts = PurePosixPath(key).parts
    return (
        len(parts) >= 4
        and parts[0] == "lake"
        and parts[2] == "_judge"
        and key.endswith(".jsonl")
        and not PurePosixPath(key).name.startswith("sample_review")
    )
