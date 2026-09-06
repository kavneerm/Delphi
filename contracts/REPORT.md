# REPORT — agent0-contracts

## What I built

Seven files in `contracts/`, plus a test suite in `tests/agent0-contracts/`.

**`spec_schema.json`** — one persona spec. `spec_id`, `spec_version`, `seat` (enum of the 12 seats in `seats.md`), `authority` {`unilateral`, `requires_release`, `recommend_only`}, `information` {`feeds[{name, latency_minutes, confidence_scale}]`, `clearance`}, `decision_clock` {`poll_minutes`, `wake_on_inject`, `deliberation_minutes`}, `utility_weights` (the eight named terms), `risk_posture`, `time_horizon`, `private_type`, `psyche`, `priors`, `voice`, `backstory`. The seat-dependence of `private_type` is enforced, not documented: `if/then` blocks require `storm_reposition|opportunistic_isr|action_under_cover` on `northern_fleet`, `honest_broker|opportunistic_amplifier|coordinated_with_russia` on `china`, `russian_directed|freelance|opportunistic` on `hacktivist`, and forbid the field on the other nine seats. `psyche` is required on `northern_fleet` and `kremlin` and forbidden elsewhere. `additionalProperties: false` throughout, so a typo in a spec fails at authoring time rather than at generation time.

**`action_schema.json`** — two things in one file. `x-action-ladder` is the ordered menu, rung 0 `hold` through rung 13 `terrestrial_response`, each with `irreversible`, a `costs` vector {`propellant`, `signaling`, `debris`, `political`} normalised to [0,1], `allowed_seats`, a description and a notes field. Validators ignore `x-` keywords, so the file's *root* is the decision output schema — `{beliefs {hostile, natural, unknown, per_actor}, messages[{to, channel, text}], action {type, params}, reasoning}` — and `action_schema.json` can be handed straight to a structured-output call. Per-action parameter requirements are conditional on `action.type`: `maneuver` needs `asset_id` and `delta_v_mps`, `public_attribution` needs `attributed_actor` and `confidence_stated`, `kinetic` needs `target_asset_id` and `weapon_class`, and so on for all fourteen.

**`event_log_schema.json`** — one JSONL line per event: `sim_time_s`, `wall_time`, `type` (the eight given), `seat` (nullable, since `storm_update` and `episode_end` have no owner), `payload`, `seed`, `env_version`, `episode_id`. Payload shape is fixed per type by conditional blocks — an `action` line carries the action plus `decided_at_sim_time_s` so the deliberation delay is visible in the log; `message_sent`/`message_delivered` are paired by `message_id`, and a sent line with no delivered line is how a dropped message is recorded; `episode_end` carries per-seat utilities and the seat-to-spec_id map. Two rules written into the description because Agent 1's definition of done depends on them: replay compares every field **except** `wall_time`, and lines are written in non-decreasing `sim_time_s` order with ties broken by queue insertion order.

**`inject_schema.json`** — a scenario or replay file holding `injects` (`{sim_time_s, recipients, content, confidence, source}` plus optional `inject_id`, `feed`, `source_class`, `source_url`, `truthful`, `is_knife_inject`) and/or `ground_truth` (`{cause, attribution_time_s, real_responses, notes}` plus optional `responsible_actor`, `expected_beliefs`, `forbidden_actions`). `anyOf` on the two, so Agent 10 can keep the inject timeline and the scoring key in separate files. `attribution_time_s` is nullable — an incident that was never publicly resolved is a first-class case, not a gap.

**`lake_record_schema.json`** — one decision with everything `docs/agent_workstreams.md` lists, plus the provenance `AGENTS.md` requires: `record_id`, `lake_version`, `spec_id`, `spec_version`, `env_version`, `seed`, `episode_id`, `seat`, `sim_time_s`, `filtered_state`, `injects_seen`, `messages_seen`, `output`, `outcome_utility`, `judge_scores{authority,risk,private_info,voice}`, `pair_id`, and optional `pair_flipped_field`, `pair_variant`, `grid_cell`, `gen_model`, `gen_source`, `prompt_version`, `judge_version`, `schema_retries`, `tokens`. `outcome_utility` and `judge_scores` are explicitly nullable because they are filled in after the fact; a judged record must carry a `judge_version`, and a paired record must say which field was flipped and which arm it is, both enforced by `if/then`.

**`s3_layout.md`** — bucket from `WARGAME_BUCKET`, the six prefixes, concrete key templates for each, id conventions for `episode_id`/`run_id`/`sweep_id`/`eval_id`, the five version strings with their patterns, the object-metadata block every `put_object` sets (including `git-commit`), and the write discipline: write-as-you-go, append-only within a version, idempotent judging, no secrets, quarantine boundary, and a local mirror at `WARGAME_LOCAL_ROOT` for offline work.

**`README.md`** — how the five schemas `$ref` each other, the six-line registry recipe for resolving those refs, how to read the ladder as data, and the three things that are easy to get wrong.

**`examples/`** — `spec_northern_fleet_cautious.json` and `decision_usspacecom_knife_inject.json`, both validating, both written as real content rather than filler so Agent 9 has a worked example of the voice and backstory depth the specs need.

## How to run it

```bash
python3.12 -m venv .venv && source .venv/bin/activate
pip install jsonschema referencing pytest ruff
pytest tests/agent0-contracts -q
ruff check tests/agent0-contracts && ruff format --check tests/agent0-contracts
```

To validate your own artefacts, copy the `registry` fixture from `tests/agent0-contracts/test_contracts.py`, or the six-line version in `contracts/README.md`. The schemas `$ref` each other by bare filename, so a plain `Draft202012Validator(schema)` with no registry will fail to resolve.

