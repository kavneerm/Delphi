# Review checklist

What the visual-critic passes actually caught, written down so the work does not have to be
re-derived — or re-paid for — every time.

Four critic passes across this build found **twenty-one** defects. Two were visible by
looking at the render. The other nineteen needed measurement. This file is the measurement.

Each item below states **the check**, **how to run it**, and **why the obvious version of
the check fails**. That last part is the expensive knowledge: most of these failed first as
a wrong measurement, not as a missed defect.

---

## 1. Anchors

**Check.** The horizon is at 58% of the stage and the vanishing point at 50%, in the *art*,
not merely in the DOM.

```
npm run check:invariant          # DOM anchors + locked-transform identity + pixel boundary
npm run probe -- horizon <png>   # same method, one shot
```

**Why the obvious version fails.** "Find the strongest edge in the image" is the wrong
question and gave a wrong answer three separate times:

- Sampling full width: structures occlude much of the horizon, so a full-width haze edge
  elsewhere outscored it.
- Sampling the VP corridor: the sun sits on the VP, and once it became a stack of hard
  stepped rows each of those rows was a strong edge.
- Scoring by luminance: mid III→IV at 390 the horizon crosses `#413545` → `#2c2b3d` — 39 in
  colour distance but 0.015 in luminance, below any sane threshold.

The question that works is **"is there a real boundary at 58%, and is it the strongest one
locally"**, scored by *how many columns show a colour step at that row* — the horizon spans
the frame, a roofline spans one building, the sun spans ~30% of the width.

**Never widen a tolerance to make this pass.** Three times the failure was the measurement
asking the wrong question, and each time widening would have hidden a real defect.

## 2. Occlusion — colour search proves presence, only a profile proves absence

**Check.** Every spec'd structure is actually visible. Nothing is 100% hidden.

```
npm run probe -- column <png> <x>      # what is painted where, in order
```

For absence, walk the **skyline profile**: the topmost structure-toned pixel per column
across a range. A spike means the structure clears what is in front of it; a flat run means
it does not.

**Why the obvious version fails.** Act I's water tower is the same `#3E2E2E` as the facade
hiding it, so a colour search finds plenty of "tower" pixels while the tower is entirely
invisible. Only the profile distinguishes them. The church spire had the same problem.

**Recurring failure mode in this build:** near-slot content painting over far-slot content.
Slot 1 paints in front of slots 2–5, so anything full-width there erases the scene behind
it. It has bitten three times — the Act I ground plane, the cast shadows, and Act II's slums
standing behind the wall that is supposed to be blocking the view of them.

## 3. Act II saturation — the argument depends on it

**Check.** Cyan and magenta appear only on the two monoliths, the blimp ad panels, and the
road's reflection of those two sources. Every saturated region must trace to a source
*above* it. Reflections must be visibly darker and lower in chroma than their source.

```
npm run probe -- chroma <png> --min-sat 0.5 --min-area 20
npm run probe -- chroma <png> --min-sat 0.35     # re-run lower to catch near-misses
```

Slum windows must measure sat ≈ 0.07. One warm window destroys the argument.

## 4. Act III distribution — count is the wrong measure

**Check.** Act III uses the *identical* hues (`#00E5FF`, `#FF2D95`), distributed rather than
concentrated.

**Why the obvious version fails.** Region *count* moved from 1,072 to 210 when the pixel
register landed — not because the art changed, but because adjacent windows merge on the
chunk grid. Count measures grid resolution, not distribution.

**Measure spatial spread instead:** what fraction of the frame's width carries any
saturation. Act II 9–10 of 20 columns; Act III 20 of 20. That is the claim §1 actually
makes, and it is unambiguous.

Peak density is *not* discriminating — 26% vs 25% in the densest column — and should never
be quoted as evidence.

Also note the grain layer costs ±4 per channel, so exact-hex matching badly under-reports.
Sample with a tolerance.

## 5. Copy contrast — measure the right two things

**Check.** Body copy clears 4.5:1 against what is actually behind it.

```
npm run shots -- --backdrop      # bd-* shots, copy layer hidden
npm run probe -- contrast bd-<vp>_<p>.png <x> <y> <w> <h> --scrim '#1A1D24' --alpha 0.78
```

