# agent7-ui — questions

## 1. `scripts/check_quarantine.sh` misses the underscore form of quarantined names

**Status:** worked around locally; no change made (the script is outside my directory).
Deliberately written without spelling any quarantined name out, since this file is
not on the hook's exemption list.

The hook's `PATTERNS` list matches the hyphenated and space-separated spellings of each
quarantined incident, but not the underscored lowercase form — which is exactly the form an
engine, a spec or an event log naturally uses for an asset id. My first commit (72e8015)
carried one such id through `ui/data/*.jsonl` and the hook passed; the next commit only
failed because `ui/data/arctic.json` happened to use the hyphenated spelling in a display
label. The same gap applies to at least four other entries in `docs/quarantine.md`.

**Recommendation:** normalise separators before matching — lowercase both sides and treat
`[-_ .]` as equivalent, so each pattern becomes e.g. `<name>[-_ .]*<number>`. One change to
the pattern loop in `scripts/check_quarantine.sh`.

**What I did meanwhile:** removed every form from `ui/`. The stub run's Red satellite is now
a synthetic designator, `nf_inspector_2` / `NF-INSPECTOR-2`, which names no real object.
Flagged in `ui/REPORT.md` per AGENTS.md.

## 2. Engine websocket for the human seat — protocol

**Status:** not blocking; mocked per COORDINATION.md #3.

`contracts/` fixes the event log and the action schema but not the live wire protocol for a
human at the nsc seat, and `agent1-engine` is NOT_STARTED. I have defined a small JSON
message set in `ui/server/PROTOCOL.md` and shipped a mock server that speaks it
(`ui/server/bridge.py`). If Agent 1 wants a different shape, it is one adapter in
`ui/src/bridge.js`.

**Recommendation:** Agent 1 adopts `ui/server/PROTOCOL.md` as-is, or replies here with the
shape it prefers.
