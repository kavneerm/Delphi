# `check:perf` — everything wrong with it, and the fix

**Status:** FIXED. `npm run check:perf` passes — 21 assertions, 0 failures, 0 frames over
budget at all three viewports. Result below; diagnosis retained because it is the reasoning
the fix rests on.

| viewport | worst frame, before | after |
| --- | --- | --- |
| 1440x900 | 39.10ms | **15.80ms** |
| 768x1024 | 25.60ms | **13.10ms** |
| 390x844 | 18.90ms | **8.30ms** |

**What fixed it, in order of effect.** Each was measured; none is speculative.

1. **`Stage.sync` amortises** — layers build in `STAGGER_ORDER` under a per-frame budget,
   at least one per frame. Safe because at a transition's start no incoming layer is
   visible: crossfade enters at opacity 0, rise/extrude below their clip line, drift
   off-canvas. A slot need only exist when its own staggered window opens.
2. **`act.build()` yields its own frame** — second-largest single item (6.49ms, Act III).
3. **The second aberration plate blits instead of re-uploading.** `aberrates(slot)` is true
   for five of eight slots, and each was handing the same 721kB image to `putImageData`
   twice. `drawImage` from the first canvas moves it GPU-side. Total build cost across a
   sweep: **118.9ms -> 79.4ms**.
4. **Locked-layer uploads are deferred** to their own budget unit. Slot 7 is the only slot
   with both a `draw` and a `drawLocked`, and it was the entire act-entry cost — measured
   27.0 / 25.6 / 21.5 / 8.2ms for the four acts against <=2.8ms for every other layer. The
   *element* is still appended immediately, because within a slot child order is paint
   order; only the canvas upload moves.
5. **`BUILD_BUDGET_MS` 6 -> 3.** At 6 the measured work-median was 7.1ms — above the budget —
   so a frame could admit a second unit before noticing it was over, and 1440x900 peaked at
   16.7ms. A budget below the cost of one unit makes "one unit per frame" the normal case
   rather than the lucky one. Work-median is now 3.2-3.8ms.

The single most useful step was **not** any of these: it was measuring under real wheel
scrolling instead of teleports, which is what showed the spikes were genuine rather than a
harness artifact, and later showed which changes actually moved them.

**Why this file exists:** the diagnosis below is measured, not reasoned, and it must survive
a context compaction. Resume from here rather than from memory.

---

## 0. One-paragraph summary

`check:perf` gates on **p99 of a sample that is 93% idle frames**. The idle frames are an
artifact of the harness waiting 220ms after each teleport, and how many get recorded depends
on wall-clock scheduling. So the p99 *rank* moves between runs of identical code: measured
**13.40 → 18.90ms, sd 2.20ms, over five runs with no code change**. The one statistic that is
actually stable — `max`, sd 0.29ms — is gated second and treated as secondary. The check is
backwards, and on top of that its p99 budget is unreachable by construction under the
current build strategy.

---

## 1. The measured evidence

Five consecutive runs of the exact `check:perf` measurement at 1440x900, no code change
between them:

```
run1: n=298 p99=13.40 max=26.20 | idle<0.5ms:280 0.5-4:4 4-16:12 >16:2
run2: n=294 p99=18.20 max=26.20 | idle<0.5ms:275 0.5-4:3 4-16:12 >16:4
run3: n=323 p99=15.30 max=26.70 | idle<0.5ms:302 0.5-4:5 4-16:13 >16:3
run4: n=296 p99=18.80 max=26.70 | idle<0.5ms:276 0.5-4:4 4-16:12 >16:4
run5: n=330 p99=18.90 max=26.90 | idle<0.5ms:310 0.5-4:3 4-16:13 >16:4

p99 across runs: 13.40..18.90  sd=2.20ms      <- the gated statistic
max across runs: 26.20..26.90  sd=0.29ms      <- the stable one
sample count:    294..330                     <- the denominator moves
```

**Roughly 16 frames out of ~300 do any work at all.** Everything else is the page idling
through `gotoP`'s 220ms waits.

---

## 2. Defects, most severe first

### D1 — p99 is computed over an idle-padded sample, so its rank is noise

