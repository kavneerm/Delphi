# Asset contract

Brief §10. Every depth slot accepts either the generated SVG or a drop-in replacement, and
the scroll engine addresses slots only through this contract. Illustrated art can replace
any single slot, in any single act, without touching the timeline, the progress store, or
any other slot.

The honest framing this exists to serve: what ships from the generator is strong flat
vector with a print-process finish. It is not hand-illustrated work. This contract is what
makes replacing it later cheap instead of a rewrite.

---

## 1. What a slot is

Eight slots exist permanently, in every act, for the life of the page. They are never
created or destroyed by a transition — an act is a *parameterisation* of the eight, and a
transition interpolates them slot by slot.

| Slot | Contents | Rate | Effects |
| --- | --- | --- | --- |
| 0 | Foreground props | 1.60× | blur 4px, on twos (12fps) |
| 1 | Near ground, road surface, shadows | 1.30× | halftone in shadow |
| 2 | Near structures | 1.15× | full line weight |
| 3 | Mid structures | 1.00× | full line weight |
| 4 | Far structures | 0.75× | aberration begins |
| 5 | Ridge / skyline | 0.50× | aberration, no outline |
| 6 | Atmospheric haze | 0.30× | blur 6px |
| 7 | Sky, sun, celestial | 0.10× | gradient only |

## 2. The interface

```ts
interface ActDefinition {
  id: string;
  name: string;
  build(geo: Geometry): readonly SlotArt[];   // exactly 8, index 0 = nearest
}

interface Geometry {
  w: number;        // stage width, CSS px
  h: number;        // stage height, CSS px
  horizon: number;  // = h * 0.58, absolute
  vp: number;       // = w * 0.50, absolute
  bleed: number;    // overdraw margin present on every layer
}

interface SlotArt {
  verb: 'rise' | 'extrude' | 'crossfade' | 'drift';
  clipBottom?: number;   // stage y; content below is clipped away. Static.
  travelPx?: number;     // rise distance; defaults to the drawn height
  free: string;          // markup for the drifting layer
  locked?: string;       // markup for the VP-registered layer
}
```

`build` must be a **pure function of `geo`**. It is called on first paint, on resize, and
once per act by the reduced-motion path. It must not read the clock, the scroll position,
or any module state.

## 3. The two layers, and why they are two

```
.slot
  .layer.drift[data-drift="free"]      ← lateral drift.  translate3d(x, 0, 0)
    .travel[data-travel="<verb>"]      ← transition travel. translate3d(dx, dy, 0)
      <svg>  … free markup …
  .layer.locked[data-vp-locked]        ← never transformed, ever
    <svg>  … locked markup …
```

**Anything whose geometry converges on, references, or terminates at the vanishing point
goes in `locked`.** Road edges, fence lines, building perspective lines, the sun disc.
Everything else goes in `free`.

This is not a convention that gets checked at review time — it is what makes the invariant
structural. The VP cannot move because nothing that defines it is ever given a transform.
There is no counter-translation keeping two things in sync, and therefore no way for them
to fall out of sync. `npm run check:invariant` asserts every `[data-vp-locked]` layer has
an identity transform at all 15 checkpoints × 3 viewports.

Drift and travel are separate elements for the same reason: each can be asserted alone.
`npm run check:parallax` requires every drift layer to have `Y = 0` always, and every
travel layer to be identity during a hold.

## 4. Coordinate space

There are two authoring paths. Generated art uses the first; drop-in illustration uses the
second.

### 4a. Generated art — stage pixels, responsive

SVG user units equal stage CSS pixels, 1:1. The engine emits

```
viewBox="-BLEED -BLEED (w + 2·BLEED) (h + 2·BLEED)"   preserveAspectRatio="none"
```

on a layer inset by `-BLEED` on all sides, so user unit `(x, y)` is stage pixel `(x, y)`
exactly. Write geometry against `geo`: a mesa at `0.2 * geo.w`, a sun of radius
`0.09 * geo.h` centred on `(geo.vp, geo.horizon)`.

Because it is a function of `geo`, the composition **reflows** at 390px rather than
cropping. `build` is re-run on resize.

### 4b. Drop-in illustration — fixed authoring space, anchor-locked

Illustrated art cannot reflow, so it declares a fixed authoring space instead:

```
viewBox="0 0 1000 1000"     horizon at y = 580     vanishing point at x = 500
```

The engine maps it with a uniform scale-to-cover and then translates so that
`(500, 580)` lands exactly on `(geo.vp, geo.horizon)`. Both anchors are therefore exact at
every viewport, and the crop falls at the edges of the frame.

Consequence, stated plainly: at 390×844 a cover-mapped 1000×1000 illustration shows about
46% of its authored width. Anything that must survive mobile belongs within
`x ∈ [270, 730]`. Art placed outside that band is decoration.

### 4c. Required anchor elements

A drop-in SVG must expose, at minimum:

```xml
<g data-drift="free"> … </g>
<g data-vp-locked>    … </g>   <!-- omit if the slot has no VP-registered geometry -->
```

and, if the slot uses `rise` or `extrude`, a documented `clipBottom` in the same
coordinate space as its `viewBox`.

## 5. Bleed

Every layer carries `BLEED_PX = 64` of overdraw on all four sides. A layer that drifts
laterally would otherwise expose the stage edge at the extremes of its sweep. Fill
geometry — sky, ground, haze — must extend into the bleed. Slot 0's total sweep is 48px at
1440w, so 64px clears it with margin.

## 6. Transition verbs

| Verb | Motion | Use for |
| --- | --- | --- |
| `rise` | translate Y, clipped at the horizon | slots 4–5. Structures emerge from and sink into the horizon. |
| `extrude` | translate Y, clipped at the structure's own base line | slots 2–3. A near building's base sits far below the horizon; sinking it into the horizon reads as sliding down a hole. |
| `crossfade` | opacity between two static layers | slots 6–7 and slot 1's fill only. **Never structures.** |
| `drift` | translate X, off canvas | slot 0 props. |

`rise` and `extrude` are the same transform. They differ only in where the static clip line
sits. Neither ever fades: a structure that fades instead of moving is the cross-dissolve
the brief forbids, and the visual-critic files it as a finding.

Per-slot stagger and easing are the engine's, not the art's — see `src/timeline.ts`.

## 7. What the engine guarantees to an asset

- `geo.horizon` and `geo.vp` are exact and never change during a session.
- `build` is called on first paint, on resize, and once per act in reduced-motion.
- Only `transform` and `opacity` are written per frame. Never `width`, `height`, `top`,
  `left`, or any layout property.
- Slot 0 is rendered at 12fps from a separate accumulator; everything else at display rate.
- Layers for acts outside the current one — plus the other end of an in-flight transition —
  are dropped from the DOM and rebuilt on demand.

## 8. What an asset must not do

- Animate anything. Art is static; the engine moves it.
- Reference `Date`, `Math.random`, scroll position, or module state inside `build`.
- Put VP-registered geometry in the `free` group.
- Bake copy into paths or images. All words live in real DOM text (brief §8).
- Use a gradient on a solid object. Gradients are permitted in slots 6 and 7 only
  (art-direction §3).
