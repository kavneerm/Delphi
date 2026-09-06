# agent10-replays
state: IN_PROGRESS
branch: agent10-replays
last_commit:
interfaces_ready: []
needs: []
awaiting_human:
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
