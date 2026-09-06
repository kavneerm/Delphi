# Superset Launch Prompts — Execution Plan v2

Paste `SHARED PREAMBLE` at the top of every agent prompt, then the agent-specific block.
Launch order: **Agent 0 first** (contracts, ~30 min, human-reviewed), then everything in Wave 1 at once, then Wave 2 as dependencies land.

Repo assumed at `~/svalbard-wargame`. Adjust paths if different.

---

## SHARED PREAMBLE (prepend to every agent)

You are one of several parallel coding agents building a real-time wargame simulation for a hackathon due Sunday 12:00 p.m. Read `docs/execution_plan_v2.md` and `docs/agent_workstreams.md` first; they are authoritative. Then read everything in `contracts/` — these are frozen interface definitions. **Never edit anything in `contracts/`, `calib/holdout_2025_2026.csv`, `eval/replays/`, or `docs/quarantine.md`.** If `contracts/` does not exist yet, stop and report; do not invent schemas.

Rules:
- Python 3.11, type hints, `pyproject.toml`, `ruff` clean, tests under `tests/` with `pytest`. No notebooks.
- Every artifact written to S3 carries `env_version`, `spec_version`, `lake_version`, and `seed` per `contracts/s3_layout.md`. AWS CLI is configured; use `boto3`.
- Secrets from environment variables only (`OPENAI_API_KEY`, AWS creds via the CLI profile). Never write keys to disk.
- Quarantine: the incidents in `docs/quarantine.md` (Kosmos-2558, Viasat KA-SAT, Dozor-Teleport, Balticconnector, Intelsat-33e, Galaxy 15, and all 2025–26 counterspace events) must not appear in specs, exemplars, prompts, or training data. If you find one, remove it and flag it in your final report.
- Work only inside your worktree's directories. Do not touch other agents' directories.
- Commit small, often, with messages prefixed by your agent name. When done, write `REPORT.md` in your directory: what you built, how to run it, what's untested, open questions for humans.
- If blocked on a decision that changes an interface, stop and write the question to `QUESTIONS.md` instead of guessing.

---

## AGENT 0 — CONTRACTS (run first; a human reviews before Wave 1)

Directory: `contracts/`, `docs/`.
Goal: draft the frozen interface files from the plan so every other agent can start.

Produce:
1. `contracts/spec_schema.json` — JSON Schema for a persona spec: `spec_id`, `spec_version`, `seat` (enum of the 12 seats), `authority` {unilateral: [actions], requires_release: [actions], recommend_only: [actions]}, `information` {feeds: [{name, latency_minutes, confidence_scale}], clearance}, `decision_clock` {poll_minutes, wake_on_inject: bool, deliberation_minutes}, `utility_weights` {asset_loss, escalation_risk, alliance_cohesion, domestic_political, reputation_resolve, revenue, liability, career}, `risk_posture` (enum), `time_horizon` (enum), `private_type` (seat-dependent enum; Northern Fleet: storm_reposition|opportunistic_isr|action_under_cover; China: honest_broker|opportunistic_amplifier|coordinated_with_russia; hacktivist: russian_directed|freelance|opportunistic), `psyche` (Red only: revisionist|revanchist|opportunistic_cautious|regime_survival), `priors` {}, `voice` (string), `backstory` (string).
2. `contracts/action_schema.json` — the action menu as an ordered ladder: hold, maneuver, private_demarche, public_attribution, request_commercial_priority, share_telemetry, geofence_or_throttle, disclose_incident, jam, dazzle, ground_cyber, counter_rpo, kinetic, terrestrial_response. Mark each with `irreversible: bool`, `costs` {propellant, signaling, debris, political}, and `allowed_seats`. Plus the decision output schema: `{beliefs: {hostile: float, natural: float, unknown: float, per_actor: {}}, messages: [{to, channel, text}], action: {type, params}, reasoning: string}`.
3. `contracts/event_log_schema.json` — one JSON line per event: `sim_time_s`, `wall_time`, `type` (inject|action|message_sent|message_delivered|state_change|storm_update|attribution_revealed|episode_end), `seat`, `payload`, `seed`, `env_version`, `episode_id`.
4. `contracts/inject_schema.json` — replay inject `{sim_time_s, recipients: [seat], content, confidence, source}` and ground truth `{cause, attribution_time_s, real_responses: {seat: action}, notes}`.
5. `contracts/lake_record_schema.json` — one decision with full metadata as listed in `docs/agent_workstreams.md`.
6. `contracts/s3_layout.md` — bucket name from env `WARGAME_BUCKET`; prefixes `specs/`, `lake/`, `runs/`, `checkpoints/`, `validation/`, `logs/`; object naming with version tags.
7. `contracts/targets.md` — the numeric pass conditions from the plan, one per line, machine-readable table at the bottom.
8. `docs/quarantine.md` — the list above, with a one-line reason each.
9. `contracts/seats.md` — the 12 personas and 5 rule actors with one-paragraph descriptions taken from the plan.

