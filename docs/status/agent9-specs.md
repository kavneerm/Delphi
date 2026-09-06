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

  2026-09-05 — 12 specs (northcom, usspacecom, nsc headless, norway) + validate_drafts.py,
  which checks spec_schema plus the authority invariants the schema states only in prose,
  the priors sum, duplicate spec_ids, and runs scripts/check_quarantine.sh over the exemplars.
  Two surprises: (1) requires_release names releasing seats for Blue and Red only, so an ally
  seat like norway has no release route — Q1 in specs/drafts/QUESTIONS.md with a fallback;
  (2) I was sharing the primary worktree with other agents and a commit of mine briefly landed
  under someone else's branch checkout — moved to a dedicated worktree at
  ../Panoptes-agent9-specs and recommitted. Nothing of mine reached another agent's branch.

  2026-09-05 — Train pool complete at 25 specs, all validating: 3 each for northcom,
  usspacecom, nsc, norway, northern_fleet, kremlin, china; 2 each for starlink, iridium.
  Coverage checks pass — all three northern_fleet private_types, all three china private_types,
  all four psyches present so eval/holdout_mix.py can sweep the axis without touching holdout.
  Red variance is visibly tighter than Blue by construction: Red risk_posture spans two steps
  (cautious-balanced) against Blue's five (risk_averse-risk_acceptant), Red utility weights
  differ by <=0.10 within a seat against Blue swings of 0.3-0.6, and the three china variants
  are identical on every field another seat can observe.
  Next: 4 holdout specs, then exemplars/ (10 cards), then devset/ (8 scenarios).
