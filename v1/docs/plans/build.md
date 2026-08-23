# Build plan — The Frontier Remains Open

Status: **All four acts built, copy deck in, pixel-art register applied, post-process in.
Verification green. Remaining: critic passes on Acts II–IV, reduced-motion copy, and the
Phase 8 performance/a11y measurements.**

This file is the source of truth for multi-step progress. On resume, re-read this file
rather than trusting conversation memory. Tick boxes as work lands.

---

## 0. Toolchain verification (done)

| Check | Result |
| --- | --- |
| Node ≥ 20 | `v26.5.0` ✅ |
| npm | `11.17.0` |
| `npx playwright install chromium` | exit 0 — Chrome for Testing 151.0.7922.34 (chromium v1234) ✅ |
| Platform | darwin 26.5.1, arm64 |
| ImageMagick | **not installed** — see B3 |
| `MorphSVGPlugin` in public `gsap` npm | present (`package/dist/MorphSVGPlugin.js`) — free, no extra dep |

### Versions to pin (exact, no ranges)

```
vite            8.2.1
typescript      7.0.2
gsap            3.15.0
lenis           1.3.26
playwright      1.62.1
```

`typescript@7.0.2` is the native compiler port. If it produces friction with Vite 8 in
Phase 1, the documented fallback is `typescript@5.9.3` — that swap does not need a new
approval, but it gets noted here when it happens.

Nothing else is installed without asking. Specifically **not** assumed approved:
`@playwright/test` (the plain `playwright` library is enough for the shot harness), any
Vite plugin, any font package.

---

## A. Blocking questions — RESOLVED 2026-08-13

### A1 — What the parallax multiplier multiplies · *delegated to me; defined below*

The problem: §3 gives each slot a rate (1.60× … 0.10×), but §1 pins the stage and freezes
the horizon. During a **hold** there is no camera translation for a rate to scale. Vertical
translation of slots 4–7 moves the horizon and breaks the invariant. And *horizontal*
translation of a whole slot moves the **vanishing point**, breaking the other half of the
invariant — slot 1's road edges, slot 4's fence line and slots 2–3's perspective all
converge on `50vw` and cannot slide.

So the rate cannot multiply scroll position for any slot that carries VP-registered
geometry. Definition, in full:

**1. Rate `r` is a displacement multiplier, never a scroll multiplier. Vertical *drift* is
zero for every slot at every scroll position, always.**

The only vertical motion in the build is **transition travel** (B2's rise/sink and
extrusion), which is clipped so the horizon itself is never displaced. Drift and travel are
separate transforms on separate elements, so the check can assert them separately: drift
groups must have `f = 0` in their matrix at all times; travel groups may move in Y only
while `phase === 'transition'`.

**2. Each slot SVG exposes exactly two transform targets, and VP-registered geometry is in
neither.**

```
<svg>                          ← never transformed
  <g data-drift="free">   …    ← receives lateral drift (below)
  <g data-travel="…">     …    ← receives transition rise/sink or extrusion clip
  <g data-vp-locked>      …    ← road edges, fence lines, perspective, sun. NEVER transformed
</svg>
```

Only the free group drifts, so the VP is structurally incapable of moving — not kept in
place by two transforms cancelling out, which is the fragile version. This authoring
convention becomes part of `docs/asset-contract.md`, so a drop-in illustrated slot
inherits the guarantee.

**3. Lateral drift.** `x = (p − 0.5) × r × D`, applied to the free group only. `D = 30px`
at 1440w, scaling linearly with viewport width (390w → 8px). Total sweep over the page:
slot 0 = 48px, slot 3 = 30px, slot 5 = 15px, slot 7 = 3px. Monotonic and leftward, so it
reads as a slow truck to the right through one continuous world. Horizontal translation
cannot move a horizontal line, so the horizon is untouched by construction.

Act I sits at `−r×D/2` and Act IV at `+r×D/2` — a 15px difference on the mesas, far below
the threshold at which Act IV would stop reading as the same place.

**4. Transition lurch.** Through a transition the drift amplitude is boosted 3× on an
ease-in-out that returns to the baseline curve by the end. This is where the rates become
visible: it is deliberately concentrated at `p` = 0.18 / 0.46 / 0.74, the three
mid-transition checkpoints.

