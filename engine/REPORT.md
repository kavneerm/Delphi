# REPORT — agent1-engine

## What I built

A deterministic, replayable, real-time wargame engine for the 72-hour Arctic
counterspace scenario, driven by scripted agents and calling no model anywhere.

Built in the order `docs/agent_workstreams.md` specifies.

| module | what it is |
|---|---|
| `engine/loop.py` | Single-threaded priority queue keyed on sim time. Sim time is an **integer number of seconds quantised onto `tick_s`**, ties break by `(priority, insertion order)` per `event_log_schema`, and events carry data rather than closures so a queue can be snapshotted and rebuilt. `pause()`, `resume()`, `snapshot()`, `fork(snapshot, seed, n)`. A `realtime_factor` speed dial for the demo, which touches nothing but `wall_time`. |
| `engine/rng.py` | Named RNG streams derived `blake2b(seed:stream)`. Named streams matter: one shared generator would mean adding a storm draw silently shifted every later attribution lag and broke comparison across a sweep. |
| `engine/orbits.py` | Two-body propagation, classical elements ↔ state vector, impulsive burns, ground tracks. No perturbations, no conjunction analysis. |
| `engine/world.py` | The Arctic order of battle across the three asset classes — persistent HEO nodes (individually propagated, including the ASBM pair hosting EPS-R), constellations (aggregated: a representative plane for the track, a member count for capacity), pass-based sensors (a square wave, so a picture arrives in lumps) — plus the ground segment, protected-comms capacity, propellant and reputation. Every mutation goes through one write path that emits the `state_change` line as it writes. |
| `engine/storm.py` | Kp/Dst series or a shaped curve; per-seat `sensor_confidence` and `comms_bandwidth` multipliers; safe-mode hazards per asset class; tracking-degradation and screening-suspension windows with hysteresis. |
| `engine/attacks.py` | `jam`, `dazzle`, `ground_cyber`, `rpo` as effects with a duration, a per-type attribution-lag draw, and a **telemetry signature only operator seats can read**. Storm outages are effects too, signed `natural` — same observable, two causes, one flag a minority of seats can see. |
| `engine/seats.py` | The filtered view: feeds at their latency and confidence scale, clearance, message routing with per-channel delay, the decision clock. |
| `engine/injects.py` | Replay-file loading, a synthetic ambiguity timeline, the five scripted rule actors, and `hacktivist_injects` with its hidden per-run affiliation. |
| `engine/utility.py` | Eight terms in [0,1], weighted by the persona's own weights, **sign convention fixed in the engine rather than the spec** so two personas stay comparable. `alliance_cohesion` inverts for Red. |
| `engine/log.py`, `engine/storage.py` | Sorted-key JSONL, an assertion that lines come out in non-decreasing `sim_time_s`, `equal_ignoring_wall_time`, and one S3/local-mirror helper per `s3_layout.md` §6. |
| `engine/stubs.py` | `hold`, `random_in_menu`, `aggressive`. Seeded off the episode RNG, so a stub run is as reproducible as any other. |
| `engine/agent_api.py` | The interface Gen, Train, Selfplay and Eval implement: `observe()`, `act(view)`, `wake_policy`, plus `decide_release()` and the coercion that turns an invalid decision into a logged `hold` instead of a dead sweep cell. |
| `engine/human_agent.py` | An `agent_api` agent whose `act()` blocks on an external event (the UI) and whose `observe()` returns the seat's filtered view. Default seat `nsc`. |
| `engine/episode.py` | The orchestrator: both clock modes, both release policies, the world consequences of all fourteen rungs, the end-of-episode reveal. |
| `engine/specs.py` | Nine placeholder specs under `spec_v0`, so the engine runs before `specs/train/` exists. Superseded per seat by any real spec on disk. |
| `engine/bridge.py` | The live wire protocol for a human at a seat: a WebSocket (or newline-JSON TCP) server that runs one episode on a worker thread and serves one seat to one client. **Sends the seat's filtered view, never the event log** — see below. |
| `engine/run.py`, `replay.py`, `storm_check.py`, `bridge.py` | The four CLIs. |

### The two axes that change the shape of a run

