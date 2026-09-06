# Project Brief: Persona-Population Wargaming for Counterspace Crises

*Shared starting point for the team. Paste this into any assistant you're working with.*

## 1. Context

- **Event:** DNHacks 2026, Station DC, Sept 5–6. Hacking began Sat 10 a.m. **Submission deadline: Sunday 12:00 p.m.** Showcase 1 p.m., finalists/live demos 4 p.m.
- **Category:** Defense (presented by Second Front). Their stated interest includes *agent trust* — testing frameworks, adversarial red-teaming systems, and trust verification for autonomous agents. Our project is pitched as a red-team population for stress-testing plans and agents. Open Category (DTX Ventures) is the fallback.
- **Judging:** each category and two special awards (Best in Design, Best Use of AI) have separate judges; expect three judge groups at demos. Judges "heavily weight technical depth" even though AI-assisted building is allowed. Statecraft.ai is a sponsor — find their table.
- **Team max:** 5. Everyone gets $100 in OpenAI Codex credits.

## 2. One-sentence narrative

> A Chinese inspector satellite closes on a US missile-warning satellite. Doctrine doesn't say what to do. Space Force games this once a year with one Red team; we game it a thousand times overnight against a *population* of adversary personas and show which responses hold up.

Everything built should map back to this sentence.

## 3. Why this is worth doing (the argument)

1. **Traditional wargames are n=1.** DoD's central repository holds ~750 games total since 2015 (~75–100/yr department-wide). CNA runs ~20/yr; USMC's center 20/yr; Army War College 3–4/yr; big Title 10 games are once a year with 9–12 months of planning. The CSIS Taiwan study's 24 iterations was considered unusually rigorous. Replaying a scenario with different assumptions essentially never happens. An AFRL brief names "low number of runs limiting statistical analysis" and inability to see how outcomes change when Red plays differently as core problems.
2. **Prompted LLMs collapse the human distribution.** Rivera et al. (2024) found all five off-the-shelf LLMs escalate and none de-escalate. Real humans with identical information diverge (ExComm airstrike vs. blockade factions; USS *Stark* held fire and got hit, USS *Vincennes* fired and shot down an airliner, same theater, same year; Petrov and Arkhipov). Lamparth et al.'s wargame with 107 national-security experts showed wide human variance. A single LLM Red cell = one temperament.
3. **Space is the ideal domain for this.** No historical space war to calibrate against, no agreed thresholds, attribution lags of hours-to-days, reversible/deniable attacks (jamming, dazzling, RPO), debris commons dynamics, dual-use commercial entanglement. The value of many runs with diverse adversaries is highest exactly where humans have the least intuition. The action space is small and discrete, so the engine is easy to build.
4. **Scale is justified by replay, tail events, and adversary-strategy sweeps — not by claiming persona variance is huge.** Thousands of runs (20 personas × 50 scenario variants × seeds) is defensible. "Millions" is not; don't say it.

## 4. Scenario (build this one fully)

**The rendezvous-and-proximity operation (RPO).** A Chinese Shijian-class inspector satellite begins a slow maneuver toward a US missile-warning / SDA transport-layer satellite. Closest approach in ~36 simulated hours. Could be inspection, signals collection, a grappling test, or a capability demonstration.

**Intel checkpoints (turns):** initial detection → trajectory confirmed → 12 hours out → closest approach → aftermath. Each checkpoint delivers a report with a tunable confidence level (this is our simulated sensor-noise layer; we do *not* claim real sensor data).

**Action menu (short escalation ladder, ordinal):** hold · maneuver away · private demarche · public warning · dazzle/jam · cyber · counter-RPO · kinetic · terrestrial response. Each action has costs: propellant, signaling (fear vs. resolve), debris risk, domestic/alliance political cost.

**Seats:**
- Space Force Delta commander (can maneuver; cannot shoot)
- USSPACECOM commander (authorizes non-kinetic; must request kinetic)
- NSC space director
- PLA Aerospace Force commander
- Chinese MFA
- Commercial operator with assets near the trajectory (Starlink-analog)

**Parameters to sweep:** closest-approach distance, intel confidence, time-to-closest-approach, whether a Taiwan crisis is simultaneously running.

