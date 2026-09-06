# finisher
state: IN_PROGRESS
branch: finisher
last_commit: bdfabf4
interfaces_ready: [engine/agent_api, engine/human_agent, engine/bridge, calib/attribution_lags.csv, specs/train, specs/exemplars, gen/agent]
needs: []
awaiting_human:
updated: 2026-09-06 05:39 UTC
notes: |
  2026-09-05 — Completed the inventory, integrated engine and non-holdout
  calibration work, fixed the low-Kp/high-density storm defect, and promoted the
  reviewed train persona pool plus exemplar bank. env_v1 is
  frozen: February now reports 36 tracking hours and a nonzero safe-mode median;
  both 72-hour clock modes replay byte-identically. 202 tests, ruff and quarantine
  checks pass. The storage/audit, Fireworks training pipeline, and UI playback/live
  bridge are integrated; 419 tests passed immediately before the UI merge validation.
  The user-approved live Terra cost check completed sequentially: 10 72-hour episodes,
  90 sealed decisions/calls, 1,421,936 prompt tokens (1,027,120 cached), 52,159 output
  tokens including 6,313 reasoning tokens, zero failures/retries, and mean latency
  6.07 seconds. At Terra flex prices this is $1.62 for the sparse nine-decision sample.
  UI playback was served locally against `ui/data/run_seed1_continuous.jsonl` and
  verified to load a real engine `state_change` event. The focused asset/websocket
  suite passed (7 tests); the full log-schema suite is intentionally slow because it
  validates every event in the bundled multi-thousand-line logs. Full lake generation
  is now approved with a $1,500 cap. The production runner is capped at 36
  continuous-clock episodes (about 36,288 decisions; $1,398 conservative projection)
  and is ready to launch after its local environment rebuild and validation.

  2026-09-06 05:39 — Luna generation was first started at sixteen concurrent
  full-size calls, but all bridge workers blocked while the async loop was idle.
  It was stopped before it wrote a record. The provider and bridge pass
  single-call probes; eight concurrent calls also pass a live structured-output
  probe. `gen/run.py` now caps the production batch at eight (`cfdd044`), and
  the approved 36-episode run has been restarted with eight established provider
  connections. The read-only judge poll remains running; it will not make
  judge-model calls until a current cost estimate is presented. Filter
  verification retained 170/200 mock records with valid chat shape, intact pairs,
  manifest versions and the 32k-floor focused checks. Offline gates correctly
  fail repetitive mock pairs while passing schema/persona checks. Fireworks full
  smoke had already completed on llama31_8b; a later reuse-only deployment was
  manually torn down after the terminal interrupted its runner, and the account
  was reconfirmed at zero live deployments.
