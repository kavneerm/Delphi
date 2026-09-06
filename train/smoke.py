"""End-to-end smoke test on 200 examples, one base at a time.

    python -m train.smoke --base llama31_8b
    python -m train.smoke --base qwen3_8b

Validates the whole Fireworks path before any sweep budget is spent: preflight
the base -> filter the (mock, until Gen lands) lake -> upload a dataset -> one
tiny SFT LoRA job -> bring up an on-demand deployment -> load the adapter -> one
chat request -> tear the deployment down.

Llama went first, deliberately: `llama-v3p1-8b-instruct` is past its deprecation
date (2025-11-26) and reports `Status: INTERNAL`, so if it could not train that
had to be known before the sweep. It trains fine — 200 examples, 371s, adapter
usable. The base that turned out **not** to train was the other one; see
`fireworks.TUNABILITY_NOTE`. Which is the argument for this script existing: the
model-library flags are not the answer, a 200-example job is.

The deployment is billed per GPU-hour. Teardown runs in a `finally` block, and
`--no-deploy` stops after training for a cheaper first pass. `--reuse-model`
finishes an interrupted run's deployment leg without paying to train twice.
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from train import filter as filt
from train.fireworks import BASE_MODELS, Client, FireworksError

SMOKE_EXAMPLES = 200
WORK_DIR = Path(".wargame-local/tmp")


def _stamp() -> str:
    return datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")


def _log(step: str, **fields: object) -> dict:
    row = {"t": datetime.now(UTC).isoformat(timespec="seconds"), "step": step, **fields}
    print(json.dumps(row, default=str), flush=True)
    return row


def build_dataset(out: Path, examples: int = SMOKE_EXAMPLES) -> dict:
    """200 chat-format examples through the real filter, from the mock lake."""
    config = filt.load_config()
    records, source = filt.read_lake(None, examples * 2)
    rows, stats = filt.filter_records(records, filter_version="filter_v0", config=config)
    rows = rows[:examples]
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    return {"path": str(out), "examples": len(rows), "source": source, "stats": stats.as_dict()}


def _deploy_and_probe(
    client: Client,
    result: dict,
    trail: list[dict],
    base: dict[str, Any],
    deployment_id: str,
    keep_up: bool,
) -> dict:
    """Bring up a deployment, load the adapter, send one request, tear it down."""
    created = False
    try:
        result["deployment_up"] = datetime.now(UTC).isoformat(timespec="seconds")
        client.create_deployment(deployment_id=deployment_id, base_model=base["id"])
        created = True
        client.wait(
            lambda: client.get_deployment(deployment_id),
            done=("READY",),
            failed=("FAILED", "DELETING", "UNSPECIFIED"),
            interval=15,
            timeout=1800,
        )
        trail.append(_log("deployment_ready", deployment=deployment_id))

        deployed = client.load_lora_and_wait(deployment_id, result["output_model"])
        result["deployed_model"] = deployed.get("name")
        trail.append(
            _log("adapter_loaded", model=result["output_model"], deployed=deployed.get("name"))
        )

        # Which `model` string actually routes to an adapter on a dedicated
        # deployment is undocumented and the failure modes differ. Probe the
        # candidates once, here, inside a deployment that is already up.
        ref, probe = client.probe_inference_ref(result["output_model"], deployment_id)
        result["inference_ref_probe"] = probe
        result["inference_ref"] = ref
        trail.append(_log("inference_ref_probe", winner=ref, tried=len(probe)))
        if ref is None:
            raise FireworksError(
                "no inference ref routed to the adapter: "
                + "; ".join(f"{p['ref']} -> {p['result'][:80]}" for p in probe)
            )

        reply = client.chat(
            model=ref,
            messages=[
                {"role": "system", "content": "You are the norway seat. Smoke test."},
                {"role": "user", "content": "Uplink degraded, Kp 8 reported. One sentence: hold?"},
            ],
            max_tokens=64,
            temperature=0.0,
        )
        text = reply["choices"][0]["message"]["content"]
        result["sample_completion"] = text[:400]
        trail.append(_log("inference_ok", chars=len(text)))
        result["ok"] = True
    except FireworksError as exc:
        result["error"] = str(exc)[:2000]
        trail.append(_log("failed", error=str(exc)[:400]))
    finally:
        if created and not keep_up:
            try:
                client.delete_deployment(deployment_id)
                result["deployment_down"] = datetime.now(UTC).isoformat(timespec="seconds")
                trail.append(_log("deployment_deleted", deployment=deployment_id))
            except FireworksError as exc:
                result["teardown_error"] = str(exc)[:500]
                trail.append(_log("teardown_failed", error=str(exc)[:400]))
    result["trail"] = trail
    return result


def run(
    base_key: str,
    *,
    deploy: bool = True,
    keep_up: bool = False,
    dry_run: bool = False,
    job_timeout: int = 5400,
    reuse_model: str | None = None,
) -> dict:
    base = BASE_MODELS[base_key]
    stamp = _stamp()
    tag = f"smoke-{base_key.replace('_', '-')}-{stamp.lower()}"
    client = Client.from_env(dry_run=dry_run)
    trail: list[dict] = []
    result: dict = {
        "base_key": base_key,
        "base_model": base["id"],
        "base_status": base["status"],
        "started": stamp,
        "ok": False,
    }
    trail.append(_log("start", base=base["id"], status=base["status"], account=client.account))

    if not dry_run:
        problems = client.preflight([base_key])
        if problems:
            result["error"] = problems[base_key]
            trail.append(_log("preflight_failed", error=problems[base_key]))
            result["trail"] = trail
            return result
        trail.append(_log("preflight_ok", supervised_lora_tunable=True))

    deployment_id = f"{tag}-dep"

    if reuse_model:
        result["output_model"] = reuse_model
        result["reused"] = True
        trail.append(_log("reusing_model", model=reuse_model))
        return _deploy_and_probe(client, result, trail, base, deployment_id, keep_up)

    dataset_path = WORK_DIR / f"{tag}.jsonl"
    built = build_dataset(dataset_path)
    trail.append(_log("dataset_built", **{k: v for k, v in built.items() if k != "stats"}))
    result["dataset_examples"] = built["examples"]

    try:
        result["dataset"] = client.create_dataset(tag, dataset_path)
        trail.append(_log("dataset_uploaded", dataset=result["dataset"]))

        job = client.create_sft_job(
            job_id=tag,
            dataset_id=tag,
            output_model_id=tag,
            base_model=base["id"],
            lora_rank=8,
            epochs=1,
            max_context_length=4096,
        )
        result["job"] = job.get("name", tag)
        trail.append(_log("sft_job_created", job=result["job"], state=job.get("state")))

        if dry_run:
            result["ok"] = True
            result["trail"] = trail
            return result

        started = time.monotonic()
        final = client.wait(lambda: client.get_sft_job(tag), timeout=job_timeout)
        result["train_seconds"] = round(time.monotonic() - started)
        result["output_model"] = final.get("outputModel")
        trail.append(
            _log(
                "sft_job_done",
                state=final.get("state"),
                model=result["output_model"],
                seconds=result["train_seconds"],
            )
        )
    except FireworksError as exc:
        result["error"] = str(exc)[:2000]
        trail.append(_log("failed", error=str(exc)[:400]))
        result["trail"] = trail
        return result

    if not deploy:
        result["ok"] = True
        result["note"] = "trained; deployment skipped (--no-deploy)"
        result["trail"] = trail
        return result

    return _deploy_and_probe(client, result, trail, base, deployment_id, keep_up)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="200-example Fireworks smoke test.")
    p.add_argument("--base", choices=sorted(BASE_MODELS), required=True)
    p.add_argument("--no-deploy", action="store_true", help="stop after the training job")
    p.add_argument("--keep-up", action="store_true", help="do not tear the deployment down")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--job-timeout", type=int, default=5400)
    p.add_argument(
        "--reuse-model",
        help="skip training and deploy this already-tuned model, to finish an "
        "interrupted smoke without paying to train twice",
    )
    p.add_argument("--out", type=Path, help="write the result JSON here")
    args = p.parse_args(argv)

    result = run(
        args.base,
        deploy=not args.no_deploy,
        keep_up=args.keep_up,
        dry_run=args.dry_run,
        job_timeout=args.job_timeout,
        reuse_model=args.reuse_model,
    )
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k != "trail"}, indent=2, default=str))
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
