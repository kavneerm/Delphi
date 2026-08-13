import { STAGGER_ORDER, STAGGER_STEP } from './config.ts';

export type ActIndex = 0 | 1 | 2 | 3;

export interface HoldSegment {
  readonly kind: 'hold';
  readonly act: ActIndex;
  readonly a: number;
  readonly b: number;
}

export interface TransitionSegment {
  readonly kind: 'transition';
  readonly from: ActIndex;
  readonly to: ActIndex;
  readonly a: number;
  readonly b: number;
}

export type Segment = HoldSegment | TransitionSegment;

/** Brief §5. Contiguous, no gaps. */
export const SEGMENTS: readonly Segment[] = [
  { kind: 'hold', act: 0, a: 0.0, b: 0.12 },
  { kind: 'transition', from: 0, to: 1, a: 0.12, b: 0.25 },
  { kind: 'hold', act: 1, a: 0.25, b: 0.4 },
  { kind: 'transition', from: 1, to: 2, a: 0.4, b: 0.53 },
  { kind: 'hold', act: 2, a: 0.53, b: 0.68 },
  { kind: 'transition', from: 2, to: 3, a: 0.68, b: 0.8 },
  { kind: 'hold', act: 3, a: 0.8, b: 1.0 },
];

export const ACT_HOLD_P: readonly number[] = SEGMENTS.filter(
  (s): s is HoldSegment => s.kind === 'hold',
).map((s) => (s.a + s.b) / 2);

export function segmentAt(p: number): Segment {
  const clamped = Math.min(Math.max(p, 0), 1);
  for (const s of SEGMENTS) {
    if (clamped < s.b) return s;
  }
  return SEGMENTS[SEGMENTS.length - 1] as Segment;
}

/** Local progress within a segment, 0..1. */
export function localT(segment: Segment, p: number): number {
  const span = segment.b - segment.a;
  if (span <= 0) return 0;
  return Math.min(Math.max((p - segment.a) / span, 0), 1);
}

/**
 * Camera position, 0..1 — a monotonic remap of `p` that spends proportionally more of
 * its travel inside transitions (build.md A1.4). Holds carry weight 1, transitions 3, so
 * the 38% of the page that is transition accounts for 65% of the lateral sweep. This is
 * what makes the slot rates legible at p = 0.18 / 0.46 / 0.74.
 */
const HOLD_WEIGHT = 1;
const TRANSITION_WEIGHT = 3;

function segmentWeight(s: Segment): number {
  return s.kind === 'hold' ? HOLD_WEIGHT : TRANSITION_WEIGHT;
}

const TOTAL_WEIGHTED_LENGTH = SEGMENTS.reduce(
  (sum, s) => sum + (s.b - s.a) * segmentWeight(s),
  0,
);

export function cam(p: number): number {
  const clamped = Math.min(Math.max(p, 0), 1);
  let acc = 0;
  for (const s of SEGMENTS) {
    const w = segmentWeight(s);
    if (clamped >= s.b) {
      acc += (s.b - s.a) * w;
      continue;
    }
    acc += (clamped - s.a) * w;
    break;
  }
  return acc / TOTAL_WEIGHTED_LENGTH;
}

/**
 * Per-slot window inside a transition. Slot `slot` starts at its stagger offset and
 * finishes 0.52 later, so the eight slots never arrive together (which would read as a
 * cut, brief §3).
 */
export function slotWindow(slot: number): { start: number; end: number } {
  const rank = STAGGER_ORDER.indexOf(slot as (typeof STAGGER_ORDER)[number]);
  const start = (rank < 0 ? 0 : rank) * STAGGER_STEP;
  const span = 1 - STAGGER_STEP * (STAGGER_ORDER.length - 1);
  return { start, end: start + span };
}

export function slotProgress(slot: number, t: number): number {
  const { start, end } = slotWindow(slot);
  if (end <= start) return t >= end ? 1 : 0;
  return Math.min(Math.max((t - start) / (end - start), 0), 1);
}

/** Easing varied per slot so the eight do not share a motion signature (brief §3). */
export function slotEase(slot: number, x: number): number {
  switch (slot) {
    case 7:
    case 6:
      return x * x * (3 - 2 * x); // smoothstep — atmosphere settles gently
    case 5:
    case 4:
      return 1 - Math.pow(1 - x, 3); // out-cubic — distant mass decelerates into place
    case 3:
    case 2:
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; // in-out-cubic
    case 1:
      return 1 - Math.pow(1 - x, 4); // out-quart — ground arrives last and hard
    default:
      return x; // slot 0 props drift linearly off-canvas
  }
}
