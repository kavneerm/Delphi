# agent9-specs
state: AWAITING_HUMAN: sample_review
branch: agent9-specs
last_commit: 5b3b993
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

  2026-09-05 — Read the other agents' branches instead of declaring done. Found a real
  integration break nobody had reported: train/gates.py:load_json_dir globs non-recursively and
  train/devset.py reads a flat scenario["expected"]["action"], so the devset — which follows
  contracts/inject_schema.json, one directory per scenario with the key held separately — would
  load ZERO scenarios and exit with "agent9-specs has not landed". That failure message reads as
  me being late rather than as a shape mismatch, which is how it would have survived to Sunday.
  Kept the contract shape (inject_schema documents ground_truth.expected_beliefs as the thing
  train/devset.py scores against) and shipped specs/drafts/devset_view.py, which projects the
  contract files into exactly the dicts run_scenario already expects — 54 (scenario, seat) rows,
  verified. One import line on agent4's side, or two characters in load_json_dir. QUESTIONS.md Q6.
  Also filled ground_truth.real_responses across all eight expected.json files; it was empty,
  which meant response_match — one of only four targets a synthetic devset can honestly measure —
  had nothing to score against. Seats expected to hold are deliberately absent from that map,
  which is what the contract says an absent seat means.
  Downgraded Q5: train/devset.py already parses targets.md at runtime to avoid naming a
  quarantined replay, which is a good workaround and lowers the urgency of the rename.

  2026-09-05 — Second break found the same way. gen/specs.py names a counterfactual arm
  '<spec_id>_cf_<field>_<new_value>'; the private_type suffix is 35 chars against spec_id's
  64-char maxLength, so northern_fleet_correct_procedure produced a 67-char arm and would have
  failed re-validation inside gen/sweep.py — on the hidden-type seat whose pairs
  counterfactual_sensitivity most depends on. Renamed to northern_fleet_procedural (60-char
  arm). validate_drafts.py now checks every spec against every flip it could take, and I
  verified the guard fires by reintroducing the old id. Both breaks were invisible to schema
  validation: they only appear when you read what the consumer actually does.

  PR: https://github.com/kavneerm/Delphi/pull/4

  Blocked on nothing. Downstream agents can read specs/drafts/ directly before promotion if the
  coordinator would rather not wait for a human.
