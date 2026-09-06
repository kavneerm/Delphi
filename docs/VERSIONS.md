# VERSIONS
| version | what | commit | set by | when | note |
|---|---|---|---|---|---|
| env_v0 | placeholder storm/attack curves | — | scaffold | — | replaced by env_v1 at env_lock |
| contracts_v1 | frozen interfaces: spec/action/event_log/inject/lake_record/env_config schemas, s3_layout, seats | 7e00826 | agent0-contracts | 2026-09-05 | 77 tests green; DRAFT markers removed by a human at merge |
| contracts_v1 (rev) | nine-seat fold: nato/ksat/hacktivist folded; nsc human-playable; env_config adds clock_mode + release_policy; 5 new event types | 7660c65 | agent0-contracts | 2026-09-05 | human scope change, applied before merge and before any consumer, so a revision of v1 rather than a v2 |

## Fireworks deployment log

`train/serve.py` writes one row per up/down; the rows below for the smoke test
were backfilled by hand from `.wargame-local/smoke/*.log`, since the smoke test
predates `serve.py`. The deployment is billed **per GPU-hour**: a gap between an
`up` row and its `down` row is money spent, and every row here should have a
`down` within minutes of its `up`.

| up (UTC) | down (UTC) | minutes | deployment | base | purpose | outcome |
|---|---|---|---|---|---|---|
| 2026-09-06 02:04:42 | 2026-09-06 02:07:20 | 2.6 | `smoke-llama31-8b-20260906t020441z-dep` | llama31_8b | smoke: deploy leg | adapter loaded; inference 404 (`Model not found`) |
| 2026-09-06 02:12:36 | 2026-09-06 02:15:45 | 3.2 | `smoke-llama31-8b-20260906t021235z-dep` | llama31_8b | smoke: deploy leg | adapter loaded; inference 404 (`fault filter abort`) |
| 2026-09-06 02:18:07 | 2026-09-06 02:21:19 | 3.2 | `smoke-llama31-8b-20260906t021806z-dep` | llama31_8b | smoke: 4-way inference-ref probe | all four refs 404 |

**Running total: 9.0 GPU-minutes on H100, all on the llama31_8b smoke path.**
No qwen3_8b deployment has ever reached `READY` — every attempt was refused at
create time by the addon/quantization check, which costs nothing.

Every one of those deployments was torn down by the `finally` block in
`train/smoke.py`, and the account has been verified at **0 live deployments**
after each attempt. No deployment has ever been left up.

Training jobs are billed separately from deployments and are not GPU-hour
metered the same way; for the record, the two smoke SFT jobs were
`smoke-llama31-8b-20260906t015356z` (200 examples, rank 8, 1 epoch, 371s,
COMPLETED) and `smoke-qwen3-8b-20260906t020721z` (same shape, COMPLETED).

### Deployment log, continued

| up (UTC) | down (UTC) | minutes | deployment | base | purpose | outcome |
|---|---|---|---|---|---|---|
| 2026-09-06 02:28:53 | 2026-09-06 02:34:52 | 6.0 | `smoke-llama31-8b-20260906t022852z-dep` | llama31_8b | smoke: deploy leg | **SUCCESS** — adapter loaded, inference returned a completion |

That row is the first successful serve, and it is also the one that exposed a
teardown gap worth recording: Fireworks **refuses a plain delete on a deployment
that has served traffic in the last hour** (`400 "deployment has received
inference requests in the last hour, pass ignore_checks to skip this check"`).
The check is backwards for this project — the deployments most needing teardown
are exactly the ones that just answered a dev-set request — and the failure mode
is a GPU billing by the hour. It was caught and deleted manually within ~2
minutes. `Client.delete_deployment` now passes `ignoreChecks=true` by default and
`ensure_deployment_gone()` confirms the deployment is actually gone rather than
assuming the DELETE worked.

**Running total: 15.0 H100-minutes.** Account verified at 0 live deployments.