Validate all JSON Schemas with `jsonschema`. Write one example spec and one example decision that validate. Stop and report; do not start on any other workstream.

---

## WAVE 1 — launch together once contracts are approved

### AGENT 1 — ENGINE
Directory: `engine/`. Follow the `ENGINE` section of `docs/agent_workstreams.md` exactly, in the listed order (loop → world → storm → attacks → seats → injects → utility → log → stubs → agent_api). Priorities: determinism (seeded RNG everywhere, byte-identical replay from log), a single-threaded priority-queue event loop keyed on sim time, and per-seat filtered views. Physics: two-body propagation plus impulsive maneuvers; no conjunction analysis. Storm layer multiplies per-seat `sensor_confidence` and `comms_bandwidth`, applies safe-mode draws per asset class, and opens tracking-degradation and screening-suspension windows; load profiles from `calib/storm_effects.csv` if present, else use placeholder G4/G5/Carrington curves clearly marked TODO. Attack effects: jam, dazzle, ground_cyber, rpo, each with observable effects, duration, an attribution-lag draw from `calib/attribution_lags.csv` (placeholder if absent), and a telemetry-signature flag visible only to operator seats. Definition of done: `python -m engine.run --seed 1 --storm G5 --stubs --hours 72` completes; `python -m engine.replay <log>` reproduces it byte-identically; `python -m engine.storm_check --profile may2024` prints safe-mode count and degradation hours. Tests for the loop, replay determinism, and filtered views. Do not call any LLM.

### AGENT 2 — CALIBRATION
Directory: `calib/`. Follow the `CALIBRATION` section. Use web access to pull from the Secure World Foundation Global Counterspace Capabilities reports (2018–2024 editions and their data sheets at swfound.org/counterspace) and the CSIS Space Threat Assessments (2018–2024) to build `red_action_rates.csv` by actor × category (EW, cyber, RPO, directed energy, kinetic). Build `attribution_lags.csv` from public incident records that are NOT in `docs/quarantine.md` (e.g., Kosmos-2542/2543 2020, Luch/Olymp, Kosmos-1408 test, Shijian-21, GPS jamming cases). Build `storm_effects.csv` and the Kp/Dst series files for May 2024 and Feb 2022 from NOAA SWPC. Build `holdout_2025_2026.csv` from the 2025 CSIS and 2026 SWF reports, then `chmod 444` it and add a `.gitattributes`/pre-commit check that no file outside `eval/` imports it. Every row cites a URL and page/section. Write `calibration.md`. Do not include any quarantined incident in the first three tables.