**`clock_mode`.** `continuous` runs each seat on its own decision clock, so seats
act on stale, unequal pictures. `checkpoint` wakes every seat together and
collects **sealed** decisions — every view is built before any decision is
applied, so no seat sees another's decision from the same checkpoint. All three
schedule types work: `fixed`, `variable_tempo` (an explicit list, so tempo can
tighten around the knife inject), and `adaptive` (pulled forward by an inject, a
non-hold action or a pending release, clamped to `min_interval_s` so a burst
cannot collapse the episode into a thousand checkpoints).

**`release_policy`.** Both policies emit `release_requested` and then
`release_granted` or `release_denied`, sharing a `release_id`. `auto` draws
against `approval_probability` (with per-action overrides) off the episode seed.
`human` routes to the NSC seat and **pauses the clock**, which is what makes a
human-played episode replayable: because the engine is single-threaded and the
clock is the event queue rather than the wall, no event dispatches while a person
thinks, so someone taking four minutes and someone taking four seconds produce
the same episode.

Every irreversible action (`kinetic`, `terrestrial_response`, `counter_rpo`)
goes through release regardless of what the spec says.

## How to run it

```bash
# The definition of done, both clock modes
python -m engine.run --seed 1 --storm G5 --stubs --hours 72
python -m engine.run --seed 1 --storm G5 --stubs --hours 72 --clock checkpoint --schedule adaptive

# Reproduce either one
python -m engine.replay <log>

# The env_lock numbers
python -m engine.storm_check --profile may2024

# A human at the NSC seat (scripted channel when no operator is attached)
python -m engine.run --seed 3 --storm G4 --stubs --hours 24 --release human

# A live human seat over a socket, for the UI
python -m engine.bridge --seat nsc --port 8765 --seed 1 --storm G5 --hours 72

# From a config file
python -m engine.run --stubs --config contracts/examples/env_config_sweep_continuous_auto.json
```

Logs go to `logs/<env_version>/<lake_version>/<scenario_id>/seed=<seed>/<episode_id>.jsonl`
per `contracts/s3_layout.md`, into the local mirror by default and into the
bucket under `WARGAME_STORAGE=s3`. Object metadata carries every version tag,
the seed, the episode id and the git commit.

Attaching a real UI to the human seat:

```python
from engine.human_agent import ExternalDecisionChannel, HumanAgent
from engine.run import run_episode

channel = ExternalDecisionChannel()
channel.on_prompt(lambda kind, context: draw(kind, context))   # your UI
# in the UI thread:
channel.submit_decision(decision)                               # unblocks act()
channel.submit_release(release_id, granted=True, rationale="…") # unblocks release
```

## Tests (command + result)

```
$ python -m pytest tests/agent1-engine/ -q
66 passed in 7.65s

$ python -m engine.run --seed 1 --storm G5 --stubs --hours 72
log lines 8142, decisions 980, ~6 s
$ python -m engine.replay <that log>
REPLAY OK: byte-identical except wall_time

$ python -m engine.run --seed 1 --storm G5 --stubs --hours 72 --clock checkpoint --schedule adaptive
log lines 3473, decisions 396
$ python -m engine.replay <that log>
REPLAY OK: byte-identical except wall_time

$ python -m engine.storm_check --profile may2024
prints peak Kp, minimum Dst, both multipliers, tracking and screening window
hours, and safe-mode counts across seeds with a median and a range
```

The tests worth naming:

* **`test_seats.py`** — the leak guards. `filtered_state` becomes the user turn
  of a training example, so no seat's view may carry another seat's
  `private_type`, the hacktivist affiliation, the true storm state (as opposed to
  SWPC's forecast carrying this run's error), an undelivered message, an inject
  on a feed the seat does not have, or an inject's `truthful` /
  `is_knife_inject` scoring keys.
* **`test_replay.py`** — byte-identical rerun in continuous mode and all three
  checkpoint schedules; different seeds diverge; a human-played episode replays
  from the log rather than by re-running the person.
* **`test_contracts_compliance.py`** — every line validates in both clock modes;
  both modes emit the same event types apart from `checkpoint`; no action lands
  outside its seat's authority; no irreversible action lands without a granted
  release; `nato`, `ksat` and `hacktivist`-as-a-seat never reappear.
