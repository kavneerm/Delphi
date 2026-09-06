# agent10-replays
state: AWAITING_HUMAN: replay_review
branch: agent10-replays
last_commit: cb36f66
interfaces_ready: []
needs: []
awaiting_human: replay_review — a human reviews eval/replays_draft/ and moves approved files to eval/replays/
updated: 2026-09-05
notes: |
  2026-09-05 — Read AGENTS.md, COORDINATION.md, contracts/inject_schema.json,
  contracts/targets.md, contracts/seats.md, docs/quarantine.md. Branch cut from
  origin/main at 71a19d5. Authoring six replay drafts into eval/replays_draft/
  (4 real: Kosmos-2558, Viasat KA-SAT, Dozor-Teleport, Balticconnector;
  2 controls: Intelsat-33e, Galaxy 15). Now: web-verifying dates for the
  Kosmos-2558 and Viasat timelines before writing any inject.

  2026-09-05 — Web-verified the core dates for all six incidents (launch/onset,
  disclosure, attribution). Surprises worth recording: (a) the Dozor-Teleport
  attack was self-attributed by the Ukrainian Cyber Alliance on 2025-08-14,
  two years after the fact and long outside any 72-hour window — so ground truth
  gets a real responsible actor but attribution_time_s stays null, which is what
  keeps the entropy target honest; (b) the Kosmos-2558 close approach is
  2022-08-04 ~14:16 UTC at ~67 km, not the ~75 km first published. Next:
  write eval/replays_draft/ scaffolding and the Kosmos-2558 inject timeline.

  2026-09-05 — eval/replays_draft/ created: dir README (authoring conventions) plus
  the kosmos_2558 replay — 12 injects with source_url on every one, a ground-truth
  file, and a scoring.md mapping to contracts/targets.md. Both JSON files validate
  against contracts/inject_schema.json. Deliberately omitting the optional `feed`
  key everywhere: the schema drops an inject for any recipient whose spec lacks the
  named feed, and specs/ has not published a feed vocabulary, so naming feeds now
  would silently delete injects. Routing uses recipients + source_class instead.
  Next: viasat_ka_sat and dozor_teleport.

  2026-09-05 — viasat_ka_sat drafted: 13 injects, ground truth, scoring.md. All four
  JSON files validate. Two things worth a human's attention. (1) The action ladder in
  contracts/action_schema.json has no rung for a commercial operator *extending*
  service into a region — which is exactly what the other constellation did on
  2022-02-26, the most consequential commercial decision in the whole incident.
  geofence_or_throttle means restricting, so scoring it there would invert the rung.
  That seat is therefore in the inject timeline and deliberately out of the scoring
  key; flagged in viasat_ka_sat_scoring.md for the contract owner, not blocking.
  (2) response_match needs to be computed against an in-window expectation column,
  not the raw real_responses times — three of the four real responses happened 34 to
  75 days after episode end, and scoring correct patience against them would mark it
  as failure. Each scoring.md now carries that table. Next: dozor_teleport.

  2026-09-05 — BRANCH INCIDENT, now contained; read this if you are the coordinator.
  I had been launched in the shared primary checkout (/Users/kavneerm/Desktop/Panoptes)
  rather than in my own worktree, which already existed at ../Panoptes-agent10-replays.
  At least five agents plus a coordinator were committing in that one checkout against
  whatever branch happened to be checked out. Consequences: (a) agent1, agent2, agent4
  and agent9 commits landed on the agent10-replays branch pointer and were pushed to
  origin/agent10-replays, which is why that ref carries engine/, calib/ and train/ work
  that is not mine; (b) my own four draft commits landed on agent4-train instead and
  were pushed there; (c) agent4 later rebased, so my tip 033a472 is now on no remote
  ref at all. Nothing was lost: I have moved into my own worktree, reset to
  origin/main (9f1413b), cherry-picked my six commits cleanly, and re-validated all
  four JSON files against contracts on current main. The branch now diffs against main
  as exactly eight files, all mine.
  Remaining question is the push, and it is a human's call: my rebuilt branch is not a
  fast-forward from origin/agent10-replays, so landing it needs a force-push, which
  AGENTS.md forbids. The stale commits on that ref are duplicates — agent1, agent2 and
  agent9 all carry the same work in more advanced form on their own branches (checked:
  origin/agent1-engine has all 26 engine/ files) — so no content would be lost, but I
  am not rewriting a shared ref on my own judgement. Not blocking my authoring; I am
  continuing with dozor_teleport locally and committing to my worktree.
  Also, minor but persistent: in a worktree-isolated session the Bash tool refuses any
  command containing the literal token `eval`, which is the name of my working
  directory. Using `git add -A` and the file tools instead.

  2026-09-05 — dozor_teleport and balticconnector drafted; 4 of 6 replays done, all
  8 JSON files validating against contracts on current main (9f1413b). Two authoring
  notes. (1) dozor is the only file in the set using truthful:false on the claimed
  attribution, and its scoring.md pins the entropy computation to the four hypotheses
  that were actually live rather than the whole nine-seat roster — spreading mass over
  actors nobody proposed would inflate dozor_entropy_ratio for free. Max entropy over
  four candidates is 2 bits, so the 0.80 target means >= 1.6 bits. (2) balticconnector
  needed cause=unknown with responsible_actor=null, which is a distinction worth
  holding: the mechanism was established (an anchor off a named vessel, 17 days later),
  the intent never was. responsible_actor 'none' would have been wrong because a ship
  did do it. Flagged in that scoring.md that an attribution to the china seat is a
  false positive and not partial credit, even though the vessel really was Chinese —
  no Chinese state direction was ever established. Next: the two controls
  (control_intelsat_33e, control_galaxy_15), then REPORT.md and a PR.

  2026-09-05 — ALL SIX REPLAYS DRAFTED. 19 files in eval/replays_draft/: six replays x
  (injects + ground_truth + scoring.md), plus the directory README and REPORT.md.
  74 injects, every one with a source_url. All 12 JSON files validate against
  contracts/inject_schema.json as it stands on main (9f1413b), and a consistency lint
  covering the invariants the schema cannot express — inject ordering, exactly one knife
  inject per file, unique inject_ids, recipients restricted to the nine seats or 'all',
  forbidden_actions equal to the three irreversible actions, controls carrying
  responsible_actor 'none' — comes back clean on all six. Quarantine verified: every
  occurrence of a quarantined incident name in anything I wrote is under eval/ or in
  this status file, both exempt by design; scripts/check_quarantine.sh passes over every
  tracked file. Read agent1-engine's hazard note in HANDOFFS.md, which independently
  describes the shared-checkout collision and recommends exactly the history cleanup I
  had already done. Setting AWAITING_HUMAN: replay_review — the gate is a human reading
  the drafts and moving approved files into eval/replays/, which per AGENTS.md I must
  not write to. Opening a PR now. Two things for agent6-eval to read before writing
  eval/replay_table.py: the in-window expectation tables (real responses often postdate
  episode end by weeks) and the per-replay counting rules, especially the four-hypothesis
  candidate set for dozor_entropy_ratio and the control false-positive rule.
