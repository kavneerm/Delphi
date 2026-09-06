# finisher
state: IN_PROGRESS
branch: finisher
last_commit: pending
interfaces_ready: [engine/agent_api, engine/human_agent, engine/bridge, calib/attribution_lags.csv]
needs: [spec promotion, generation cost check]
awaiting_human:
updated: 2026-09-05
notes: |
  2026-09-05 — Completed the inventory, integrated engine and non-holdout
  calibration work, and fixed the low-Kp/high-density storm defect. env_v1 is
  frozen: February now reports 36 tracking hours and a nonzero safe-mode median;
  both 72-hour clock modes replay byte-identically. 202 tests, ruff and quarantine
  checks pass. No OpenAI or Fireworks call has been made. Next: spec/gen integration
  and the mandatory 10-episode cost check.
