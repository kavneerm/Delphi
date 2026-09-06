"""Launch the training sweep.

    python -m train.launch --backend fireworks --sweep-id sweep-20260906-01
    python -m train.launch --variant qwen25_7b:32:3:filter_v1 --dry-run

One SFT LoRA job per sweep variant from `train/config.yaml`. Each variant's
filtered dataset is built once, uploaded once as a Fireworks dataset, and reused
by every variant sharing that filter version — the sweep varies base, rank and
epochs over a small number of distinct datasets, so re-uploading per variant
would be pure waste.

Everything a run produced is written to S3 before the job is even polled:
`runs/<sweep_id>/<run_id>/manifest.json` and `checkpoints/<run_id>/provider.json`
carry the dataset id, job id, output model id, base model, rank, epochs and all
five version strings. A result whose versions cannot be recovered is not a
result (`contracts/s3_layout.md` §2), so the ids land before anything can crash.

`sagemaker` and `ec2` are unexercised stubs: EC2 G/VT on-demand quota
`L-DB2E81BA` is 0 with an increase pending, and every SageMaker g5 training
quota is 0. They raise rather than pretend.
"""

from __future__ import annotations

import argparse
import json
import os
import uuid
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from train import filter as filt
from train import storage
from train.filter import judged_lake_prefix
from train.fireworks import BASE_MODELS, Client, FireworksError
from train.versions import Versions, git_sha

#: Local scratch for files on their way to Fireworks. Deliberately NOT under
#: $WARGAME_LOCAL_ROOT: that directory mirrors the bucket key-for-key, so a
#: `tmp/` or `smoke/` folder inside it reads as a seventh contract prefix to
#: anything listing the mirror (`infra.audit --local` flags exactly that, and it
#: is what agent8-infra spotted). These files are never storage keys -- they are
#: uploaded to Fireworks by path and deleted by nobody -- so they belong outside
#: the key space entirely.
WORK_DIR = Path(os.environ.get("WARGAME_SCRATCH", ".wargame-scratch"))


@dataclass(frozen=True)
class Variant:
    """One cell of the sweep."""

    base: str
    rank: int
    epochs: int
    filter_version: str

    @classmethod
    def parse(cls, spec: str) -> Variant:
        """`base:rank:epochs:filter_version`, e.g. `qwen25_7b:32:3:filter_v1`."""
        try:
            base, rank, epochs, filter_version = spec.split(":")
        except ValueError as exc:
            raise ValueError(f"bad variant {spec!r}; want base:rank:epochs:filter_version") from exc
        return cls(base=base, rank=int(rank), epochs=int(epochs), filter_version=filter_version)

    def run_id(self, salt: str) -> str:
        """`<base>-r<rank>-e<epochs>-<filter_version>-<6 hex>` per s3_layout.md §3."""
        short = uuid.uuid5(uuid.NAMESPACE_URL, f"{salt}/{self}").hex[:6]
        return f"{self.base}-r{self.rank}-e{self.epochs}-{self.filter_version}-{short}"

    def __str__(self) -> str:
        return f"{self.base}:{self.rank}:{self.epochs}:{self.filter_version}"


def default_sweep_id(now: datetime | None = None) -> str:
    return f"sweep-{(now or datetime.now(UTC)).strftime('%Y%m%d')}-01"


def variants_from_config(config: dict[str, Any]) -> list[Variant]:
    return [
        Variant(
            base=v["base"],
            rank=int(v["rank"]),
            epochs=int(v["epochs"]),
            filter_version=v["filter"],
        )
        for v in config["sweep"]["variants"]
    ]


def versions_for(config: dict[str, Any], filter_version: str) -> Versions:
    """The version tuple a run under `filter_version` is tagged with.

    Raises if the filter is not in the config: a run tagged `filter_v9` that no
    config block defines is a result nobody can reproduce, which
    `contracts/s3_layout.md` §2 says to discard. Better to refuse it here.
    """
    if filter_version not in config["filters"]:
        raise KeyError(
            f"unknown filter {filter_version!r}; config defines {sorted(config['filters'])}"
        )
    cfgv = config["versions"]
    versions = Versions(
        env_version=cfgv["env_version"],
        spec_version=cfgv["spec_version"],
        lake_version=cfgv["lake_version"],
        filter_version=filter_version,
        judge_version=cfgv["judge_version"],
    )
    versions.validate()
    return versions


# ------------------------------------------------------------------- datasets


