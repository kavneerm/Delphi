# env_lock — storm numbers against the record

The `env_lock` gate in `docs/COORDINATION.md` §9: *"storm check numbers vs.
`calib/storm_effects.csv`; then bump `env_v1`."* This is that comparison, run
against the calibration merged to `main` in `9f1413b`.

**Status: not frozen. Two mismatches need a decision that is not mine to make.**

Reproduce with:

```bash
python -m engine.storm_check --profile may2024 --seeds 20
python -m engine.storm_check --profile feb2022 --seeds 20
```

Both profiles now load with **no `TODO_CALIB` left**: every field the engine uses
comes from a cited row or from `calib/series/`, and `storm_check` prints the URL
per field.

---

## May 2024 (G5)

| what | engine | calibration | cited | verdict |
|---|---|---|---|---|
| peak Kp | **9.00** at +12 h | **9.000** | GFZ definitive | ✅ exact |
| NOAA G-scale | **G5** | **G5** | NOAA scales | ✅ exact |
| minimum Dst | **−395 nT** | **−406 nT** | Kyoto provisional | ⚠️ 11 nT shallow — artifact, see A |
| tracking degradation | **43.0 h** | **120 h** | arXiv 2406.08617 | ⚠️ see B |
| screening suspension | **34.0 h** | **72 h** | arXiv 2406.08617 | ⚠️ see B |
| satellites lost | **0** | **0** | arXiv 2406.08617 | ✅ |
| safe modes (72 h, 20 seeds) | median **40**, range 29–48 | 1 documented (ICESat-2, 6-week window) | NSIDC | ➖ not comparable, see C |

## February 2022 (G1)

| what | engine | calibration | cited | verdict |
|---|---|---|---|---|
| peak Kp | **5.33** at +9 h | **5.333** | GFZ definitive | ✅ exact |
| NOAA G-scale | **G1** | **G1** | NOAA scales | ✅ exact |
| minimum Dst | **−60 nT** | **−66 nT** | Kyoto provisional | ⚠️ 6 nT shallow — same artifact as A |
| tracking degradation | **0.0 h** | **36 h** | GFZ | ❌ **see D — the real finding** |
| screening suspension | **0.0 h** | **0 h** | SWSC | ✅ |
| satellites lost | **0** | **38** | SWSC 2022 | ❌ **see D** |
| safe modes (72 h, 20 seeds) | median **0**, range 0–1 | 49 documented | SpaceX updates | ❌ **see D** |

---

## A. Dst minimum is 2–9 % shallow — a resampling artifact

Kp is published 3-hourly and Dst hourly. `engine/storm.py` merges them onto the
**Kp** timestamps and takes the nearest Dst, so an hourly extremum falling
between two Kp stamps is lost. Both events' true minima sit inside the 72-hour
window, so this is purely resampling, not windowing:

| profile | engine (3 h-sampled) | true hourly min in the same window | cited |
|---|---|---|---|
| may2024 | −395 nT | **−406 nT** | −406 nT |
| feb2022 | −60 nT | **−66 nT** | −66 nT |

**Fix**, if you want it: take the interval *extremum* rather than the nearest
sample when merging. Roughly ten lines in `_read_series`. It makes both profiles
match their cited minima exactly.

**Impact if left alone: cosmetic.** Nothing in the engine keys off Dst — it is
carried on the `storm_update` line for the UI and for the SWPC bulletin text.
Every multiplier, hazard and window is computed from Kp.

## B. May 2024 degradation windows are shorter than the record

The engine opens tracking degradation at Kp ≥ 6 and closes it below 5.5, which
inside the 72-hour window gives 43 h against 45 h of Kp ≥ 6 — internally
consistent. The record says 120 h.

Two separate things are going on, and only the second is a defect:

1. **Window length.** The cited 120 h runs 2024-05-10 15:00 → 05-15 15:00. A
   72-hour episode cannot contain 120 hours. This part of the gap is a scale
   difference, not an error.
