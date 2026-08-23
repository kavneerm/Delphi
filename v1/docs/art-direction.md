# Art direction

Reference document. Read before building any act; re-read the relevant act section before
each visual-critic pass.

---

## 1. The thesis, rendered in color

This is the most important idea in the document and every palette decision serves it:

> **Act II concentrates all saturation into two light sources. Act III distributes the
> same hues across hundreds of small ones.**

The identical cyan and magenta appear in both acts. In the Closed Frontier they belong to
two monoliths and everything human is gray. In the Open Frontier they are scattered
through windows, signs, gardens, and canals, and the gray is gone. Concentration versus
distribution, argued in light rather than in copy.

Do not introduce a new palette for Act III. Redistribute Act II's.

## 2. Fixed anchors

| Anchor | Value | Applies |
| --- | --- | --- |
| Horizon line | `58vh` | All acts, all scroll positions |
| Vanishing point | `50vw`, on the horizon | All acts |
| Road edge convergence | Both edges terminate exactly at the VP | Acts I, III, IV |
| Sun/celestial center | `50vw`, `y` varies by act | All acts |

The road in Act II is the only one that does **not** reach the vanishing point: it is
walled off part-way along. That occlusion is the point — the frontier is closed. Keep the
VP visible but unreachable.

**Depth convention, stated once because §2 and §5 previously implied opposite ends:** depth
`d` runs from the vanishing point (`d = 0`) toward the viewer (`d = 1`). Act II's wall sits
at `d = 0.5`. Reading "70% of the distance" from the viewer's end put the wall almost on top
of the camera and left the road occupying the bottom 8% of the frame.

## 3. Technique

### The register: chunky pixel art

**This governs everything below it.** The whole frame reads as chunky pixel art: hard
edges, flat colour fills, no gradient inside any object.

- **Chunk grid.** Every coordinate snaps to a multiple of `PIXEL`, ≈ `w / 200` — about 7px
  at 1440 wide, scaling with the viewport so the chunk reads at a constant size relative to
  the composition. Implemented in `src/acts/shared.ts`; `rect`, `poly`, `line` and `circle`
  all snap, so an act cannot opt out by accident.
- **No curves.** Circles are stacked chunk rows (`blockCircle`), diagonals are staircases
  of chunks. A true `<circle>` or `<line>` anti-aliases regardless of `shape-rendering`,
  and one smooth curve in a frame of hard edges is what reads as wrong.
- **Sub-chunk shapes do not exist.** A length rounds *up* to one chunk minimum; anything
  smaller would anti-alias into a grey smear.
- `shape-rendering="crispEdges"` on every layer `<svg>`.

The one permitted smooth gradient is the **sky** (slot 7), vertically. Nothing else.

*(Added at the client's direction, superseding the parts of this section it contradicts —
see the two amendments below.)*

### Cel shading
**Two to three tonal steps per surface, and no more.** Base, shadow, and optionally one
highlight. No gradients on objects, ever.

Gradients are permitted **only** in the slot 7 sky, as a smooth vertical ramp. Slot 6 haze
is a flat band with a hard edge.

*(Amended: haze was previously allowed a gradient. Under the pixel-art register it is a
flat band.)*

### Line
- Slots 2–3: stroke 1.5–2.5px, color = surface shadow tone darkened 20%, not black.
  Rounded up to a whole chunk, so an outline is one chunk wide rather than a hairline.
- Slots 4–5: no stroke
- Line weight never scales with zoom; it is a print artifact, not a 3D property

### Halftone
- Dot screen in shadow regions only, never in light
- **The dot is exactly one chunk**, square, chunk-aligned. Depth is carried by the *pitch*
  instead — 2 chunks at slot 1 widening to 4 at slot 5 — so distant slots read coarser
  while every dot still lands on the grid.

  *(Amended. The original "dot radius 1.5px at slot 1 scaling to 4px at slot 5" predates
  the pixel register and is entirely sub-chunk at PIXEL≈7. Implementing those radii
  literally violates the register; rounding them up to whole chunks made every dot ~5×
  its intended size and the screen swallowed the art. Moving the depth cue to the pitch
  satisfies both, and is how a dither works in pixel art.)*
- `mix-blend-mode: multiply`, opacity 0.12–0.25
- Implement as a repeating radial-gradient mask or a static SVG pattern fill. **Static.**

### Chromatic aberration
The signature move. Duplicate the slot, offset the red channel `+2px` x and the cyan
`−2px` x, composite. Apply to slots 4+ and, during fast scroll, slot 0.

Offset scales with scroll velocity: 0px at rest → 6px at peak, quantised to whole chunks so
the fringe lands on the grid like everything else.

