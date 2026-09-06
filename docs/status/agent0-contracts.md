# agent0-contracts
state: IN_PROGRESS
branch: agent0-contracts
last_commit:
interfaces_ready: []
needs: []
awaiting_human:
updated: 2026-09-05
notes: |
  2026-09-05 — Read AGENTS.md, COORDINATION.md, execution_plan_v2, agent_workstreams,
  targets.md, seats.md. Wrote contracts/spec_schema.json (seat-dependent private_type and
  Red-only psyche enforced with if/then) and contracts/action_schema.json (14-rung ladder as
  x-action-ladder data + the decision output schema as the root). Now on event_log_schema,
  inject_schema, lake_record_schema, s3_layout.md, then the jsonschema validation test and
  two committed examples. Surprise: the ladder's irreversible set from targets.md
  (kinetic, terrestrial_response, counter_rpo) excludes public_attribution and
  disclose_incident, which are unrecallable but not counted — noted per rung so Engine and
  Eval do not disagree about the metric.