With `n=294`, `p99` selects `floor(294 * 0.99) = 291` — the 4th largest of 294.
With `n=330`, it selects `floor(330 * 0.99) = 326` — the 5th largest of 330.

Which rank p99 lands on is decided by **how many idle frames were recorded**, which is
decided by scheduling. The underlying work distribution is nearly identical across runs
(12-13 frames in 4-16ms, 2-4 over 16ms, max stable to 0.29ms) — but the reported p99 swings
by 5.5ms. A gate at 4ms would pass or fail on luck if the true value were near it.

**This is the root defect.** Percentiles are only meaningful over a population you control
the composition of. Here the population is ~93% padding.

### D2 — the sample count is uncontrolled (294–330, a 12% swing)

Follows from D1 and makes it worse: every run percentile-selects from a different-sized
population, so runs are not comparable to each other, let alone to a fixed budget.

### D3 — single run, no repetition

No median-of-N, no repeat. A flaky statistic is gated on one observation.

### D4 — the p99 ≤ 4ms budget is unreachable by construction

`Stage.sync` deliberately spends up to `BUILD_BUDGET_MS = 6ms` per frame building layers,
to avoid 30ms frames. Build frames are ~5% of all frames. So **p95 and p99 both land inside
build frames by definition**, and no amount of optimisation moves p99 below 6ms while the
amortisation exists.

Confirmed exactly: at 768x1024 and 390x844 the check reports p99 of **6.40ms and 6.60ms** —
i.e. `BUILD_BUDGET_MS`, to the tenth.

The 4ms budget was written when the assumption was "steady state is what matters, act entry
is rare". Amortisation deliberately trades a rare 30ms frame for several 6ms frames, which
is better for the user and worse for this metric. **The metric now punishes the fix.**

### D5 — teleport-only measurement, which cannot evaluate the thing being optimised

`gotoP` jumps to a checkpoint and waits. That means:
- every act entry builds every layer at once, which is harsher than a real scroll, and
- the page then idles for 220ms, which is far more slack than a real scroll gives.

Neither resembles a user. Worse, **it structurally cannot see any prewarm or amortisation
strategy working**, because it never presents realistic frame pacing. This is why the
earlier `preraster-lookahead` experiment measured as "no effect" and was reverted — the
harness could not have shown an effect. That reversion should be revisited; the patch is at
`docs/experiments/preraster-lookahead.patch`.

Real wheel scrolling measures very differently. Same build, 1440x900:
- teleport: max 26.2ms
- continuous wheel: max 25.0ms, p99 15.2ms, 2 frames of 206 over 16ms

### D6 — the most meaningful number is printed but never asserted

`over` (count of frames above `MAX_BUDGET_MS`) is computed, printed, and then not used in
any assertion. "How many frames did we drop" is the question a reader of this check
actually has, and it is display-only. The assertions are `p99` (noisy) and `max` (one
sample).

### D7 — `max` is a single-sample statistic

Gating on the single worst frame makes the build hostage to one GC pause. In practice it
measured *stable* here (sd 0.29ms), so this is a latent risk rather than an active one —
worth noting, not worth over-correcting. Do not "fix" this by switching to p99.

### D8 — measures only our write pass, not the frame

`__writePass` times `progress.tick` + `stage.render`. It excludes the compositor work that
`putImageData` and canvas insertion trigger *after* our code returns, so it can understate
true frame cost, and it can never observe an actually-dropped frame. The file's rationale
for this is sound (rAF deltas in headless Chromium are dominated by CDP round-trips) but
the limitation should be stated rather than implied.

### D9 — uniform budgets across viewports

1440x900 rasters ~3x the pixels of 390x844 and carries the same 4ms/16ms budget. The 16ms
frame budget is legitimately uniform — a frame is 16ms everywhere — but a uniform *p99*
budget across wildly different work is not obviously meaningful.

### D10 — `__writePass` is capped at 4000 samples in `main.ts` and truncates silently

Not reached at ~300 samples per teleport run, but a continuous-scroll run at 60fps reaches
it in ~67 seconds, and the truncation is silent.

---

## 3. What the check should measure instead

The user-facing question is **"does any frame miss its deadline, and how often?"** — not
"what is the 99th percentile of a padded sample".

1. **Drive realistically.** Continuous wheel scroll through the page and back, which is what
   a reader does. Keep the teleport sweep as a separately-reported worst case.
