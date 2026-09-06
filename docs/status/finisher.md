# finisher
state: IN_PROGRESS
branch: finisher
last_commit: 89d0a7a
interfaces_ready: [engine/agent_api, engine/human_agent, engine/bridge, calib/attribution_lags.csv, specs/train, specs/exemplars, gen/agent]
needs: [generation runner, cost check approval]
awaiting_human:
updated: 2026-09-05
notes: |
  2026-09-05 — Completed the inventory, integrated engine and non-holdout
  calibration work, fixed the low-Kp/high-density storm defect, and promoted the
  reviewed train persona pool plus exemplar bank. env_v1 is
  frozen: February now reports 36 tracking hours and a nonzero safe-mode median;
  both 72-hour clock modes replay byte-identically. 202 tests, ruff and quarantine
  checks pass. No OpenAI or Fireworks call has been made. The merged Gen branch has
  prompt/agent/client foundations but lacks sweep/run/judge/cost-check commands; finish
  those before the mandatory 10-episode cost check.
