# agent7-ui
state: IN_PROGRESS
branch: agent7-ui
last_commit: 84e3e7d
interfaces_ready: []
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