def build_dataset(
    *,
    filter_version: str,
    config: dict[str, Any],
    sweep_id: str,
    lake_prefix: str | None,
    mock: int,
    specs_dir: Path,
    upload_to_s3: bool,
) -> tuple[Path, dict[str, Any]]:
    """Filter the lake once for this filter version. Returns (path, manifest)."""
    records, source = filt.read_lake(lake_prefix, mock)
    specs = filt.load_specs(specs_dir)
    examples, stats = filt.filter_records(
        records, filter_version=filter_version, config=config, specs=specs
    )
    if not examples:
        raise SystemExit(f"{filter_version} kept 0 examples; nothing to train on")

    WORK_DIR.mkdir(parents=True, exist_ok=True)
    path = WORK_DIR / f"{sweep_id}-{filter_version}.jsonl"
    with path.open("w", encoding="utf-8") as fh:
        for ex in examples:
            fh.write(json.dumps(ex, ensure_ascii=False) + "\n")

    versions = versions_for(config, filter_version)
    dataset_key = f"runs/{sweep_id}/_datasets/dataset_{filter_version}.jsonl"
    manifest = filt.build_manifest(
        filter_version=filter_version,
        config=config,
        versions=versions,
        stats=stats,
        dataset_key=dataset_key,
        source=source,
    )
    if upload_to_s3:
        meta = versions.as_metadata()
        storage.put_text(
            dataset_key, path.read_text(encoding="utf-8"), meta, "application/x-ndjson"
        )
        manifest_key = f"runs/{sweep_id}/_datasets/manifest_{filter_version}.json"
        storage.put_json(manifest_key, manifest, meta)
    return path, manifest


# --------------------------------------------------------------------- launch


def launch_fireworks(
    *,
    variants: list[Variant],
    config: dict[str, Any],
    sweep_id: str,
    lake_prefix: str | None,
    mock: int,
    specs_dir: Path,
    dry_run: bool,
    upload_to_s3: bool,
    wait: bool,
    approve_base_swap: bool = False,
) -> list[dict[str, Any]]:
    client = Client.from_env(dry_run=dry_run)
    lr = float(config["sweep"].get("learning_rate") or 0.0) or None
    results: list[dict[str, Any]] = []

    # Refuse to spend on a base that is dead, or on one substituted for a dead
    # base without a human saying so. Choosing the sweep's bases is a human call.
    problems = client.preflight(
        sorted({v.base for v in variants}), allow_unapproved=approve_base_swap
    )
    if problems:
        raise SystemExit(
            "sweep refused before spending anything:\n"
            + "\n".join(f"  {k}: {v}" for k, v in problems.items())
        )

    # One dataset per distinct filter version, shared across the variants using it.
    datasets: dict[str, tuple[str, dict[str, Any]]] = {}
    for filter_version in sorted({v.filter_version for v in variants}):
        path, manifest = build_dataset(
            filter_version=filter_version,
            config=config,
            sweep_id=sweep_id,
            lake_prefix=lake_prefix,
            mock=mock,
            specs_dir=specs_dir,
            upload_to_s3=upload_to_s3,
        )
        dataset_id = f"{sweep_id}-{filter_version.replace('_', '-')}"
        name = client.create_dataset(dataset_id, path)
        datasets[filter_version] = (dataset_id, manifest)
        print(json.dumps({"step": "dataset", "filter": filter_version, "dataset": name}))

    for variant in variants:
        base = BASE_MODELS.get(variant.base)
        if base is None:
            raise SystemExit(f"unknown base {variant.base!r}; have {sorted(BASE_MODELS)}")
        run_id = variant.run_id(sweep_id)
        dataset_id, manifest = datasets[variant.filter_version]
        versions = versions_for(config, variant.filter_version)
        record: dict[str, Any] = {
            "run_id": run_id,
            "sweep_id": sweep_id,
            "variant": asdict(variant),
            "base_model": base["id"],
            "base_status": base["status"],
            "base_context_length": base["context_length"],
            "dataset_id": dataset_id,
            "lora_rank": variant.rank,
            "epochs": variant.epochs,
            "learning_rate": lr,
            "versions": {**{k: getattr(versions, k) for k in versions.__dataclass_fields__}},
            "git_commit": git_sha(),
            "created": datetime.now(UTC).isoformat(timespec="seconds"),
            "dataset_manifest_stats": manifest["stats"],
        }
        try:
            job = client.create_sft_job(
                job_id=run_id,
                dataset_id=dataset_id,
                output_model_id=run_id,
                base_model=base["id"],
                lora_rank=variant.rank,
                epochs=variant.epochs,
                learning_rate=lr,
            )
            record["job"] = job.get("name", run_id)
            record["job_id"] = run_id
            record["state"] = job.get("state")
            record["output_model"] = job.get("outputModel")
        except FireworksError as exc:
            record["error"] = str(exc)[:1500]
            record["state"] = "CREATE_FAILED"

        # Ids to S3 before polling: a crash must not lose the provenance.
        if upload_to_s3:
            meta = versions.as_metadata()
            storage.put_json(f"runs/{sweep_id}/{run_id}/manifest.json", record, meta)
            storage.put_json(f"checkpoints/{run_id}/provider.json", record, meta)
        results.append(record)
        print(json.dumps({"step": "job", "run_id": run_id, "state": record.get("state")}))

    if wait and not dry_run:
        for record in results:
            if record.get("state") == "CREATE_FAILED":
                continue
            try:
                final = client.wait(lambda rid=record["job_id"]: client.get_sft_job(rid))
                record["state"] = final.get("state")
                record["output_model"] = final.get("outputModel")
            except FireworksError as exc:
                record["state"] = "FAILED"
                record["error"] = str(exc)[:1500]
            if upload_to_s3:
                versions = versions_for(config, record["variant"]["filter_version"])
                meta = versions.as_metadata()
                storage.put_json(f"checkpoints/{record['run_id']}/provider.json", record, meta)
            done = {"step": "done", "run_id": record["run_id"], "state": record["state"]}
            print(json.dumps(done))

    return results


