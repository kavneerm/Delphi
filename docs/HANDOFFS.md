# HANDOFFS (append-only)
Format: `<timestamp> <from> → <to>: <what merged, commit, how to use>`
2026-09-05 agent0-contracts → all agents: contracts_v1 on branch agent0-contracts (7e00826) — spec_schema, action_schema (root = decision output, x-action-ladder = the 14-rung menu), event_log_schema, inject_schema, lake_record_schema, s3_layout.md, README.md, examples/. Schemas $ref each other by bare filename: build a referencing Registry, recipe in contracts/README.md or tests/agent0-contracts/test_contracts.py. Open questions in contracts/QUESTIONS.md.
