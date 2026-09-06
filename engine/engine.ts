/**
 * The Engine: the one public surface.
 *
 *   order(o)        a seat issues an order → gated → logged → applied if allowed
 *   grant/deny      a releasing seat answers a pending request
 *   tick(t)         advance scenario time; poll every seat whose decision clock is due
 *   observe(seat)   what that seat can see — its input to the model, never the whole world
 *   attach(seat, m) put a model behind a seat: Null, Human, or Remote
 *
 * The engine owns three things and nothing else: the log, the per-asset runtime state, and
 * the clock. The catalog is immutable once loaded; the gate is a pure function of catalog,
 * storm and order. Everything the UI shows comes from the log.
 *
 * No DOM, no fetch of its own, no timers. The same file runs in the page today and in a
 * Lambda when there is one.
 */

import { Catalog } from './catalog.ts';
import { legal } from './gate.ts';
import { distanceKm } from './geo.ts';
import { Log } from './log.ts';
import { HumanModel, NullModel } from './model.ts';
import { Storm, freshState } from './storm.ts';
import type {
  ActionId, Area, Asset, AssetState, CatalogRaw, Decision, DecisionRequest, Effect,
  Event, Observation, Order, PersonaModel, SeatId, Severity, Spec, Verdict,
} from './types.ts';

export interface EngineOptions {
  /** T+0 as minutes after midnight Z. The scenario opens at 14:00Z. */
  t0Minutes?: number;
  severity?: Severity;
}

/** How long an effect runs if the order does not say. Scenario minutes. */
const EFFECT_DURATION: Partial<Record<Effect, number>> = {
  jam_gnss: 120, jam_satcom_uplink: 120, jam_satcom_downlink: 120,
  dazzle_eo: 30, cyber_ground: 600, rpo_inspect: 720, cable_interfere: 1440,
};

/** Which of a platform's effects an action switches on. */
const EFFECT_OF_ACTION: Partial<Record<ActionId, Effect[]>> = {
  jam: ['jam_gnss', 'jam_satcom_uplink', 'jam_satcom_downlink'],
  dazzle: ['dazzle_eo'],
  ground_cyber: ['cyber_ground'],
  counter_rpo: ['rpo_inspect'],
};

interface PendingRelease { order: Order; verdict: Extract<Verdict, { kind: 'pending' }> }

export class Engine {
  readonly catalog: Catalog;
  readonly log = new Log();
  readonly storm: Storm;
  readonly t0Minutes: number;
  t = 0;

  private readonly state = new Map<string, AssetState>();
  private readonly models = new Map<SeatId, PersonaModel>();
  private readonly history = new Map<SeatId, Decision[]>();
  private readonly lastPoll = new Map<SeatId, number>();
  private readonly inFlight = new Set<SeatId>();
  private readonly pending = new Map<string, PendingRelease>();
  private readonly posture = new Map<SeatId, DecisionRequest['posture']>();

  constructor(raw: CatalogRaw, specs: Spec[], opts: EngineOptions = {}) {
    this.catalog = new Catalog(raw, specs);
    this.storm = new Storm(this.catalog, this.log, this.state);
    this.t0Minutes = opts.t0Minutes ?? 14 * 60;
    this.storm.severity = opts.severity ?? 'G4';
    for (const seat of this.catalog.specs.keys()) this.models.set(seat, new NullModel());
  }

  // ---------------------------------------------------------------- seats and models

  attach(seat: SeatId, model: PersonaModel): void {
    this.models.set(seat, model);
  }

  model(seat: SeatId): PersonaModel | undefined {
    return this.models.get(seat);
  }

  setPosture(seat: SeatId, p: DecisionRequest['posture']): void {
    this.posture.set(seat, p);
  }

  setSeverity(severity: Severity): void {
    if (this.storm.severity === severity) return;
    this.storm.severity = severity;
    this.log.push({ t: this.t, type: 'severity', severity });
  }

  // ---------------------------------------------------------------- orders

  /** Gate an order, record the verdict, and if it stands, make it so. */
  order(order: Order): Verdict {
    return this.judge(order, null);
  }

