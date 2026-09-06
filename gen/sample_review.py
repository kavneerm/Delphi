"""Create the required 50-high / 50-low human review from judged lake records."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from gen.config import GenConfig
from gen.keys import is_judged_key, judged_prefix, sample_review_key
from gen.quarantine import assert_clean
from infra.storage import Storage, Versions


def score(record: dict[str, Any]) -> float:
    scores = record.get("judge_scores") or {}
    names = ("authority", "risk", "private_info", "voice")
    return sum(float(scores.get(name, 0)) for name in names) / len(names)


def render(records: list[dict[str, Any]], *, title: str) -> str:
    lines = [f"## {title}", ""]
    for index, record in enumerate(records, 1):
        output = record["output"]
        lines.extend(
            [
                f"### {index}. {record['record_id']} — {score(record):.2f}/5",
                "",
                f"- Seat/spec: `{record['seat']}` / `{record['spec_id']}`",
                f"- Action: `{output['action']['type']}`",
                f"- Judge: `{record['judge_scores']}`",
                f"- Reasoning: {str(output.get('reasoning') or '').strip()}",
                "",
            ]
        )
    return "\n".join(lines)


def build(config: GenConfig) -> str:
    store = Storage.from_env()
    prefix = judged_prefix(config.lake_version, config.judge_version)
    records = [
        record
        for key in store.list(prefix)
        if is_judged_key(key)
        for record in store.get_jsonl(key)
    ]
    if len(records) < 100:
        raise ValueError(f"need at least 100 judged records, found {len(records)}")
    ordered = sorted(records, key=lambda record: (score(record), str(record["record_id"])))
    low, high = ordered[:50], ordered[-50:]
    text = "\n".join(
        [
            "# Lake sample review",
            "",
            f"Lake: `{config.lake_version}`; judge: `{config.judge_version}`.",
            "Read both sections before approving training. Scores are means of authority, risk,",
            "private-information and voice.",
            "",
            render(high, title="50 highest-scored records"),
            render(low, title="50 lowest-scored records"),
        ]
    )
    assert_clean(text, where="sample review")
    return text


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=None, help="optional local copy")
    args = parser.parse_args(argv)
    config = GenConfig()
    text = build(config)
    if args.out:
        args.out.write_text(text)
    Storage.from_env().put_text(
        sample_review_key(config.lake_version, config.judge_version),
        text,
        versions=Versions(
            env_version=config.env_version,
            spec_version=config.spec_version,
            lake_version=config.lake_version,
            judge_version=config.judge_version,
        ),
        require=("env_version", "spec_version", "lake_version", "judge_version"),
    )
    print(sample_review_key(config.lake_version, config.judge_version))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
