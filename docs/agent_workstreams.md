# Agent Workstreams — Phases 1–4

Six Codex agents, one Superset worktree each. All agents read `contracts/` first and never modify it; contract changes go through a human.

## contracts/ (human-owned, written in Phase 0, read by every agent)

- `spec_schema.json` — persona spec fields
- `action_schema.json` — action menu + escalation ladder + structured decision output {beliefs, messages[], action, reasoning}
- `event_log_schema.json` — one JSON line per event: sim_time, type, seat, payload, seed, env_version
- `inject_schema.json` — replay inject format + ground_truth format
- `lake_record_schema.json` — one decision with full metadata (spec_id, spec_version, env_version, seed, episode_id, sim_time, filtered_state, injects_seen, messages_seen, output, outcome_utility, judge_scores{authority,risk,private_info,voice}, pair_id)
- `s3_layout.md` — bucket/prefix conventions and version tagging
- `targets.md` — numeric pass conditions
- `quarantine.md` — the 3 replays, 2 controls, all 2025–26 events

---

## Agent 1 — ENGINE (`worktree: engine`)

**Goal:** A deterministic, replayable, real-time wargame engine with a storm layer and four attack types, driven by stub agents.

**Build, in order:**
1. `engine/loop.py` — single-threaded event loop; priority queue keyed on sim_time; seeded RNG; clock with speed dial; 72-sim-hour episode; pause/scrub.
2. `engine/world.py` — state: satellite positions (two-body + impulsive maneuver), asset classes {persistent HEO nodes, constellations, pass-based sensors}, protected-comms capacity, propellant, gateway/cable status, reputation scores.
3. `engine/storm.py` — severity profiles (G4/G5/Carrington, plus a loader for real Kp/Dst series); multiplies each seat's sensor_confidence and comms_bandwidth; safe-mode probability per asset class scaled by severity; tracking degradation + conjunction-screening suspension windows.
4. `engine/attacks.py` — jam, dazzle, ground_cyber, rpo. Each: observable effects, duration, attribution_lag ~ distribution(type), telemetry signature flag (natural vs. interference) visible to operator seats only.
5. `engine/seats.py` — per-seat filtered view: feeds, latencies, clearance; message delivery with per-channel delay; decision clock (poll interval / wake-on-inject).
6. `engine/injects.py` — load inject files (contracts/inject_schema); emit on schedule.
7. `engine/utility.py` — per-persona utility at episode end from the persona's own weights.
8. `engine/log.py` — write event stream to S3 per `event_log_schema`; `replay(log)` reproduces state exactly.
9. `engine/stubs.py` — scripted agents for every seat (hold / random-in-menu / aggressive) so a full episode runs with no LLM.
10. `engine/agent_api.py` — the interface real agents implement: `observe() -> filtered_state`, `act(decision_json)`, `wake_policy`.

**Definition of done:** `python -m engine.run --seed 1 --storm G5 --stubs` completes a 72-hour episode; `python -m engine.replay <log>` reproduces it byte-identically; storm check script reports safe-mode count and degradation duration for the May-2024 profile; `env_version` bumps to `env_v1` and is frozen.

**Do not:** call any LLM; read `lake/`; touch `contracts/`.

---

## Agent 2 — CALIBRATION (`worktree: calib`)

**Goal:** Turn the open record into the parameter table the engine and generator use, with every number cited.

**Build:**
1. `calib/red_action_rates.csv` — by actor (Russia, China, other), by category (EW, cyber, RPO, DE, kinetic), counts and rates from SWF/CSIS **2018–2024 only**. Source URL and report page per row.
2. `calib/attribution_lags.csv` — by attack type: distribution parameters fit to public incident records **excluding quarantine.md**.
3. `calib/storm_effects.csv` — May 2024 and Feb 2022: safe-mode counts, tracking-degradation hours, screening-suspension hours, satellites lost; NOAA Kp/Dst series files for the storm loader.
4. `calib/holdout_2025_2026.csv` — the held-out year's events, same columns as (1), **write-protected; used only by Agent 6 in Phase 6**.
5. `calib/calibration.md` — one paragraph per table: what it feeds, what was assumed, what was rejected and why.

**Definition of done:** engine loads (1)–(3) from config with no hardcoded numbers; every row has a citation; (4) is present but nothing outside Agent 6 imports it.

**Do not:** include any quarantined incident or 2025–26 event in (1)–(3).

---

## Agent 3 — GENERATION (`worktree: gen`)

**Goal:** Produce the training lake: 30–50k scored decisions from a frontier model playing every seat inside the locked engine.

