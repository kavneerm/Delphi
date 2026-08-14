# Plan — fine pixel-art substrate

**Status:** awaiting approval. Nothing in `src/` has been touched.
**Supersedes:** `docs/plans/build.md` §D2 R1/R2 ordering (see §8).

---

## 1. Context

The build is structurally complete: four acts, eight permanent depth slots, the
horizon/VP invariant holding at 491 assertions, 2081 parallax assertions, a shot harness
and a pixel prober. What it is not is *good-looking*. The client supplied seven reference
illustrations in `Object Reference/` and asked for that level of finish.

The original request was to fan out subagents, one per object, each screenshotting its own
work until it matched a reference. That is rejected, for reasons that are now measured
rather than asserted — see §2. The gap is not object fidelity. It is **resolution, palette
depth, and composition density**, all of which are global properties that per-object
authorship actively destroys.

The intended outcome: Acts I–IV rendered at reference fidelity ("Best Sample" tier —
dense street, dithered skies, facade detail), on a substrate that can express it, with the
match to the references verified by measurement rather than by an agent looking at a PNG.

---

## 2. Measured baseline

`Object Reference/*` converted to PNG and measured against `shots/1440x900_*.png` on
identical terms. Run length = horizontal run of flat colour (Manhattan tolerance 14);
`pal99` = distinct colours at 4 bits/channel covering 99% of the frame.

| Frame | w | p25 run | as % of width | pal99 | value bands used |
| --- | --- | --- | --- | --- | --- |
| ref Act1 Best | 399 | 2 | **0.50%** | 188 | 2 |
| ref Act1 Third Best | 626 | 2 | **0.32%** | 442 | 5 |
| ref Act2 Good sample | 596 | 2 | **0.34%** | 481 | 2 |
| ref Act2 Best | 384 | 14 | 3.65% | 176 | 4 |
| **ours p=0.00 (Act I)** | 1440 | 26 | **1.81%** | 66 | 4 |
| **ours p=0.32 (Act II)** | 1440 | 27 | **1.88%** | 43 | 3 |
| **ours p=0.60 (Act III)** | 1440 | 14 | 0.97% | 116 | 5 |
| **ours p=0.90 (Act IV)** | 1440 | 41 | **2.85%** | 75 | 4 |

Three conclusions, each of which is a work item:

1. **Detail is 4–6× too coarse.** Chunk is `w/200` ≈ 7px; the references resolve detail at
   ~0.3–0.5% of frame width.
2. **The palette is 2.5–6× too shallow.** Even the most restrained reference — a silhouette
   piece — carries 176 colours across 99% of the frame. Act II carries 43.
3. **Act II's value structure is collapsed.** 85% of its frame sits in the darkest band
   against the reference's 59%/27% dark-to-bright split. The reference's large bright sky
   is doing most of the readability work. This is invisible by inspection and was found
   only by measuring.

Supporting counts, from exploration:

- Each act emits **~500–1,400 SVG elements**. A 480×300 buffer is **144,000 pixels**. The
  frame is being painted with roughly a thousand marks; that is why it reads as empty.
- ~85–90% of each act file is **composition** (palettes, depth tables, `facade()`, seeded
  LCGs, slot assembly). Rasterisation is **~40–70 lines per act** plus five emitters in
  `src/acts/shared.ts`. **The substrate swap does not touch composition.**

---

## 3. Why not per-object subagents

- **The levers are global.** Sky treatment, palette depth, value separation and density are
  frame-wide properties. A perfectly-drawn wagon changes none of the numbers in §2.
- **Parallel authorship destroys coherence.** Eight authors pick eight chunk sizes, tone
  counts and light directions. The thesis of this build is *one world seen four times*.
  No test catches incoherence; it is unrecoverable after the fact.
- **Self-screenshotting is the weakest available loop.** Four critic passes found 21
  defects; **19 were invisible to inspection** (`docs/review-checklist.md`). CLAUDE.md
  already forbids the author grading its own work.