* **`test_loop.py`** — ordering, tie-break by insertion order, quantisation,
  pause/resume, snapshot/restore, and `fork` reproducibility.

## Versions produced

| version | value | note |
|---|---|---|
| `env_vN` | `env_v1` | **proposed, not yet frozen.** Awaiting the `env_lock` human gate. |
| `spec_vN` | `spec_v0` | the engine's nine placeholder specs, superseded per seat by anything in `specs/train/`. Not a real spec-pool version and will never be mistaken for one. |
| `lake_vN` | `lake_v0` | used only as a key segment for engine-written logs; Gen sets the real one. |
| `filter_vN`, `judge_vN` | — | not this workstream. |

## Untested / known gaps

1. **`env_v1` is not frozen.** `python -m engine.storm_check --profile may2024`
   run against `agent2-calib`'s committed `storm_effects.csv` reports every field
   calibrated with no `TODO_CALIB` left, but that file is not on `main` yet, so
   the engine in this branch still falls back to placeholder curves. The gate
   needs a human to compare the numbers against the record and then freeze.
2. **Calibration is loaded but not yet merged.** `engine/storm.py` reads Agent
   2's long-format CSV and the `calib/series/` Kp/Dst pairs, verified against
   their committed files. Until they reach `main`, `--storm-profile may2024`
   silently gives placeholder curves — `storm_check` says so loudly, `run.py`
   prints `[TODO_CALIB placeholder]`, and neither should be ignored.
3. **`calib/attribution_lags.csv` does not exist yet.** The four medians (jam 6 h,
   dazzle 18 h, ground_cyber 72 h, rpo 12 h) are placeholders chosen for their
   *ordering*, which the public record supports; the magnitudes are not evidence.
4. **The specs are placeholders until `specs/train/` is populated.** Verified
   against `agent9-specs`' real pool: all 25 parse, validate and satisfy the
   authority invariants, and a 72-hour episode on them completes and replays
   byte-identically. That cross-check found a real bug in already-merged code —
   `load_pool` used `setdefault` against a dict that already held a placeholder
   for every seat, so a populated `specs/train/` was **silently ignored** and
   every episode ran on placeholders. Fixed and pinned by a regression test.
   Anyone who ran the engine before `49b123f` was not running the real specs.
5. **Stub behaviour is not a behavioural claim.** `aggressive` climbs on belief,
   time and observed rung; it produces a plausible trace for the UI and the lake
   plumbing and nothing more. No target in `contracts/targets.md` should be read
   off a stub run.
