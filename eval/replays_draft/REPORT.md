# REPORT — agent10-replays

## What I built

Six replay scenarios in `eval/replays_draft/`, three files each — an inject timeline, a
ground-truth key held in a separate file, and a `scoring.md` mapping the replay onto
`contracts/targets.md`. Nineteen files including the directory README and this report.

| replay_id | kind | window (t = 0 → end) | injects | knife inject | cause | responsible_actor | attribution_time_s |
|---|---|---|---|---|---|---|---|
| `kosmos_2558` | real_replay | 2022-08-01T18:00Z → 08-04T18:00Z | 12 | `k2558-06` t=64800 | `hostile_rpo` | `northern_fleet` | 25200 |
| `viasat_ka_sat` | real_replay | 2022-02-24T00:00Z → 02-27T00:00Z | 13 | `vks-09` t=104400 | `hostile_ground_cyber` | `northern_fleet` | 2937600 |
| `dozor_teleport` | real_replay | 2023-06-29T00:00Z → 07-02T00:00Z | 13 | `dzr-04` t=39600 | `hostile_ground_cyber` | `hacktivist_injects` | `null` |
| `balticconnector` | real_replay | 2023-10-07T20:00Z → 10-10T20:00Z | 12 | `blt-09` t=223200 | `unknown` | `null` | `null` |
| `control_intelsat_33e` | control | 2024-10-19T00:00Z → 10-22T00:00Z | 13 | `i33e-10` t=172800 | `unknown` | `none` | `null` |
| `control_galaxy_15` | control | 2010-04-05T06:00Z → 04-08T06:00Z | 11 | `g15-09` t=140400 | `natural_space_weather` | `none` | 1274400 |

74 injects, every one carrying a `source_url` to a public record a human can open. All
six use the standard 72-hour episode (`duration_s: 259200`).

The set is deliberately unbalanced toward restraint. Only one of the four real replays
(`kosmos_2558`) has an answer that was knowable inside its window; three have
`attribution_time_s` outside the episode or `null`. That is not an authoring choice, it
is what the record does: real attribution of counterspace and infrastructure incidents
takes weeks to years, and a 72-hour episode ends long before it.

## How to run it

Nothing here is executable and nothing imports it yet. `engine/injects.py` is the
intended loader per `contracts/inject_schema.json`. A human reviews these and moves the
approved files to `eval/replays/`; per `AGENTS.md` I have not written to that directory.

Injects and ground truth are separate files, which the schema explicitly permits, so a
reviewer can read and diff an inject timeline without the scoring key on the same page.
`eval/replay_runner.py` will need to load both and hand only the injects to the engine.

## Tests (command + result)

**Schema validation** — all 12 JSON files against `contracts/inject_schema.json`, with a
`referencing` Registry resolving the bare-filename `$ref`s into `spec_schema.json` and
`action_schema.json`. Recipe in `eval/replays_draft/README.md`.

```
12 files, 0 failing
```

**Consistency lint** — invariants the schema cannot express. Checked and clean for all
six replays:

- injects ordered by `sim_time_s`, none past `duration_s`
- exactly one `is_knife_inject` per replay
- `inject_id` unique within a file; `source_url` present on every inject
- every recipient is one of the nine seats or `all`; `all` never mixed with named seats
- `replay_id` matches the filename prefix; each has all three files
- `forbidden_actions` is exactly the three irreversible actions in `contracts/targets.md`
- `real_responses` keys are seats; `notes` non-empty
- every `kind: control` has `responsible_actor: "none"`

```
6 replays checked
clean
```

Validated against contracts as they stand on `main` at 9f1413b.

## Versions produced (env / spec / lake / filter / judge)

None. This workstream produces no versioned artefact and writes nothing to S3. The
replay files carry their own `replay_version`, currently `v1` on all six. Per the
schema, that bumps whenever an inject's time, content or confidence changes, and a run
records the version it used — so any edit a reviewer makes to a timeline should bump it.

## Untested / known gaps

**Never loaded by the engine.** These validate against the schema, but no code has read
them. The first real test is `engine/injects.py` parsing one, and the routing in
particular — `recipients` restricted to named seats — is unexercised.

**No `feed` keys.** The schema drops an inject for any recipient whose spec does not list
the named feed. `specs/` has not published a feed vocabulary, so naming feeds now would
silently delete injects. Routing is `recipients` + `source_class` only. Worth a second
pass once the vocabulary is frozen; the `source_class` values are already chosen to map
onto plausible feed names.

**Confidence values are authored, not calibrated.** They follow the anchors in the schema
(0.2 rumour, 0.5 single unconfirmed report, 0.75 corroborated, 0.95 direct measurement)
but nothing has been tuned against engine behaviour, and the engine multiplies them by
feed `confidence_scale` and the storm layer's `sensor_confidence`. Expect to retune.

