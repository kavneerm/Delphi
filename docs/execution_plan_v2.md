# Execution Plan v2 — Svalbard Commercial-LEO Blackout Wargame

**Deadline:** Sunday 12:00 p.m. Timeline assumes start ~3:30 p.m. Saturday.

## Stack and roles
- **Superset** — orchestrates parallel Codex coding agents, one git worktree per workstream. Builds the code. Not the wargame runtime.
- **Codex** — writes the pipeline. Does not generate training data directly.
- **OpenAI API ($2.5k credits)** — frontier model for trajectory generation, the LLM judge, and the prompted-only baseline. Model: GPT-6 Astra if the org has access (released Sept 3, limited rollout); otherwise GPT-5.5 Thinking. Same model for the judge.
- **Fireworks ($500 credits)** — hosted LoRA fine-tuning and serving: datasets + SFT/DPO jobs via REST/`firectl`, one on-demand deployment carrying every sweep adapter as multi-LoRA. **Billed per GPU-hour** — bring the deployment up only for dev-set eval, round-2 generation, and final validation, tear it down between each, and log up/down times to `docs/VERSIONS.md`.
- **AWS** — S3 for specs/lake/runs/checkpoints. SageMaker / EC2 GPU (g5.12xlarge / p4d) for LoRA is a **fallback only**: EC2 G/VT quota is 0 (request pending) and every SageMaker g5 training quota is 0, so neither path is usable today. The engine runs anywhere.
- **Open-weight base** — Llama 3.1 8B and Qwen 2.5 7B (air-gappable; matters for the Defense pitch).

## Budget (approximate; the cost check sets the real numbers)
| Item | Est. |
|---|---|
| Main lake, 50–80k decisions | $600–900 |
| Judge, first pass + two re-judges | $200–300 |
| Targeted regeneration (per-seat/scenario) | $300 |
| Round-2 judging (generation is on our own model) | $150 |
| Final eval + prompted-only baseline + Lamparth | $150 |
| Fireworks (training jobs ~$50–80; dedicated deployment ~$200–300 with spin-down discipline; reserve ~$100) | ~$350–480 |
| Reserve | ~$500 |

Do not: regenerate the whole lake after it exists; run the thousand-run sweep on the frontier model.

## Locked decisions
- Validation = 3 real replays (Kosmos-2558, Viasat KA-SAT, Dozor-Teleport) + 2 false-positive controls (Intelsat-33e, Galaxy 15) + held-out 2025–26 counterspace action mix. **Quarantined from specs, exemplars, and training.**
- Iteration uses a synthetic dev set only. Real replays and held-out year run **once**, at the end.
- One environment (`env_v1`), parameterized, locked before generation. A perturbed config exists only for the final robustness check.
- One persona-conditioned model; Red psyche (revisionist / revanchist / opportunistic-cautious / regime-survival) is a spec field.
- Generate once, big; training is a parallel sweep over filters of the cached lake; specific failures patched with DPO.
- Targets (`targets.md`): ≥90% on safety metrics (controls unattributed; no irreversible action where reality had none; Red kinetic ≈ 0; counterfactual sensitivity); ≥75% response match; belief lag ≤ 1 inject; spread maintained on Dozor.

## Seats
Personas: NORTHCOM, USSPACECOM, NSC, Norway, NATO, Northern Fleet, Kremlin/MFA, Starlink-analog, Iridium-analog, KSAT, hacktivist, China.
Rules: SWPC forecaster, insurer, media clock, OSINT clock, civilian users.

---

## Phase 0 — Contracts (3:30–4:15 p.m. Sat) — humans, before any agent starts
Write `contracts/` by hand; agents read it, never edit it:
- `spec_schema.json`, `action_schema.json` (menu + ladder + decision output), `event_log_schema.json`, `inject_schema.json`, `lake_record_schema.json`, `s3_layout.md`, `targets.md`, `quarantine.md`.
- Owners: Engine (1), Data/Training (1), UI/Demo (1), Scenario/Personas/Pitch (1–2). Provision the GPU instance / SageMaker quota **now**.