Parallelism is still used — but on units where coherence is *structurally enforced*
rather than hoped for. See §6: sprites drawn from a shared indexed palette cannot go
off-model, and conformance is checked by a script.

---

## 4. Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | **Fixed-resolution palette-indexed canvas** per slot; upscale with `image-rendering: pixelated` | Detail becomes free — 144k pixels whether plain or ornate. Deletes the 1px-seam / sub-chunk-culling / fractional-transform bug class, which exists *because* we snap vectors. |
| D2 | Buffer holds **palette indices** (`Uint8Array`), not RGBA | **Rationale corrected — see §10.** Not "off-palette becomes impossible": crossfades composite two acts at partial opacity (`src/stage.ts:148,153`), grain overlays, halftone multiplies, and the acts use `fill-opacity` 20+ times, so off-palette pixels are guaranteed at the composite. The real reason is that indexing makes palette validation **possible at all** — you cannot recover a palette from a screenshot once grain and crossfades have touched it. Validate at the buffer, never at the shot. Secondary: it enforces coherence *within* a layer, which is where multi-author drift actually happens, and makes dither/hue-ramps index arithmetic. |
| D3 | **Integer scale S=3** at all three test viewports (1440→480, 768→256, 390→130) | Non-integer upscale resamples and softens; softness is the one thing pixel art cannot survive. |
| D4 | Buffer covers stage **+ bleed**; overflow absorbed by the bleed | `.layer` is already `inset: calc(-1 * var(--bleed))`; no new machinery. Bleed grows from a flat 64 to 65–66 per axis — see D10, which uses that slack to land both anchors on exact art cells. |
| D5 | **Aberration keeps the two-plate DOM structure.** Both plates `drawImage` the *same cached source bitmap*; only the offset differs, quantised to multiples of S | **Reversed from the first draft — see §10.** Moving the channel split into the buffer forces a full re-raster every frame, because the offset is velocity-driven (`src/progress.ts:52-55`) and `art-direction.md` §3 explicitly forbids tweening filter values per frame. Plates stay compositor-only and free. |
| D6 | **Halftone becomes real ordered dithering** between palette ramp steps, in the art — but **never across the horizon row** | A multiply overlay over true pixel art reads as a screen-door artifact. Dithering *is* how pixel art shades. The horizon exclusion protects `edgeCoverage` (`scripts/pixels.ts:205`), which needs ≥55% of VP-corridor columns to show a clean step at that row. |
| D7 | **Grain stays at stage level**, retiled to the art grid (S×S blocks) | **Corrected from the first draft.** Grain must *not* live in the layer buffers — it would parallax with the layer. It is an artifact of the final printed sheet. But `#stage::after` is currently 1 device px, which at S=3 is sub-art-pixel and visibly breaks the register. |
| D8 | **`build()` cached per act**, not called per slot | `src/stage.ts:234` runs `build()` 8× per act and discards 7/8. Harmless with strings; unaffordable when each call rasterises. |
| D9 | **Hybrid art sources.** Procedural for geometry-driven content (sky, clouds, ground, road, building masses in perspective, skylines, water). Hand-authored sprites for repeated props (figures, wagons, lamps, poles, cacti, birds, awnings). | Matches how the references are actually constructed, and is what makes them read as dense. |
| D11 | **Transforms round to whole *device* pixels** (`1/dpr` CSS px), not to art pixels | An integer-device-px translate shifts the rastered texture without resampling — a 3×3 block stays a 3×3 block. Snapping to S would be destructive: slot 7's *total page sweep* is `0.1 × 30 = 3px` at 1440 and **0.81px at 390**, so snapping to 3 deletes its parallax entirely. Every per-frame write is fractional today (`src/stage.ts:102,128,163,172` — `toFixed(2)`/`toFixed(3)`). |
| D12 | **Canvas CSS size is set explicitly to `artW*S` px**, overflowing `.layer` | Reusing `.layer svg { width:100% }` (`src/styles.css:102-108`) gives a non-integer scale. `image-rendering: pixelated` still hard-edges it, so art pixels come out unevenly 3-or-4 device px wide — a wobbling grid, worse than blur, and no current check catches it. |