**Build:**
1. `gen/prompt.py` — assembles: stable prefix (spec + exemplars from `specs/exemplars/`, cache-friendly) + variable suffix (filtered state, injects, messages, belief table). Enforces `action_schema` via structured outputs; retry on schema failure.
2. `gen/agent.py` — implements `engine.agent_api` by calling the OpenAI API (model configurable; default the best available to the org, fallback GPT-5.5). Async, 50–100 in flight, exponential backoff.
3. `gen/sweep.py` — parameter grid: storm severity, intel confidence, Red type × psyche, pre-existing crisis, commercial-sharing policy, Iridium survival, seed. Samples specs from `specs/train/` (never `specs/holdout/`). Builds counterfactual pairs: same seed/state, one spec field flipped, shared `pair_id`.
4. `gen/run.py` — launches episodes across the grid on the engine; writes each decision to S3 as a `lake_record` immediately (no in-memory lake); tags spec_version/env_version/seed.
5. `gen/judge.py` — second pass over S3: per-dimension 1–5 scores {authority, risk, private_info, voice} with rubric from the spec; writes scores back; idempotent so it can be re-run with a new rubric.
6. `gen/cost_check.py` — runs 10 episodes, reports tokens and $ extrapolated to the full grid; must be run and approved by a human before `run.py --full`.
7. `gen/sample_review.py` — dumps 50 high / 50 low judged records to a markdown file for human read.

**Definition of done:** cost check approved; full run complete; every record has utility + four judge scores; sample review file produced.

**Do not:** use any quarantined incident in exemplars or scenarios; read `specs/holdout/`; regenerate the full lake after it exists (regenerate by seat or scenario only, via `run.py --seat X` / `--scenario Y`).

---

## Agent 4 — TRAINING (`worktree: train`)

**Goal:** A parallel sweep of LoRA fine-tunes over filters of the lake, served for evaluation, with provenance.

**Build:**
1. `train/filter.py` — config-driven: judge threshold, utility cutoff (per-persona percentile), counterfactual oversampling factor, seat weighting, pair-consistency check (drop pairs whose two decisions are identical). Emits JSONL in chat format (system=spec, user=state+injects+messages, assistant=decision JSON) + a manifest with lake/filter versions.
2. `train/launch.py` — `--backend {fireworks,sagemaker,ec2}`, default `fireworks`. Uploads the filtered JSONL as a Fireworks **dataset**, then creates one SFT **LoRA** job per sweep variant through the Fireworks REST API / `firectl` CLI, over `accounts/fireworks/models/llama-v3p1-8b-instruct` and `accounts/fireworks/models/qwen2p5-7b-instruct` — both IDs verified 2026-09-06 with `firectl get model <id> --api-key "$FIREWORKS_API_KEY"`, each reporting `Tunable: true` and `Supports Lora: true`. Re-verify against the model library if a job 404s, and use what it returns rather than a guess. **Llama caveat:** that model is past its stated `Deprecation Date: 2025-11-26` and reports `Status: INTERNAL`, where Qwen reports `OK` — run the 200-example smoke test on the Llama arm *first*, and if it fails pick a replacement 8B-class base before spending sweep budget. **Context caveat:** the two bases differ 4× (Llama 131072, Qwen 32768) — check prompt length against the 32k floor in `filter.py`, or the Qwen arm degrades silently instead of erroring. `sagemaker` and `ec2` (Unsloth/PEFT) stay available for when GPU quota lands. base ∈ {Llama-3.1-8B, Qwen2.5-7B}, rank ∈ {16,32}, epochs ∈ {2,3}, filter config ∈ list. Each job tagged with all versions; provider dataset/job/model ids and checkpoints to `s3://…/checkpoints/<run_id>/`.
3. `train/continue.py` — continue training from a checkpoint using Fireworks **continue-from-LoRA** off the existing tuned adapter (for round 2).
4. `train/dpo.py` — build preference pairs from the lake (same state, high vs. low on a chosen judge dimension) into a preference-pair JSONL, submit it as a Fireworks **DPO** job, run one epoch on a checkpoint, log the patch in `checkpoints/<run_id>/patches.md`.
5. `train/serve.py` — creates **one** Fireworks on-demand deployment and loads **every** sweep adapter onto it as **multi-LoRA**; exposes `engine.agent_api` as a thin client that selects the adapter by name per request so the fine-tuned model can play seats; `--down` deletes the deployment. Falls back to a vLLM server on EC2 for `sagemaker`/`ec2`.
6. `train/gates.py` — pre-eval gates per checkpoint: held-out-persona coherence (from `specs/holdout/`), counterfactual sensitivity (paired decisions differ), schema validity rate. Fails fast.
7. `train/devset.py` — runs the synthetic dev scenarios (from `specs/devset/`) against a served checkpoint; writes a metrics table per `targets.md`.

