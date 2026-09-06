# FINISHER PLAN

Inventory timestamp: 2026-09-05.  Base: `origin/main` at `9f1413b`.

This is an integration plan only.  No implementation branches have been merged
into `finisher` yet.

## Branch and PR audit

| workstream | branch / last commit | merged to main | open PR | inventory finding |
|---|---|---:|---|---|
| contracts | `agent0-contracts` / `bcc5c16` | yes | none | `contracts_v1` is approved; schemas are present and no `DRAFT` marker remains. |
| engine | `agent1-engine` / `279f08c` | no | [#2](https://github.com/kavneerm/Delphi/pull/2) | 12 commits ahead; deterministic engine, bridge, human agent, both clocks and env-lock analysis. |
| calibration | `agent2-calib` / `b171648` | partly | [#5](https://github.com/kavneerm/Delphi/pull/5) | Main has storm/rate/series baseline; branch adds attribution lags, holdout isolation, citations and tests. |
| generation | `agent3-gen` / `1f34596` | integrated on `finisher` | none | Prompt, strict schema projection, async `GenAgent`, real-engine integration, plus now-promoted `specs/train` and exemplars. `sweep/run/judge/cost_check/sample_review` still need implementation. |
| training | `agent4-train` / `1d0d67d` | no | none | 5 commits ahead; Fireworks smoke path, filtering, gates, serving, DPO/continue and tests. |
| self-play | none | no | none | not started; explicitly non-critical until all required demo work is done. |
| evaluation | none | no | none | not started; must only run after human `eval_trigger`. |
| UI | `agent7-ui` / `2913ea6` | no | none | offline playback console and human-seat UI exist; live bridge/capture/report remain. |
| infrastructure | `agent8-infra` / `3338f7d` | partly | [#3](https://github.com/kavneerm/Delphi/pull/3) | Main already has bootstrap/storage; branch adds audit/selftest and hardening. |
| specs | `agent9-specs` / `c2d5578` | no | [#4](https://github.com/kavneerm/Delphi/pull/4) | 25 train, 4 holdout, 10 exemplars, 8 devsets are staged under `specs/drafts/`, pending promotion. |
| replay drafts | `agent10-replays` / `8ac10e1` | no | [#6](https://github.com/kavneerm/Delphi/pull/6) | Six quarantine-contained drafts; human must promote reviewed files into protected `eval/replays/`. |
| pitch | none | no | none | not started; parallel, not required for the runnable demo definition. |

`agent0-contracts` is an ancestor of main.  Every listed unmerged branch is
ahead of `origin/main`; agent9 is additionally 19 commits behind and needs a
careful conflict resolution.  GitHub currently reports PRs #2–#6 above and no
PRs for generation, training, UI, self-play, evaluation, or pitch.

## Critical-path gap ranking

1. **Contracts — complete.** Frozen interfaces and approved `contracts_v1` are on main.  Open non-blocking contract questions include the local-mirror ignore rule, the exact evaluation metric scope, and a commercial capacity action gap discovered by replay drafting.

2. **Engine / env lock — nearly complete but blocked at a real gate.** Agent 1 reports byte-identical 72-hour replay in continuous and checkpoint modes, storm/release checks, human agent, query/bridge and sample logs.  Its `ENV_LOCK.md` identifies the material defect: the February 2022 low-Kp/high-density profile produces zero degradation, losses, and safe modes because the model keys harm to Kp alone.  Recommendation: make the documented density/drag and persistence fixes before freezing `env_v1`, then stop at `env_lock`.  The attribution-lag regime (first indication rather than public attribution) also needs explicit acceptance.

3. **Calibration — integrate immediately after engine compatibility review.** Main already supplies the first calibration tables; PR #5 supplies `attribution_lags.csv`, holdout isolation, provenance and tests.  The engine reads its long storm-table format and attribution rows.  Open calibration decisions: accept derived first-indication lags for a 72-hour exercise, and accept the constructed incident table/provenance method.

4. **Generation — implementation is incomplete and generation is gated.** Merge the existing safe foundation only after engine lock.  Finish `lake.py`, grid/sweep, run writer, judge, 10-episode cost check and sample review.  Do not call a model before the engine gate.  At `cost_check`, print hidden reasoning-token usage and estimated total; wait for `gen/APPROVED` before any full run.  Specs must be promoted or deliberately consumed from their drafts under an explicit human decision first.

5. **Training — code is unusually complete; data and human choices are missing.** It has a successful Llama 3.1 8B end-to-end Fireworks smoke path and successful deployment inference, with 15 H100 minutes recorded and no live deployment.  It cannot proceed without judged lake records, promoted specs/devset, and a choice of second base.  Recommendation: approve `accounts/fireworks/models/qwen3-14b` as the measurable train-and-serve second arm, or run a Llama-only reduced sweep; use no more than four variants.  Reconcile the devset layout adapter from agent9 before the online gate/devset run.

6. **Evaluation — deliberately deferred.** No implementation exists and replay material remains quarantined in drafts.  Build only after a candidate is selected; run exactly once after `eval_trigger`.

## Parallel demo work

- **Specs:** promote after the review command in `specs/drafts/REVIEW.md`; the branch contains a valid pool and a contract-faithful devset projection.  The training devset loader currently expects a different shape, so integration must use `devset_view.py` or update Train without changing contracts.
- **UI:** merge after engine because it contains large real logs and depends on engine assets.  Validate an offline real-log playback first; connect the existing engine bridge only if it remains stable.  Produce a fallback recording either way.
- **Replay drafts:** do not merge into `eval/replays/` automatically; their contents are quarantine material and need human review/promotion.
- **Infra:** merge audit/selftest hardening when it does not conflict.  `infra.storage` is the canonical helper; engine, generation and train should delegate to it with S3 as default.  No EC2/SageMaker launch: quota remains insufficient.

## Decisions needing human input

1. **env_lock:** approve the recommended storm density/drag/persistence fix and first-indication attribution-lag regime, then inspect the re-run.
2. **spec promotion / sample material:** approve `specs/drafts/promote.py --all` (or name exclusions).  This is prerequisite to meaningful generation and gates.
3. **cost_check:** approve the 10-episode reported spend before full generation.
4. **sample_review:** approve the judge/lake samples before training.
5. **training base:** approve Qwen3-14B as the second train-and-serve base, or explicitly select Llama-only; then review the reduced sweep and select `candidate_final`.
6. **evaluation:** trigger once only after a candidate is approved.

## Integration sequence after approval

Create and remain on `finisher` from this base; merge in this order, running
`ruff`, focused/full `pytest`, an engine stub/replay check where applicable, and
`scripts/check_quarantine.sh` after every merge:

1. `agent1-engine` (do not freeze until the human gate), then `agent2-calib`.
2. `agent9-specs`; resolve its stale-base conflicts in favor of main plus the validated draft material.
3. `agent3-gen`, then `agent4-train`, including the spec/devset adapter.
4. `agent8-infra` hardening where non-conflicting.
5. `agent7-ui` and a real-log playback verification.
6. Keep replay drafts quarantined pending review; implement evaluation only on trigger.  Skip self-play unless all prior required work is complete.

Before any external run over 100 calls, print the estimate and stop.  Every
OpenAI invocation must use the environment-selected flex-tier model at low
reasoning effort; Fireworks deployments must be torn down immediately and logged
in `docs/VERSIONS.md`.