6. ~~No scenario file has been run end to end.~~ **Closed.** All eight of
   `agent9-specs`' devset `scenario.json` files drive a full episode through
   `--replay`, and all eight of `agent10-replays`' files parse and validate
   through `load_replay` (structural check only — no episodes, no names, since
   running those is Agent 6's job). A regression test drives a scenario file
   end to end and asserts its ground truth reaches the reveal and no seat.
7. **`fork()` is exercised but not at scale.** Reproducible on a small queue and
   wired into the bridge's what-if path, which forks a mid-episode snapshot and
   runs each branch to completion. Nobody has forked 50 ways.
8. **The world model is coarse where the contract allows it.** Constellations are
   aggregated, pass windows are square waves, and the ground-cyber target match
   is a substring test against ground-segment ids. All adequate for the
   decisions the seats are making, all worth knowing before anyone reads a
   number off them.
9. **`engine/run.py` refuses to run without `--stubs`**, deliberately: the engine
   calls no model, and the flag makes that a property of the CLI rather than a
   promise.

## Quarantine check

Searched the whole of `engine/` and `tests/agent1-engine/` for every incident in
`docs/quarantine.md` — the four real replays, the two false-positive controls,
and the held-out-year reports — case-insensitively, including the variant
spellings the pre-commit hook checks. **Nothing found.** The
`scripts/check_quarantine.sh` hook ran clean on every commit on this branch.

Two deliberate choices keep it that way:

* Asset ids in `engine/world.py` are generic (`rf_inspector_1`,
  `starlink_arctic`, `asbm_1`), never a real satellite that appears in the
  quarantine list.
* The synthetic timeline in `engine/injects.py` is written from scratch as an
  Arctic storm-plus-ambiguity scenario. It carries no historical incident at all,
  quarantined or allowed.

### One finding, outside my directory

Sweeping the whole repo rather than just `engine/` turned up two hits in
`tests/agent0-contracts/test_contracts.py` (lines 327 and 436): an asset-id
fixture that spells one of the quarantined satellites with an underscore instead
of a space. `scripts/check_quarantine.sh` matches the spaced form, so the
underscore form goes straight past the hook and the commit succeeded.

It is a test fixture, not a prompt, so nothing has reached a model — but the
guard has a hole and the hole is the shape of every id-style spelling. Both the
test file and the hook are outside my directory, so I have not touched either.
The exact strings, and the two fixes a human should make, are in the
`agent1-engine → agent0-contracts / human` line in `docs/HANDOFFS.md`, which is
on the hook's exemption list precisely so a finding like this can be written down
somewhere a model will never read it. (This paragraph deliberately does not spell
them: `engine/` is not exempt, and the hook correctly refused my first draft of
this report for naming them here.)

`engine/injects.py` does load files from `eval/replays/` when asked, which is
correct — `contracts/inject_schema.json` says the engine is the one component
that may. Nothing in `specs/`, `gen/` or the lake reads them, and the engine
never copies ground truth into a filtered view: `ground_truth` is read only to
emit the `attribution_revealed` line at episode end.

## Handoffs made

1. **→ agent7-ui**: `engine/samples/stub_run.jsonl` — a real 72-hour episode log,
   3473 lines, every line valid, ordered, ending in `episode_end`. With
   `engine/samples/README.md` saying where the ground tracks, storm overlay,
   ladder, release cycle and end-of-episode reveal live in the log, and flagging
   that beliefs are lake-record fields rather than event-log fields.
2. **→ agent2-calib**: the exact columns `engine/storm.py` and
   `engine/attacks.py` read, and the note that everything is optional with a
   `TODO_CALIB` fallback.
3. **→ agent7-ui, again**: both their follow-up asks. `action` lines now carry
   `payload.beliefs` and `payload.reasoning`, so the log is self-sufficient for
   a persona card; and a `state_change` at t=0 carries every asset's initial
   two-body elements, so they can propagate their own arcs instead of
   interpolating 30-minute samples and hand-copying `engine.world`. Plus
   `engine/bridge.py` for the live human seat, with the protocol documented at
   the top of the file and an explicit offer to conform to theirs instead.

   **With one caution, which is the reason the bridge exists.** The event log is
   the god's-eye record. Rendering a *live* human-played episode from it would
   show the person at NSC what Red believes. The bridge sends `engine/seats.py`
   output only, filters the events it forwards to that seat's own traffic, and
   never forwards `attribution_revealed` before `episode_end`. There is a test
   asserting a live client is never sent the hidden affiliation or any seat's
   `private_type`.

4. **→ agent9-specs**: their pool loads and runs, plus the `load_pool` bug their
   work uncovered, plus a note that `exemplar_card_schema.json` sits among the
   specs and will land in `specs/train/` if `promote.py` is not selective.

5. **→ agent6-eval**: their replay-loading path is exercised, and new
   `PANOPTES_SPECS_DIR` / `PANOPTES_CALIB_DIR` overrides let a perturbation run
   (`env_v1_perturbed`) point at a different spec pool or calibration table
   without touching the checkout.

6. **→ agent3-gen, agent4-train, agent5-selfplay, agent6-eval**:
   `engine.agent_api` — `BaseAgent`, `WakePolicy`, `default_params_for()` and
   `coerce_decision()`. Stop mocking it.
7. **→ coordinator/human**: the shared-checkout hazard. The twelve agents are
   sharing one git checkout and one HEAD rather than a worktree each, so a branch
   switch by one agent moves everyone; two of my commits landed on whichever
   branch was current and had to be rebuilt on `agent1-engine`. I have moved to a
   dedicated worktree.