  private judge(order: Order, decision: Decision | null): Verdict {
    const verdict = legal({ catalog: this.catalog, storm: this.storm, t: this.t, t0Minutes: this.t0Minutes }, order);
    if (decision) this.log.push({ t: this.t, type: 'decision', seat: order.seat, decision, verdict });
    else this.log.push({ t: this.t, type: 'order_result', seat: order.seat, order, verdict });

    switch (verdict.kind) {
      case 'allow':
        this.apply(order, verdict.asset);
        break;
      case 'pending':
        this.pending.set(`${order.seat}:${order.action}`, { order, verdict });
        this.log.push({
          t: this.t, type: 'release_requested', seat: order.seat, action: order.action,
          release_by: verdict.release_by,
          ...(verdict.asset ? { asset: verdict.asset } : {}),
          ...(order.target_id ? { target: order.target_id } : {}),
        });
        // A releasing seat woken by a request decides on its own clock, not the requester's.
        this.wake(verdict.release_by);
        break;
      case 'recommend':
        this.log.push({
          t: this.t, type: 'recommendation', seat: order.seat, to: verdict.to, action: order.action,
          ...(order.target_id ? { target: order.target_id } : {}),
          ...(order.text ? { text: order.text } : {}),
        });
        this.wake(verdict.to);
        break;
      case 'reject':
        break;
    }
    return verdict;
  }

  /** The releasing seat says yes. The held order is applied as if it had been allowed. */
  grant(by: SeatId, forSeat: SeatId, action: ActionId): Verdict {
    const key = `${forSeat}:${action}`;
    const held = this.pending.get(key);
    if (!held) return { kind: 'reject', because: 'target', reason: `nothing pending from ${forSeat} for ${action}` };
    if (held.verdict.release_by !== by) {
      return { kind: 'reject', because: 'spec', reason: `${by} cannot release ${action} for ${forSeat}; that is ${held.verdict.release_by}'s` };
    }
    this.pending.delete(key);
    this.log.push({ t: this.t, type: 'release_granted', by, for: forSeat, action });
    this.apply(held.order, held.verdict.asset);
    const v: Verdict = { kind: 'allow', asset: held.verdict.asset, reason: `released by ${by}` };
    this.log.push({ t: this.t, type: 'order_result', seat: forSeat, order: held.order, verdict: v });
    return v;
  }

  deny(by: SeatId, forSeat: SeatId, action: ActionId, reason?: string): void {
    const key = `${forSeat}:${action}`;
    const held = this.pending.get(key);
    if (!held || held.verdict.release_by !== by) return;
    this.pending.delete(key);
    this.log.push({ t: this.t, type: 'release_denied', by, for: forSeat, action, ...(reason ? { reason } : {}) });
  }

  pendingReleases(): PendingRelease[] {
    return [...this.pending.values()];
  }

  /**
   * What an allowed order does to the world. Only the actions with a physical consequence
   * do anything here; a démarche is its own record. Effects run for a default duration
   * unless the order carries one, and end themselves through the log.
   */
  private apply(order: Order, assetId: string | null): void {
    const platform = assetId ? this.catalog.byId.get(assetId) : undefined;
    const effects = EFFECT_OF_ACTION[order.action];

    if (effects && platform) {
      const effect = effects.find((e) => platform.effects.includes(e));
      if (effect) {
        this.startEffect(order.seat, effect, platform.id, order.target_id, order.area);
        if (effect === 'cyber_ground' && order.target_id) this.markDown(order.target_id);
      }
    }

    if (order.action === 'board_vessel' && order.target_id && platform) {
      // A boarding puts the vessel on everyone's plot: AIS or not, it has been seen.
      this.expose(order.target_id, 'all', platform.id);
    }

    if (order.action === 'task_imagery_pass' && order.area) {
      // A pass over an area shows the tasking seat what is in it.
      for (const a of this.catalog.assets) {
        if (a.pos && a.owner !== order.seat && distanceKm(a.pos, order.area) <= order.area.radius_km) {
          this.expose(a.id, [order.seat], platform?.id);
        }
      }
    }

    if (platform) {
      this.storm.stateOf(platform.id).last_order = { t: this.t, action: order.action, by: order.seat };
    }
  }

  // ---------------------------------------------------------------- world state

  startEffect(seat: SeatId, effect: Effect, source: string, target?: string, area?: Area, minutes?: number): void {
    const until = this.t + (minutes ?? EFFECT_DURATION[effect] ?? 60);
    this.log.push({
      t: this.t, type: 'effect_started', seat, effect, source, until,
      ...(target ? { target } : {}), ...(area ? { area } : {}),
    });
  }

  endEffect(effect: Effect, source: string): void {
    this.log.push({ t: this.t, type: 'effect_ended', effect, source });
  }

  markDown(id: string): void {
    this.change(id, { down: true });
  }

  restore(id: string): void {
    this.change(id, { down: false, safe_mode: false });
  }

  safeMode(id: string): void {
    this.change(id, { safe_mode: true });
  }

  setAirborne(id: string, airborne: boolean): void {
    this.change(id, { airborne });
  }

  expose(id: string, to: SeatId[] | 'all', by?: string): void {
    const s = this.storm.stateOf(id);
    if (to === 'all') s.exposed_to = [...this.catalog.specs.keys()];
    else s.exposed_to = [...new Set([...s.exposed_to, ...to])];
    this.log.push({ t: this.t, type: 'exposed', asset: id, to, ...(by ? { by } : {}) });
  }

