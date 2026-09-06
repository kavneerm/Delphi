# agent0-contracts
state: DONE
branch: agent0-contracts
last_commit: 7660c65
interfaces_ready: [contracts/spec_schema.json, contracts/action_schema.json, contracts/event_log_schema.json, contracts/inject_schema.json, contracts/lake_record_schema.json, contracts/env_config_schema.json, contracts/s3_layout.md, contracts/seats.md, contracts/examples/]
needs: []
awaiting_human: contract review — delete the DRAFT lines from all ten files in contracts/ and answer contracts/QUESTIONS.md (Q2 pyproject.toml, Q6 metric scope, Q9a Norway holding geofence_or_throttle) before Wave 1 launches
updated: 2026-09-05
notes: |
  2026-09-05 — contracts_v1 complete, then revised in place for the human nine-seat fold.
  Six JSON schemas, s3_layout.md, seats.md rewritten, README.md with the cross-ref registry
  recipe, four examples that validate. 77 tests green under tests/agent0-contracts; ruff clean.
  The fold: seats are the nine (nato and ksat folded into utility terms and Norway's ground
  segment, hacktivist into the hacktivist_injects rule actor with a per-run hidden affiliation).
  nsc is the human-playable seat. New contract env_config_schema.json carries clock_mode
  {continuous | checkpoint(fixed|variable_tempo|adaptive)} and release_policy
  {human | auto(approval_probability)}; event_log gains checkpoint, release_requested,
  release_granted, release_denied, human_action. Both modes emit the same log format — the
  property everything downstream depends on.
  Surprising and worth knowing: four schema descriptions named quarantined incidents
  (Dozor, Intelsat-33e, Galaxy 15). Structured outputs send description text to the model,
  so a quarantined name in action_schema.json would have been in every generation prompt.
  All four scrubbed; grep list is in contracts/REPORT.md, re-run it after any contract edit.
  Ten open questions in contracts/QUESTIONS.md, none blocking. Next: open PR to main.