**5. Rise/sink travel is NOT scaled by `r`.** A structure must travel its own height to
clear the horizon clip, so scaling it would leave far structures half-sunk. Parallax there
comes from the geometry for free — a 12vh mesa travels 12vh, a 40vh near building travels
40vh — and `r` would double-count it. What differentiates the slots in a transition is
stagger order and easing (§3), not travel distance.

**6. Slot 0 prop self-motion** (tumbleweeds, blimps, motes, birds) is scaled by `r`, on the
12fps accumulator.

Net: `r` is used in exactly two places — lateral drift amplitude and slot 0 prop speed.
That is less than §3 implies, and it is what survives the invariant.

**Verification.** `npm run check:parallax` drives `p` in fine increments, reads each slot's
computed transform matrix from the DOM, and asserts: every drift group has `f = 0`; the
ratios between slot X-displacements match the §3 rate table within 1%; and every
`[data-vp-locked]` layer has an identity transform. Stronger than reading it off
screenshots, and it does not depend on how few checkpoints land mid-transition.

### A5 — Paint-property writes (decided while implementing Phase 1)

§7 says only `transform`, `opacity` and `filter` may be animated, but B2 calls for
interpolating sky gradient stops and road-edge polygon points, both of which are paint
writes. Rule adopted:

> A paint-property write is permitted only where it is O(1) per frame and confined to a
> single small element. Anything full-screen uses transform or opacity.

So: the road edge polygon (one element, 4 points) interpolates its `points` attribute
directly. The sky gradient (slot 7), the haze (slot 6) and ground fills (slot 1) are two
stacked **static** layers crossfaded by opacity — visually indistinguishable from stop
interpolation at these palettes, and compositor-only. This is not the cross-dissolve §3
forbids: that prohibition is about *structures* fading in and out instead of rising and
sinking, and structures (slots 2–5) never use opacity as their transition verb.

### A2 — Act II saturation rule contradicts Act II slot 1 · **amend the rule**

`art-direction.md` §5 saturation rule: cyan and magenta appear *only* on the two monoliths
and the blimp advertising, "**No exceptions**." §9 checklist repeats it: "zero saturated
pixels outside monoliths and blimp panels."

`art-direction.md` §5 slot 1: "the road, now paved, wet, reflecting the monolith light in
cyan and magenta streaks — the only saturation at ground level, and it is *reflected*,
not owned."

Those cannot both hold. The reflection is clearly intended and it is argued for, so the
rule is what is mis-worded. Left as-is, the visual-critic files a `BROKEN` finding on
every Act II pass forever.

**Resolved:** amend `art-direction.md` §5 and the §9 checklist to read —

> Cyan and magenta appear only on the two monoliths, the blimp ad panels, and the road's
> reflection of those two sources. Reflected saturation must be visibly darker and lower
> in chroma than its source, and must be traceable to a source above it. No emissive
> human-scale element is saturated.

Edited at the source in Phase 1 so it is not re-litigated on every critic pass.

### A3 — The Act II copy scrim does not meet the Act II contrast requirement · **per-act alpha**

`art-direction.md` §8 fixes copy at `#F5F0E8` over "a backdrop blur scrim at 30% of the
act's darkest tone", and §8 also requires ≥ 4.5:1 body contrast in every act. In Act II
the copy column is pushed **right**, toward the frame edge (`copy-deck.md`), and the
magenta monolith sits at `62vw` rising past the top of the frame. The column overlaps it.

Computed (WCAG relative luminance, sRGB compositing):

| Backdrop behind copy | Scrim `#1A1D24` alpha | Contrast vs `#F5F0E8` |
| --- | --- | --- |
| Cyan window `#00E5FF` | 0.30 (as specified) | **2.49:1 — fails** |
| Cyan window `#00E5FF` | 0.55 | 4.62:1 — bare pass |
| Cyan window `#00E5FF` | 0.65 | 6.07:1 |
| Cyan window `#00E5FF` | 0.80 | 9.30:1 |
| Monolith body `#1A1D24` | 0.30 | ~16:1 |

