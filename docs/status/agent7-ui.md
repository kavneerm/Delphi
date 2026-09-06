# agent7-ui
state: IN_PROGRESS
branch: agent7-ui
last_commit: f22c711
interfaces_ready: [ui/ console (offline playback), ui/serve.py]
needs: [engine/samples/stub_run.jsonl (agent1-engine), validation/heatmap.csv + validation/final_report.md (agent6-eval), engine local websocket for the human seat (agent1-engine)]
awaiting_human:
updated: 2026-09-05
notes: |
  2026-09-05 — Read AGENTS.md, COORDINATION.md, and all six contracts. agent1-engine is
  NOT_STARTED so there is no engine/samples/stub_run.jsonl yet; per COORDINATION.md #3 I built
  ui/tools/make_stub_run.py, a deterministic schema-driven generator, and three stub runs
  (continuous seed 1041, checkpoint seed 1041, alt run seed 2087). 21 tests in tests/agent7-ui
  pass, including full jsonschema validation of every line against contracts/event_log_schema.json.
  Surprise: seat feed latencies had to be made pairwise distinct or two seats land on the same
  decision timestamp, which would kill the "timestamps drift apart" story the persona cards exist
  to tell.

  2026-09-05 — App skeleton in: index.html + styles.css (dark ops console), and the modules
  behind it — data.js (prefers the engine path, falls back to the stub, one place that knows the
  difference), model.js (Run: snapshotAt/filteredView/tempo), orbits.js (Kepler + north-polar
  projection), map.js, panels.js (persona cards, ladder, in-flight bars, channel pips, storm),
  timeline.js (scrub + tempo strip), dom.js. Chose a north-polar azimuthal map over a world
  equirectangular one: the scenario is Svalbard/Barents and the storm overlay is an auroral oval,
  which only reads correctly on a polar projection. Now on: src/app.js wiring, then the human-seat
  panel, fork panel, and the websocket bridge.

  2026-09-05 — Quarantine hit, flagged per AGENTS.md: my stub's Red satellite used a designator
  reserved for Agent 6's replays. Removed everywhere in ui/ and regenerated the stubs. Worth other
  agents knowing: scripts/check_quarantine.sh matches the hyphenated spelling but not the
  underscored asset-id form, so a leak of that shape passes the hook — my first commit carried one
  through. Written up in ui/QUESTIONS.md. Now on: src/app.js wiring, human seat, fork, websocket.


  2026-09-05 — agent1-engine's real log landed on main, so the synthetic generator is deleted
  (ui/tools/ is gone) and the console now plays engine output only. Produced two more runs with
  `python -m engine.run` — seed 1 continuous, which pairs with the committed checkpoint sample for
  an honest same-seed clock comparison, and a seed 7 release_policy:human run for the human-seat
  panel. Commands recorded in ui/data/README.md. 24 tests green.
  Two surprises worth other agents' time: (1) the log carries assets.ground_tracks only every 30
  sim minutes, which is a third of a LEO orbit, so it places markers but cannot draw an arc — the
  browser still propagates arcs, from the engine's own elements copied into ui/data/assets.json and
  pinned by a test against engine.world. (2) beliefs and reasoning are lake-record fields and are
  NOT on model action lines; only human_action carries beliefs. Requested them from agent1-engine
  in HANDOFFS.md. Cards say "beliefs not in this log" meanwhile — no invented numbers.
  Now on: src/app.js wiring, then the human seat, fork panel and websocket bridge.

  2026-09-05 — THE CONSOLE RUNS. app.js wiring, split screen, clock compare, validation view and
  the human-seat panel all in; 24 tests green. Verified in headless Chrome against the real engine
  log rather than by inspection — page loads clean, 9 cards, 14 rungs, 8 channels — which is how I
  found three defects that reading the code had not: loadRun still expected the pre-rebase manifest
  keys (nothing loaded at all), .panel's display:flex outranks the UA [hidden] rule so the human
  aside laid out while hidden, and a fixed ±40min ground-track window is 5% of a Molniya orbit so
  the HEO arcs drew as stubs.
  The clock-compare view is the one worth showing a judge: same seed, same specs, T+23:02 —
  continuous has a 4h18 seat spread across nine different timestamps, checkpoint has 1h with seven
  seats on 21:30:00 exactly. Next: ui/server/bridge.py + PROTOCOL.md (the live path and fork), then
  REPORT.md, the 3-minute capture, and the PR.
