import { cam, localT, segmentAt, type ActIndex, type Segment } from './timeline.ts';

export interface Frame {
  /** Master scroll progress, 0..1. The single value every slot subscribes to. */
  p: number;
  /** Weighted camera position, 0..1 (timeline.cam). */
  c: number;
  /** Normalised scroll speed, 0..1. Drives aberration offset. */
  velocity: number;
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
    const instant = Math.abs(f.p - this.lastP) / dt / VELOCITY_REF;
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

/** Acts whose geometry must be resident: the current one plus a transition's other end. */
export function residentActs(frame: Readonly<Frame>): ActIndex[] {
  if (frame.segment.kind === 'transition') {
    return [frame.segment.from, frame.segment.to];
  }
  return [frame.segment.act];
}