Implement as **three stacked copies of the slot's SVG** — red-tinted, cyan-tinted, base —
composited with `mix-blend-mode: screen` and separated by `translate3d` only. The offset is
a transform, so it is compositor-only, never re-rasterizes, and responds continuously
rather than in steps.

Do **not** implement this as an SVG filter. `filter: url(#…)` on a full-screen layer is
CPU-rastered in Chromium and re-rasterizes on every change; with the two blur layers that
would put four filtered full-screen layers in the frame budget. Never tween filter
primitive values per frame under any implementation.

Implemented as **two** plates, not three: `feColorMatrix` keeps R on one and G+B on the
other, and screening them reconstructs the original exactly at zero offset. A third
untinted base copy would wash the fringe out under `screen`. The filters are static — set
once, never tweened — which is what the prohibition above is actually protecting.

*(Amended from the original "4 pre-baked filter definitions swapped at velocity
thresholds" — see `docs/plans/build.md` A4. The specified result is unchanged.)*

### On twos
Slot 0 updates at 12fps from its own accumulator. Everything else runs at display rate.
Cheap, and the single most reference-evocative detail in the build.

### Depth of field
**Removed.** Blur directly contradicts the hard-edge register — a blurred foreground over
chunky pixel art reads as a rendering error rather than as depth.

Depth is carried instead by what already carries it: the parallax rates, the aerial
perspective already stepping through slots 2→5, and chunk size. Distance can also be read
by drawing far slots on a coarser effective grid.

*(Amended: this section previously specified blur 4px on slot 0 and 6px on slot 6. Both are
gone. This also returns the two blurred full-screen layers to the frame budget, which is a
straight win against §7.)*

### What to avoid
Photoreal texture, ambient occlusion, soft shadows, bloom, lens flare, drop shadows on UI,
and any gradient on a solid object. Also: smooth curves, sub-chunk detail, anti-aliased
edges, and any object edge that does not land on the chunk grid.

The look is *printed*, not *rendered* — and *placed*, not *drawn*.

---

## 4. Act I — The Frontier (dawn)

**Feeling:** the moment before a decision. Open, warm, quiet, undetermined.

### Palette
| Role | Hex |
| --- | --- |
| Sky, zenith | `#1B2A4A` |
| Sky, upper | `#4A5B8C` |
| Sky, mid | `#C97B5A` |
| Sky, lower | `#F2A65A` |
| Sky, horizon | `#FFD9A0` |
| Sun core / rim | `#FFE8B0` / `#FF9E4F` |
| Far mesas (slot 5) | `#6B5B7B` |
| Mid ground (slot 4) | `#A87C5F` |
| Near desert | `#C89A6B` |
| Desert highlight band | `#D8AC7C` |
| Desert shadow step | `#7A5C4A` at 34% — renders `#AE845F` |
| Road surface | `#BC8F63` |
| Wheel ruts | `#A87C5F` at 45% |
| Town silhouette (slots 2–3) | `#3E2E2E` |
| Accent | `#FF5E3A` |
| Cast shadows | `#4A5B8C` at 40% multiply — renders `#876A51` over road |

Where a row gives an opacity, the *rendered* value is what a shot samples; the hex is the
source colour, not the expected sample. Rows without an opacity must sample literally, to
within ±1 per channel — a gradient stop landing on the horizon rasterises a channel low, so
`#FFD9A0` legitimately samples `#FFD89F` in the last unoccluded sky row.

### Composition
- **Slot 7:** five-stop vertical sky gradient. Sun disc centred on the horizon at the VP —
  `50vw / 58vh`, radius ≈ `9vh`, so the horizon bisects it and the upper half stands clear.
  *(Amended: the original said "tangent to the horizon" and then gave a centre on it, which
  cannot both hold. The numbers were kept.)* Sun sits *behind* the road, at the VP — this
  is what makes the open land read as destination rather than backdrop.
- **Slot 6:** warm haze band, `#FFD9A0` at 30%, `±6vh` around the horizon.
- **Slot 5:** three mesa silhouettes, staggered, tallest at 20vw and 80vw. Never
  occluding the VP.
- **Slot 4:** low scrub, distant fence line converging toward the VP.
- **Slots 3–2:** **three buildings**, at the same marks as Act IV — the loop is the same
  handful of structures at two different hours, not a town demolished between acts. False
  fronts, pitched roofs, porch awnings, roof furniture. Buildings are **silhouettes with lit
  window rectangles** in `#FFE8B0` — no interior detail. Perspective converging on the VP.

  *(Amended at the client's direction. This replaces "western town, buildings flanking both
  sides of the road … a water tower, a church spire at 32vw" — with three buildings those
  landmarks read as clutter and the spire has no street to stand on. What separates Act I
  from Act IV is now light, not density: see §7.)*
- **Slot 1:** near-foreground debris only. **The road surface, the wheel ruts, the ground
  plane and the town's cast shadows are drawn with the backdrop, not here.**

  Slot 1 paints in front of slots 2–5, so a full-width ground plane in it erases the town,
  the fence and the scrub — and anything converging on the VP has to be VP-registered
  anyway, which slot 1's drifting layer is not — and the ruts converge on the VP exactly as
  the road edges do, so they are VP-registered for the same reason. This applies to every
  act; see `docs/asset-contract.md` §3. The dirt road still converges on the VP with long
  westward shadows cast toward the viewer; only the layer it lives in has changed.
- **Slot 0:** two tumbleweeds crossing at different speeds, dust motes, three birds.
  On twos.

### The shot
Standing at the near end of the main street, looking down it. Town on both sides, road
running out past the last building into open land, sun rising exactly where the road
disappears. Nothing blocks the way out.

---

## 5. Act II — The Closed Frontier

**Feeling:** enclosure. Vertical, monumental, and only two things are alive.

### Palette
| Role | Hex |
| --- | --- |
| Sky, zenith | `#4A4A52` |
| Sky, mid | `#8A7A6A` (sodium smog) |
| Sky, horizon | `#B5A08A` |
| Monolith bodies | `#1A1D24` |
| Monolith windows | `#00E5FF`, `#FF2D95` |
| Slums | `#5A5A5E`, `#6E6E72`, `#4A4A4E` |
| Slum windows | `#8A8A80` — dim, never saturated |
| Blimp bodies | `#3A3A3E` |
| Blimp ad panels | `#FF2D95`, `#00E5FF` |
| Occluded sun | `#8A7A6A` — must render *brighter* than the sky at its own height |

Where a row gives an opacity, the rendered value is what a shot samples. Rows without one
sample literally, to within ±1 per channel. `#B5A08A` (Sky, horizon) is the exception: the
slot 6 haze specified below covers the entire horizon band, so it is never directly
samplable.

**Saturation rule, enforced strictly:** cyan and magenta appear *only* on the two
monoliths, the blimp ad panels, and the road's reflection of those two sources. Reflected
saturation must be visibly darker and lower in chroma than the source, and must be
traceable to a source above it. No emissive human-scale element is saturated — one warm
window in the slums destroys the argument.

*(Amended: the original read "only on the two monoliths and the blimp advertising, no
exceptions", which contradicted the wet-road reflection specified in slot 1 below. See
`docs/plans/build.md` A2.)*

### Composition
- **Slot 7:** flat, oppressive sky. Sun still at the VP but occluded to a dim disc,
  barely brighter than the smog. The gradient compresses toward the horizon: less sky.
- **Slot 6:** particulate haze, `#8A7A6A` at 45%, denser than Act I.
- **Slot 5:** the **two monoliths**, flanking the VP at 38vw and 62vw, rising past the
  top of the frame — no visible tops. Windows in a cold grid, cyan on one, magenta on the
  other. They are the brightest objects on screen.
- **Slot 4:** the wall closing the road at `d = 0.5` — see §2's depth convention.
  Continuous, no gate. The VP stays visible above it. **Slums further away than the wall are
  drawn in slot 4 with it, not in slots 2–3**, because those paint in front of slot 4 and a
  slum behind the wall would otherwise paint over the thing blocking the view of it.
- **Slots 3–2:** slums pressing in from both sides, accreted and irregular, leaning over
  the road, narrowing it. Antennas, tarps, pipework, stacked improvised floors. Where Act
  I's town had gaps between buildings, this has none.
- **Slot 1:** the road, now paved, wet, reflecting the monolith light in cyan and magenta
  streaks — the only saturation at ground level, and it is *reflected*, not owned.
- **Slot 0:** three blimps at different depths and speeds, drifting horizontally, ad
  panels in unfamiliar scripts. On twos. Ash falling.

### Foreign-script ad panels
Use **invented glyph forms** — original geometric constructions that read as writing
without being any real script. Do not use real text in any language. The point is
illegibility to the viewer standing in the street, not any particular nation.

### The shot
Same street, same viewpoint. The town has been built upward and inward. Two towers own
the sky, the road is walled, and the only color in the world belongs to whoever owns the
towers.

---

## 6. Act III — The Open Frontier

**Feeling:** density without enclosure. The same city scale, distributed.

### Palette
| Role | Hex |
| --- | --- |
| Sky, zenith | `#1E1B3A` |
| Sky, upper | `#3D2E5C` |
| Sky, mid | `#7A4A7E` |
| Sky, lower | `#E8825E` |
| Sky, horizon | `#FFC98C` |
| Tower bodies | `#2A2440` |
| Warm window light | `#FFD98A` |
| Retained cyan / magenta | `#00E5FF`, `#FF2D95` — **distributed** |
| Greenspace | `#3DA871`, `#6ECF9E`, shadow `#1F7A52` |
| Water, canals | `#4FC3D9` |
| Accent violet | `#C05EE8` |
| Music motes | `#FFE9A8` |

### Composition
- **Slot 7:** dusk gradient, full height — the sky is *back*, more of it than in Act II.
  Sun low at the VP, warm, unoccluded.
- **Slot 6:** clean warm haze, no particulate.
- **Slot 5:** **many towers, varied heights**, none dominant, none exceeding the frame.
  The tallest is shorter than Act II's monoliths. Rooftop gardens visible as green caps.
  Window light is warm with cyan/magenta scattered irregularly through it.
- **Slot 4:** the wall is gone. The road runs to the VP. Mid-rise buildings, terraced,
  planted.
- **Slots 3–2:** street level — trees along the road, a canal crossing at 40% depth,
  market stalls, awnings, a footbridge. Buildings have gaps, courtyards, and light
  between them.
- **Slot 1:** the road, unpaved center with planted margins. People at ground level in
  silhouette, small, several.
- **Slot 0:** **music motes** — warm glowing particles rising from street level, denser
  near the market, drifting up and fading. Leaves. Birds. On twos.

### On the music
Do not draw notation. Music renders as rising warm particles with a slight lateral drift,
emitted from two or three ground-level points. Notation would be literal and would look
like clip art.

### The shot
Same street, same viewpoint. The city is as dense as Act II, but you can see the sky, the
road reaches the horizon, there are people in it, and the light belongs to everyone.

---

## 7. Act IV — The Frontier Returns

**Feeling:** the decision unmade. Return, not resolution.

### Palette
Act I's palette, cooled: zenith `#16243F`, mid `#B86F52`, horizon `#F2A65A`. Slightly
bluer, slightly earlier. Pre-dawn rather than dawn.

### Composition
Act I's composition, with two changes:
1. The road is wider (`0.26` against Act I's `0.24`) and the open land beyond it occupies
   more of the frame.
2. No sun disc yet. Glow at the horizon, sun not risen — and fewer windows lit.

*(Amended: this list previously began "the town is sparser — two or three buildings, not a
full street". Since §4 was changed to give Act I those same three buildings at the same
marks, the two acts' town arrays are byte-identical and sparseness no longer distinguishes
them. What does is light: a cooled palette, no risen sun, fewer lit windows.)*

The loop must be recognizable as the same place, and it must read as *earlier* than Act
I, not later. The argument is that the choice is still open.

**Slot 0:** a single tumbleweed. One bird. Nothing else.

---

## 8. Typography

- Display: a grotesque with real weight range — Söhne, Neue Haas Grotesk, or Inter Tight
  as the free fallback. Tight tracking (`-0.02em`) at display sizes.
- Body: same family, `400`, `1.6` line height, max measure `62ch`.
- Copy sits in a fixed left column at `8vw` on desktop, full-width with a scrim on mobile.
- Copy color is constant across acts: `#F5F0E8` over a backdrop-blur scrim tinted with the
  act's darkest tone. Do not recolor copy per act — the scrim adapts, the text does not.
- **Scrim opacity is a solved value, not a fixed one.** Baseline 30%, raised per act to
  whatever clears 4.5:1 against the *worst-case* backdrop falling inside the copy column's
  bounds. Act II lands ≈65%: its column is pushed right, over the 62vw monolith, and 30%
  over a `#00E5FF` window measures 2.49:1. Verify with `npm run probe -- contrast`, never
  by eye. (See `docs/plans/build.md` A3.)
- Act headings reveal by word on `p` thresholds, not by time. Never scroll-jack.

## 9. Verification checklist

Per act, before declaring it done:

- [ ] Horizon at exactly 58vh, VP at 50vw, at every checkpoint
- [ ] All eight slots populated, correct relative parallax rates
- [ ] Palette matches this document (sample the shot; don't eyeball)
- [ ] Act II: zero saturated pixels outside the monoliths, the blimp panels, and the road
      reflections of those two sources
- [ ] Act III: cyan/magenta present but distributed across ≥20 sources
- [ ] Structures rise/sink at the horizon; nothing cross-dissolves. Scoped to slots 5–2:
      the sky (7), haze (6) and ground fills (1) cannot rise at a horizon they *are*, so
      they crossfade between two static layers. VP-locked geometry also crossfades — it
      can never be transformed. No structure ever uses opacity as its transition verb.
- [ ] Body copy ≥ 4.5:1 contrast wherever it is **fully revealed**, at every checkpoint
      including mid-transition. Mid-*reveal* a block and its scrim are both at partial
      opacity by design, so no pixel reaches `#F5F0E8` and the ratio is meaningless —
      measure the fully-revealed state, and measure the scrim composited over the backdrop
      (`probe contrast --scrim`), never the bare scene
- [ ] Reduced-motion render is complete and readable