## Phase 1 — Build in parallel (4:15–8:00 p.m. Sat) — Superset, Agents 1–2 + UI agent; humans on specs
- **Agent 1 ENGINE:** event loop, world state, storm layer, four attack types (jam, dazzle, ground-cyber, RPO), per-seat filtered views, injects, utility, S3 event log with exact replay, stub agents, `agent_api`. Done when a 72-hour stub episode runs, replays byte-identically, and the May-2024 storm check lands in range → **lock `env_v1`**.
- **Agent 2 CALIBRATION:** `red_action_rates` (SWF/CSIS 2018–24), `attribution_lags` (non-quarantined incidents), `storm_effects` (May 2024, Feb 2022, NOAA series), `holdout_2025_2026` (write-protected, Agent 6 only), `calibration.md` with citations.
- **UI agent:** orbit/ground-track view, persona cards, ladder, storm overlay, scrubbable timeline — built against `event_log_schema` using stub logs.
- **Humans:** 25–35 specs (2–4 temperaments per seat; Red psyche field), 4–6 held-out specs, exemplar bank (non-quarantined episodes), 6–8 synthetic dev scenarios with known correct behavior, pitch skeleton, replay files authored but not run.

**Milestone 8:00 p.m.:** env locked; specs, exemplars, dev set in S3.

## Phase 2 — Generation (8:00–11:30 p.m. Sat) — Agent 3
- Prompt = cached prefix (spec + exemplars) + variable suffix (filtered state, injects, messages, beliefs); structured outputs; async 50–100 in flight.
- Grid: storm severity × intel confidence × Red type/psyche × pre-existing crisis × commercial-sharing policy × Iridium survival × seeds; counterfactual pairs with shared `pair_id`.
- **Human gate:** `cost_check` on 10 episodes → approve → full run. Target 50–80k decisions written to S3 as they complete.
- Judge as a second pass over S3 (per-dimension 1–5: authority, risk, private-info, voice), idempotent.
- **Human gate:** read the 50 high / 50 low sample review; fix judge rubric and re-judge if fooled.

## Phase 3 — Training sweep (11:30 p.m.–1:30 a.m.) — Agent 4
- Filters: judge ≥3/≥4/≥5 × utility top 30/50/70% × counterfactual oversampling 2×/4× × Red weighting; drop pairs whose two decisions are identical.
- LoRA: base {Llama-3.1-8B, Qwen2.5-7B} × rank {16,32} × epochs {2,3}. 8–12 jobs in parallel, all version-tagged.
- Gates before eval: held-out-persona coherence, counterfactual sensitivity, schema validity.
- Serve survivors on vLLM; run the synthetic dev set; write `summary.md`.

## Phase 4 — Iterate (1:30–6:00 a.m.) — Agents 4–5, Scenario owner
- Diagnose by layer before retraining: natural events attributed → signature/inject timing; escalates early → judge risk dimension or utility weights; commercial discloses instantly → utility weights; beliefs don't update → generation prompt; right belief/wrong action → authority in judge.
- Cheap fixes first: re-judge / re-filter (minutes) → regenerate one seat (~1 hr) → DPO patch on the best checkpoint (minutes, log it). Never regenerate everything.
- **Agent 5 ROUND 2:** best checkpoint plays every seat against the full pool (never twins); judge; continue-train from checkpoint; dev set again.
- **Stop rule:** first checkpoint meeting `targets.md` on the dev set is `candidate_final`. Sleep.

## Phase 5 — Final validation (6:00–8:00 a.m. Sun) — Agent 6, run once
- Three real replays + two controls: attribution-lag table, response match, false-positive rate, Dozor spread.
- Held-out 2025–26 action mix under each Red psyche, all four reported with margins, vs. a persistence baseline.
- Perturbation test in `env_v1_perturbed`.
- Prompted-only frontier baseline on the base scenario (the "one LLM collapses the distribution" control).
- Lamparth comparison if time.
- Numbers go on the slide as they are.

## Phase 6 — Demo, one-pager, submission (parallel from Sat evening; final 8:00–11:15 a.m. Sun)
- Demo: live-speed replay of a logged run → freeze at the knife inject, split-screen "same intel, two commanders" → persona-swap dropdown → thousand-run heatmap (storm severity × Red type → false-positive escalation rate) → validation table → robustness/exploitability chart. Pre-recorded fallback.
- One-pager PDF, README, name, ethics answer, judge-specific answers. Rehearse 3×.
- **Submission starts 11:15 a.m.** One owner.

## Human gates (agents don't pass these alone)
1. Env lock. 2. Cost check. 3. Sample review. 4. `candidate_final`. 5. Trigger Phase 5 exactly once.

## Critical path
contracts → env lock → generation → sweep → final validation. Everything else is parallel. If env lock slips past 9 p.m., cut attack types to jam + ground-cyber and seats to eight; never cut the storm layer or the replay harness.