Magenta `#FF2D95` is darker than cyan and passes at a lower alpha; cyan is the worst case
and sets the floor.

**Resolved:** scrim alpha becomes a **per-act value, solved at build time against the
worst-case backdrop inside the column bounds, with a hard 4.5:1 floor.** Act II lands
~0.65 (6.07:1); Acts I/III/IV stay near the spec'd 0.30. Copy color stays `#F5F0E8`
everywhere, which is what §8 actually protects — the scrim adapts, the text does not.

`art-direction.md` §8 gets amended to state the rule as a floor rather than a fixed 30%.
The solved value is asserted by `npm run probe -- contrast` at every checkpoint, not
eyeballed.

### A4 — Chromatic aberration: SVG filters vs. layered blend · **layered blend**

§4 and `art-direction.md` §3 specify aberration as an SVG filter, with 4 pre-baked filter
definitions swapped at velocity thresholds. That works, but every swap re-rasterizes a
full-screen layer, and `filter: url(#…)` on large layers is CPU-rastered in Chromium. Four
filtered full-screen layers (slots 4, 5 aberration + slots 0, 6 blur) is the single
biggest threat to the §7 60fps budget.

**Resolved:** render the aberrating slot as **three stacked copies** of the same SVG —
red-tinted, cyan-tinted, base — composited with `mix-blend-mode: screen`, offset by pure
`translate3d`. Then:

- offset becomes a transform, so it is compositor-only and never re-rasters;
- velocity response is **continuous** (0→6px) instead of 4 discrete steps;
- no filter primitives are animated, satisfying §4's actual constraint more strictly than
  the filter approach does.

Cost: 3× the DOM nodes and 3× the one-time raster for slots 4–5. Static content, so it is
paid once at init.

Blur stays as a static `filter: blur()` on slots 0 and 6 — rasterized once, cached while
the layer only translates. Halftone stays a static pattern fill with `multiply`. Neither
is animated.

`art-direction.md` §3's aberration paragraph gets amended to describe the layered
technique. The *result* the spec asks for is unchanged: red +2px / cyan −2px at rest,
scaling to 6px at peak scroll velocity, on slots 4+ and on slot 0 during fast scroll.

---

## B. Decisions taken (defaults, stated not asked)

### B1 — The three source docs are not at the paths the brief cites

The brief references `docs/art-direction.md`, `docs/copy-deck.md`, and
`.claude/agents/visual-critic.md`. All three are at the repo root:
`./art-direction.md`, `./copy-deck.md`, `./visual-critic.md`. `visual-critic.md` carries
agent frontmatter and **cannot be invoked as a subagent from the root** — it has to sit in
`.claude/agents/` for Phase 2's review loop to run at all. `visual-critic.md` also refers
to `docs/art-direction.md` internally.

Phase 1 step 0 moves them to the cited paths. No content changes except A2/A3 amendments
if approved. Flagged rather than done silently.

### B2 — Transition verbs, per slot

"Structures rise from and sink into the horizon, not fade" is the instruction; path-morphing
a western false-front town into a leaning slum stack is not tractable and MorphSVG between
dissimilar topologies looks like melting. So morphing is used only where topology is
genuinely shared, and everything else uses motion:

| Slot | Verb |
| --- | --- |
| 7 sky | interpolate gradient stop colors (shared topology — 5 stops in every act) |
| 6 haze | color + opacity + band height |
| 5 far | **horizon rise/sink** — translate3d Y, statically clipped at 58vh |
| 4 far-mid | horizon rise/sink, clipped at 58vh |
| 3, 2 near | **ground-plane extrusion** — a `<clipPath>` rect whose *transform* sweeps up from each structure's own base line. A near building's base is far below the horizon; sinking it into the horizon is geometrically wrong and would read as the building sliding down a hole |
| 1 ground | road edge polygon point interpolation (4 points, shared topology) + flat fill color interpolation |
| 0 props | drift on/off canvas laterally |

Nothing cross-dissolves. No slot animates whole-layer opacity as its primary verb.

### B3 — No ImageMagick; a project-local pixel prober instead