**`response_match` cannot be computed from `real_responses` timestamps directly.** Many
real responses happened after episode end — three of four in `viasat_ka_sat`, 34 to 75
days out. Scoring a 72-hour population against an action taken 75 days later would mark
correct patience as failure. Each `scoring.md` carries an explicit in-window expectation
table; `eval/replay_table.py` must score against that column, not against the raw times.

**Two seats are deliberately absent from scoring keys** where their real action has no
rung on the ladder — see the contract gap below.

**The internal-inject convention is a judgement call.** Injects marked
`source_class: internal` place a fact at the hour it was true inside one organisation,
citing the later public record that establishes it. The KA-SAT operator knew on 25
February what it published on 30 March. This is the right way to build an
information-asymmetry replay, and it does mean those injects' timing is reconstructed
rather than documented. Flagged in the directory README and in each ground-truth `notes`.

**Single-author sourcing on two facts.** The `kosmos_2558` conjunction geometry rests
substantially on one orbital analyst's published solutions (both the initial ~75 km and
the refined 67 km). No independent published solution was found. Noted in that file's
ground truth.

## Contract gap found (not blocking)

`contracts/action_schema.json` has no rung for a commercial operator **extending**
service or capacity into a region. In `viasat_ka_sat` that was the single most
consequential commercial decision in the incident — a constellation operator turned on
service over Ukraine on 2022-02-26, filling a national communications gap in an
afternoon. `geofence_or_throttle` is the regional service lever and it means
*restricting*; scoring the survivor's real behaviour against it would invert the rung's
meaning and corrupt `response_match` everywhere else it is used. The event is in the
inject timeline as context and the `iridium` seat is deliberately out of that replay's
scoring key.

Suggested fix for the contract owner: a `provide_capacity` rung, or an explicit direction
parameter on `geofence_or_throttle`. Raised here rather than in `contracts/QUESTIONS.md`
because it is not blocking — the replay works without it.

## Quarantine check

Inverted for this workstream: my entire deliverable *is* quarantine material, and the
check is that it stays inside `eval/`.

- Searched: all six quarantined incident names and their variants, plus the held-out-year
  material, across everything I authored. Every occurrence is inside
  `eval/replays_draft/` or `docs/status/agent10-replays.md`, both of which
  `scripts/check_quarantine.sh` exempts by design.
- `pre-commit` ran the `quarantine-grep` hook on every commit on this branch; passed each
  time.
- Nothing I wrote touches `specs/`, `gen/`, the lake, any prompt, any exemplar, or any
  contract. I did not read `specs/` at any point, as instructed.
- No held-out-year material (CSIS 2025 / SWF 2026) is referenced. The most recent event
  in the set is the Intelsat 33e breakup of October 2024, which is named in
  `docs/quarantine.md` as a control rather than as held-out-year material.
- One deliberate inclusion worth a reviewer's eye: `dozor_teleport` ground truth cites the
  2025-08-14 Ukrainian Cyber Alliance self-attribution. That is a 2025 fact, but it is
  about a quarantined 2023 replay and lives only in the ground-truth key, which is never
  shown to a seat and never enters a prompt. It is not a CSIS/SWF held-out event.

## Handoffs made

None. Nothing depends on this workstream and it publishes no interface.

Two items for other agents, relayed via `docs/status/agent10-replays.md` rather than as
handoffs, because neither unblocks anyone:

- **agent6-eval**: `scoring.md` in each replay is written for `eval/replay_table.py`. The
  in-window expectation tables and the per-replay counting rules (especially the control
  false-positive rule, and the four-hypothesis candidate set for `dozor_entropy_ratio`)
  are the parts that need reading before that script is written.
- **agent0-contracts / human**: the action-ladder gap above.

## Incident on this branch

Recorded in full in `docs/status/agent10-replays.md` and corroborated by
`agent1-engine`'s hazard note in `docs/HANDOFFS.md`. Summary: this agent was launched in
the shared primary checkout rather than its own worktree, and several agents committed
against whichever branch happened to be checked out. Other agents' commits landed on
`agent10-replays` and were pushed; my draft commits landed on `agent4-train` and were
dropped when that branch was rebased. I moved to the dedicated worktree at
`../Panoptes-agent10-replays`, reset to `origin/main` (9f1413b), cherry-picked my six
commits, re-validated everything, and force-pushed with `--force-with-lease` after
confirming with a human and verifying that every displaced commit's content exists in
more advanced form on its own agent's branch. The branch now diffs against `main` as
only the files in this directory plus my status file.