### D10 — anchor registration, without widening any tolerance

The first draft proposed quantising the horizon and relaxing `LAYOUT_QUANTUM` to ~1.5px.
**That is wrong** — `docs/review-checklist.md` §1 says never widen a tolerance to make this
pass, and it would blind the check to a real 1px regression forever. It also forgot the
vanishing point, which `scripts/invariant.ts:66` asserts to the same 1/64px.

Instead: **choose the bleed, not the anchor.** Pick per-axis bleed `B ∈ [64, 64+S)` such
that `anchor + B ≡ 0 (mod S)`. Both anchors then land on exact art-cell boundaries while
staying within half a pixel of true:

| viewport | horizon (true → chosen) | B_top | error | VP | B_left |
| --- | --- | --- | --- | --- | --- |
| 1440×900 | 522.00 → **522** | 66 | **0.00px** | 720 | 66 |
| 768×1024 | 593.92 → **594** | 66 | 0.08px | 384 | 66 |
| 390×844 | 489.52 → **490** | 65 | 0.48px | 195 | 66 |

Verification: `(522+66)/3 = 196`, `(594+66)/3 = 220`, `(490+65)/3 = 185`, `(720+66)/3 =
262`, `(384+66)/3 = 150`, `(195+66)/3 = 87` — all exact.

`scripts/invariant.ts` keeps its **1/64px tolerance**, now asserted against `horizonPx(h)` /
`vpPx(w)` exported from `src/config.ts`, plus a *second, independent* assertion that
`|horizonPx(h)/h − 0.58| ≤ 0.5/h`. Two exact checks, neither widened. `PIXEL_EPSILON = 2.5`
stays below S, so a one-art-row error still fails.

Cost: `geo.bleed` becomes **per-axis and viewport-dependent**, so `BLEED_PX = 64` as a
constant (`docs/asset-contract.md` §5) becomes false.

---

## 5. Architecture

```
src/art/
  palette.ts     the global indexed palette + per-act ramps; index -> RGBA once
  buffer.ts      Buf: {w,h,idx:Uint8Array}; px/hline/vline/fillRect/blit/clipped ops
  draw.ts        ramp() dithered gradient, bayer(), outline(), floodRegion()
  sky.ts         cloud fields, banded sun, horizon glow — the biggest single lever
  sprites/       text-authored sprites (see 6)
  compose.ts     Buf -> ImageData -> ImageBitmap, aberration + grain applied here
```

`src/acts/shared.ts` keeps every arithmetic helper unchanged — `groundY`, `depthScale`,
`roadHalf`, `roadCentre`, `windingRoad`, `meander`, `tint`, `shade`, `clearsVP`,
`VP_KEEP_CLEAR`. Only the five emitters (`rect`, `poly`, `blockCircle`/`circle`, `line`,
`windowGrid`) and `outlined` are replaced by buffer ops. The chunk-grid snapping
(`setPixelGrid`/`snapX`/`snapY`/`snapSize`) is **deleted** — on a real pixel grid it is
both unnecessary and the direct cause of the coarseness in §2.

`SlotArt.free`/`.locked`/`parts[].markup` change from `string` to a draw callback
(`(buf: Buf, geo: Geometry) => void`), so `docs/asset-contract.md` needs the
corresponding edit. `src/reduced.ts` renders the same callbacks — one code path, not two.
It also has a **pre-existing bug to fix while we are there**: `src/reduced.ts:68` iterates
only `[piece.free, piece.locked]`, so `parts` are dropped and Act I's tumbleweeds do not
exist in reduced motion at all.

`.free` and `.locked` stay **separate elements**. Compositing them into one buffer per slot
is tempting and wrong: `scripts/invariant.ts:89` asserts `lockedTransforms.length > 0` —
"the invariant has no witness" — so collapsing them silently deletes both the structural
guarantee and the check that proves it.

### Raster architecture

