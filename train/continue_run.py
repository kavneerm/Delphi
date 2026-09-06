"""Round-2 training: continue from an existing tuned adapter, never from base.

    python -m train.continue_run --from-run <run_id> --sweep-id sweep-20260906-02 \
        --lake-prefix lake/lake_v2/ --filter filter_v1

Fireworks continue-from-LoRA is `warmStartFrom` on an SFT job pointed at the
already-tuned model instead of `baseModel`. Round 2 exists precisely so the
self-play data lands on top of round-1 behaviour; starting from base would throw
that away, which is why `launch.py` and this module are separate entry points
and why `--base` is not a flag here at all.

The module file is `continue_run.py` because `continue` is a Python keyword and
`train/continue.py` cannot be imported. `train/continue.py` is a two-line shim so
the filename the brief names still works from the command line.
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from train import filter as filt
from train import storage
from train.filter import judged_lake_prefix
from train.fireworks import Client, FireworksError
from train.launch import Variant, build_dataset, versions_for
from train.versions import git_sha


def load_run(sweep_id: str, run_id: str) -> dict[str, Any]:
    """The round-1 provider record for `run_id`."""
    return json.loads(storage.get_text(f"checkpoints/{run_id}/provider.json"))


def continue_from(
    *,
    source: dict[str, Any],
    sweep_id: str,
    filter_version: str,
    config: dict[str, Any],
    client: Client,
    lake_prefix: str | None,
    mock: int,
    specs_dir: Path,
    rank: int | None = None,
    epochs: int | None = None,
    upload_to_s3: bool = True,
) -> dict[str, Any]:
    warm_start = source.get("output_model")
    if not warm_start:
        raise SystemExit(
            f"{source.get('run_id')} has no output_model; it never finished, "
            "so there is nothing to continue from"
        )

    variant = Variant(
        base=source["variant"]["base"],
        rank=rank or int(source["variant"]["rank"]),
        epochs=epochs or int(source["variant"]["epochs"]),
        filter_version=filter_version,
    )
    run_id = variant.run_id(f"{sweep_id}/r2/{source['run_id']}")
    path, manifest = build_dataset(
        filter_version=filter_version,
        config=config,
        sweep_id=sweep_id,
        lake_prefix=lake_prefix,
        mock=mock,
        specs_dir=specs_dir,
        upload_to_s3=upload_to_s3,
    )
    dataset_id = f"{sweep_id}-{filter_version.replace('_', '-')}-r2"
    client.create_dataset(dataset_id, path)

    record: dict[str, Any] = {
        "run_id": run_id,
        "sweep_id": sweep_id,
        "round": 2,
        "continued_from_run_id": source["run_id"],
        "warm_start_from": warm_start,
        "variant": {
            "base": variant.base,
            "rank": variant.rank,
            "epochs": variant.epochs,
            "filter_version": variant.filter_version,
        },
        "base_model": source.get("base_model"),
        "dataset_id": dataset_id,
        "dataset_manifest_stats": manifest["stats"],
        "git_commit": git_sha(),
        "created": datetime.now(UTC).isoformat(timespec="seconds"),
    }
    try:
        job = client.create_sft_job(
            job_id=run_id,
            dataset_id=dataset_id,
            output_model_id=run_id,
            warm_start_from=warm_start,
            lora_rank=variant.rank,
            epochs=variant.epochs,
            learning_rate=float(config["sweep"].get("learning_rate") or 0) or None,
        )
        record["job"] = job.get("name", run_id)
        record["job_id"] = run_id
        record["state"] = job.get("state")
        record["output_model"] = job.get("outputModel")
    except FireworksError as exc:
        record["error"] = str(exc)[:1500]
        record["state"] = "CREATE_FAILED"

    if upload_to_s3:
        meta = versions_for(config, filter_version).as_metadata()
        storage.put_json(f"runs/{sweep_id}/{run_id}/manifest.json", record, meta)
        storage.put_json(f"checkpoints/{run_id}/provider.json", record, meta)
    return record


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Continue training from a tuned adapter.")
    p.add_argument("--from-run", required=True, help="round-1 run_id to warm start from")
    p.add_argument("--sweep-id", required=True)
    p.add_argument("--filter", dest="filter_version", required=True)
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
    p.add_argument("--rank", type=int)
    p.add_argument("--epochs", type=int)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--no-s3", action="store_true")
    args = p.parse_args(argv)

    if not args.lake_prefix and not args.judged and not args.mock:
        raise SystemExit("pass --lake-prefix (round-2 lake) or --mock N")

    config = filt.load_config(args.config)
    if args.judged:
        cfgv = config["versions"]
        args.lake_prefix = judged_lake_prefix(cfgv["lake_version"], cfgv["judge_version"])
    client = Client.from_env(dry_run=args.dry_run)
    source = load_run(args.sweep_id, args.from_run)
    record = continue_from(
        source=source,
        sweep_id=args.sweep_id,
        filter_version=args.filter_version,
        config=config,
        client=client,
        lake_prefix=args.lake_prefix,
        mock=args.mock,
        specs_dir=args.specs_dir,
        rank=args.rank,
        epochs=args.epochs,
        upload_to_s3=not args.no_s3 and not args.dry_run,
    )
    print(json.dumps(record, indent=2, default=str))
    return 0 if not record.get("error") else 1


if __name__ == "__main__":
    raise SystemExit(main())