### AGENT 3 — GENERATION
Directory: `gen/`. Follow the `GENERATION` section. Build against `engine.agent_api` (import it; if `engine/` isn't ready, code to the interface in `contracts/` and use a mock). Prompt assembly: stable cached prefix (spec + exemplars from `specs/exemplars/`) + variable suffix (filtered state, injects, messages, belief table); OpenAI Responses API with structured outputs enforcing the decision schema; retry on schema failure; async with a configurable concurrency limit (default 64) and exponential backoff. Model from env `GEN_MODEL` (default `gpt-6-astra`, fallback `gpt-5.5`). Sweep grid from `gen/grid.yaml`: storm severity, intel confidence, Red private type × psyche, pre-existing crisis, commercial-sharing policy, Iridium survival, seeds; counterfactual pairs share a `pair_id`. Write each decision to S3 as a lake record immediately. Judge as a separate idempotent pass (`gen/judge.py`) with a rubric derived from the spec, scoring authority/risk/private_info/voice 1–5. `gen/cost_check.py` runs 10 episodes and prints tokens and extrapolated dollars for the full grid; `gen/run.py --full` must refuse to run unless `cost_check` has written an approval file that a human touched. `gen/sample_review.py` dumps 50 high / 50 low to markdown. Never read `specs/holdout/`.

### AGENT 4 — TRAINING
Directory: `train/`. Follow the `TRAINING` section. `filter.py` (config-driven, emits chat-format JSONL + manifest; drops counterfactual pairs whose two decisions are identical), `launch.py` (parallel LoRA jobs on SageMaker training jobs or EC2 with PEFT/Unsloth; bases Llama-3.1-8B and Qwen2.5-7B; rank/epochs from config; checkpoints to S3 with all version tags), `continue.py`, `dpo.py` (pairs from the lake on a chosen judge dimension, one epoch, logs a patch note), `serve.py` (vLLM on EC2 exposing `engine.agent_api`), `gates.py` (held-out persona coherence, counterfactual sensitivity, schema validity), `devset.py` (runs `specs/devset/` scenarios against a served checkpoint and writes a metrics table per `contracts/targets.md`). Start with a smoke test on 200 examples to validate the whole path end to end before anything else. Do not run real replays or the held-out year.

### AGENT 7 — UI / DEMO
Directory: `ui/`. Build against `contracts/event_log_schema.json` using stub logs (ask Agent 1 for a sample log or generate one from the schema). Single-page web app (React or plain HTML+JS; keep it simple): ground-track map with satellite arcs and a countdown clock; a card per persona showing last decision time, beliefs, and current reasoning; the escalation ladder with actions landing on it; a storm-severity overlay; a scrubbable timeline; a persona-swap dropdown that reloads a different logged run; a "split-screen" mode that freezes at a chosen sim time and shows two seats side by side. Also a heatmap component that reads `validation/heatmap.csv` (x: storm severity, y: Red type, value: false-positive escalation rate) and a validation-table component that reads `validation/final_report.md`. Must play back a logged run at adjustable speed with no live model calls. Record a 3-minute screen capture of a stub run as the fallback demo.

### AGENT 8 — INFRA
Directory: `infra/`. Create S3 buckets/prefixes per `contracts/s3_layout.md` (Terraform or a boto3 script; idempotent). Provision one GPU instance (g5.12xlarge or p4d if quota allows; request quota if not and report), with an AMI that has CUDA, PyTorch, PEFT, Unsloth, vLLM installed; write `infra/gpu_setup.sh`. Provision a small EC2 or use local for the engine. Write `infra/serve_vllm.sh <checkpoint_s3_uri>`. IAM role with S3 read/write scoped to the bucket. Cost guardrails: tag everything `project=svalbard`, write `infra/teardown.sh`. Report instance IDs and endpoints in `REPORT.md`.

### AGENT 9 — SPEC DRAFTER (human-reviewed output)
Directory: `specs/drafts/`. Using `contracts/spec_schema.json` and `contracts/seats.md`, draft 2–4 temperament variants for each of the 12 seats (target 30 specs) plus 5 held-out specs in `specs/drafts/holdout/`. Ground authority envelopes and information feeds in open doctrine (Space Force Doctrine Publication 1, the 2020 PLA Science of Military Strategy CASI translation, FFI/CNA analyses of the Northern Fleet, Norway's defense white papers, the Svalbard Treaty); ground behavioral priors in the SWF/CSIS 2018–24 record. Red specs must vary primarily by `private_type` and `psyche`, with lower temperament variance than Blue (Russian centralization). Every spec validates against the schema. Also draft `specs/drafts/exemplars/` — 8–10 historical decision episodes as short structured cards (situation, information available, decision, why), none from `docs/quarantine.md` (use ExComm, Stark/Vincennes, Petrov, Able Archer, Kosmos-2542/2543, Luch/Olymp, Starlink-Ukraine geofencing, Kosmos-1408 responses, Shijian-21, May 2024 operator actions). And draft `specs/drafts/devset/` — 8 synthetic scenarios with known correct behavior (storm-only → unattributed; clean jamming signature → attributed; ambiguous → spread; etc.), each with a `expected.json`. A human moves approved files from `drafts/` to `specs/train/`, `specs/holdout/`, `specs/exemplars/`, `specs/devset/`.

### AGENT 10 — REPLAY AUTHOR (human-reviewed output)
Directory: `eval/replays_draft/`. Author the four real replays and two controls per `contracts/inject_schema.json`: Kosmos-2558 (2022), Viasat KA-SAT (2022), Dozor-Teleport (2023), Balticconnector (2023); controls Intelsat-33e (2024) and Galaxy 15 (2010). For each: an inject timeline of what was publicly knowable and when (with source URLs), a ground-truth file (cause, attribution time, real responses by real actor), and a `scoring.md` describing pass conditions per `contracts/targets.md`. Use web access to verify every date. A human reviews and moves to `eval/replays/`. Do not share these files with any other agent and do not reference them anywhere else.

### AGENT 11 — PITCH & ONE-PAGER
Directory: `pitch/`. From `docs/execution_plan_v2.md` and the project brief, draft: the one-sentence narrative; a six-beat pitch script (dependence → fragility → adversary behavior → the attribution problem → why current tools fail → what we built), each beat with its real-world example and citation; the validation slide skeleton with placeholders for the replay table, held-out action mix, perturbation delta; the ethics answer; judge-specific answers (Second Front, Space/Navy CTOs, VCs); a README (200 words); a one-page PDF template. Propose five project names. Everything is a draft for humans to edit.

---

## WAVE 2 — launch as dependencies land

### AGENT 5 — ROUND-2 SELF-PLAY (after `candidate_final` exists)
Directory: `selfplay/`. Reuse `gen/run.py` with the agent swapped to `train/serve.py`; opponents sampled from the full spec pool with the constraint that the same spec never occupies two seats in one episode; large grid. Reuse `gen/judge.py` and `train/filter.py`; call `train/continue.py` from `candidate_final`; re-run `train/gates.py` and `train/devset.py`; write a before/after table; mark `candidate_final_r2` only if it improves on `contracts/targets.md`.

### AGENT 6 — EVALUATION (build now, RUN only when a human triggers)
Directory: `eval/`. Build `replay_runner.py`, `replay_table.py`, `holdout_mix.py` (all four Red psyches, distance metric, persistence baseline), `perturb.py` (uses `env_v1_perturbed` config), `baseline_prompted.py` (frontier model prompted-only on the base scenario), optional `lamparth.py`, and `report.py` producing `validation/final_report.md` plus `validation/heatmap.csv` and PNGs. Guard: `report.py` refuses to run unless `--checkpoint <id> --human-approved` is passed, and refuses a second run if `final_report.md` exists. Build and test everything on stub logs and a smoke checkpoint; do not run on real replays until triggered.

---

## Human checklist while agents run
1. Review Agent 0 output → approve contracts → launch Wave 1.
2. Review Agent 9 drafts → move to `specs/train|holdout|exemplars|devset`.
3. Review Agent 10 drafts → move to `eval/replays/`.
4. Approve env lock (Agent 1's storm check numbers).
5. Approve `gen/cost_check` output → touch the approval file.
6. Read Agent 3's sample review → re-judge if needed.
7. Pick `candidate_final` from Agent 4's summary.
8. Trigger Agent 6 once.
9. Submission at 11:15 a.m.
