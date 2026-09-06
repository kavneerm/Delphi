# ui/server/PROTOCOL.md — the human-seat wire protocol

The console is offline everywhere except one panel. Playback reads a finished
event log off disk; **the human-seat panel is the only live path**, and this is
what it says to the engine.

Transport: a websocket on `ws://127.0.0.1:8778`, one JSON object per frame, UTF-8.
Loopback only — there is no authentication and there should not be one, because
nothing here should ever be reachable off the machine running the demo.

`ui/server/bridge.py` is the reference implementation. `ui/src/bridge.js` is the
client, and is the whole adapter: if `agent1-engine` prefers a different shape,
that one file changes and nothing else does.

## Client → server

| `op` | fields | meaning |
|---|---|---|
| `hello` | `seat` | the operator is sitting at this seat. Sent on connect and on every seat change. |
| `subscribe` | — | start streaming event-log lines. |
| `answer_release` | `release_id`, `decision`, `hold_minutes`, `rationale` | answer the release the engine is waiting on. `decision` is `grant`, `deny` or `hold`. |
| `submit_action` | `action`, `beliefs`, `reasoning` | the operator's decision at its own decision point. `action` validates against `action_schema.json#/$defs/action`. |
| `fork` | `release_id`, `options`, `n`, `horizon_hours` | run `n` continuations per option from the snapshot at this release and report where they end up. |

`hold` is `deny` plus a re-request `hold_minutes` later. The engine has no third
answer — `contracts/event_log_schema.json` has `release_granted` and
`release_denied` and nothing else — so hold is the UI's word for "denied for now",
and it is logged as a denial with the reason in `rationale`.

## Server → client

| `ev` | fields | meaning |
|---|---|---|
| `hello` | `episode_id`, `seat`, `clock_mode`, `release_policy`, `duration_s` | sent on connect. |
| `event` | `line` | one event-log line, exactly as written to the log. Same schema as playback, so the console renders live and recorded events with the same code. |
| `prompt` | `kind` (`release`\|`decision`), `context` | the engine has stopped and is waiting for this seat. `context` for a release carries `request` and the seat's filtered `view`. |
| `clock` | `paused`, `sim_time_s` | the sim clock stopped or started. |
| `fork_result` | `release_id`, `options` | see below. |
| `error` | `message` | anything that went wrong. |

### `fork_result`

```json
{
  "ev": "fork_result",
  "release_id": "rel-00023",
  "horizon_hours": 12,
  "options": {
    "grant": { "n": 50, "irreversible": 19, "escalated": 24, "completed": 50 },
    "deny":  { "n": 50, "irreversible": 4,  "escalated": 31, "completed": 50 }
  }
}
```

* `irreversible` — continuations in which an **adversary** seat took an
  unblocked `counter_rpo`, `kinetic` or `terrestrial_response`. Adversary is
  relative to the operator's side per `contracts/seats.md`: for a Blue or ally
  operator that is `northern_fleet` and `kremlin`; for a Red operator it is the
  Blue and ally seats.
* `escalated` — continuations that reached a rung above the one requested
  without crossing into irreversible.
* `completed` — continuations that ran without error. The UI divides by `n`, so a
  crashed continuation shows up as a smaller share rather than as a wrong one.

## How the clock behaves

`contracts/env_config_schema.json` `release_policy: human` sets `pause_clock:
true`, and the engine honours it — `Episode._adjudicate` calls `loop.pause()`
before asking the seat and resumes afterwards. Sim time genuinely does not move
while a person thinks, which is what keeps a human-played episode replayable.
The console mirrors that: a `prompt` stops playback, an answer restarts it.

## Determinism

A human-played episode is not reproducible by re-running the stubs, so the engine
records `agents_descriptor = {"kind": "human", ...}` and `engine/replay.py` drives
it from the recorded decisions instead. The bridge changes nothing about that.

Forks are seeded from the master seed plus the continuation index, so the same
fork request returns the same numbers twice. That matters: a fork panel whose
numbers move when you press the button again is not evidence of anything.