**Two ways this measurement lies:**

1. Point it at a normal shot and it finds the *glyphs* — `#F5F0E8` over `#F5F0E8`, 1.00:1,
   meaningless.
2. Point it at a `bd-` shot without `--scrim` and it measures the bare scene, because the
   backdrop pass hides the scrim along with the text.

**Mid-reveal ratios are meaningless by design.** A block and its scrim are both at partial
opacity during a reveal, so no pixel reaches `#F5F0E8`. Two independent passes filed this as
a scrim defect before the cause was pinned. Reveal windows are now placed so no §6
checkpoint falls inside one; §9 scopes its floor to fully-revealed copy.

Per-act scrim values live in `src/copy.ts` (`SCRIM_ALPHA`, `SCRIM_TONE`).

## 6. The pixel-art register

**Check.** No smooth curve, no anti-aliased edge, no sub-chunk detail, no gradient inside an
object. The only smooth gradient is the slot 7 sky.

Things that have violated it, each found by measurement:

| Violation | How it hid |
| --- | --- |
| `poly()` snapped vertices only | the rasteriser joined them with a smooth 1-device-pixel staircase |
| `outlined()` wrote `stroke-width="1.5"` verbatim | half-pixel overhang produced an anti-aliased seam on every building edge |
| Bézier birds | hard-edged under `crispEdges`, but curve-derived and sub-chunk |
| Fractional plate transforms | resampling gave every aberrated edge a 1px blend column |
| `blockCircle` snapping each row's y independently | 1px gaps; trees read as venetian blinds |

**The dangerous inverse:** a snapping helper that *discards* detail below its resolution
silently deletes whole features. `blockCircle` culled rows narrower than half a chunk, and
Act III's music motes — which have their own subsection in §6 — rendered as **zero pixels**
at every viewport. §3 says a length rounds *up* to one chunk; make sure helpers obey that
rather than culling. This class of bug is worst at the smallest viewport, where nothing else
is looking.

## 7. Transitions

**Check.** Structures rise and sink at the horizon. Nothing cross-dissolves.

Compare consecutive checkpoints: a structure's fill should stay at its *exact* hex while its
extent moves. An exact fill proves opacity 1, so any disappearance is travel, not a fade.

Scoping (§9, amended): slots 5–2 are structures and never use opacity as their verb. Sky
(7), haze (6) and ground fills (1) crossfade — they cannot rise at a horizon they *are*.
VP-locked geometry also crossfades, because it can never be transformed.

**Two travel bugs found here:**
- travel shorter than the art's extent above its clip line leaks the incoming act above the
  horizon
- `drift` with a fractional offset only clears the frame for art authored beyond that
  fraction of the width

## 8. Engine invariants

```
npm run check:parallax           # 2081 assertions
```

Asserts no vertical drift on any slot ever, drift ratios matching the §3 rate table within
1%, travel identity during holds, and identity transforms on every `[data-vp-locked]` layer.

**Timing trap:** slot 0 runs at 12fps and is skipped on non-tick frames, so a measurement
taken too early reads a stale transform. `gotoP` waits two full periods. A newly built layer
is now written on the frame it appears, which was a real pop-in bug as well as a flaky test.

## 9. Performance

```
?perf=1                          # exposes window.__writePass
```

**Do not measure frame times via rAF deltas in headless Chromium.** They are dominated by
CDP round-trips and rAF throttling, and `goto()` teleports force layer rebuilds that never
happen in real scrolling. That method reported p50 273ms and 76% of frames over budget —
entirely artifact. Measuring the write pass instead gives 0.10ms p50.

LCP needs a real candidate: a zero-opacity block is not one, and neither is inline SVG. The
page had **no LCP candidate at all** until the h1 was made present at first paint.

---

## Process

**Freeze the tree before launching a critic.** No source edits and no `npm run shots`
between launch and report. One pass was wasted reviewing artifacts 31 minutes older than the
code, hit a briefly-broken build, and had `shots/` deleted underneath it twice —
`scripts/shoot.ts` `rmSync`s the directory, so two concurrent runs race.

**Give the critic engine context, not just shots.** Three of the eleven Act I findings were
engine bugs that a shots-only review would have filed as art problems.

**The critic never grades its own build.** Fresh context every pass.
