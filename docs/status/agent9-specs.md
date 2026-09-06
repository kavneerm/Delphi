# agent9-specs
state: IN_PROGRESS
branch: agent9-specs
last_commit:
interfaces_ready: []
needs: []
awaiting_human:
updated: 2026-09-05
notes: |
  2026-09-05 — Read AGENTS.md, COORDINATION.md, contracts/spec_schema.json, seats.md,
  action_schema.json, inject_schema.json, targets.md, docs/quarantine.md. Launch prompt still
  says 12 seats / 30 specs; contracts_v1 folded to 9, so targeting ~25 train + 4 holdout.

  2026-09-05 — 12 of ~25 specs drafted and validating: northcom x3, usspacecom x3, nsc x3
  (headless, for runs with no human at the release seat), norway x3 (ground segment =
  SvalSat/Andoya/Vardo/two Svalbard cables per seats.md). Wrote specs/drafts/validate_drafts.py
  — spec_schema plus the authority invariants the schema states only in prose (pairwise
  disjoint, subset of the ladder's allowed_seats), the priors sum, duplicate spec_ids, and
  scripts/check_quarantine.sh over the exemplar bank.

  2026-09-05 — Two surprises. (1) spec_schema's requires_release names releasing seats only
  for Blue (NSC) and Red (Kremlin), so an ally seat like norway has no release route — Q1 in
  specs/drafts/QUESTIONS.md, with a fallback so the seat is never wholly blocked. (2) I was
  sharing the primary worktree with other agents and my first commit landed under someone
  else's branch checkout; moved to a dedicated worktree at ../Panoptes-agent9-specs on
  agent9-specs and recommitted. Nothing of mine reached another agent's branch.
  Next: northern_fleet x3, kremlin x3, china x3, starlink x2, iridium x2.
