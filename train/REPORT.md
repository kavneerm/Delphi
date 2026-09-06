# REPORT — agent4-train

Status at time of writing: the training path is verified end to end through
*training*; the *serving* leg is still being closed out. Read
`docs/status/agent4-train.md` for the live state and `train/QUESTIONS.md` for the
one open decision (the second base).

## What I built

| file | what it does |
|---|---|
| `train/config.yaml` | the only place sweep and filter numbers live: four `filter_vN` blocks, ten sweep variants, serve/DPO/gate settings |
| `train/filter.py` | lake -> chat-format JSONL + manifest; judge thresholds, per-persona utility percentile, counterfactual oversampling, seat weights, identical-pair drop, context-floor length check |
| `train/launch.py` | the sweep: one SFT LoRA job per variant, one dataset per distinct filter version shared across the variants using it, provider ids to S3 before polling |
| `train/serve.py` | one deployment per base with every sweep adapter loaded as multi-LoRA; `ServedAgent` implements `engine.agent_api`; `--down`; up/down logged to `docs/VERSIONS.md` |
| `train/gates.py` | schema validity, counterfactual sensitivity, held-out persona coherence; `--offline` scores recorded outputs with no GPU |
| `train/devset.py` | `specs/devset/` against served adapters, metrics table graded against `contracts/targets.md` |
| `train/continue_run.py` (+ `continue.py` shim) | round-2 continue-from-LoRA; warm start only, never from base |
| `train/dpo.py` | preference pairs at the same decision point on one judge dimension; one epoch; patch note to `checkpoints/<run_id>/patches.md` |
| `train/fireworks.py` | REST client: datasets, SFT/DPO jobs, deployments, multi-LoRA, inference, polling, base preflight |
| `train/storage.py`, `train/versions.py` | S3 + local-mirror writer and the five version strings, with the §4 metadata block enforced |
| `train/mocklake.py` | contract-valid stand-in for `lake/` until agent3-gen writes it |
| `train/agent_api_shim.py` | real `engine.agent_api` if merged, contract-shaped mock otherwise |
| `train/backends/{sagemaker,ec2}.py` | unexercised stubs; no GPU quota exists |

## How to run it

```bash
# filter (mock lake until gen/run.py lands)
python -m train.filter --filter filter_v1 --mock 2000 --out runs/local/dataset.jsonl

# 200-example end-to-end smoke on one base
python -m train.smoke --base llama31_8b

# the sweep
python -m train.launch --backend fireworks --lake-prefix lake/lake_v1/ --wait

# eval window: bring it up, gate, score, tear it down
python -m train.serve  --up   --sweep-id <sweep> --base llama31_8b
python -m train.gates  --sweep-id <sweep>
python -m train.devset --sweep-id <sweep>
python -m train.serve  --down --sweep-id <sweep> --base llama31_8b
```

`--dry-run` on `launch`/`continue`/`dpo` prints the request bodies without
calling out. `gates.py --offline` needs no deployment at all.

## Tests

```
$ .venv/bin/python -m pytest tests/train -q
53 passed
```

Covering: the identical-pair drop (including a pair that differs only in prose),
the context-floor check in both `drop` and `flag` modes, per-persona utility
cutoffs, the chat shape, manifest completeness, all three gates against the real
`action_schema` via a `referencing` registry, resource-id coercion, dry-run
bodies, the accelerator and addon defaults, and the §4 metadata contract.

Two of them caught real bugs in my own code: the resource-id regex rejected
single-character ids, and `Versions.as_metadata()` was omitting `seed` and
`episode-id`.

## Versions produced

None yet — no sweep has run. `train/config.yaml` currently points at the `_v0`
placeholders (`env_v0`, `spec_v0`, `lake_v0`, `judge_v0`) because Engine has not
locked `env_v1`, humans have not approved a spec pool, and Gen has not written
`lake_v1`. `filter_v0` is the smoke-path filter; `filter_v1`..`filter_v3` are the
real sweep arms. Every artefact carries all five strings plus the git SHA.

## Untested / known gaps

- **No real lake.** Everything is exercised against `train/mocklake.py`. The
  filter's judge and utility thresholds are guesses until real score
  distributions exist; expect to re-tune `filter_v1`..`v3` once `lake_v1` lands,
  with a version bump.
- **Serving is not yet proven.** Training and teardown work; the inference call
  to a loaded adapter does not yet route (see the status file). `serve.py`,
  `gates.py --online` and `devset.py` are therefore untested against a live
  endpoint, and the gate thresholds have never been evaluated on a real model.
- **`continue_run.py` and `dpo.py` have not been run against Fireworks at all** —
  dry-run only. They are round-2 tools and there is no round-1 checkpoint yet.
- **`sagemaker` and `ec2` are stubs that raise.** EC2 G/VT quota `L-DB2E81BA` is
  0 (increase `312f3b0f78754d25920d9b0f6482d2feWs3fPUjY`, `CASE_OPENED`); every
  SageMaker g5 training quota is 0.
- **Held-out coherence is a structural proxy.** It checks the action against the
  spec's authority envelope; the judged version is `gen/judge.py`'s authority
  dimension. Do not read it as a semantic coherence score.
- **`specs/holdout/` and `specs/devset/` are empty**, so `gates.py` online and
  `devset.py` exit with an explanation rather than running.

## Quarantine check

Searched `train/` and `tests/train/` for every incident name and control in
`docs/quarantine.md`, via the `scripts/check_quarantine.sh` pre-commit hook on
every commit.

One real hit, and it is worth recording because it was not obvious: `devset.py`
had copied the machine-readable target table out of `contracts/targets.md`, and
one of those metric names is derived from a quarantined replay. Copying a frozen
contract was the underlying mistake; the fix removes both problems at once —
`devset.py` now parses that table from the contract at runtime and names the
un-measurable rows from whatever it reads, so no quarantined string lives in
`train/` and the targets cannot drift out of sync either. No quarantined material
reaches any prompt, dataset or exemplar: the only text that reaches a model is
`filter.py`'s chat rendering of lake records and specs.

## Handoffs made

- `docs/HANDOFFS.md`, 2026-09-06 02:12 → agent3-gen: `train/storage.py` and
  `gen/storage.py` are two writers for one bucket over disjoint prefixes;
  comparing them found the missing metadata keys. Live S3 path verified.

Nothing is published under `interfaces_ready` yet. `train/serve.py` is what
agent5-selfplay and agent6-eval wait on, and it is not ready to hand over.