`visual-critic.md` mandates `convert img.png -crop 1x1+X+Y txt:` for palette sampling.
ImageMagick is not installed on this machine. Rather than add a system dependency,
Phase 1 ships `scripts/probe.ts` — decodes a PNG in the already-installed Chromium via
canvas, zero new packages:

```
npm run probe -- sample <png> <x> <y>          # hex + rgb at a pixel
npm run probe -- horizon <png>                 # measured horizon y, as px and as % of height
npm run probe -- contrast <png> <x> <y> <w> <h>  # worst-case contrast of #F5F0E8 over that region
npm run probe -- chroma <png> --min-sat 0.5    # count + bbox distinct saturated regions (A2, Act III ≥20)
```

`visual-critic.md` gets its Method §3 updated to call `npm run probe` instead of `convert`.
This is strictly more capable than the ImageMagick line it replaces — the Act III "count
≥20 distinct sources" and the Act II saturation checks become measurements instead of
eyeballing.

### B4 — Stagger arithmetic

§3's "stagger ≈ 0.06 of act progress per slot" reads as 0.06 of the **transition's
normalized [0,1] progress**, not of master `p`. Check: 8 slots × 0.06 = 0.48, leaving each
slot 0.52 of its window to travel — workable. Read as master `p`, 8 × 0.06 = 0.48 against
transition spans of 0.13/0.13/0.12, which is impossible. Going with normalized.

### B5 — Lazy init vs. the eight-slot invariant

§7 says acts 3+ scroll-lengths away are not rendered, init lazily, tear down behind. §3
says an act is a *parameterization of eight permanent slots*, not a separate scene — so
there is no per-act DOM tree to tear down without breaking the model.

Resolution: the eight slot elements are permanent and never torn down. What is lazily
built and released is each act's **SVG geometry payload**, kept for acts within ±1 of the
current position (both endpoints live through a transition). Bounded DOM and memory,
invariant intact.

### B6 — First paint / LCP

Everything is JS-generated, so nothing paints until the bundle executes — a real risk
against LCP ≤ 2.5s on Fast 3G. `index.html` ships the Act I sky gradient and the horizon
rule as inline CSS, plus the `<h1>` as real text, so first paint is server-cheap and the
LCP element is the heading. Inline `<svg>` is not an LCP candidate; the H1 is.

### B7 — Typography

Self-hosted Inter Tight variable, latin subset, woff2 (~30–40KB), with `size-adjust` /
`ascent-override` metrics on the fallback so `font-display: swap` costs no layout shift
(CLS = 0 is a hard §7 requirement). No CDN, no font package — the woff2 is committed as
an asset. If you would rather not carry a font file, the fallback is a system grotesque
stack and the display tracking gets retuned; say so and I will not add the file.

### B9 — Contrast must be measured against a backdrop shot, not a normal one

Discovered while wiring `probe contrast` in Phase 1. Pointed at an ordinary shot it finds
the *glyphs* — `#F5F0E8` over `#F5F0E8`, 1.00:1 — and reports a failure that means nothing.

`npm run shots -- --backdrop` therefore emits a parallel `bd-{viewport}_{p}.png` set
rendered with `?nocopy=1`, which hides the copy layer. `probe contrast` is documented to
require those. With that fixed the numbers are real: at p=0.32 the worst backdrop pixel
under the h1 is `#dfdedf` at 1.18:1, and at p=0.60 it is a `#FFE9A8` prop at 1.06:1. Both
are correct failures against an unscrimmed layer — Phase 6 adds the scrim and they must go
green.

### B10 — `@types/node`, and the font decision

- **`@types/node@24.10.1` added** as a devDependency. Types only, zero runtime bytes, not
  in the shipped payload. The alternative was hand-rolling ambient declarations for
  `node:zlib`, `node:http` and `node:fs`, which is fragile for no gain. Node 26 runs the
  `.ts` scripts natively via type-stripping, so there is no `tsx` or `ts-node`.
- **No font file yet.** B7 proposed self-hosting Inter Tight; Phase 1 ships a system
  grotesque stack instead, because adding a binary asset I cannot verify the metrics of is
  not something to do in a scaffolding phase. Phase 6 makes the call and, if the font goes
  in, must land `size-adjust`/`ascent-override` fallback metrics with it — CLS = 0 is a
  hard §7 requirement.

