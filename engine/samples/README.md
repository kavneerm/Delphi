# engine/samples/

Committed episode logs, for anyone who needs a real one before the engine is
merged. Every line validates against `contracts/event_log_schema.json`; lines are
in non-decreasing `sim_time_s`; the last line is `episode_end`.

| file | how it was produced |
|---|---|
| `stub_run.jsonl` | `python -m engine.run --seed 1 --storm G5 --stubs --hours 72 --scenario g5_ambiguous_signature --clock checkpoint --schedule adaptive` |

`stub_run.jsonl` is a full 72-hour episode driven by scripted agents — no model
was called. 3473 lines, 396 decisions across the nine seats, 44 adaptive
checkpoints, 112 release requests under `release_policy: auto` (63 granted, 49
denied), 82 injects, 73 storm updates.

## Reading it

The first line is a `state_change` with `payload.what == "config.env"`: it
carries the entire `env_config` the episode ran under, the agent descriptor and
the spec ids per seat. That is what `engine/replay.py` rebuilds from, and it is
the fastest way to see how the run was configured.

For the UI specifically:

* **ground tracks** — `state_change` lines with `payload.what ==
  "assets.ground_tracks"`, every 30 sim minutes, `{asset_id: {lat_deg, lon_deg,
  alt_km}}`. Enough to draw arcs without any orbital math in the browser.
* **storm overlay** — `storm_update` lines carry `severity`, `kp`, `dst_nt`, the
  two multipliers, and the `tracking_degraded` / `screening_suspended` flags.
* **the ladder** — `action` lines carry `payload.action.type`; rung order is
  `x-action-ladder` in `contracts/action_schema.json`, and rung index is
  meaningful. `payload.blocked` marks an action the engine refused.
* **per-seat cards** — beliefs and reasoning are deliberately *not* in the event
  log (they are lake-record fields, per `contracts/lake_record_schema.json`), so
  a card should show last decision time, last action and the release state. If
  the UI needs beliefs on screen, say so and the engine can add them to the
  `action` payload under a new key — additional payload keys are always allowed.
* **release cycle** — `release_requested` then `release_granted` /
  `release_denied`, joined on `payload.release_id`.
* **the reveal** — the final `attribution_revealed` line carries ground truth:
  `cause`, `responsible_actor`, and `private_types` including the
  `hacktivist_injects` affiliation drawn for this run. Do not show it before the
  end of playback; that is the whole point of the exercise.

## Regenerating

Any run writes the same shape. `--clock continuous` produces a longer log with
no `checkpoint` lines and the same format otherwise — nothing downstream should
branch on which mode it was.
