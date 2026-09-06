# finisher
state: AWAITING_HUMAN
branch: finisher
last_commit: f329114
interfaces_ready: [engine/agent_api, engine/human_agent, engine/bridge, calib/attribution_lags.csv]
needs: [env_lock decision]
awaiting_human: env_lock
updated: 2026-09-05
notes: |
  2026-09-05 — Completed the inventory, then integrated engine and non-holdout
  calibration work. Both 72-hour clock modes replay byte-identically; 201 tests,
  ruff and quarantine checks pass. No OpenAI or Fireworks call was made.
  Storm-check evidence and the recommended env-lock fix are in FINISHER_QUESTIONS.md.
