# S3 LAYOUT. DRAFT until a human deletes this line.

Bucket name comes from the environment variable `WARGAME_BUCKET` (see `.env.example`; the scaffold default is `svalbard-wargame`). Never hardcode it. AWS credentials come from the CLI profile in `AWS_PROFILE` (`panoptes`), never from a file in the repo.

```python
import os
BUCKET = os.environ["WARGAME_BUCKET"]   # KeyError is the correct failure
```

Region, lifecycle and IAM are Agent 8's (`infra/`). This file fixes only the key layout and the version tags, so that any object found in the bucket can be traced back to the code and configuration that produced it.

---

## 1. Prefixes

| prefix | what | written by | read by |
|---|---|---|---|
| `specs/` | persona specs, exemplar cards, dev-set scenarios | humans (approved from `specs/drafts/`) | Gen, Train, Selfplay, Eval |
| `lake/` | scored decisions, one JSONL record per decision | Gen (`gen/run.py`), Selfplay (`selfplay/run.py`); judged in place by `gen/judge.py` | Train (`train/filter.py`) |
| `runs/` | training-sweep artefacts: filtered datasets, manifests, gate results, dev-set tables, `summary.md` | Train, Selfplay | humans, Eval |
| `checkpoints/` | adapter weights and provider ids per training run, plus `patches.md` for DPO patches | Train (`train/launch.py`, `dpo.py`) | Train (`serve.py`), Selfplay, Eval |
| `validation/` | final validation artefacts: replay tables, held-out action mix, perturbation delta, `heatmap.csv`, `final_report.md` | Eval (`eval/report.py`) | humans, UI |
| `logs/` | episode event logs, one JSONL file per episode per `event_log_schema.json` | Engine (`engine/log.py`) | Engine replay, UI, Eval |

Nothing else goes in the bucket. A seventh prefix is a contract change and goes through `QUESTIONS.md`.

---

## 2. Version tags

Five version strings, all defined in `docs/COORDINATION.md` §8 and registered in `docs/VERSIONS.md`:

| string | pattern | set at | meaning |
|---|---|---|---|
| `env_vN` | `^env_v[0-9]+(_perturbed)?$` | env lock (Agent 1) | engine, storm curves, attack parameters |
| `spec_vN` | `^spec_v[0-9]+$` | when humans approve a spec pool | the persona specs in play |
| `lake_vN` | `^lake_v[0-9]+$` | start of a generation run | prompt template, grid, generating model |
| `filter_vN` | `^filter_v[0-9]+$` | each `train/filter.py` config | judge threshold, utility cutoff, oversampling, weighting |
| `judge_vN` | `^judge_v[0-9]+$` | each judge rubric | the rubric behind `judge_scores` |

Plus `contracts_vN` for this directory, currently `contracts_v1`.

**Rule:** every object carries, both in its key and in its S3 object metadata, every version that could change its content. A result whose versions cannot be recovered is not a result; discard the run.

---

## 3. Key templates

Angle brackets are substitutions. Every segment is lowercase snake_case except ids, which may carry hyphens.

```
specs/<spec_version>/train/<spec_id>.json
specs/<spec_version>/holdout/<spec_id>.json
specs/<spec_version>/devset/<replay_id>.json
specs/<spec_version>/exemplars/<exemplar_id>.md
specs/<spec_version>/manifest.json

lake/<lake_version>/<env_version>/<spec_version>/<scenario_id>/seed=<seed>/<episode_id>.jsonl
lake/<lake_version>/_index/<episode_id>.json
lake/<lake_version>/_judge/<judge_version>/<episode_id>.jsonl

runs/<sweep_id>/<run_id>/dataset_<filter_version>.jsonl
runs/<sweep_id>/<run_id>/manifest.json
runs/<sweep_id>/<run_id>/gates.json
runs/<sweep_id>/<run_id>/devset_table.md
runs/<sweep_id>/summary.md

checkpoints/<run_id>/adapter/            # provider-written weights, if exportable
checkpoints/<run_id>/provider.json       # dataset id, job id, model id, base model, rank, epochs
checkpoints/<run_id>/patches.md          # DPO patch log, appended by train/dpo.py

validation/<eval_id>/final_report.md
validation/<eval_id>/heatmap.csv
validation/<eval_id>/replay_<replay_id>_v<replay_version>.json
validation/<eval_id>/holdout_mix_<psyche>.json
validation/<eval_id>/perturbation.json
validation/<eval_id>/figures/<name>.png

logs/<env_version>/<lake_version>/<scenario_id>/seed=<seed>/<episode_id>.jsonl
```

