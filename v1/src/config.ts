/**
 * Constants shared by the runtime and the verification scripts.
 * Nothing in here is allowed to vary at runtime except through viewport size.
 */

/** The one structural invariant. Both anchors are fractions of the stage box. */
export const HORIZON_FRAC = 0.58;
export const VP_FRAC = 0.5;

/**
 * Art-pixel scale: one art pixel is this many CSS pixels.
 *
 * 3 divides all three test viewports exactly (1440→480, 768→256, 390→130), which matters
 * because a non-integer upscale resamples, and softness is the one thing pixel art cannot
 * survive. It is also what makes `image-rendering: pixelated` produce *even* cells — a
 * fractional scale hard-edges but leaves art pixels alternately 3 and 4 device px wide,
 * which reads as a wobbling grid.
 */
export const ART_SCALE = 3;

/**
 * The anchors, in whole CSS pixels.
 *
 * Rounding to a whole pixel is what lets the art register to the anchor exactly: at
 * 390x844 the ideal horizon is 489.52, and no pixel boundary exists there. The deviation
 * is at most half a pixel, and `check:invariant` asserts that separately — see the note
 * on the invariant below.
 */
export function horizonPx(h: number): number {
  return Math.round(h * HORIZON_FRAC);
}

export function vpPx(w: number): number {
  return Math.round(w * VP_FRAC);
}

/**
 * Where an art buffer's origin sits on one axis, so the anchor lands exactly on a cell
 * boundary rather than mid-cell.
 *
 * Returns the smallest overdraw >= BLEED_PX for which `(anchor + origin)` divides by
 * ART_SCALE. Only the buffer sees this; `Geometry.bleed` stays a single scalar and acts
 * are never asked to reason about it. The alternative — quantising the anchor itself to a
 * multiple of ART_SCALE — costs up to 1.5px of anchor error, three times worse.
 */
export function bufferOriginFor(anchorPx: number): number {
  const remainder = (((anchorPx + BLEED_PX) % ART_SCALE) + ART_SCALE) % ART_SCALE;
  return BLEED_PX + ((ART_SCALE - remainder) % ART_SCALE);
}

/**
 * Snap a transform to a whole *device* pixel.
 *
 * Device, not art, pixel. An integer-device-px translate shifts a rastered layer without
 * resampling it, so edges stay hard. Snapping to ART_SCALE instead would be destructive:
 * slot 7's entire drift sweep across the page is 3.0px at 1440 and 0.8px at 390, so a 3px
 * quantum turns it into a single jump, or deletes it outright.
 *
 * `dpr` is passed rather than read from `window`, because the verification scripts import
 * this module under node and must compute the identical value.
 */
export function roundToDevicePx(value: number, dpr: number): number {
  const scale = dpr > 0 ? dpr : 1;
  return Math.round(value * scale) / scale;
}

/** Depth slots, index 0 = nearest the viewer. */
export const SLOT_COUNT = 8;

/** Parallax rates from the brief §3. Used for lateral drift and slot-0 prop speed only. */
export const SLOT_RATES = [1.6, 1.3, 1.15, 1.0, 0.75, 0.5, 0.3, 0.1] as const;

export const SLOT_NAMES = [
  'props',
  'ground',
  'near',
  'mid',
  'far',
  'ridge',
  'haze',
  'sky',
] as const;

/**
 * Lateral drift amplitude at a 1440px-wide viewport, scaled linearly with width.
 * Total sweep for a slot across the whole page is `rate * DRIFT_BASE_PX`.
 */
export const DRIFT_BASE_PX = 30;
export const DRIFT_REFERENCE_WIDTH = 1440;

/**
 * Overdraw on every layer so a drifting layer never exposes a stage edge.
 *
 * 66 rather than 64: it must clear the widest drift (slot 0 sweeps 48px, so ±24px) and be
 * a multiple of ART_SCALE, so that in the common case `bufferOriginFor` returns exactly
 * this and the buffer needs no extra margin at all.
 */
export const BLEED_PX = 66;

/** Slot 0 runs on twos: 12fps from its own accumulator. */
export const TWOS_FPS = 12;
export const TWOS_MS = 1000 / TWOS_FPS;

/**
 * Scroll container height, in viewport heights — how much scrolling the whole piece costs.
 *
 * Note the container is not the travel. The stage is `position: sticky` at `100vh`, so the
 * distance a reader's wheel actually covers is `(SCROLL_VH/100 - 1) x h`, one viewport
 * height less than the container. At 1440x900 that is **2880px**, roughly 29 wheel ticks
 * for the four acts, and each act transition (Δp = 0.13 / 0.13 / 0.12) gets 374 / 374 /
 * 346px — about 41vh apiece. `check:pace` reads the travel off `scrollHeight` rather than
 * trusting this comment.
 *
 * Getting that distinction wrong overstates every derived figure by 4.2/3.2, and it is easy
 * to do: the container height is the number written into CSS, and the travel is the number
 * the reader feels.
 *
 * This is the *only* knob for traversal distance. Lenis' `wheelMultiplier` changes the same
 * quantity — progress per tick — and turning both compounds into a number neither of them
 * describes, so it stays at its default. See docs/plans/pacing.md §1.
 */
export const SCROLL_VH = 420;

/**
 * Lenis smoothing time constant, seconds — how long the view takes to catch up to input.
 *
 * Orthogonal to SCROLL_VH: that one sets how far you must scroll, this one sets how much
 * lag you feel while doing it. Lenis' own default is 1.2, which reads as sluggish here.
 */
export const SCROLL_SMOOTH_S = 0.65;

/** Per-slot stagger through a transition, as a fraction of *normalized* transition
 *  progress (build.md B4). 8 slots x 0.06 = 0.48, leaving 0.52 for each slot to travel. */
export const STAGGER_STEP = 0.06;

/** Order slots enter/leave a transition: sky first, far-to-near, ground last, props drift. */
export const STAGGER_ORDER = [7, 6, 5, 4, 3, 2, 1, 0] as const;

/** Screenshot checkpoints, brief §6. */
export const CHECKPOINTS = [
  0.0, 0.06, 0.12, 0.18, 0.25, 0.32, 0.4, 0.46, 0.53, 0.6, 0.68, 0.74, 0.8, 0.9, 1.0,
] as const;

export interface Viewport {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

export const VIEWPORTS: readonly Viewport[] = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
];

export function driftAmplitude(viewportWidth: number): number {
  return (DRIFT_BASE_PX * viewportWidth) / DRIFT_REFERENCE_WIDTH;
}
