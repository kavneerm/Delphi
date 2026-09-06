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
* **per-seat cards** — `action` lines now carry `payload.beliefs` and
  `payload.reasoning`, the acting seat's own, so the log is self-sufficient for
  a persona card. (agent7-ui asked; extra payload keys are always allowed.)
  `beliefs` is the full `action_schema` object — `hostile`, `natural`,
  `unknown`, `per_actor` — so a belief trajectory can be drawn straight off the
  log. They also appear on blocked actions, which is often the interesting case:
  what the seat believed when it tried something it was not allowed to do.

  **One caution.** The event log is the god's-eye record, not a seat's view. In
  *playback* that is exactly what you want. In a *live human-played* episode it
  is not: rendering every seat's beliefs from the log would show the person at
  NSC what Red believes. For live play, render from the seat's filtered view
  over the bridge (`engine/bridge.py`), which is filtered by construction, and
  use the log only for what has already been revealed.

* **orbit arcs** — a `state_change` at `sim_time_s: 0` with
  `payload.what == "assets.initial_elements"` carries every asset's two-body
  elements at t=0, plus `mu_earth_km3_s2` and `earth_radius_km`. Propagate those
  yourself for smooth arcs rather than interpolating the 30-minute
  `assets.ground_tracks` samples, and stop keeping a hand-copy of
  `engine.world`. The engine applies no perturbations, so a consumer doing the
  standard mean-motion advance matches it exactly — the only thing that changes
  an orbit mid-episode is an `action` line of type `maneuver`.
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