**Definition of done:** sweep of 8–12 runs completes; gates + dev-set table for every survivor in `s3://…/runs/<sweep_id>/summary.md`; one checkpoint marked `candidate_final` when it meets `targets.md`.

**Do not:** run the real replays or the held-out year (that's Agent 6); train from the base model for round 2; edit filter configs without bumping the version.

**No local GPU.** The EC2 G/VT on-demand quota (`L-DB2E81BA`) is currently **0** with an increase request pending (`312f3b0f78754d25920d9b0f6482d2feWs3fPUjY`, `CASE_OPENED`), and every SageMaker g5 training quota is also 0. Do not assume a GPU instance exists; `fireworks` is the default backend for that reason.

**Deployment discipline.** The Fireworks on-demand deployment is billed **per GPU-hour**. Bring it up only for dev-set eval, round-2 generation, and final validation; tear it down with `serve.py --down` between each; log every up/down time to `docs/VERSIONS.md`.

---

## Agent 5 — ROUND-2 SELF-PLAY (`worktree: selfplay`) — starts when `candidate_final` exists

**Goal:** Second-generation data from the fine-tuned model playing the full persona pool, then continued training.

**Build:**
1. `selfplay/run.py` — same as `gen/run.py` but the agent is `train/serve.py`; opponents sampled from the whole spec pool (never the same spec on both sides); large grid, cheap.
2. Reuse `gen/judge.py` and `train/filter.py`; call `train/continue.py` from `candidate_final`.
3. Re-run `train/gates.py` and `train/devset.py`; if better, mark `candidate_final_r2`.


**Fireworks deployment discipline.** `train/serve.py` fronts a single Fireworks on-demand deployment carrying every sweep adapter as multi-LoRA, selected by adapter name per request (`--backend {fireworks,sagemaker,ec2}`, default `fireworks`). Billed **per GPU-hour**: bring it up for this phase only, tear it down with `serve.py --down` when the phase ends, and log both times to `docs/VERSIONS.md`.

**Definition of done:** one round complete with a before/after dev-set table; a second round only if time and improvement.

---

## Agent 6 — EVALUATION (`worktree: eval`) — builds throughout, runs once at the end

**Goal:** The final validation artifacts, run exactly once against the final checkpoint.

**Build:**
1. `eval/replays/` — the three real replays (Kosmos-2558, Viasat KA-SAT, Dozor-Teleport) and two controls (Intelsat-33e, Galaxy 15) as inject + ground-truth files per `inject_schema`. Human-authored content; agent handles format and loading.
2. `eval/replay_runner.py` — runs N seeds of a replay against a served checkpoint; records belief trajectory per seat, action distribution, irreversible-action rate.
3. `eval/replay_table.py` — per replay: real attribution lag vs. population median; real modal response vs. population modal; false-positive rate on controls; belief spread on Dozor.
4. `eval/holdout_mix.py` — runs the population under each Red psyche value on the standard scenario grid; compares action mix to `calib/holdout_2025_2026.csv`; reports all four psyches with distance metric and a persistence baseline.
5. `eval/perturb.py` — reruns the dev set under `env_v1_perturbed`; reports delta.
6. `eval/lamparth.py` (optional) — population spread vs. human spread vs. base model on the Lamparth scenario.
7. `eval/report.py` — one markdown + one PNG per table for the deck.

**Definition of done:** `eval/final_report.md` produced from a single invocation with the final checkpoint id embedded; no reruns after it exists.


**Fireworks deployment discipline.** `train/serve.py` fronts a single Fireworks on-demand deployment carrying every sweep adapter as multi-LoRA, selected by adapter name per request (`--backend {fireworks,sagemaker,ec2}`, default `fireworks`). Billed **per GPU-hour**: bring it up for this phase only, tear it down with `serve.py --down` when the phase ends, and log both times to `docs/VERSIONS.md`.

**Do not:** run before Agent 4 marks a final candidate; let anything in `eval/replays/` leak into `specs/` or the lake.

---

## Dependency order

contracts → {Engine, Calibration} in parallel → env lock → Generation → Training sweep → Round-2 (optional) → Evaluation (once).
UI agent (Phase 7) runs in parallel from the moment `event_log_schema` exists, using stub logs.

## Human checkpoints (don't let agents pass these alone)
- Approve env lock (storm check numbers look right).
- Approve cost check before full generation.
- Read the 50/50 sample review before the sweep.
- Choose `candidate_final`.
- Trigger Agent 6 exactly once.
