# agent9-specs
state: IN_PROGRESS
branch: agent9-specs
last_commit:
interfaces_ready: ["specs/drafts/ (25 train + 4 holdout specs, spec_v1, real spec_ids)"]
needs: []
awaiting_human:
updated: 2026-09-05
notes: |
  2026-09-05 — Read AGENTS.md, COORDINATION.md, contracts/spec_schema.json, seats.md,
  action_schema.json, inject_schema.json, targets.md, docs/quarantine.md. Launch prompt still
  says 12 seats / 30 specs; contracts_v1 folded to 9, so targeting ~25 train + 4 holdout.

  2026-09-05 — 12 specs (northcom, usspacecom, nsc headless, norway) + validate_drafts.py.
  Two surprises: (1) requires_release names releasing seats for Blue and Red only, so an ally
  seat like norway has no release route — Q1 in specs/drafts/QUESTIONS.md; (2) I was sharing
  the primary worktree with other agents and a commit briefly landed under someone else's
  branch checkout — moved to a dedicated worktree at ../Panoptes-agent9-specs.

  2026-09-05 — Train pool complete at 25 specs across all nine seats. All three
  northern_fleet private_types, all three china private_types, all four psyches present.
  Red variance tighter than Blue by construction. One quarantine catch: a notes field named
  the spread metric in contracts/targets.md by its machine-readable key, which is built on a
  quarantined replay name — hook caught it pre-commit, reference now generic, and the wider
  contracts problem (train/ is not exempt but has to emit that column) is Q5 in QUESTIONS.md.

  2026-09-05 — 4 holdout specs done: usspacecom_after_the_error, norway_industrial_north,
  northern_fleet_disciplinarian, starlink_board_constrained. Each is a novel *field
  combination* rather than new prose, so train/gates.py held-out-persona coherence tests
  generalisation and not paraphrase: highest attribution_threshold paired with the most
  permissive sharing posture; an ally seat carrying commercial revenue/liability weights and
  an insurer feed; opportunistic_isr x regime_survival at risk_averse, one step outside the
  trained Red range; and the only commercial spec in the pool that puts its signature rung
  behind release.
  Seen agent7-ui building on engine/samples/stub_run.jsonl (c9809b4, on agent1-engine). That
  stub uses spec_v0 with placeholder ids of the form "<seat>_placeholder". Real spec_ids at
  spec_v1 are on this branch now — UI persona cards should not hardcode the placeholders.
  I cannot append to docs/HANDOFFS.md (AGENTS.md limits me to my own status file), so this
  note and the PROGRESS line are the relay.
  Next: exemplars/ (10 cards from the allowed list), then devset/ (8 scenarios + expected.json).