`build(geo)` → draw-command list → raster into an `OffscreenCanvas` →
`transferToImageBitmap()`, cached in `Map<actIndex, Bitmap[]>` keyed by a geo signature.
Each layer is a `<canvas>` that `drawImage`s its bitmap **once at build time**. Per frame:
`transform`/`opacity` writes only — identical to today.

Cost model, measured against the real buffer sizes (stage + per-axis bleed, S=3):
**523×343 = 179k px at 1440**, 115k at 768, 56k at 390. ~12 buffers per act; worst case
during a transition is two acts resident ≈ **4.3M px ≈ 17–29ms desktop, 60–100ms on a
low-end phone** — paid **once per act-entry and once per resize, never per frame**. Plates
share one source bitmap, so they cost a `drawImage`, not a fill.

Mitigations: raster in a Worker (acts are pure functions of `geo`, so they port cleanly),
and pre-raster the *incoming* act one segment early via a lookahead on `residentActs()`
(`src/progress.ts:76`) so the act-change frame costs nothing.

Watch compositor memory: ~34 promoted layers at 1440 ≈ **219MB** of texture. The current
SVG build already pays this; canvas makes it non-negotiable.

Everything in `src/stage.ts` that writes `transform`/`opacity` per frame (`:110–175`) and
the `clip-path: inset()` on `.drift` (`:241–244`) is substrate-agnostic and does not change
in *structure* — but every value written must now be rounded (D11), and `clipBottom` must
be snapped to the art grid at build time (it is `toFixed(2)` today at `src/stage.ts:242`,
which leaves a sliver of an art pixel at the clip edge).

---

## 6. Sprite pipeline

Sprites are **text**, not binaries — diffable in git, agent-authorable, and checkable:

```ts
export const LAMP = sprite(`
..3..
.343.
.111.
`);   // each char indexes the shared palette; '.' = transparent
```

- Authored at **2–3 discrete sizes** and blitted at integer positions. Never fractionally
  scaled — a scaled sprite resamples and breaks the register.
- `npm run check:sprites` validates: every char is a defined palette index, rows are
  equal length, dimensions are in the allowed set, and the sprite uses no colour outside
  its declared ramp. **Off-model art fails a command, not a review.**
- This is the unit that parallelises safely, and it is the productive form of the original
  request: an agent authoring a sprite works against a fixed canvas, a fixed palette and a
  fixed light direction, and its output is verified mechanically rather than by eye.

---

## 7. Phases

Each phase states its exit criterion and the command that proves it. No phase reports done
without showing that command's output.

### P0 — Reference envelope (prerequisite for everything) ✅
- [x] `artStats()` in `scripts/pixels.ts`; `scripts/refstats.ts` with `envelope` / `measure`
      / `check`; `docs/reference-envelope.json` committed.
- [x] `npm run check:refmatch` shoots the four act holds × three viewports at `?nocopy=1`
      and compares against the envelope.
- **Exit met.** `check:refmatch` exits 1 with **27 failures of 48 assertions**:

  | group | bound | worst observed |
  | --- | --- | --- |
  | Act 1 | runP25 ≤ 0.99% of width | 4.87% (Act IV @ 390) |
  | Act 1 | pal99 ≥ 188 | 58 (Act I @ 1440) |
  | Act 1 | fine ≥ 18.4% | 1.3% (Act IV @ 1440) |
  | Act 2 | pal99 ≥ 176 | 33 (Act II @ 1440) |
  | Act 2 | fine ≥ 11.6% | 1.6% (Act II @ 1440) |

**Two gates, deliberately separate.** `npm run check` (typecheck + invariant + parallax, and
later register + perf) must be green at *every* commit. `npm run check:art` (refmatch) is the
fidelity gate and stays red until P4/P5. Folding refmatch into `check` would leave it red for
four phases, which trains you to ignore the one signal that matters.

