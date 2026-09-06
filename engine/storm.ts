/**
 * The storm layer: is this platform reachable right now?
 *
 *   comms(asset) = max over the asset's bands of  storm[severity][band] × jam(asset, band)
 *
 * and an asset is *down* — cannot act, relay, or be reached at all — if the engine has
 * marked it down, or if every one of its modelled dependencies is down.
 *
 * Three modelling decisions live here and nowhere else:
 *
 *   Dependencies are alternatives, not a chain. SvalSat lists both fibre cables; on one
 *   intact cable it stays up. That is what makes the redundancy the catalog wrote down
 *   mean something, and it is what makes `share_telemetry` the resolving move after a
 *   single cable is cut. A power dependency that is not itself an asset is ignored.
 *
 *   Which bands a jammer hits. The catalog names the effect but not the band. GNSS jamming
 *   hits L-band and the PNT pseudo-band; satcom jamming (either direction) hits every
 *   satellite radio band except EHF, which is protected by design. Fibre and line-of-sight
 *   are not radio and are never jammed.
 *
 *   Reach of a jammer. The source's own range_km if it has one, else 200 km; measured from
 *   the effect's declared area if it has one, else from the source's position. A source
 *   with neither has no reach — it cannot be range-checked, so it does not count.
 */

import { distanceKm } from './geo.ts';
import type { Catalog } from './catalog.ts';
import type { Log } from './log.ts';
import type { Asset, AssetState, CommsBand, Effect, SeatId, Severity } from './types.ts';

/** Below this, a platform is "unreachable" and an order through it is rejected. */
export const COMMS_THRESHOLD = 0.5;
/** What one jammer in range does to one band. Two jammers compound. */
export const JAM_FACTOR = 0.15;
/** Reach of a jammer whose record gives no range_km. The gate uses the same figure. */
export const DEFAULT_JAM_RANGE_KM = 200;

const JAMMED_BANDS: Partial<Record<Effect, readonly (CommsBand | 'pnt')[]>> = {
  jam_gnss: ['l_band_narrow', 'pnt'],
  jam_satcom_uplink: ['ku_band_leo', 'ka_band', 'x_band_mil', 'uhf_satcom', 'l_band_narrow'],
  jam_satcom_downlink: ['ku_band_leo', 'ka_band', 'x_band_mil', 'uhf_satcom', 'l_band_narrow'],
};

export function freshState(): AssetState {
  return { down: false, airborne: false, exposed_to: [], safe_mode: false };
}

export class Storm {
  severity: Severity = 'G4';

  // Plain fields, not parameter properties: Node runs the check by stripping types, and a
  // parameter property is a transform, not a type — strip-only mode refuses it.
  private readonly catalog: Catalog;
  private readonly log: Log;
  private readonly state: Map<string, AssetState>;

  constructor(catalog: Catalog, log: Log, state: Map<string, AssetState>) {
    this.catalog = catalog;
    this.log = log;
    this.state = state;
  }

  stateOf(id: string): AssetState {
    let s = this.state.get(id);
    if (!s) { s = freshState(); this.state.set(id, s); }
    return s;
  }

  /** Marked down, or every modelled dependency down. Cycle-safe. */
  isDown(asset: Asset, seen: Set<string> = new Set()): boolean {
    if (this.stateOf(asset.id).down || this.stateOf(asset.id).safe_mode) return true;
    if (seen.has(asset.id)) return false;
    seen.add(asset.id);
    const deps = asset.dependencies.filter((d) => this.catalog.byId.has(d));
    if (deps.length === 0) return false;
    return deps.every((d) => this.isDown(this.catalog.asset(d), seen));
  }

  /** Product of every jammer in range that touches this band. 1 means unjammed. */
  jamFactor(asset: Asset, band: CommsBand | 'pnt', t: number): number {
    if (!asset.pos) return 1;                              // nothing to measure reach against
    let f = 1;
    for (const e of this.log.activeEffects(t)) {
      const bands = JAMMED_BANDS[e.effect];
      if (!bands || !bands.includes(band)) continue;
      const source = this.catalog.byId.get(e.source);
      if (!source || this.isDown(source)) continue;
      const from = e.area ?? source.pos;
      if (!from) continue;
      const reach = e.area?.radius_km ?? source.range_km ?? DEFAULT_JAM_RANGE_KM;
      if (distanceKm(from, asset.pos) <= reach) f *= JAM_FACTOR;
    }
    return f;
  }

  /** 0..1. The best path the asset has, after storm and jamming. 0 if it is down. */
  comms(asset: Asset, t: number): number {
    if (this.isDown(asset)) return 0;
    if (asset.comms.length === 0) return 1;                // a thing with no radio is not "muted"
    let best = 0;
    for (const band of asset.comms) {
      const v = this.catalog.stormFactor(this.severity, band) * this.jamFactor(asset, band, t);
      if (v > best) best = v;
    }
    return best;
  }

  reachable(asset: Asset, t: number): boolean {
    return this.comms(asset, t) >= COMMS_THRESHOLD;
  }

  /**
   * Whether the seat has somewhere to bring imagery down: a ground station it controls or
   * owns, on fibre, not down, and reachable. The catalog puts nearly every polar downlink
   * through SvalSat, which is the point of the scenario.
   */
  downlink(seat: SeatId, t: number): { up: boolean; station?: Asset; reason?: string } {
    // A station is a site: ground, on fibre, and somewhere. The cables carry `fiber` too but
    // have a path rather than a position, and nobody downlinks to a cable.
    const stations = [...this.catalog.controlled(seat), ...this.catalog.owned(seat)]
      .filter((a, i, all) => a.kind === 'ground' && a.pos && a.comms.includes('fiber') && all.indexOf(a) === i);
    if (stations.length === 0) return { up: false, reason: `${seat} controls no ground station with fibre` };
    for (const s of stations) if (!this.isDown(s) && this.reachable(s, t)) return { up: true, station: s };
    const s = stations[0]!;
    return {
      up: false, station: s,
      reason: this.isDown(s) ? `${s.name} fibre down until restored` : `${s.name} comms ${Math.round(this.comms(s, t) * 100)}%`,
    };
  }

  /** The jammers a seat has switched on, for its own observation. */
  activeFrom(seat: SeatId, t: number) {
    return this.log.activeEffects(t).filter((e) => e.seat === seat);
  }
}