**Cheap second scenario (same seats, same engine, different opening):** "the disappearing satellite" — a GPS/SBIRS satellite goes silent during a crisis, cause unknown; tests acting under ~30% confidence and the ability to *withhold*.

Future-work scenarios: persistent constellation jamming; debris-creating ASAT test; commercial infrastructure as a wartime target.

## 5. What a persona is

One decision-maker in one seat — *who is making the call*, not a country and not a real named individual. It bundles:

- **Seat structure (mostly fixed per seat):** authority envelope (act unilaterally / needs release / recommend only), information set and latency, decision clock.
- **Individual temperament (varies):** utility weights over outcomes (status, own casualties/asset loss, economic cost, domestic political cost, reputation for resolve, alliance cohesion, *career incentive* as a separate term), risk posture, time horizon, private information, priors about other actors, lessons carried from prior crises, communication style.

Two to four temperaments per seat → 20–40 personas. Archetypes are grounded in real patterns (Vincennes/Stark, ExComm split), but the claim is **coverage of the plausible space, not prediction of individuals.**

In model terms, the persona is the system prompt; fine-tuning teaches the model to take the spec seriously instead of drifting to the default assistant temperament.

## 6. Technical architecture

**Design decisions (non-negotiable):**
- One persona-conditioned model, many specs. Not one LoRA per persona. Goal is generalization to unseen specs.
- Structured JSON action output against a fixed schema; scoring is deterministic.
- Fine-tune on who the persona *is*; keep beliefs about specific opponents in context (reset per game). Prevents overfitting to one opponent population.
- Open weights (Llama 3.1 8B or Qwen 2.5 7B) so it can run air-gapped — matters to Second Front.