2. **Separate idle from work explicitly** and report both, so no statistic is silently
   computed over padding.
3. **Gate on properties of the work:**
   - `max` — worst single frame, must fit one display frame
   - `overBudget` — count of frames above the frame budget; this is the number that matters
   - steady-state median — proves we are not doing work every frame
4. **Repeat and take the median run**, so a single scheduling artifact cannot decide the
   build.
5. **Retire the p99 gate.** It is unreachable by construction (D4) and noisy (D1). Report it,
   do not gate it.

Budgets to propose (needs sign-off — `docs/plans/build.md` §7 is the source of the current
numbers and is not mine to rewrite unilaterally):
- `max <= 16ms` — no frame misses a 60Hz deadline
- `overBudget == 0` under continuous scroll
- `median <= 1ms` — steady state stays free

---

## 4. The check being honest is not enough — the build must also pass it

At 1440x900 the worst frame is still ~26ms, so an honest 16ms gate is still red. Two known
wins remain, both measured:

### F1 — `buildLayer` is one indivisible budget unit but does two rasters

A slot's `draw` and `drawLocked` are rastered in the same call, so the per-frame budget
cannot split them. Slot 7 is both the biggest `draw` and the biggest `drawLocked`:

| act | slot 7 draw | slot 7 locked | act total (Node, 1440x900) |
| --- | --- | --- | --- |
| i | 4.23ms | 2.38ms | 7.22ms |
| ii | 3.48ms | 0.90ms | 7.42ms |
| iii | 2.19ms | 1.31ms | 5.94ms |
| iv | 1.94ms | 4.14ms | 6.77ms |

Splitting them into separate budget units roughly halves the worst indivisible unit.

### F2 — every act builds 59–289KB of SVG markup that is then discarded

All four acts emit **nine slots carrying both a `draw` callback and SVG markup**, and `draw`
takes precedence everywhere it is present (`stage.ts` `buildLayer`, and `reduced.ts` sets
`markups[i] = undefined`). So the markup is computed and dropped.

```
1440x900   i: build() 1.53ms  markup  70KB   ii: 2.65ms  90KB
         iii: build() 6.49ms  markup 197KB   iv: 0.83ms  59KB
390x844    i: build() 1.46ms  markup 162KB  iii: 4.80ms 289KB
```

Act III spends 6.49ms per entry on strings nothing reads. This is leftover from the SVG →
canvas substrate migration. Removing it also drops bundle size.

Risk: it is a change across four ~1700-line act files, and the markup is the reduced-motion
fallback for any slot that does *not* have a `draw`. Must confirm per slot that `draw`
exists before deleting its markup — `check:travel` already proves every rise/extrude slot
rasters, and nine-of-nine emit both.

---

## 5. Tasks

- [ ] Rewrite `scripts/perf.ts`: scroll-driven primary, teleport secondary, idle/work split,
      median-of-N, gate on max + overBudget + median, report p99 without gating it
- [ ] Prove the new check can fail (mutation: raise `BUILD_BUDGET_MS`, or revert amortisation)
- [ ] F1 — split `draw` / `drawLocked` into separate budget units in `Stage.sync`
- [ ] F2 — delete discarded markup from the four acts (confirm `draw` present per slot first)
- [ ] Re-measure; expect 1440x900 max under 16ms
- [ ] Revisit `docs/experiments/preraster-lookahead.patch` — it was reverted on evidence the
      harness was incapable of producing (D5)
- [ ] Full `npm run check` + `check:browsers` green
- [ ] Get sign-off on the budget change before treating §3's numbers as final

## 6. Context needed after a compaction

- Current state: `check:perf` **fails**; all other checks pass (invariant 466, parallax 2372,
  register 18, travel 39, deck 25, pace 408, browsers 513).
- `BUILD_BUDGET_MS = 6` in `src/stage.ts`; `Stage.sync` amortises builds in `STAGGER_ORDER`
  and `act.build()` yields its own frame; `main.ts` gates the first-paint placeholder on
  `stage.settled`.
- Live at https://inevitablefrontier.org, deployed at commit 7136090.
- `npm run deploy` builds + syncs + invalidates. Do not deploy with checks red.