2. **Persistence.** The record's degradation *outlasts the Kp excursion* —
   catalogue re-acquisition and thermospheric recovery keep tracking degraded
   after the storm subsides. The engine closes the window when Kp falls. So even
   normalising for window length, the engine recovers too fast.

## C. Safe-mode counts are not comparable as stated

The engine's median of 40 is drawn across its own ~350-unit Arctic fleet over 72
hours. The May 2024 calibration row documents **1** safe mode, for one science
spacecraft, over a six-week window — it is a case study, not a fleet rate.
Nothing here says the engine is wrong; it says these two numbers do not answer
the same question. The Feb 2022 row (49 safe modes in a LEO constellation) is
the one with fleet-scale meaning, and see D.

## D. February 2022 is where the engine actually fails

This is the finding I would not want you to miss.

Feb 2022 is the canonical "a geomagnetic storm destroyed a constellation" event:
**38 satellites lost, 49 safe modes, 36 h of tracking degradation.** The engine,
given that profile, produces **zero** degradation hours, **zero** losses, and a
median of **zero** safe modes. A G1 that killed 38 spacecraft currently reads as
a quiet day.

The cause is that the engine models storm damage as a function of **Kp alone**.
Peak Kp was 5.33, below the engine's Kp ≥ 6 tracking threshold and far down its
safe-mode hazard curve, which is quadratic above Kp 4. But the Feb 2022 losses
were not driven by Kp magnitude — they were driven by **thermospheric density
during a low-altitude deployment**, and the calibration table already carries
exactly those rows, which the engine does not read:

| row the engine ignores | value |
|---|---|
| `density_enhancement_factor` (leo_200_400km) | **2.25×** |
| `drag_increase_operator_reported` (leo_constellation) | **1.50×** |
| may2024 `density_enhancement_factor` (leo_400km) | 6.0× |
| may2024 `decay_rate_increase_factor` | 4.7× |

**This matters beyond storm realism.** The whole scenario turns on a seat being
unable to tell a storm from an attack. If the engine's storm cannot produce
serious damage at moderate Kp, then damage at moderate Kp is *evidence of
attack* — and the discrimination the exercise is built on gets easier than
reality warrants, in the direction that flatters the model.

---

## What I recommend, and what I need you to decide

Three options. I recommend **2**.

**1. Freeze `env_v1` as it stands.** Defensible for a Sunday deadline: peak Kp
and G-scale match exactly, both profiles are fully cited, replay is exact, and
Gen can start immediately. Accepts that the storm under-damages at moderate Kp
and that Feb 2022 does not reproduce.

**2. Make the three changes below, then freeze.** My estimate is roughly an hour
of engine work plus a re-run, and it closes every mismatch in the tables above:

- **A** — merge Dst on interval extrema. ~10 lines. Cosmetic but free.
- **B** — hold a degradation window open for the cited
  `tracking_degradation` / `screening_suspension` duration when the calibration
  asserts one, instead of closing on Kp hysteresis. Clipped to the episode.
- **D** — add a drag/density term to the safe-mode hazard, read from the
  `density_enhancement_factor` and `drag_increase_operator_reported` rows, so a
  low-Kp high-density event can still hurt a low-altitude constellation. This is
  the one that matters.

**3. Freeze `env_v1` now and do the above as `env_v2`.** Unblocks Gen today and
keeps a clean version boundary, at the cost of a lake generated under a storm
model we already know is wrong in a way that biases the central task.

**Why I am not choosing.** All three touch the parameters `env_version` exists to
freeze, and everything Gen, Train and Eval produce is stamped with it. Changing
the storm after generation starts invalidates the lake. That is a gate decision,
so it stays with you.

**What is not blocked either way.** `calib/attribution_lags.csv` does not exist
yet, so the four attack attribution lags are still placeholders chosen for their
ordering (jam < dazzle < rpo < ground_cyber), which the public record supports;
the magnitudes are not evidence. They are independent of the storm layer and of
this decision.
