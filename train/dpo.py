"""DPO patch: build preference pairs from the lake, run one epoch on a checkpoint.

    python -m train.dpo --from-run <run_id> --sweep-id sweep-20260906-01 --dimension risk

A preference pair is two decisions the population made **at the same state**
that the judge scored differently on one chosen dimension. Same state is the
whole point: a pair drawn from two different situations teaches the model which
situation it prefers, not which behaviour. Records are therefore grouped on
`(episode_id, seat, sim_time_s)` — the same key `record_id` is built from — and
a pair is emitted only when the score gap on the chosen dimension clears
`dpo.min_score_gap`.

This is a *patch*, not a training run: one epoch, warm-started from an existing
tuned adapter, aimed at one dimension that the dev-set table showed was weak.
Every patch appends a note to `checkpoints/<run_id>/patches.md` saying which
dimension, how many pairs, from which lake — because a checkpoint that has been
patched twice on two dimensions is not the checkpoint its `provider.json`
describes, and the eval needs to know.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from train import filter as filt
from train import storage
from train.filter import judged_lake_prefix
from train.fireworks import Client, FireworksError
from train.launch import WORK_DIR, versions_for
from train.versions import git_sha

DIMENSIONS = ("authority", "risk", "private_info", "voice")


def state_key(record: dict[str, Any]) -> tuple[str, str, int]:
    """The decision point. Two records sharing this key faced the same state."""
    return (record["episode_id"], record["seat"], int(record["sim_time_s"]))


def build_preference_pairs(
    records: list[dict[str, Any]],
    *,
    dimension: str,
    min_gap: int,
    specs: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    """Preference-pair JSONL rows: the same prompt, a chosen and a rejected reply."""
    if dimension not in DIMENSIONS:
        raise ValueError(f"unknown judge dimension {dimension!r}; have {DIMENSIONS}")
    specs = specs or {}
    groups: dict[tuple[str, str, int], list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        scores = record.get("judge_scores")
        if scores and dimension in scores:
            groups[state_key(record)].append(record)

    pairs: list[dict[str, Any]] = []
    for group in groups.values():
        if len(group) < 2:
            continue
        ranked = sorted(group, key=lambda r: r["judge_scores"][dimension])
        worst, best = ranked[0], ranked[-1]
        gap = best["judge_scores"][dimension] - worst["judge_scores"][dimension]
        if gap < min_gap:
            continue
        chat = filt.to_chat(best, specs)
        prompt = chat["messages"][:2]
        pairs.append(
            {
                "messages": prompt,
                "chosen": json.dumps(best["output"], ensure_ascii=False, sort_keys=True),
                "rejected": json.dumps(worst["output"], ensure_ascii=False, sort_keys=True),
            }
        )
    return pairs


def patch_note(
    *,
    run_id: str,
    source_run_id: str,
    dimension: str,
    pairs: int,
    lake_source: str,
    job: str,
    min_gap: int,
) -> str:
    return "\n".join(
        [
            f"## {datetime.now(UTC).isoformat(timespec='seconds')} — DPO on `{dimension}`",
            "",
            f"- warm start: `{source_run_id}`",
            f"- patched checkpoint: `{run_id}`",
            f"- preference pairs: {pairs} (min score gap {min_gap} on {dimension})",
            f"- lake: `{lake_source}`",
            f"- job: `{job}`",
            f"- code: `{git_sha()}`",
            "",
            f"One epoch. This checkpoint no longer matches its `provider.json` on the "
            f"`{dimension}` dimension; re-run `train/gates.py` and `train/devset.py` "
            "before comparing it to an unpatched run.",
            "",
        ]
    )


def append_patch_note(run_id: str, note: str, metadata: dict[str, str]) -> str:
    key = f"checkpoints/{run_id}/patches.md"
    try:
        existing = storage.get_text(key)
    except Exception:  # noqa: BLE001 - first patch on this checkpoint
        existing = f"# patches — `{run_id}`\n\n"
    return storage.put_markdown(key, existing.rstrip("\n") + "\n\n" + note, metadata)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="DPO patch on one judge dimension.")
    p.add_argument("--from-run", required=True, help="run_id of the checkpoint to patch")
    p.add_argument("--sweep-id", required=True)
    p.add_argument("--dimension", choices=DIMENSIONS)
    p.add_argument("--config", type=Path, default=filt.CONFIG_PATH)
    p.add_argument("--lake-prefix")
    p.add_argument(
        "--judged",
        action="store_true",
        help="read lake/<lake_version>/_judge/<judge_version>/ from config -- the judged "
        "tree holds complete records and reads each decision once",
    )
    p.add_argument("--mock", type=int, default=0)
    p.add_argument("--specs-dir", type=Path, default=Path("specs/train"))
    p.add_argument("--min-gap", type=int)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--no-s3", action="store_true")
    args = p.parse_args(argv)

    if not args.lake_prefix and not args.judged and not args.mock:
        raise SystemExit("pass --lake-prefix or --mock N")

    config = filt.load_config(args.config)
    if args.judged:
        cfgv = config["versions"]
        args.lake_prefix = judged_lake_prefix(cfgv["lake_version"], cfgv["judge_version"])
    dcfg = config["dpo"]
    dimension = args.dimension or dcfg["dimension"]
    min_gap = args.min_gap if args.min_gap is not None else int(dcfg["min_score_gap"])

    source = json.loads(storage.get_text(f"checkpoints/{args.from_run}/provider.json"))
    warm_start = source.get("output_model")
    if not warm_start:
        raise SystemExit(f"{args.from_run} has no output_model to patch")

    records, lake_source = filt.read_lake(args.lake_prefix, args.mock)
    specs = filt.load_specs(args.specs_dir)
    pairs = build_preference_pairs(records, dimension=dimension, min_gap=min_gap, specs=specs)
    if not pairs:
        raise SystemExit(
            f"no preference pairs on `{dimension}` with a gap of {min_gap}+ at the same "
            "state; lower --min-gap or judge more of the lake"
        )

    WORK_DIR.mkdir(parents=True, exist_ok=True)
    run_id = f"{args.from_run}-dpo-{dimension}"
    path = WORK_DIR / f"{run_id}.jsonl"
    with path.open("w", encoding="utf-8") as fh:
        for row in pairs:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")

    client = Client.from_env(dry_run=args.dry_run)
    dataset_id = f"{args.sweep_id}-dpo-{dimension}".replace("_", "-")
    client.create_dataset(dataset_id, path)

    record: dict[str, Any] = {
        "run_id": run_id,
        "sweep_id": args.sweep_id,
        "kind": "dpo_patch",
        "dimension": dimension,
        "min_score_gap": min_gap,
        "pairs": len(pairs),
        "warm_start_from": warm_start,
        "continued_from_run_id": args.from_run,
        "variant": source.get("variant"),
        "base_model": source.get("base_model"),
        "dataset_id": dataset_id,
        "lake_source": lake_source,
        "git_commit": git_sha(),
        "created": datetime.now(UTC).isoformat(timespec="seconds"),
    }
    try:
        job = client.create_dpo_job(
            job_id=run_id,
            dataset_id=dataset_id,
            output_model_id=run_id,
            warm_start_from=warm_start,
            lora_rank=int(dcfg.get("lora_rank", 16)),
            epochs=int(dcfg.get("epochs", 1)),
        )
        record["job"] = job.get("name", run_id)
        record["state"] = job.get("state")
        record["output_model"] = job.get("outputModel")
    except FireworksError as exc:
        record["error"] = str(exc)[:1500]
        record["state"] = "CREATE_FAILED"

    if not args.no_s3 and not args.dry_run:
        meta = versions_for(config, source["variant"]["filter_version"]).as_metadata()
        storage.put_json(f"checkpoints/{run_id}/provider.json", record, meta)
        append_patch_note(
            args.from_run,
            patch_note(
                run_id=run_id,
                source_run_id=args.from_run,
                dimension=dimension,
                pairs=len(pairs),
                lake_source=lake_source,
                job=str(record.get("job", "-")),
                min_gap=min_gap,
            ),
            meta,
        )

    print(json.dumps(record, indent=2, default=str))
    return 0 if not record.get("error") else 1


if __name__ == "__main__":
    raise SystemExit(main())