Id conventions:

- `episode_id` — `<scenario_id>-<seed>-<8 hex>`, e.g. `g5_lowconf_auc-1041-3f9a2b71`. Unique, stable, and the join key between `logs/` and `lake/`.
- `run_id` — `<base>-r<rank>-e<epochs>-<filter_version>-<6 hex>`, e.g. `qwen25_7b-r32-e3-filter_v2-a71c04`.
- `sweep_id` — `sweep-<YYYYMMDD>-<2 digit>`, e.g. `sweep-20260906-01`.
- `eval_id` — `eval-<YYYYMMDD>-<2 digit>`. Exactly one exists for the final run; `eval/report.py` refuses to overwrite an existing `final_report.md`.

`seed=<seed>` is a Hive-style partition so Athena or a plain `aws s3 ls` can select a seed without listing the whole prefix.

---

## 4. Object metadata and tags

Set on every `put_object`:

```python
ExtraArgs = {
    "Metadata": {                     # x-amz-meta-*, returned by head_object
        "env-version":   env_version,
        "spec-version":  spec_version,
        "lake-version":  lake_version,   # "" where not applicable
        "filter-version": filter_version,
        "judge-version": judge_version,
        "contracts-version": "contracts_v1",
        "seed":          str(seed),
        "episode-id":    episode_id,
        "git-commit":    git_sha,
    },
    "Tagging": "project=svalbard",     # cost attribution; infra/teardown.sh keys on it
    "ContentType": "application/x-ndjson",   # or application/json, text/markdown, text/csv, image/png
}
```

Metadata keys are lowercase with hyphens because S3 lowercases them anyway. Values are strings; empty string means not applicable, and a missing key means the writer is out of contract.

`git-commit` is the short SHA of the code that wrote the object. It is what makes a surprising number a debuggable number.

---

## 5. Write discipline

- **Write as you go.** `gen/run.py` writes each lake record when the decision completes. No in-memory lake, no end-of-run flush; a crash at 40k decisions must cost only the episode in flight.
- **Append-only within a version.** Never mutate an object under an existing version tag except the two fields `lake_record_schema.json` marks as late-filled (`judge_scores`, `outcome_utility`). Anything else is a new version.
- **Idempotent judging.** `gen/judge.py` writes to `lake/<lake_version>/_judge/<judge_version>/` and merges on `record_id`, so re-running the whole judge pass with a new rubric neither duplicates nor destroys the previous scores.
- **Content type matters.** JSONL is `application/x-ndjson`, not `application/json`; the UI fetches logs directly and a wrong type breaks streaming parse.
- **No secrets, ever.** No API keys, no `.env`, no AWS credentials in an object body or in metadata. `provider.json` holds provider *ids*, never provider *tokens*.
- **Quarantine.** Nothing derived from `docs/quarantine.md` may appear under `specs/` or `lake/`. Replay material lives in `eval/replays/` in the repo and its results only under `validation/`.

---

## 6. Local mirror

Every path above works unchanged against a local directory for offline development:

```
s3://$WARGAME_BUCKET/<key>   <->   $WARGAME_LOCAL_ROOT/<key>
```

`WARGAME_LOCAL_ROOT` defaults to `./.wargame-local`, which needs a line in the root `.gitignore` (humans own that file; flagged in `contracts/QUESTIONS.md`). Agents should read the bucket through one helper so the switch is a single environment variable, not a code path per module.
