# Calibration

Five tables turn the open counterspace record into the numbers the engine and the
generator run on. Every row cites a URL and a page or section. Nothing here is a
round number someone liked the look of; where a number *is* a judgement, the row
says so in a `kind`, `basis` or `confidence` column, and this document says why.

Two rules held throughout. Tables 1–3 exclude every incident in `docs/quarantine.md`
and every 2025–26 event, because those are what Agent 6 validates against. And a
capability is not a use: the tables carry both, in separate columns, because a
fielded weapon that has never been fired is a real and common state of the world.

| file | rows | what it feeds |
|---|---|---|
| `red_action_rates.csv` | 30 | Red action priors, `targets.md` red_kinetic_rate |
| `attribution_lags.csv` | 5 | `engine/attacks.py` attribution draw |
| `attribution_incidents.csv` | 19 | the evidence the lags are fitted from |
| `storm_effects.csv` | 32 | `engine/storm.py`, the `env_lock` gate |
| `series/{kp,dst}_{may2024,feb2022}.csv` | 488 | the storm loader's real Kp/Dst curves |
| `holdout_2025_2026.csv` | 30 | `eval/holdout_mix.py`, Phase 6 only |

---

## 1. `red_action_rates.csv` — who does what, how often

**Feeds** the generator's Red action priors and the `red_kinetic_rate` ceiling in
`contracts/targets.md`.

A complete 6 actors × 5 categories grid for 2018–2024: Russia, China, Iran, North
Korea, India, non-state × EW, cyber, RPO, directed energy, kinetic. 51 counted
episodes, 2 of them destructive.

**What was counted.** One dated episode named in the cited source. A multi-month
campaign counts once. The spine is SWF 2024's structured tables — Table 2-3 Recent
Russian RPO (p. 02-14), Table 2-4 Nudol Flight Tests (p. 02-19), Table 3-1 Recent
Chinese RPO (p. 03-09), Table 3-2 Chinese DA-ASAT Tests (p. 03-15) — because a table
the authors built is a cleaner counting unit than sentences I select from prose.
CSIS 2023 and 2024 supply the EW and cyber episodes, which SWF treats thematically
rather than as dated lists.

**What was assumed.** That a report edition naming an event is evidence the event
happened, without independent verification. That episodes are the right unit: the
Russian EW row is 16 episodes, but one of them is a C4ADS study documenting nearly
10,000 individual incidents, so the rate is a floor by a wide margin.

**What was rejected.** Counting sentences across editions — later editions repeat
earlier events, which would have inflated Russia and China simply for being covered
longer. Estimating rates for actors the reports do not cover. Filling zeros with
plausible guesses.

**Zeros here are cited, not empty.** CSIS 2023 states few Chinese cyberattacks on
space systems were recorded in five years. CSIS 2024 calls March 2024 North Korea's
first GPS jamming in eight years — a base rate stated outright. Russia's directed
energy row is 0 uses against a fielded Peresvet and a Kalina under construction.

**Two rows are floors by construction.** Russian cyber (1 episode) and Russian RPO
(7) each omit one quarantined incident. The row notes say so.

**Consistency check.** Russian destructive kinetic runs at 0.143/yr, which over a
72-hour episode is 0.0012 — comfortably under the 0.01 `red_kinetic_rate` ceiling.

---

## 2. `attribution_lags.csv` and `attribution_incidents.csv` — how long until someone is named

**Feeds** `engine/attacks.py`, which draws a per-effect attribution lag from a
lognormal keyed on attack type.

No published dataset gives effect-to-attribution lags for counterspace events, so the
evidence table came first: 19 non-quarantined incidents from 2007–2024, each with an
effect date, an attribution date, the attributing party, a strength grade and a cited
page. One is right-censored.

**The conflict this surfaced, and the choice I made.** The open record measures
*public* attribution — the gap until a state names an actor. Fitted, those medians are
74 days for jamming and 747 days for ground cyber. An episode is 72 hours. Handing
those to the engine would attribute 3.4% of jamming and 0% of cyber attacks in play,
which removes the attribution dynamics the game exists to study and puts
`belief_lag_injects` and `response_match` out of reach.