def launch_unavailable(backend: str) -> list[dict[str, Any]]:
    raise SystemExit(
        f"backend {backend!r} has no GPU capacity: EC2 G/VT on-demand quota L-DB2E81BA is 0 "
        "(increase 312f3b0f78754d25920d9b0f6482d2feWs3fPUjY, CASE_OPENED) and every SageMaker "
        "g5 training quota is 0. See train/backends/. Use --backend fireworks."
    )


# ------------------------------------------------------------------------- cli


def write_summary(sweep_id: str, results: list[dict[str, Any]], upload: bool) -> str:
    """The sweep index. `train/devset.py` appends the metrics table to it."""
    lines = [
        f"# {sweep_id}",
        "",
        f"Launched {datetime.now(UTC).isoformat(timespec='seconds')} from `{git_sha()}`.",
        "",
        "| run_id | base | rank | epochs | filter | state | output model |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in results:
        v = r["variant"]
        lines.append(
            f"| `{r['run_id']}` | {v['base']} | {v['rank']} | {v['epochs']} | "
            f"{v['filter_version']} | {r.get('state') or '-'} | "
            f"`{r.get('output_model') or '-'}` |"
        )
    failed = [r for r in results if r.get("error")]
    if failed:
        lines += ["", "## Failures", ""]
        lines += [f"- `{r['run_id']}`: {r['error'][:300]}" for r in failed]
    body = "\n".join(lines) + "\n"
    if upload:
        first = results[0] if results else None
        meta = (
            Versions(
                **{k: v for k, v in first["versions"].items() if k in Versions.__dataclass_fields__}
            ).as_metadata()
            if first
            else {}
        )
        storage.put_markdown(f"runs/{sweep_id}/summary.md", body, meta)
    return body


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Launch the LoRA sweep.")
    p.add_argument("--backend", choices=("fireworks", "sagemaker", "ec2"), default="fireworks")
    p.add_argument("--config", type=Path, default=filt.CONFIG_PATH)
    p.add_argument("--sweep-id")
    p.add_argument("--variant", action="append", help="base:rank:epochs:filter_vN; repeatable")
    p.add_argument("--lake-prefix", help="prefix under lake/ to filter")
    p.add_argument(
        "--judged",
        action="store_true",
        help="read lake/<lake_version>/_judge/<judge_version>/ from config -- the judged "
        "tree holds complete records and reads each decision once",
    )
    p.add_argument("--mock", type=int, default=0, help="use N mock lake records instead")
    p.add_argument("--specs-dir", type=Path, default=Path("specs/train"))
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--no-s3", action="store_true", help="skip writes to the bucket")
    p.add_argument("--wait", action="store_true", help="block until every job reaches a end state")
    p.add_argument(
        "--approve-base-swap",
        action="store_true",
        default=os.environ.get("APPROVE_BASE_SWAP", "") not in ("", "0", "false"),
        help="permit sweep bases that are unapproved substitutions (QUESTIONS.md #2)",
    )
    p.add_argument("--out", type=Path, help="also write the results JSON here")
    args = p.parse_args(argv)

    if args.backend != "fireworks":
        launch_unavailable(args.backend)

    config = filt.load_config(args.config)
    cfgv = config["versions"]
    if args.judged:
        args.lake_prefix = judged_lake_prefix(cfgv["lake_version"], cfgv["judge_version"])
    sweep_id = args.sweep_id or default_sweep_id()
    variants = (
        [Variant.parse(v) for v in args.variant] if args.variant else variants_from_config(config)
    )
    if not args.lake_prefix and not args.judged and not args.mock:
        raise SystemExit("pass --lake-prefix (real lake) or --mock N (until gen/run.py lands)")

    results = launch_fireworks(
        variants=variants,
        config=config,
        sweep_id=sweep_id,
        lake_prefix=args.lake_prefix,
        mock=args.mock,
        specs_dir=args.specs_dir,
        dry_run=args.dry_run,
        upload_to_s3=not args.no_s3 and not args.dry_run,
        wait=args.wait,
        approve_base_swap=args.approve_base_swap,
    )
    summary = write_summary(sweep_id, results, upload=not args.no_s3 and not args.dry_run)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(results, indent=2, default=str), encoding="utf-8")
    print(summary)
    return 0 if all(not r.get("error") for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
