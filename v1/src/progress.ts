import { cam, localT, segmentAt, type ActIndex, type Segment } from './timeline.ts';

export interface Frame {
  /** Master scroll progress, 0..1. The single value every slot subscribes to. */
  p: number;
  /** Weighted camera position, 0..1 (timeline.cam). */
  c: number;
  /** Normalised scroll speed, 0..1. Drives aberration offset. */
  velocity: number;
  /** Sign of travel: 1 forward, -1 backward, 0 at rest. Drives which act to prewarm. */
  direction: -1 | 0 | 1;
  segment: Segment;
  /** Dominant act — during a transition this is the one being left. */
  act: ActIndex;
  phase: 'hold' | 'transition';
  /** Local progress inside the current segment, 0..1. */
  t: number;
}

/** dp/ms treated as full speed. A hard flick moves the whole page in well under a second. */
const VELOCITY_REF = 0.0012;

const VELOCITY_SMOOTHING = 0.12;

type Listener = (frame: Readonly<Frame>) => void;

class ProgressStore {
  private readonly listeners = new Set<Listener>();
  private rawP = 0;
  private lastP = 0;
  private smoothedVelocity = 0;

  readonly frame: Frame = {
    p: 0,
    c: cam(0),
    velocity: 0,
    direction: 1,
    segment: segmentAt(0),
    act: 0,
    phase: 'hold',
    t: 0,
  };

  /** Called by the single ScrollTrigger. Does no work beyond storing the value. */
  setP(p: number): void {
    this.rawP = Math.min(Math.max(p, 0), 1);
  }

  /** Called once per frame from the single write pass, before anything reads `frame`. */
  tick(deltaMs: number): void {
    const f = this.frame;
    f.p = this.rawP;
    f.c = cam(f.p);

    const dt = Math.max(deltaMs, 1);
    const delta = f.p - this.lastP;
    // Held through the still frames between wheel ticks: a reader who pauses has not
    // changed their mind about which way they are going, and flipping the prewarm target
    // on every micro-pause would thrash the very work it exists to get ahead of.
    if (delta > 0) f.direction = 1;
    else if (delta < 0) f.direction = -1;
    const instant = Math.abs(delta) / dt / VELOCITY_REF;
    this.lastP = f.p;
    this.smoothedVelocity +=
      (Math.min(instant, 1) - this.smoothedVelocity) * VELOCITY_SMOOTHING;
    f.velocity = this.smoothedVelocity;

    const segment = segmentAt(f.p);
    f.segment = segment;
    f.t = localT(segment, f.p);
    f.phase = segment.kind === 'hold' ? 'hold' : 'transition';
    f.act = segment.kind === 'hold' ? segment.act : segment.from;

    for (const listener of this.listeners) listener(f);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const progress = new ProgressStore();

/** Acts whose geometry must be *visible*: the current one plus a transition's other end. */
export function residentActs(frame: Readonly<Frame>): ActIndex[] {
  if (frame.segment.kind === 'transition') {
    return [frame.segment.from, frame.segment.to];
  }
  return [frame.segment.act];
}

/**
 * Acts whose layers must *exist*, which is a longer list than the ones that must be seen.
 *
 * The raster is amortised at roughly one unit per frame and an act is ~16 units, so a
 * transition entered cold needs ~16 frames before it is fully built. A hard flick crosses a
 * transition in fewer than that, and the reader sees slots arriving late — which is the
 * seam this exists to remove. Worse, the first slot's window opens at `t = 0`, the same
 * frame the act becomes resident, so even an unhurried scroll is one frame short.
 *
 * During a hold the write pass is ~0.1ms, so the frames are there for free. This claims the
 * next act in the direction of travel and builds it then. Only one act ahead, and only
 * during a hold: residency stays bounded at three acts rather than four (build.md B5 is
 * about not holding everything, not about holding the minimum).
 *
 * Ordered so callers can treat it as a priority list — what must be seen now comes first.
 */
export function prewarmActs(frame: Readonly<Frame>): ActIndex[] {
  const resident = residentActs(frame);
  const out: ActIndex[] = [...resident];

  // Two acts ahead during a hold, one during a transition — unconditionally.
  //
  // This was gated on `frame.velocity > 0.35` to spend the effort only on a flicking reader.
  // Measured, that threshold was never reached: a hard flick from the top of the page peaked
  // at **0.263 smoothed velocity, 0 frames of 188 above 0.35**, so the whole mechanism was
  // dead code. Velocity is the wrong signal anyway — it is smoothed at 0.12/frame, and a
  // *sustained* scroll therefore reads faster than a flick, which Lenis eases out before the
  // average catches up. It would have widened the budget for exactly the reader who did not
  // need it.
  //
  // Prewarming is cheap (a hold spends ~0.1ms/frame) and idempotent, so doing it always is
  // simpler than doing it cleverly.
  const lookahead = frame.segment.kind === 'hold' ? 2 : 1;
  const step = frame.direction === -1 ? -1 : 1;
  let edge = step === 1 ? Math.max(...resident) : Math.min(...resident);
  for (let i = 0; i < lookahead; i++) {
    edge += step;
    if (edge < 0 || edge > 3) break;
    const act = edge as ActIndex;
    if (!out.includes(act)) out.push(act);
  }
  return out;
}
