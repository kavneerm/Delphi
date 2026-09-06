# agent9-specs
state: AWAITING_HUMAN: sample_review
branch: agent9-specs
last_commit:
interfaces_ready: ["specs/drafts/ (25 train + 4 holdout + 10 exemplars + 8 devset, spec_v1)", "specs/drafts/promote.py", "specs/drafts/validate_drafts.py"]
needs: []
awaiting_human: promotion of specs/drafts/ into specs/train|holdout|exemplars|devset — run `python specs/drafts/promote.py --all`; decisions and reversal commands are in specs/drafts/REVIEW.md
updated: 2026-09-05
notes: |
  2026-09-05 — Read the contracts and docs. Launch prompt still says 12 seats / 30 specs;
  contracts_v1 folded to 9, so targeted ~25 train + 4 holdout. Cut a dedicated worktree at
  ../Panoptes-agent9-specs after a commit of mine briefly landed under another agent's branch
  checkout in the shared primary worktree. Nothing of mine reached another agent's branch.

  2026-09-05 — Train pool complete: 25 specs, all nine seats, all validating. All three
  northern_fleet private_types, all three china private_types, all four psyches present in
  train, so eval/holdout_mix.py never needs to read holdout. Red variance tighter than Blue by
  construction (2 risk_posture steps vs 5; <=0.10 weight deltas within a Red seat vs 0.3-0.6).

  2026-09-05 — 4 holdout specs, each a novel field COMBINATION rather than new prose, so
  train/gates.py measures generalisation and not paraphrase. 10 exemplar cards, every one from
  the allowed list, each carrying a `contested` field; the storm card is ENVIRONMENTAL ONLY and
  names no adversary. 8 devset scenarios with expected.json.

  2026-09-05 — Told I am the biggest blocker, and that the human's review should be a move
  rather than a judgement. Correct. Added specs/drafts/promote.py (validates and quarantine-
  checks, then git-mvs approved drafts into the live tree; --except holds individual files back
  so rejecting one never blocks the other 46) and specs/drafts/REVIEW.md (five decisions with
  defaults and the exact command to reverse each, what has already been checked mechanically,
  and the three files worth reading if you read nothing else). First cut of the promoter was a
  bash script with an argument-parsing bug; rewrote it in Python rather than debug it, which
  also fits the repo's tooling. REPORT.md written.

  Two quarantine findings, both mine, both caught by the pre-commit hook before anything was
  committed: my validator originally hardcoded the banned list (a copy of the list is a copy of
  the material — it now shells out to scripts/check_quarantine.sh), and a notes field named the
  attribution-spread metric in contracts/targets.md by its machine-readable key, which is built
  on a quarantined replay name. The second is not only my problem: check_quarantine.sh exempts
  contracts/targets.md and eval/ but not train/, so train/devset.py has to emit a column it
  cannot legally name. QUESTIONS.md Q5 recommends renaming the key; contracts change, so it
  goes through agent0-contracts.

  Blocked on nothing. Downstream agents can read specs/drafts/ directly before promotion if the
  coordinator would rather not wait for a human.