**Value structure is reported, not gated.** The reference set cannot express it as a bound —
its members range from a two-band bright-sky silhouette to a night scene with 84% of its
frame in one band, so any threshold failing our Act II also fails two references. Picking a
number because it catches the frame you already know is wrong is `review-checklist.md` §1's
tolerance-fitting run backwards. Act II's `[82 14 3 0 0 1 0 0], largest 82%` prints on every
run and is an art requirement in P5, graded by a critic.

### P1 — Anchor + transform correctness, still SVG ✅
Deliberately before the substrate, so the two changes never confound each other.
- [x] `ART_SCALE` / `horizonPx` / `vpPx` / `bufferOriginFor` / `roundToDevicePx` in
      `src/config.ts`; `BLEED_PX` 64 → 66; anchors driven from `--horizon-px` / `--vp-px`.
- [x] D8 build caching, D11 transform rounding, `clipBottom` rounded, `remeasure()` now
      runs a write pass so rebuilt layers are positioned on the same frame.
- [x] `scripts/parallax.ts` rewritten; `scripts/invariant.ts` asserts against
      `horizonPx`/`vpPx` **with the 1/64px tolerance unchanged**, plus a new independent
      assertion that each anchor is within half a pixel of its true fraction.
- [x] `src/reduced.ts` uses the same anchors, and its dropped-`parts` bug is fixed.

**Measured.** Anchors land at 522 (58.000%), 594 (58.008%), 490 (58.057%) — max error
0.48px, and `bufferOriginFor` puts all six anchor/axis pairs on exact art-cell boundaries
(origins 66/66/66/66/68/66). `npm run check` green; both gates got *stronger*:

| check | before | after |
| --- | --- | --- |
| `check:invariant` | 491 assertions | **497** |
| `check:parallax` | 2081 assertions, drift within 0.6px | **2441**, drift **exact** |

**Exit criterion was wrong, and is restated.** It said "`refstats` unmoved". That assumed
the port was visually neutral; D11 is not — it deliberately stops the compositor resampling
every layer. What actually happened:

| 1440×900 | pre-P1 | post-P1 |
| --- | --- | --- |
| Act I fine% / pal99 | 1.8% / 58 | 1.8% / 56 |
| Act II fine% / pal99 | 1.6% / 33 | **0.7% / 29** |
| Act III fine% / pal99 | 2.3% / 91 | **0.4% / 70** |
| Act IV runP25 | 3.13% of w | **1.46%** |

A frame diff shows why: **98.1% (Act I) and 99.8% (Act III) of all changed runs are 1–2px
wide**, widest 14px and 7px, with 0.02%/0.11% of pixels strongly changed. Thin seams only;
no region moved. So the composition is unchanged, and the metric drop is the *removal of
anti-aliasing* — the P0 baseline was partly measuring resampling artifacts rather than art.

**Two consequences.**

1. **The gap to the references is larger than P0 reported.** Act II now sits at pal99 29
   against a 176 target (6×), and Act III at 0.4% fine against 11.6% (29×).
2. **This resolves the open finding in `build.md` §D2 R2** — "widespread 1px blends across
   every slot, including non-aberrated street level". An earlier critic attributed it to the
   paper-grain layer and declined to call it a finding. The cause was fractional layer
   transforms; it is now gone. R2 can drop that item.

**Deliberately not done:** `index.html`'s critical-paint gradient still hardcodes `58%`. It
is a placeholder removed once the stage renders, and its worst disagreement with the art is
0.48px at 390×844 — invisible, and for well under a second. Making it exact would need JS in
the critical path, which is what that block exists to avoid.

### P2 — Canvas substrate, Act I only, composition unchanged
- [ ] `src/art/{palette,buffer,draw,compose}.ts`; `SlotArt` takes draw callbacks; D12 sizing;
      D5 plates sharing one cached bitmap; D7 grain retiled; `reduced.ts` `parts` bug fixed;
      `#stage-critical` removal moved to after the first successful raster (`src/main.ts:46`).
