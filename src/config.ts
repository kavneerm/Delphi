/**
 * Constants shared by the runtime and the verification scripts.
 * Nothing in here is allowed to vary at runtime except through viewport size.
 */

/** The one structural invariant. Both anchors are fractions of the stage box. */
export const HORIZON_FRAC = 0.58;
export const VP_FRAC = 0.5;

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

/** Overdraw on every layer so a drifting layer never exposes a stage edge. */
export const BLEED_PX = 64;

/** Slot 0 runs on twos: 12fps from its own accumulator. */
export const TWOS_FPS = 12;
export const TWOS_MS = 1000 / TWOS_FPS;

/** Scroll container height, in viewport heights. */
export const SCROLL_VH = 700;

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