**Training tiers (do in order, stop where time runs out):**
1. *Prompt-only baseline* (1 hr). Spec in system prompt, frontier model. This is the control condition; the demo shows it collapsing.
2. *Distillation SFT* (~6 hrs, the core). Generate ~200 games × 6 seats × 10 turns with a frontier model playing every seat from its spec. Each example: system = spec; user = state + intel + messages; assistant = short reasoning + JSON messages/action. Score each on realized utility (persona's own weights over outcome) and fidelity (LLM judge, 1–5 against spec). Keep top ~40%. Train via Fireworks hosted LoRA (SFT, DPO, continue-from-LoRA; one on-demand multi-LoRA deployment for serving); LoRA r=16–32, 2–3 epochs, lr 2e-4. Hold out personas never seen in training; build counterfactual pairs (same state, one spec field flipped) to prove the model reads specs, not role names.
3. *Rejection-sampling round 2* (overnight). Tier-2 model plays every seat, opponents sampled from the full persona pool (never twins). Score, filter, fine-tune from the tier-2 checkpoint. This is expert iteration — self-play's benefit without RL infrastructure.
4. *DPO* (only if tier 3 finishes early). Pair best/worst sampled responses per state, one epoch.

**Known failure mode to design around:** PillagerBench (2025) showed LLM self-play against copies of itself *reduced* performance against different opponents in the scenario where opponent strategy mattered (+3 → −5.2 point diff over 20 episodes). Crisis bargaining is that kind of game. Fix: league-style diverse opponent pool + exploitability as the stopping criterion.

**Evaluation (the headline chart):**
- *Exploitability:* freeze the population, let a frontier best-responder with full knowledge of the personas play against it, measure utility extracted. Plot per training round; it should fall.
- *Action distributions at key decision nodes*, per persona, base vs. fine-tuned.
- *Held-out persona coherence* and *counterfactual sensitivity.*
- *Calibration:* run the population on Lamparth et al.'s scenario and compare the action spread to the 107-human spread. This is the one human-variance dataset that exists.

## 7. Demo plan (~4 minutes, in this order)

1. **Orbit view with the clock running.** Earth + ground track, inspector arc closing on the US asset, countdown to closest approach, persona cards around the edge lighting up at each checkpoint, actions landing on the escalation ladder. Maneuvers move the orbits.
2. **Same intel, two commanders.** Freeze at 12-hours-out. Split screen: cautious vs. aggressive Delta commander, identical inputs, reasoning streaming side by side; one maneuvers and warns, one holds and dazzles; Red reacts differently to each. *This is the thesis in 15 seconds.*
3. **Persona swap on the fly** (dropdown on the PLA card; let a judge pick).
4. **The thousand-run heatmap.** Closest-approach distance × intel confidence, cell color = fraction of runs ending in an irreversible action. A dark band = where Blue's plan reliably fails. Exploitability line chart beside it.
5. **Population map** (personas as dots, base vs. fine-tuned; blob → cloud on toggle).
6. If stable: **judge plays USSPACECOM for two turns.**

Nice-to-have: scrubbable replay timeline; "Find the Petrov" (surface runs where a persona declined to act on high-confidence intel that turned out wrong). **Pre-record a full run as fallback.** Never cut items 1, 2, and 4.

## 8. Non-technical workstream

- **Scenario writing** (start first — engine can't be built until the action menu and checkpoints exist). Sources: Secure World Foundation *Global Counterspace Capabilities* (annual, open), CSIS Aerospace Security *Space Threat Assessment*, Space Force Doctrine Publication 1, public RPO incidents (Luch/Olymp shadowing Intelsat; Shijian-21 towing a dead satellite; USA 271 vs. Chinese sats). Keep a citation list.
- **Persona writing** — 20–40 specs, each a backstory paragraph plus structured fields. Quality over quantity; judges will read two.
- **Validation story** — no space war exists to calibrate against; nobody's personas are validated; we claim coverage for stress-testing, not prediction; here's the Lamparth calibration.
- **Ethics answer** (don't improvise): simulates adversaries for human planners, never recommends Blue actions, purpose is finding where automated agents break — which is the Defense track's agent-trust prompt.
- **Judge prep:** Second Front → air-gapped open weights, human can take the Blue seat. Navy/Space CTOs → say "reversible vs. irreversible" and "debris" unprompted. VCs → first customers are wargaming shops (CNA, RAND, Space Force wargaming center), then agent developers needing red-team populations.
- **Name, README (200 words), one-page PDF** with the narrative, the heatmap, two persona cards. Grants and cohort decisions get made after Sunday from this artifact.
- **Submission owner** starts at 11:15 Sunday, not 11:55.

## 9. Suggested team split

Engine · fine-tuning/data · demo UI · scenario + personas + pitch. Fifth person floats between engine and UI.

## 10. Reference material

- Rivera et al., "Escalation Risks from Language Models in Military and Diplomatic Decision-Making" (arXiv 2401.03408) — fork this framework rather than build an engine from scratch; 8 nation agents, 27-action menu, world-model adjudication, escalation score.
- Lamparth et al. / LLMWargaming repo (github.com/ancorso/LLMWargaming) — 107-expert US-China crisis game; our calibration set.
- WarAgent (arXiv 2311.17227); WargamesAI toolbox (github.com/user1342/WargamesAI); IQT Labs Snow Globe; danielrosehill/AI-Geopol-Projects (aggregator list).
- PillagerBench (arXiv 2509.06235) — self-play overfitting result.
- Diplomacy negotiation-tactics fine-tuning paper (arXiv 2512.18292) — fine-tuning steers LLMs toward human-like negotiation.
- Theory: Schelling *Strategy of Conflict* / *Arms and Influence*; Kahn *On Escalation*; Fearon "Rationalist Explanations for War" (1995) and "Signaling Foreign Policy Interests" (1997); Osborne & Rubinstein (Bayesian games); Shoham & Leyton-Brown (exploitability/regret); Perla *The Art of Wargaming*; Caffrey *On Wargaming* (limits of wargames as evidence).

## 11. Novelty claim (narrow and defensible)

Not the first to put LLMs in wargames (Rivera, Lamparth, WarAgent, Snow Globe). Not the first to fine-tune for strategic play (Cicero). First, as far as we can find, to **train a persona-conditioned population against game-theoretic consistency and exploitability, and pitch the population as a test harness** — in a domain (counterspace) where the field has no history and no thresholds. Lead with the eval, not the personas.

## 12. Open decisions

- Fine-tuning host: Fireworks hosted LoRA (SFT, DPO, continue-from-LoRA; one on-demand multi-LoRA deployment for serving).
- 3D globe (three.js) vs. 2D ground-track map for the orbit view.
- Whether the human-in-Blue-seat demo runs live or recorded.
- Project name.