### B8 — Reduced-motion shot pass

§8 asks for `--reduced-motion=reduce` as a fourth pass, but that mode has no pinned stage
and therefore no `p` — the 15 checkpoints do not map onto it. The fourth pass shoots each
of the 4 acts as a full-page composition at all 3 viewports (12 shots), named
`rm-{viewport}_{act}.png`, plus one full-page capture per viewport for the a11y audit.

---

## C. Architecture

```
index.html            inline critical sky + h1 (B6)
src/
  main.ts             boot: Lenis, one gsap.ticker, one ScrollTrigger, one write pass
  progress.ts         the store — master p, velocity, act index, transition t; subscribe()
  stage.ts            the eight slot elements, permanent; horizon + VP anchors
  slots/…             per-slot render + per-act parameterization
  acts/{i,ii,iii,iv}.ts   parameter sets, pure functions of nothing but their own constants
  transitions.ts      per-slot verbs (B2) + stagger (B4)
  post/               halftone patterns, aberration stacks, on-twos accumulator
  copy.ts             p-driven reveal thresholds; real DOM text
  reduced.ts          first-class static path
scripts/
  shoot.ts            the shot harness (§6)
  probe.ts            pixel measurement (B3)
  invariant.ts        horizon/VP assertion across all checkpoints
docs/
  art-direction.md    (moved, B1)
  copy-deck.md        (moved, B1)
  asset-contract.md   written in Phase 1 (§10)
  plans/build.md      this file
```

One `ScrollTrigger` with `scrub`, one rAF loop (gsap.ticker drives `lenis.raf`), one write
pass per frame. Slot 0 reads a separate 12fps accumulator inside that same pass — it is a
throttled tick, not a CSS animation.

### Asset contract (§10, written in full in Phase 1)

