# agent0-contracts
state: DONE
branch: agent0-contracts
last_commit: 5871729
interfaces_ready: [contracts/spec_schema.json, contracts/action_schema.json, contracts/event_log_schema.json, contracts/inject_schema.json, contracts/lake_record_schema.json, contracts/s3_layout.md, contracts/examples/]
needs: []
awaiting_human: contract review — delete the DRAFT lines from all nine files in contracts/ and answer contracts/QUESTIONS.md (Q2 pyproject.toml and Q6 metric scope matter most) before Wave 1 launches
updated: 2026-09-05
notes: |
  2026-09-05 — contracts_v1 complete. Five JSON schemas, s3_layout.md, README.md with the
  cross-ref registry recipe, and two examples that validate. 40 tests green under
  tests/agent0-contracts; ruff clean. Did not touch targets.md or seats.md — found no errors
  in either.
  Surprising and worth knowing: four schema descriptions named quarantined incidents
  (Dozor, Intelsat-33e, Galaxy 15). Structured outputs send description text to the model,
  so a quarantined name in action_schema.json would have been in every generation prompt.
  All four scrubbed; grep list is in contracts/REPORT.md, re-run it after any contract edit.
  Eight open questions in contracts/QUESTIONS.md, none blocking. Next: open PR to main.
