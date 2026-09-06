# REPORT — agent4-train

Status at time of writing: the full Fireworks path is **verified end to end** on
`llama31_8b` — filter, dataset upload, SFT LoRA, deployment, adapter load, a real
completion, teardown. What is not done is the sweep itself, which waits on a
human decision (the second base, `train/QUESTIONS.md` #2) and on real data from
agent3-gen. Read `docs/status/agent4-train.md` for the live state.

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
| `train/storage.py`, `train/versions.py` | thin adapter over `infra.storage` (the project's one bucket helper) plus the version-string pattern validation it deliberately omits |
| `train/mocklake.py` | contract-valid stand-in for `lake/` until agent3-gen writes it |
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
140 passed
```

Nine files. The ones worth knowing about:

- `test_serve.py` drives `ServedAgent` through the **real** `engine.agent_api`
  protocol with a stubbed Fireworks client — no network, no GPU — including that
  a refusal, bad JSON and a dropped connection all become a contract-valid hold.
- `test_lake_conformance.py` runs the filter against contract-legal but awkward
  records: unjudged, `outcome_utility: null`, an orphaned pair arm, a missing
  token count, a prompt over the floor. These are the shapes the real lake will
  have on the night it lands.
- `test_filter.py` pins the double-read hazard agent3-gen flagged, including a
  test that demonstrates the 2x dataset the bug would otherwise produce.
- `test_devset.py` asserts no quarantined metric name is hardcoded, by reading
  `train/devset.py` and checking every non-measurable target name against it.

Four of them caught real bugs in my own code: the resource-id regex rejected
single-character ids; `Versions.as_metadata()` omitted `seed` and `episode-id`;
`versions_for()` silently accepted a filter version no config defined, which
would have tagged unreproducible runs; and the mock lake had two schema-invalid
action params.

## Versions produced

None yet — no sweep has run. `train/config.yaml` currently points at the `_v0`
placeholders (`env_v0`, `spec_v0`, `lake_v0`, `judge_v0`) because Engine has not
locked `env_v1`, humans have not approved a spec pool, and Gen has not written
`lake_v1`. `filter_v0` is the smoke-path filter; `filter_v1`..`filter_v3` are the
real sweep arms. Every artefact carries all five strings plus the git SHA.

## Untested / known gaps

- **No real lake.** Everything is exercised against `train/mocklake.py`, whose
  judge scores are drawn from a uniform distribution — nothing like what a real
  judge produces. The thresholds in `filter_v1`..`v3` are therefore guesses, and
  the sensible expectation is that all three need re-tuning against real score
  distributions once `lake_v1` lands, each with a version bump.
- **The sweep has never run.** Ten variants are configured and `--dry-run`
  exercises the whole path, but no real SFT job beyond the two 200-example smoke
  jobs has been submitted.
- **Serving is proven for one adapter, not for multi-LoRA.** The smoke test put
  one adapter on one deployment and got a completion back. Loading *many*
  adapters onto one deployment and selecting between them per request — which is
  the actual serving design — has never been exercised, because there has never
  been more than one adapter to load.
- **`gates.py --online` and `devset.py` have never run**, because `specs/holdout/`
  and `specs/devset/` are empty. The gate thresholds in `config.yaml` are
  therefore guesses; nothing has ever been graded against them.
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
every commit. `tests/train/test_devset.py` adds a second, independent check that
reads `train/devset.py` and asserts no non-measurable target name appears in it.

Caveat worth carrying: agent7-ui warned that the hook's PATTERNS match the
hyphenated and space-separated spellings only, not the underscored lowercase form
an asset id or spec field would use. `train/` is clean under both, but a green
hook is not proof for anyone else.

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

- → agent3-gen (02:12): two writers for one bucket over disjoint prefixes;
  comparing them found my missing metadata keys.
- → agent3-gen (03:00): acted on their lake prefix hazard, and hardened past the
  advice — `--judged` resolves the right prefix, and `read_lake()` dedupes on
  `record_id` regardless of what prefix it is given, because a flag only helps
  whoever reads it.
- → agent8-infra (03:00): scratch moved out of the mirror key space; corrected
  their read that smoke writes bad S3 keys (they were local paths) while
  confirming the underlying problem was real.
- → agent7-ui, coordinator (03:00): seconded the quarantine-hook warning with the
  leak it caught in `devset.py`.

**Handoffs received and acted on:** `engine.agent_api` (agent1), `infra.storage`
(agent8), the lake prefix hazard (agent3), the GPU-quota decision to stay on
Fireworks (agent8).

Nothing is published under `interfaces_ready` yet. `train/serve.py` is what
agent5-selfplay and agent6-eval wait on; one adapter on one deployment works, but
multi-LoRA selection is unexercised, so it is not ready to hand over.
