/**
 * legal(seat, action, target) → Allow | Pending | Recommend | Reject(reason)
 *
 * The design note's gating function, with every gap it left resolved and every refusal
 * carrying a `because` — the §7 distinction: out of character, out of platforms, wrong
 * target, out of reach, or blinded. The order of checks is the order of the reasons a
 * reader would want to hear them in: what you may do, at what, with what, from where,
 * and whether it can hear you.
 *
 * Nothing here mutates state. The engine records the verdict; this only reaches one.
 */

import { SEATS } from './types.ts';
import { clock, distanceKm, passWindow } from './geo.ts';
import { COMMS_THRESHOLD, DEFAULT_JAM_RANGE_KM } from './storm.ts';
import type { Catalog } from './catalog.ts';
import type { Storm } from './storm.ts';
import type {
  ActionRequirement, Area, Asset, Because, Clause, LatLon, Order, SeatId, Verdict,
} from './types.ts';

export interface GateContext {
  catalog: Catalog;
  storm: Storm;
  /** Scenario minutes since T+0. */
  t: number;
  /** T+0 as minutes after midnight Z, for rendering "14:40Z" in reasons. */
  t0Minutes: number;
}

type Target = { kind: 'asset'; asset: Asset } | { kind: 'area'; area: Area } | null;

const reject = (because: Because, reason: string): Verdict => ({ kind: 'reject', because, reason });

// ---------------------------------------------------------------- clauses

/** Clauses about the seat, not about any platform. */
function isSeatClause(c: Clause): boolean {
  return 'owner_has' in c || 'controls_constellation' in c;
}

function describe(clauses: Clause[]): string {
  return clauses.map((c) => {
    if ('effect' in c) return c.effect;
    if ('sensor' in c) return c.sensor;
    if ('or_sensor' in c) return c.or_sensor;
    if ('any_of' in c) return c.any_of.join('/');
    if ('owner_has' in c) return c.owner_has;
    return 'controls_constellation';
  }).join(', ');
}

/**
 * Within `requires`, clauses AND together — except that `or_sensor` widens the sensor
 * clause before it (task_imagery_pass wants eo_ir *or* sar). The top-level `or` list is an
 * alternative to the whole of `requires`: any one of its clauses alone suffices (jam wants
 * jam_gnss, or either satcom effect).
 */
function assetSatisfies(a: Asset, req: ActionRequirement): boolean {
  const one = (c: Clause): boolean => {
    if ('effect' in c) return a.effects.includes(c.effect);
    if ('sensor' in c) return a.sensors.includes(c.sensor);
    if ('or_sensor' in c) return a.sensors.includes(c.or_sensor);
    if ('any_of' in c) return c.any_of.includes(a.mobility);
    return true;                                   // seat clauses are judged elsewhere
  };
  const sensorGroup = req.requires.filter((c) => 'sensor' in c || 'or_sensor' in c);
  const rest = req.requires.filter((c) => !('sensor' in c || 'or_sensor' in c) && !isSeatClause(c));
  const primary = (sensorGroup.length === 0 || sensorGroup.some(one)) && rest.every(one);
  if (primary) return true;
  return (req.or ?? []).some(one);
}