  private change(id: string, changes: Partial<AssetState>): void {
    this.catalog.asset(id);                                    // throws on a bad id
    Object.assign(this.storm.stateOf(id), changes);
    this.log.push({ t: this.t, type: 'state_change', asset: id, changes });
  }

  stateOf(id: string): AssetState {
    return this.storm.stateOf(id);
  }

  /** A scripted event the scenario throws at some or all seats. Wakes those who listen. */
  inject(text: string, to?: SeatId[]): void {
    this.log.push({ t: this.t, type: 'inject', text, ...(to ? { to } : {}) });
    for (const seat of to ?? [...this.catalog.specs.keys()]) {
      if (this.catalog.specs.get(seat)?.decision_clock.wake_on_inject) this.wake(seat);
    }
  }

  private wake(seat: SeatId): void {
    this.lastPoll.set(seat, Number.NEGATIVE_INFINITY);
  }

  // ---------------------------------------------------------------- observation

  /** The seat's view: what it controls, what it can see, what it has heard. */
  observe(seat: SeatId): Observation {
    const spec = this.catalog.specs.get(seat);
    const clearance = spec?.information.clearance;
    const own = new Map<string, Asset>();
    for (const a of [...this.catalog.controlled(seat), ...this.catalog.owned(seat)]) own.set(a.id, a);

    const visible = (a: Asset): boolean => {
      if (own.has(a.id)) return false;
      if (a.classified && clearance !== 'ts_sci') return false;
      if (a.hidden && !this.storm.stateOf(a.id).exposed_to.includes(seat)) return false;
      return true;
    };

    return {
      t: this.t,
      severity: this.storm.severity,
      own_assets: [...own.values()].map((a) => ({
        id: a.id, name: a.name, kind: a.kind,
        comms: this.storm.comms(a, this.t), down: this.storm.isDown(a),
        ...(a.pos ? { pos: a.pos } : {}),
      })),
      contacts: this.catalog.assets.filter(visible).map((a) => ({
        id: a.id, name: a.name, kind: a.kind, owner: a.owner, ...(a.pos ? { pos: a.pos } : {}),
      })),
      feeds: spec?.information.feeds ?? [],
      recent: this.log.forSeat(seat).slice(-40),
    };
  }

  // ---------------------------------------------------------------- time

  /**
   * Advance to scenario minute `t` and poll every seat whose clock is due. Human seats are
   * never polled — they act through order() when they choose to. Returns the verdicts of
   * the decisions made this tick, in seat order.
   */
  async tick(t: number): Promise<Array<{ seat: SeatId; decision: Decision; verdict: Verdict }>> {
    this.t = Math.max(this.t, t);
    this.expireEffects();
    const out: Array<{ seat: SeatId; decision: Decision; verdict: Verdict }> = [];

    for (const [seat, spec] of this.catalog.specs) {
      const model = this.models.get(seat);
      if (!model || model instanceof HumanModel || this.inFlight.has(seat)) continue;
      const last = this.lastPoll.get(seat) ?? Number.NEGATIVE_INFINITY;
      if (this.t - last < spec.decision_clock.poll_minutes) continue;

      this.lastPoll.set(seat, this.t);
      this.inFlight.add(seat);
      try {
        const req: DecisionRequest = {
          seat, spec, posture: this.posture.get(seat) ?? 'Balanced',
          observation: this.observe(seat), history: this.history.get(seat) ?? [],
        };
        const decision = await model.decide(req);
        (this.history.get(seat) ?? this.history.set(seat, []).get(seat)!).push(decision);
        const order: Order = {
          seat, action: decision.action,
          ...(decision.params.asset_id ? { asset_id: decision.params.asset_id } : {}),
          ...(decision.params.target_id ? { target_id: decision.params.target_id } : {}),
          ...(decision.params.area ? { area: decision.params.area } : {}),
          ...(decision.text ? { text: decision.text } : {}),
        };
        out.push({ seat, decision, verdict: this.judge(order, decision) });
      } finally {
        this.inFlight.delete(seat);
      }
    }
    return out;
  }

  private expireEffects(): void {
    for (const e of this.log.ofType('effect_started')) {
      if (e.until !== undefined && e.until <= this.t) {
        const alreadyEnded = this.log.ofType('effect_ended').some((x) => x.effect === e.effect && x.source === e.source && x.t >= e.t);
        if (!alreadyEnded) this.log.push({ t: e.until, type: 'effect_ended', effect: e.effect, source: e.source });
      }
    }
  }

  /** Everything since `t`, for a UI that renders incrementally. */
  eventsSince(t: number): Event[] {
    return this.log.since(t);
  }
}

export { freshState };
export type { Verdict, Order, Decision, Observation, SeatId };
