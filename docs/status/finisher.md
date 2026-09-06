# finisher
state: AWAITING_HUMAN
branch: finisher
last_commit: pending
interfaces_ready: [engine/agent_api, engine/human_agent, engine/bridge, calib/attribution_lags.csv, specs/train, specs/exemplars, gen/agent]
needs: [GEN_MODEL environment setting, approval for 3960-call live cost check]
awaiting_human: cost_check
updated: 2026-09-05
notes: |
  2026-09-05 — Completed the inventory, integrated engine and non-holdout
  calibration work, fixed the low-Kp/high-density storm defect, and promoted the
  reviewed train persona pool plus exemplar bank. env_v1 is
  frozen: February now reports 36 tracking hours and a nonzero safe-mode median;
  both 72-hour clock modes replay byte-identically. 202 tests, ruff and quarantine
  checks pass. No OpenAI or Fireworks call has been made. Added a no-spend generation
  preflight: the representative ten-episode check is 3,960 calls and has a $341.73
  conservative ceiling. Awaiting explicit approval and GEN_MODEL before live calls.