So the file carries both regimes. The columns the engine reads — `median_hours`,
`sigma`, `floor_hours` — describe **first-indication** attribution: the point at which
a seat can tell an effect is hostile and name a likely source. The measured public
figures sit beside them in `public_attribution_median_hours`,
`public_attribution_median_days` and `public_p_attributed_within_72h`.

- `sigma` is **fitted** from the incidents (`sigma_basis = fitted_from_incidents`).
- `median_hours` is a **modelling choice** (`median_basis = derived_modeling_first_indication`).
  Its *ordering* is measured — kinetic, then rpo, then jam, then ground_cyber. Its
  *level* is mine: 1 h / 6 h / 18 h / 96 h / 240 h. **This wants a human at `env_lock`**
  and is written up as `calib/QUESTIONS.md` Q1.

| attack type | engine median | P(attributed ≤72 h) | public median | n |
|---|---|---|---|---|
| kinetic | 1 h | 0.99 | 1.5 d | 3 |
| rpo | 6 h | 0.90 | 28.4 d | 4 |
| jam | 18 h | 0.78 | 74.2 d | 5 (+1 censored) |
| dazzle | 96 h | 0.41 | — | 0 |
| ground_cyber | 240 h | 0.19 | 746.6 d | 6 |

**What the record actually shows, beyond the medians.**

*Dazzle has no publicly attributed satellite incident anywhere in 2018–2024.* That is
the finding, not a gap in searching: `never_attributed_fraction` is 1.0 and its sigma
is assumed rather than fitted.

*The RPO spread is not detection difficulty.* All four RPO incidents were trackable in
near real time. The 285-day case is political decision time — France knew within days
and chose to say so ten months later. What is slow is calling a maneuver hostile, not
seeing it.

*Cyber attribution is not merely slow, it is actively corrupted.* Not one of the six
cyber incidents is a formal same-state attribution: the fastest, at 72 days, is a
legislator's remark, and the rest are a commission report, a vendor report and agency
researchers. In the Turla case, US and UK officials state the group masqueraded as
Iranian hackers to mislead investigators. This is the evidentiary basis for the
`hacktivist_injects` rule actor in `contracts/env_config_schema.json`.

**Assumed.** Lognormal, because lags are positive and right-skewed and 19 points will
not distinguish it from a Weibull. Same-day attributions floored at half a day so the
log is defined — they are real observations, not missing data.

**Under-counted, knowingly.** Only one incident is marked censored, but incidents that
were never attributed mostly never enter these reports at all. The fitted medians are
optimistic. Two cyber effect dates are known only to the year, making those lags upper
bounds; `effect_date_precision` records this per row.

Regenerate with `python calib/fit_attribution_lags.py`.

---

## 3. `storm_effects.csv` and the Kp/Dst series — what a storm actually does

**Feeds** `engine/storm.py` and the `env_lock` gate via `engine/storm_check.py`.

Long format, 32 rows: one row is one fact, keyed on `(profile, metric, asset_class)`.
Profiles are `may2024`, `feb2022` and `gscale`. `kind` separates `observed` from
`derived_from_series` (my arithmetic on the cited series) and `derived_from_source`
(my reading of a cited statement), so the human at `env_lock` can see which is which.

**The finding that should shape `env_v1`.** May 2024 was G5 — Kp 9.0, Dst −406 nT, a
6× density enhancement at 400 km — and lost **zero** satellites. February 2022 was G1
— Kp 5.33, Dst never below −66 nT — and lost **38**, with safe mode entered correctly
and uselessly. Storm severity does not predict damage. The engine must not scale harm
off the G-scale alone; what mattered in 2022 was altitude, drag and a forecast gap,
not the index. `pre_event_forecast_gap` records that the operator launched into a
picture that did not contain the storm.

Recovery outstrips the storm by an order of magnitude: the May 2024 G1+ window is 48
hours, and one science satellite's data gap ran from 10 May to 21 June — 1008 hours.
A 72-hour episode can contain the whole storm and none of the recovery.