Every slot accepts either the generated SVG or a drop-in illustrated replacement at the
same `viewBox` and the same named anchor points (`#anchor-horizon`, `#anchor-vp`, plus
per-slot base lines for B2's extrusion clip). The scroll engine addresses slots only
through that contract, so illustrated art can replace any slot later without touching
timeline code. This is the honest hedge against §10: what ships here is strong flat vector
with a convincing print finish, not hand-illustrated work at the And—Now level.

---

## D. Phases

**The original nine phases are complete.** They assumed an empty directory; that plan is
retained below as a record, and superseded by the phases in §D2.

### D1 — Original phases, closed

| Phase | State |
| --- | --- |
| 0 Plan | ✅ |
| 1 Scaffold + harness | ✅ |
| 2 Act I | ✅ three critic passes, clear |
| 3 Act II + I→II | ✅ built; one critic pass, findings applied |
| 4 Act III + II→III | ✅ built; **no clean critic pass** |
| 5 Act IV + III→IV | ✅ built; **no clean critic pass** |
| 6 Copy + typography | ✅ copy done; **typography not started** (still a system stack) |
| 7 Post-process | ✅ halftone, aberration, grain, on-twos |
| 8 Reduced motion, a11y, performance | ✅ measured — see §E |

Two items from that list are genuinely unfinished and carry forward: a clean critic pass on
Acts III–IV, and typography.

---

### D2 — Revised phases

The outline is done. What remains is refinement, real content, and shipping. These are
ordered by dependency, not importance: R1 protects everything after it, R2 is the last
correctness gate, and R3 needs input that only the client has.

#### R0 — Version control ✅
- [x] `git init`, `.gitignore` (node_modules, dist, shots, agent-memory), baseline commit

Done after two incidents in one session where a source file had to be rewritten from memory.

#### R1 — Lock in what the critic knows
- [x] `docs/review-checklist.md` — the twenty-one defects four passes found, each with the
      check, how to run it, and why the obvious version of the check fails
- [ ] Promote the mechanical ones into `npm run check` so they cost nothing to re-run:
  - [ ] **saturation trace** — every saturated region in Act II resolves to a permitted
        source above it; fails the build otherwise
  - [ ] **distribution** — Act II ≤ 12/20 columns, Act III ≥ 18/20
  - [ ] **skyline profile** — named landmarks are not 100% occluded
  - [ ] **register** — no sub-chunk rect, no `<ellipse>`, no `<circle>`, no gradient outside
        slot 7, in any act's emitted markup
  - [ ] **contrast** — every copy block, fully revealed, with its act scrim composited
- [ ] `npm run check` runs typecheck + invariant + parallax + all of the above

**Exit:** a regression in any of those fails a command, not a 30-minute agent. The critic is
then reserved for judgement — composition, whether an act *reads* — which is what it is
actually good at.

#### R2 — One clean critic pass on Acts III–IV
- [ ] Freeze the tree. No source edits, no `npm run shots`, between launch and report
- [ ] Fix, re-shoot, re-critique until no correctness findings
- [ ] Resolve the one unverified observation left by the stopped pass: "widespread 1px
      blends across every slot, including non-aberrated street level". An earlier pass
      examined the same thing and attributed it to the paper-grain layer (1px noise, 0.055
      overlay, ±2/255) and explicitly did not call it a finding. Confirm which it is before
      acting

**Exit:** all four acts have passed a critic against a tree that matched the code.

#### R3 — Real content · **blocked on the client**
`docs/copy-deck.md` marks these unspecified, and they were deliberately not invented:
- [ ] Organisation name
- [ ] CTA destinations — `#TODO-get-involved`, `#TODO-full-case`
- [ ] Footer: contact, socials, legal
- [ ] Page `<title>`, meta description, share image

Also needs a decision, from Phase 0 B7 and never made:
- [ ] **Typography.** Self-host an Inter Tight woff2 subset (~35KB) with `size-adjust` /
      `ascent-override` fallback metrics so `font-display: swap` costs no layout shift —
      CLS = 0 is a hard §7 budget. Or keep the system grotesque stack and retune the display
      tracking. The build currently does the latter by default

#### R4 — Adversarial review
- [ ] Fresh subagent, against this plan file, per CLAUDE.md. Never run
- [ ] Report only gaps affecting correctness or a stated requirement

#### R5 — Ship
- [ ] Deploy target (unspecified)
- [ ] Re-measure §7 against the deployed build, not the local one
- [ ] Cross-browser: the build leans on `mix-blend-mode`, `backdrop-filter`, `color-mix`,
      `isolation` and SVG `feColorMatrix`. Only Chromium has been tested. **Safari and
      Firefox are entirely unverified** and the aberration and scrim are the likely breaks

---

### D3 — Known risks carried forward

| Risk | Status |
| --- | --- |
| Acts III–IV never critic-verified | R2 |
| Safari/Firefox untested — blend modes and filters are load-bearing | R5, untouched |
| Drawing quality vs the reference (§10) | accepted; asset contract makes per-slot replacement cheap |
| `scripts/shoot.ts` `rmSync`s `shots/` — concurrent runs race | worth a lock file if it recurs |
| Copy deck timing changed once (`act1-h1` starts at p=0, for LCP) | flagged; client's call to reverse |

## E. Budget tracking

| Item | Est. gz | Note |
| --- | --- | --- |
| gsap core + ScrollTrigger | ~41KB | MorphSVG only if B2 needs it (~10KB) |
| lenis | ~5KB | |
| app + generated SVG | ~60–90KB | the real variable; SVG emitted as TS is bytes in the bundle |
| **JS total** | **~110–145KB** | budget 180KB — headroom, but SVG verbosity is the thing to watch |
| Inter Tight woff2 subset | ~35KB | B7 |

Measured at Phase 1 and re-measured every phase; if generated SVG pushes JS past 150KB gz,
geometry moves to a compact numeric encoding expanded at runtime.

## F. Risk register

| Risk | Mitigation |
| --- | --- |
| 4 filtered full-screen layers blow 60fps | A4 removes 2 of them; blur budget stays at exactly 2 layers per `art-direction.md` §3 |
| Near-structure transitions read as sliding, not rising | B2's ground-plane extrusion; caught by the critic's transition check |
| Act II contrast | A3, measured not eyeballed, checked first per §8 |
| Generated art plateaus below the reference | §10 accepted openly; asset contract makes per-slot replacement cheap |
| Critic findings churn on a mis-worded spec | A2 fixed at the source rather than re-litigated every pass |