- [ ] Port Act I **unchanged in composition** — same shapes, same tones, now rasterised.
- **Exit — the one check that proves it:** new `npm run check:register`. Load
  `?nocopy=1&frozen=1` (a new param zeroing every transform so all slots' grids are in
  phase), screenshot, and assert **every S×S cell is uniform** across the stage. That single
  assertion catches non-integer upscale, fractional translate, sub-art-pixel grain and
  fractional clip edges simultaneously — nothing else catches all four. Plus
  `check:invariant`, `check:parallax`, and `refstats` within 5% of P1. **Prove it changed
  nothing before changing everything.**

### P3 — Perf gate
- [ ] `npm run check:perf`: `?perf=1`, drive all 15 checkpoints, assert write-pass
      **p99 < 4ms and max < 16ms**.
- **Exit:** green. `docs/review-checklist.md` §9 quotes p50 = 0.10ms — **the p50 will keep
  looking fine while p99 explodes**, so p50 is not the gate.

### P4 — Act I to reference fidelity, single author, no parallelism
- [ ] Palette expanded to the §2 target; sky/cloud renderer; dithered ramps — **never across
      the horizon row**; density pass: continuous street wall, receding poles, populated street.
- [ ] **Re-tune density constants.** S=3 makes desktop detail 2.3× finer *and mobile 1.5×
      coarser* (`PIXEL` is 7/4/2 today). Every count tuned at chunk 7 — `windowGrid` cols/rows,
      the 30-iteration scrub loop (`src/acts/i.ts:459`), 20 motes, 14 foreground stones, mesa
      steps — will read empty at chunk 3. This is real work, not re-plumbing.
- [ ] `npm run check:palette` (page hook returns each layer's index histogram; assert every
      index is declared and every declared index is used) and `npm run check:sprites`.
- **Exit:** Act I inside the reference envelope on all four §2 metrics at all three viewports,
  and compared against `shots/1440x900_0.06.png` from the current baseline. **No parallel
  agent starts until this passes** — it is the style bible.

### P5 — Acts II–IV, one agent per act
- [ ] Each agent receives: finished Act I as style bible, `src/art/*` primitives, the locked
      shared palette, the envelope, and `docs/review-checklist.md`.
- [ ] Act II additionally must fix the collapsed value structure (§2 conclusion 3).
- **Exit:** all four acts inside the envelope; full `npm run check`;
  `npm run shots -- --backdrop` with zero console issues.

### P6 — Grading, in a separate context
- [ ] Fresh critic per act against a **frozen** tree (`docs/review-checklist.md` Process).
- **Exit:** no correctness findings.

`npm run check` gains: `check:register`, `check:palette`, `check:sprites`, `check:perf`,
`check:refmatch`, and `check:reduced` (all four reduced scenes render non-empty and include
`parts`). The old sub-chunk register check is obsoleted — there are no sub-pixel shapes when
there are only pixels.

---

## 8. Effect on the existing plan

`docs/plans/build.md` §D2 R1 (promote critic checks into `npm run check`) is **partly
superseded**: the saturation-trace, distribution and contrast checks survive unchanged and
should still be built, but the *register* check is obsoleted by D1 and the skyline check
should be folded into `check:refmatch`. R2's clean critic pass on Acts III–IV is deferred
to P6 — critiquing art that is about to be redrawn wastes the pass. R3 (client content) and
R5 (ship) are unaffected. **R5's cross-browser risk is unchanged**, not reduced: keeping the
aberration plates (D5) means `feColorMatrix`, `mix-blend-mode: screen` and `isolation` stay
load-bearing and still untested outside Chromium.

`docs/art-direction.md` §3 requires amendment before P4: the chunk grid (`w/200`), "two to
three tonal steps per surface, and no more", "sub-chunk shapes do not exist", and the
halftone-as-overlay clause each directly forbid the look the references have. **The current
spec is working as written — it is what produced the §2 numbers.**

`docs/asset-contract.md` clauses that become false and must be rewritten in P2: §2
(`free`/`locked` are `string`), §3 (the DOM diagram), §4a (SVG user units 1:1 with stage px,
and "the composition **reflows** at 390 rather than cropping" — a fixed S means it *crops*),
§4c (drop-in SVG with `data-drift` / `data-vp-locked` groups), and §5 (`BLEED_PX = 64`
constant → per-axis, viewport-dependent).