## Tests (command + result)

`pytest tests/agent0-contracts -q` → **40 passed**. `ruff check` → All checks passed. `ruff format --check` → already formatted.

The suite covers: all five schemas are valid draft 2020-12; every `$ref` in every file resolves; both examples validate; belief and prior distributions sum to 1; ladder order matches the `action_type` enum and rungs are dense 0–13; every ladder entry validates against `x-ladder-entry-schema`; the `irreversible` set is exactly `{kinetic, terrestrial_response, counter_rpo}` per `targets.md`; only `kinetic` creates real debris; `hold` is available to all 12 seats; no seat has fewer than two actions; NSC is the only Blue seat allowed `kinetic` or `terrestrial_response`; the example spec's authority lists are disjoint and its executable authority is inside the menu; the seat enum matches the rows of `seats.md`; the actor enum covers seats, rule actors, `environment` and `system`. Then the negative cases, which are the ones that matter: a China `private_type` on the Northern Fleet seat is rejected, a `psyche` on Norway is rejected, a `private_type` on NSC is rejected, an unknown spec field is rejected, four under-specified action params are rejected, and an invented action type is rejected.

## Versions produced

`contracts_v1` — added to `docs/VERSIONS.md`. No env, spec, lake, filter or judge version is set by this workstream; `s3_layout.md` defines the patterns all five must match and the metadata key each object carries them under.

## Untested / known gaps

- **The schemas have never met real data.** They are validated against two examples I wrote. The first real contact is Agent 1's event log and Agent 9's spec drafts, and that is when the conditional payload blocks in `event_log_schema.json` will be found to be too strict or too loose.
- **`filtered_state` is deliberately open.** Six keys are named, the rest is Engine's. Freezing it before `engine/world.py` exists would have frozen the wrong shape.
- **No release-mechanism schema.** `requires_release` says an action needs release; nothing says what a release message looks like. Left to Engine as internal state — but if `filtered_state` needs to show pending releases, that is a contract change. Flagged as Q8.
- **The cost vectors are judgement, not calibration.** The [0,1] numbers on each rung are my ordering of relative cost. Agent 2's tables may argue with them; the ordering matters more than the values, and only `kinetic`'s `debris: 1.0` is load-bearing.
- **`allowed_seats` is my reading of `seats.md`**, not doctrine. The contestable calls: `hacktivist` gets `public_attribution` (meaning a public claim of responsibility, see Q6); `china` is excluded from every physical rung because `seats.md` says "statements and offers only"; `norway` may `maneuver` because it operates ASBM; `northcom` may not `public_attribution` because it is not a policy seat.
- **Cross-file `$ref` by bare filename** is convenient to read and needs a registry. If an agent hits resolution errors, that is Q-worthy, not a bug — the recipe is in `README.md`.

## Quarantine check (what I searched for, what I found)

Searched every JSON contract and both examples for: `Kosmos`, `Viasat`, `KA-SAT`, `AcidRain`, `Dozor`, `Balticconnector`, `Newnew`, `Intelsat`, `Galaxy 15`, `galaxy15`, `2025`, `2026`.

**Found four hits, all in schema description or notes text, all removed:**
- `action_schema.json` rung 3 notes named Intelsat-33e and Galaxy 15 as the control cases → now "the false-positive control scenarios".
- `action_schema.json` `beliefs.per_actor` description named Dozor → now "end-of-episode attribution entropy".
- `inject_schema.json` `attribution_time_s` named Dozor-Teleport and Intelsat-33e as the null cases → now "an unresolved incident".
- `event_log_schema.json` `scenario_id` used `replay_control_galaxy15` as an example value → now `devset_storm_only`.

This mattered more than it looks. `gen/prompt.py` enforces `action_schema.json` through structured outputs, and structured-output calls carry schema `description` text to the model. A quarantined incident named in a schema description is a quarantined incident in every generation prompt. `contracts/targets.md` names the replays and controls and that is correct — it is a scoring document that never reaches a model — but nothing in the five JSON schemas does now, and nothing should. Re-run the grep above after any contract edit.

The example spec's backstory was checked by hand: it references a 2022 Svalbard fibre disruption and an unnamed relief-for-cause, neither of which is quarantine material, and it invents its subject entirely.

## Handoffs made

`contracts_v1` unblocks Wave 1 in full — every agent's first instruction is to read this directory. Specifically:

- **Agent 1 (engine)** — `event_log_schema.json` for `log.py` and the replay comparison (exclude `wall_time`), `action_schema.json#/x-action-ladder` for `attacks.py` and the action gate, `inject_schema.json` for `injects.py`, `spec_schema.json` `information.feeds` for `seats.py`, and the `utility_weights` sign convention for `utility.py`.
- **Agent 3 (gen)** — `action_schema.json` root as the structured-output schema, `lake_record_schema.json` as the write target, `spec_schema.json` for the prompt prefix.
- **Agent 4 (train)** — `lake_record_schema.json` for `filter.py`, `s3_layout.md` for `runs/` and `checkpoints/`.
- **Agent 6 (eval)** — `inject_schema.json` for `replays/`, and Q6 needs an answer before `control_false_positive_rate` is implemented.
- **Agent 7 (ui)** — `event_log_schema.json` is enough to generate stub logs today; the `payload` conditionals tell you what each event type is guaranteed to carry.
- **Agent 9 (specs)** — `spec_schema.json` plus `examples/spec_northern_fleet_cautious.json` as the depth target. Q4 (the `risk_posture` and `time_horizon` enums) is worth reading before drafting 30 specs against them.

Open questions for humans are in `contracts/QUESTIONS.md` — eight of them, none blocking, all cheaper to answer before Wave 1 than after.