**Provenance, stated plainly.** Kp is the GFZ definitive series, which is what NOAA
SWPC's planetary-K product derives from; SWPC's own archive serves only 30 days, so it
cannot supply 2022 or 2024. Dst is Kyoto WDC provisional. The brief asked for NOAA
SWPC and this is the nearest faithful source; the NOAA G-scale thresholds and effects
text in the `gscale` rows are from SWPC directly. USGS reported −351 nT in real time
on 10 May; Kyoto's deeper −406 falls on 11 May, and the table uses Kyoto.

**Two derived numbers the gate should scrutinise.** `screening_suspension` (72 h) and
`tracking_degradation` (120 h) for May 2024 are `derived_from_source`: no public
notice records a formal suspension of conjunction screening, and the literature says
only that identifying conjunctions was "very difficult or impossible during the storm
and in the days that followed." Running `engine/storm_check.py --profile may2024`
prints the engine's own curve-derived figures (43 h and 34 h) beside these. **The gap
is real and unresolved** — roughly 3× on tracking, 2× on screening — and the gate is
where it should be settled. The check reports both rather than reconciling them.

One more thing the gate should not misread: `storm_check` draws ~40 safe-mode events
for May 2024 across the population, while the calibration row documents exactly **one**
(`safe_mode_events_documented = 1`, ICESat-2). The 40 is the engine's population model,
not a measurement. No public aggregate safe-mode count exists for that storm.

**Rejected.** Synthetic G4/Carrington profiles with invented effect numbers. The
`gscale` rows give NOAA's Kp thresholds and its own spacecraft-effects text so the
engine can interpolate severity from a cited scale; inventing a Carrington casualty
count would have been fiction with a citation stapled on.

---

## 4. `holdout_2025_2026.csv` — validation only

**Feeds** `eval/holdout_mix.py`, once, in Phase 6. Nothing else may read it.

Same 6 × 5 grid and the identical column list to `red_action_rates.csv`, so the two
compare directly. Window 2025-01-01 to 2026-12-31, deliberately disjoint: events dated
2024 inside CSIS 2025 are excluded so the windows never overlap. Sources are CSIS Space
Threat Assessment 2025 and SWF Global Counterspace Capabilities 2026, cited per row.
21 episodes, 0 destructive.

`chmod 444` stops an accidental edit. `scripts/check_holdout_isolation.sh`, wired into
pre-commit, stops the thing a file mode cannot — an accidental *read* — by failing any
commit in which source outside `eval/` names the file.

**What changed between the windows** (stated here because Eval will need it, and
because a population trained on the earlier window will be wrong in specific ways):

| actor × category | 2018–2024 | 2025–2026 |
|---|---|---|
| north_korea × ew | 0.143 /yr | **1.0 /yr** |
| russia × ew | 2.286 /yr | 3.5 /yr |
| russia × rpo | 1.0 /yr | 2.5 /yr |
| china × rpo | 1.286 /yr | 2.5 /yr |
| russia × kinetic | 1.0 /yr | 0 |
| china × kinetic | 0.571 /yr | 0 |

North Korea is the sharpest test: an actor the training window describes as acting
once in eight years is, in the holdout window, running a sustained campaign that drew
an ICAO condemnation. Kinetic testing stops entirely in both major actors while
proximity operations roughly double — the record moves toward reversible, deniable
action, which is the whole premise of the scenario.

**Both cyber rows are zero and marked censored, not absent.** With a public median of
747 days for ground cyber, intrusions occurring in 2025–26 would not yet be public.
Eval should not score a model as wrong for predicting cyber activity here.

---

## Known weaknesses

1. **Reporting bias is unmeasured.** These reports cover Russia and China in far more
   depth than Iran or North Korea, so the low rates for minor actors partly reflect
   attention, not behaviour. Nothing in the tables corrects for this.
2. **Episode counting is coarse.** One Russian EW row stands for ~10,000 incidents.
   Rates are lower bounds, unevenly so across categories.
3. **The attribution medians the engine uses are a modelling choice.** Measured
   ordering, chosen level. See `QUESTIONS.md` Q1.
4. **Two storm numbers disagree with the engine's own curve** by 2–3×. Unresolved by
   design; `env_lock` is the place to settle it.
5. **`n = 19` for attribution.** Four of five per-type fits rest on 3–6 points, and
   dazzle rests on none.