`docs/review-checklist.md` §7's transition proof — "a structure's fill should stay at its
*exact* hex while its extent moves" — becomes false under dithering, since a dithered region
has no single hex. It must become "the region's index histogram is unchanged while its bbox
moves." Amend in P4.

---

## 9. Risks, in order

| # | Risk | Detection |
| --- | --- | --- |
| R1 | **Fractional transforms softening every moving layer.** The failure that looks like "the art is a bit mushy" and gets misfiled as an art problem for weeks | `check:register` at P2, plus the exact-equality drift assertion at P1. Both land before any art work. |
| R2 | **Density constants tuned at chunk 7 read empty at chunk 3.** No check catches "sparse" | Port Act I first and compare against `shots/1440x900_0.06.png` at the same checkpoint **before any parallel agent starts**. This is the risk that otherwise yields four inconsistent acts. |
| R3 | **Raster cost during a transition** (two acts resident ≈ 4.3M px) | `check:perf` at P3, before art exists. Raster must be act-change/resize only. The original aberration-in-buffer design failed exactly here and was cut. |
| R4 | **Anchor lands a pixel off and no check notices**, because a tolerance was widened to admit it | D10: keep 1/64px against `horizonPx`, add the independent ≤0.5px-of-true assertion, keep `PIXEL_EPSILON = 2.5 < S`. |
| R5 | **Dither breaks `edgeCoverage` at the horizon** and the exact-hex transition proof | `check:invariant` fails the moment dithering touches the horizon row. Mitigation is the D6 exclusion. |
| R6 | Procedural code cannot reach "Best Sample" tier alone | Accepted and stated up front. §6 sprites are the mitigation. P4's exit is measured, so a shortfall surfaces at Act I, not at Act IV. |
| R7 | Scope — this is a drawing-layer rewrite | Composition code survives (§2), but see R2: the *result* needs re-tuning even where the code does not. P1/P2 are deliberately no-visual-change so the substrate is proven independently of the art. |

---

## 10. Adversarial review log

Reviewed in a fresh context against this file (CLAUDE.md: the author never grades its own
work). Load-bearing arithmetic re-verified before acceptance. What changed:

| First draft said | Corrected to | Why |
| --- | --- | --- |
| Aberration moves into the buffer | **Reversed.** Keep the plates | The offset is velocity-driven, so it would force a full re-raster *every frame* (~1.8M px). `art-direction.md` §3 already forbids this. |
| Widen `LAYOUT_QUANTUM` to ~1.5px | **Rejected.** Choose the bleed instead | Widening a tolerance to make a check pass is exactly what `review-checklist.md` §1 forbids. The bleed trick gives ≤0.5px error *and* keeps both checks exact. |
| Quantise the horizon | Also the **vanishing point** | `invariant.ts:66` asserts VP to 1/64px too; it was simply forgotten. |
| Transforms round to art pixels (S) | Round to **device** pixels | Snapping to 3px would delete slot 7's parallax outright — its total page sweep is 3px at 1440 and 0.81px at 390. |
| Grain moves into the buffer | Grain stays at **stage level**, retiled | In the buffer it would parallax with the layer. It is an artifact of the final sheet. |
| Indexed buffer makes off-palette "structurally impossible" | False; kept for a **different** reason | Crossfades, grain and `fill-opacity` guarantee off-palette pixels at the composite. The real value is that palette validation is impossible from a screenshot at all. |
| "85–90% of composition survives" | True of the **code**, false of the **result** | See R2. Chunk 7 → 3 changes what every density constant produces. |

Also surfaced and folded in: `reduced.ts` drops `parts` entirely (pre-existing bug),
`remeasure()` rebuilds without a transform write pass, `#stage-critical` is removed before
any layer exists, `index.html` hardcodes `58%`, and `.free`/`.locked` must stay separate
elements or `invariant.ts:89` loses its witness.
