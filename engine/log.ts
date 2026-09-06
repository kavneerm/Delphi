/**
 * The event log.
 *
 * Append-only and ordered by scenario time. It is the one record of what happened: the UI
 * moves sprites from it, the observation builder reads a seat's view of the world from it,
 * and the storm layer reads which effects are active from it. Nothing else holds state
 * about the past.
 */

import type { Effect, Event, SeatId } from './types.ts';

type EffectStarted = Extract<Event, { type: 'effect_started' }>;

export class Log {
  private readonly events: Event[] = [];

  push(e: Event): Event {
    // Keep time order even if a caller back-dates an event (the setup prompt goes in at
    // t=0 after scripted events already exist).
    let i = this.events.length;
    while (i > 0 && this.events[i - 1]!.t > e.t) i--;
    this.events.splice(i, 0, e);
    return e;
  }

  all(): readonly Event[] {
    return this.events;
  }

  since(t: number): Event[] {
    return this.events.filter((e) => e.t >= t);
  }

  last(n: number): Event[] {
    return this.events.slice(-n);
  }

  ofType<T extends Event['type']>(type: T): Extract<Event, { type: T }>[] {
    return this.events.filter((e): e is Extract<Event, { type: T }> => e.type === type);
  }

  /** Effects that have started and not ended (or expired) as of scenario minute `t`. */
  activeEffects(t: number, effect?: Effect): EffectStarted[] {
    const ended = new Set(
      this.ofType('effect_ended').filter((e) => e.t <= t).map((e) => `${e.effect}@${e.source}`),
    );
    return this.ofType('effect_started').filter(
      (e) =>
        e.t <= t &&
        (e.until === undefined || e.until > t) &&
        !ended.has(`${e.effect}@${e.source}`) &&
        (effect === undefined || e.effect === effect),
    );
  }

  /**
   * Events a seat was party to: named in them, addressed by them, or global. This is the
   * seat's memory, not the world's — a Northern Fleet jam does not appear here for Norway
   * until something exposes it.
   */
  forSeat(seat: SeatId): Event[] {
    return this.events.filter((e) => {
      switch (e.type) {
        case 'order_result': case 'decision': case 'release_requested': case 'effect_started':
          return e.seat === seat;
        case 'release_granted': case 'release_denied':
          return e.by === seat || e.for === seat;
        case 'recommendation':
          return e.seat === seat || e.to === seat;
        case 'exposed':
          return e.to === 'all' || e.to.includes(seat);
        case 'inject':
          return !e.to || e.to.includes(seat);
        case 'severity': case 'state_change': case 'effect_ended':
          return true;
      }
    });
  }
}
