# agent7-ui
state: IN_PROGRESS
branch: agent7-ui
last_commit: 72e8015
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
  to tell. Now on: the single-page app shell — ground-track map, sim clock, persona cards.