function seatSatisfies(seat: SeatId, req: ActionRequirement, target: Target, ctx: GateContext): string | null {
  for (const c of req.requires) {
    if ('owner_has' in c) {
      if (target?.kind !== 'asset') return `${c.owner_has} needs a target asset`;
      const t = target.asset;
      if (t.owner !== seat && !t.co_tenants.includes(seat)) {
        return `${seat} holds no telemetry of ${t.name} — it belongs to ${t.owner}`;
      }
    }
    if ('controls_constellation' in c) {
      const sats = ctx.catalog.owned(seat).filter((a) => a.kind === 'satellite');
      const byBand = new Map<string, number>();
      for (const s of sats) byBand.set(s.band ?? '?', (byBand.get(s.band ?? '?') ?? 0) + 1);
      if (![...byBand.values()].some((n) => n >= 2)) {
        return `${seat} owns ${sats.length} satellite(s), not a constellation`;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- target

function resolveTarget(order: Order, req: ActionRequirement, ctx: GateContext): Target | Verdict {
  let target: Target = null;
  if (order.target_id) {
    const a = ctx.catalog.byId.get(order.target_id);
    if (!a) return reject('target', `no such asset "${order.target_id}"`);
    target = { kind: 'asset', asset: a };
  } else if (order.area) {
    target = { kind: 'area', area: order.area };
  }

  if (req.target_type) {
    if (!target) return reject('target', `${order.action} needs a ${req.target_type} target`);
    if (req.target_type === 'area') {
      if (target.kind === 'asset') {
        // A named place stands in for an area around it.
        const pos = target.asset.pos;
        if (!pos) return reject('target', `${target.asset.name} has no position to task imagery over`);
        target = { kind: 'area', area: { ...pos, radius_km: 25 } };
      }
    } else {
      const want = req.target_type === 'ground_site' ? 'ground' : req.target_type;
      if (target.kind !== 'asset' || target.asset.kind !== want) {
        const got = target.kind === 'asset' ? target.asset.kind : 'an area';
        return reject('target', `${order.action} targets a ${req.target_type}, not ${got}`);
      }
    }
  }

  if (req.target_owner_in) {
    if (target?.kind !== 'asset') return reject('target', `${order.action} needs a target owned by ${req.target_owner_in.join(' or ')}`);
    if (!req.target_owner_in.includes(target.asset.owner)) {
      return reject('target', `${target.asset.name} is ${target.asset.owner}'s; ${order.action} applies to ${req.target_owner_in.join(', ')}`);
    }
  }
  return target;
}

function positionOf(target: Target): LatLon | undefined {
  if (!target) return undefined;
  return target.kind === 'asset' ? target.asset.pos : target.area;
}

function nameOf(target: Target): string {
  if (!target) return 'the target';
  return target.kind === 'asset' ? target.asset.name : `the area at ${target.area.lat.toFixed(1)}N ${target.area.lon.toFixed(1)}E`;
}

// ---------------------------------------------------------------- the gate

export function legal(ctx: GateContext, order: Order): Verdict {
  const { catalog, storm, t } = ctx;
  const { seat, action } = order;

  // 1. Out of character?
  if (!(SEATS as readonly string[]).includes(seat)) return reject('spec', `"${seat}" holds no seat`);
  const spec = catalog.specs.get(seat);
  if (!spec) return reject('spec', `no spec for seat "${seat}" — nothing is permitted`);
  const auth = spec.authority;
  if (!catalog.actions.includes(action)) return reject('spec', `no such action "${action}"`);

  if (auth.recommend_only.includes(action)) {
    const to = catalog.releaser(seat, action) ?? catalog.superior(seat);
    if (!to) return reject('spec', `${seat} may only recommend ${action}, and has no seat to recommend it to`);
    return { kind: 'recommend', to, reason: `${seat} may recommend ${action} to ${to}, not order it` };
  }
  const permitted = auth.unilateral.includes(action) || auth.requires_release.includes(action);
  if (!permitted) return reject('spec', `spec does not permit ${action}`);

  const req = catalog.requirement(action);

  // 2. The right kind of target?
  const resolved = resolveTarget(order, req, ctx);
  if (resolved && 'kind' in resolved && (resolved.kind === 'allow' || resolved.kind === 'reject' || resolved.kind === 'pending' || resolved.kind === 'recommend')) {
    return resolved as Verdict;
  }
  const target = resolved as Target;

  // 3. Something to do it with?
  const seatFail = seatSatisfies(seat, req, target, ctx);
  if (seatFail) return reject('assets', seatFail);

  const assetClauses = req.requires.filter((c) => !isSeatClause(c));
  const needsPlatform = assetClauses.length > 0 || (req.or?.length ?? 0) > 0;
  let platform: Asset | null = null;

  if (needsPlatform) {
    let candidates = catalog.controlled(seat).filter((a) => assetSatisfies(a, req));
    if (order.asset_id) {
      const chosen = catalog.byId.get(order.asset_id);
      if (!chosen) return reject('assets', `no such asset "${order.asset_id}"`);
      if (!catalog.controlled(seat).includes(chosen)) return reject('assets', `${seat} does not control ${chosen.name}`);
      if (!assetSatisfies(chosen, req)) return reject('assets', `${chosen.name} cannot ${action}: it lacks ${describe(assetClauses)}`);
      candidates = [chosen];
    }
    if (candidates.length === 0) {
      const alt = req.or?.length ? ` (or ${describe(req.or)})` : '';
      return reject('assets', `no controlled asset with ${describe(assetClauses)}${alt}`);
    }

    // 4. In reach?
    const targetPos = positionOf(target);
    const rangeMatters = targetPos && (req.range_km !== undefined || req.range_check || candidates.some((c) => c.range_km !== undefined));
    if (rangeMatters) {
      const placed = candidates.filter((c) => c.pos);
      if (placed.length > 0) {
        const limitOf = (c: Asset) => req.range_km ?? c.range_km ?? (req.range_check ? DEFAULT_JAM_RANGE_KM : Number.POSITIVE_INFINITY);
        const ranked = placed
          .map((c) => ({ c, d: distanceKm(c.pos!, targetPos), limit: limitOf(c) }))
          .sort((x, y) => x.d - y.d);
        const inReach = ranked.find((r) => r.d <= r.limit);
        if (!inReach) {
          const n = ranked[0]!;
          return reject('range', `${n.c.name} is ${Math.round(n.d)} km from ${nameOf(target)}; range ${Math.round(n.limit)} km`);
        }
        platform = inReach.c;
      } else {
        platform = candidates[0]!;
      }
    } else {
      platform = candidates[0]!;
    }

    // 5. Overhead right now?
    if (req.pass_window_required) {
      const sat = platform.kind === 'satellite' ? platform
        : target?.kind === 'asset' && target.asset.kind === 'satellite' ? target.asset : null;
      if (sat) {
        const pw = passWindow(sat, t);
        if (!pw.inPass) {
          const over = target ? ` over ${nameOf(target)}` : '';
          return reject('range', `${sat.name} next pass${over} ${clock(pw.nextStart, ctx.t0Minutes)}`);
        }
      }
    }

    // 6. Can it hear you, and can what it sees get home?
    if (req.downlink_required) {
      const dl = storm.downlink(seat, t);
      if (!dl.up) return reject('comms', `no downlink: ${dl.reason}`);
    }
    if (storm.isDown(platform)) return reject('comms', `${platform.name} is down`);
    const c = storm.comms(platform, t);
    if (c < COMMS_THRESHOLD) return reject('comms', `${platform.name} unreachable: comms ${Math.round(c * 100)}%`);
  } else if (req.downlink_required) {
    const dl = storm.downlink(seat, t);
    if (!dl.up) return reject('comms', `no downlink: ${dl.reason}`);
  }

  // 7. Does someone else have to say yes first?
  const needsRelease =
    auth.requires_release.includes(action) ||
    (req.release !== undefined && req.release !== 'none') ||
    req.irreversible === true || req.debris === true;
  if (needsRelease) {
    const by = catalog.releaser(seat, action) ?? (req.release && req.release !== 'none' ? req.release : null);
    if (!by) return reject('spec', `no seat can release ${action} for ${seat}`);
    return {
      kind: 'pending', asset: platform?.id ?? null, release_by: by,
      reason: `${action} needs release from ${by}${platform ? ` — ${platform.name} standing by` : ''}`,
    };
  }

  return {
    kind: 'allow', asset: platform?.id ?? null,
    reason: platform ? `${platform.name} tasked` : `${req.channel ?? 'direct'} channel`,
  };
}
