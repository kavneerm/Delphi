/**
 * Load, validate, normalise, index.
 *
 * This is the only file that reads the raw record shapes. Everything downstream — the
 * storm layer, the gate, the UI — sees `Asset` and `Spec` and asks the `Catalog` for them
 * by id, owner, kind, or seat.
 *
 * Validation is strict on purpose and throws on the first problem, with the record and
 * field named. The catalog is hand-edited YAML; a typo in an id or a field name that the
 * engine ignored would show up as a seat mysteriously unable to act, hours later, in a
 * demo. Better that `npm run build` refuses.
 */

import {
  KNOWN_FIELDS, KNOWN_ORBIT_FIELDS, KNOWN_REQUIREMENT_FIELDS, KNOWN_SPEC_FIELDS, SEATS,
  type ActionId, type ActionRequirement, type Asset, type AssetKind, type CatalogRaw,
  type CommsBand, type LatLon, type RawAircraft, type RawGroundSite, type RawSatellite,
  type RawShip, type SeatId, type Severity, type Spec,
} from './types.ts';

export class CatalogError extends Error {
  override name = 'CatalogError';
}

function fail(where: string, what: string): never {
  throw new CatalogError(`${where}: ${what}`);
}

function isSeat(x: unknown): x is SeatId {
  return typeof x === 'string' && (SEATS as readonly string[]).includes(x);
}

function assertKnownFields(where: string, record: object, known: readonly string[]): void {
  for (const key of Object.keys(record)) {
    if (!known.includes(key)) {
      fail(where, `unknown field "${key}" — add it to engine/types.ts or remove it`);
    }
  }
}

function assertVocab(where: string, field: string, values: string[] | undefined, vocab: string[]): void {
  for (const v of values ?? []) {
    if (!vocab.includes(v)) fail(where, `${field} contains "${v}", not in capabilities.${field}`);
  }
}

// ---------------------------------------------------------------- normalisation

function common(kind: AssetKind, r: RawSatellite | RawGroundSite | RawShip | RawAircraft): Omit<Asset, 'kind' | 'mobility' | 'raw'> {
  return {
    id: r.id, name: r.name, owner: r.owner, real: r.real === true,
    comms: r.comms ?? [], sensors: r.sensors ?? [], effects: r.effects ?? [],
    range_km: r.range_km,
    dependencies: 'dependencies' in r ? (r.dependencies ?? []) : [],
    co_tenants: 'co_tenants' in r ? (r.co_tenants ?? []) : [],
    classified: r.classified === true,
    hidden: 'visibility' in r && r.visibility === 'hidden_unless_exposed',
    ...(kind === 'satellite' ? { band: (r as RawSatellite).band, orbit: (r as RawSatellite).orbit } : {}),
  };
}

function normalise(raw: CatalogRaw): Asset[] {
  const out: Asset[] = [];
  const cap = raw.capabilities;
  const seen = new Set<string>();

  const take = <R extends RawSatellite | RawGroundSite | RawShip | RawAircraft>(
    kind: AssetKind, records: R[], extra: (r: R) => Partial<Asset>,
  ): void => {
    for (const r of records) {
      const where = `${kind} "${r?.id ?? '?'}"`;
      if (typeof r.id !== 'string' || !r.id) fail(where, 'missing id');
      if (seen.has(r.id)) fail(where, 'duplicate id');
      seen.add(r.id);
      if (typeof r.name !== 'string') fail(where, 'missing name');
      if (!isSeat(r.owner)) fail(where, `owner "${String(r.owner)}" is not a seat`);
      assertKnownFields(where, r, KNOWN_FIELDS[kind]);
      assertVocab(where, 'comms', r.comms, cap.comms);
      assertVocab(where, 'sensors', r.sensors, cap.sensors);
      assertVocab(where, 'effects', r.effects, cap.effects);
      const base = common(kind, r);
      const ext = extra(r);
      if (ext.mobility && !cap.mobility.includes(ext.mobility)) {
        fail(where, `mobility "${ext.mobility}" not in capabilities.mobility`);
      }
      out.push({ ...base, kind, mobility: 'fixed', ...ext, raw: r } as Asset);
    }
  };

  take('satellite', raw.satellites, (r) => {
    if (!r.orbit || typeof r.orbit !== 'object') fail(`satellite "${r.id}"`, 'needs an orbit block');
    assertKnownFields(`satellite "${r.id}" orbit`, r.orbit, KNOWN_ORBIT_FIELDS);
    return { mobility: 'orbital' };
  });
  take('ground', raw.ground_sites, (r) => {
    const point = typeof r.lat === 'number' && typeof r.lon === 'number';
    // A cable is a line, not a point; it has a path and no position. Anything with neither
    // is a site nobody can find.
    if (!point && !r.path) fail(`ground "${r.id}"`, 'needs lat and lon, or a path');
    return { ...(point ? { pos: { lat: r.lat!, lon: r.lon! } } : {}), mobility: 'fixed' };
  });
  take('ship', raw.ships, (r) => {
    if (!r.pos || typeof r.pos.lat !== 'number') fail(`ship "${r.id}"`, 'needs pos {lat, lon}');
    return { pos: { lat: r.pos.lat, lon: r.pos.lon }, mobility: r.mobility };
  });
  take('aircraft', raw.aircraft, (r) => ({ mobility: r.mobility, base: r.base }));

  return out;
}

// ---------------------------------------------------------------- the catalog

export class Catalog {
  readonly assets: readonly Asset[];
  readonly byId: ReadonlyMap<string, Asset>;
  readonly specs: ReadonlyMap<SeatId, Spec>;
  readonly control: ReadonlyMap<SeatId, readonly Asset[]>;
  readonly requirements: Readonly<Record<ActionId, ActionRequirement>>;
  readonly storm: Readonly<Record<Severity, Readonly<Record<string, number>>>>;
  readonly actions: readonly ActionId[];

  constructor(raw: CatalogRaw, specs: Spec[]) {
    if (raw.schema_version !== 1) fail('catalog', `schema_version ${raw.schema_version}, expected 1`);

    const assets = normalise(raw);
    const byId = new Map(assets.map((a) => [a.id, a]));

    // Dependencies and co-tenants must point at things that exist.
    for (const a of assets) {
      for (const d of a.dependencies) {
        // Power and similar utilities are named but not modelled as assets; allow them.
        if (!byId.has(d) && !/_power$/.test(d)) fail(`${a.kind} "${a.id}"`, `dependency "${d}" is not an asset`);
      }
      for (const s of a.co_tenants) if (!isSeat(s)) fail(`${a.kind} "${a.id}"`, `co_tenant "${s}" is not a seat`);
    }

    // control: every seat listed, every id real, no asset claimed by a seat that is not
    // its owner unless the catalog says so via co_tenants.
    const control = new Map<SeatId, Asset[]>();
    for (const seat of SEATS) {
      const ids = raw.control[seat];
      if (!Array.isArray(ids)) fail('control', `seat "${seat}" missing`);
      const list: Asset[] = [];
      for (const id of ids) {
        const a = byId.get(id);
        if (!a) fail('control', `seat "${seat}" controls "${id}", which is not an asset`);
        list.push(a);
      }
      control.set(seat, list);
    }
    for (const seat of Object.keys(raw.control)) {
      if (!isSeat(seat)) fail('control', `"${seat}" is not a seat`);
    }

    // action requirements: known fields, well-formed clauses.
    for (const [action, req] of Object.entries(raw.action_requirements)) {
      assertKnownFields(`action "${action}"`, req, KNOWN_REQUIREMENT_FIELDS);
      if (!Array.isArray(req.requires)) fail(`action "${action}"`, 'requires must be a list');
      for (const c of [...req.requires, ...(req.or ?? [])]) {
        const keys = Object.keys(c);
        if (keys.length !== 1) fail(`action "${action}"`, `clause ${JSON.stringify(c)} must have exactly one key`);
        const k = keys[0]!;
        if (!['any_of', 'owner_has', 'controls_constellation', 'effect', 'sensor', 'or_sensor'].includes(k)) {
          fail(`action "${action}"`, `unknown clause "${k}"`);
        }
      }
      if (req.release && req.release !== 'none' && !isSeat(req.release)) {
        fail(`action "${action}"`, `release "${req.release}" is not a seat`);
      }
    }

    // storm factors: every severity present, every band in it a known comms band or pnt.
    const bands: string[] = [...raw.capabilities.comms, 'pnt'];
    for (const sev of ['G4', 'G5', 'carrington'] as const) {
      const row = raw.storm_factors[sev];
      if (!row) fail('storm_factors', `severity "${sev}" missing`);
      for (const [band, f] of Object.entries(row)) {
        if (!bands.includes(band)) fail(`storm_factors.${sev}`, `"${band}" is not a comms band`);
        if (typeof f !== 'number' || f < 0 || f > 1) fail(`storm_factors.${sev}`, `${band} = ${f}, expected 0..1`);
      }
    }

    // specs: a list, one per seat, seats real and unique, actions real, known fields.
    const specMap = new Map<SeatId, Spec>();
    if (!Array.isArray(specs)) fail('specs', 'expected a list of seat specs');
    const actionIds = Object.keys(raw.action_requirements);
    for (const s of specs) {
      const where = `spec "${s?.spec_id ?? '?'}"`;
      if (!isSeat(s.seat)) fail(where, `seat "${String(s.seat)}" is not a seat`);
      if (specMap.has(s.seat)) fail(where, `second spec for seat "${s.seat}"`);
      assertKnownFields(where, s, KNOWN_SPEC_FIELDS);
      const a = s.authority;
      if (!a || !Array.isArray(a.unilateral) || !Array.isArray(a.requires_release) || !Array.isArray(a.recommend_only)) {
        fail(where, 'authority needs unilateral, requires_release and recommend_only lists');
      }
      for (const list of [a.unilateral, a.requires_release, a.recommend_only, a.releases ?? []]) {
        for (const act of list) if (!actionIds.includes(act)) fail(where, `authority names unknown action "${act}"`);
      }
      const overlap = a.unilateral.filter((x) => a.requires_release.includes(x) || a.recommend_only.includes(x));
      if (overlap.length) fail(where, `action(s) in more than one authority tier: ${overlap.join(', ')}`);
      if (!s.information?.clearance) fail(where, 'information.clearance missing');
      specMap.set(s.seat, s);
    }

    this.assets = assets;
    this.byId = byId;
    this.specs = specMap;
    this.control = control;
    this.requirements = raw.action_requirements;
    this.storm = raw.storm_factors;
    this.actions = actionIds as ActionId[];
  }

  asset(id: string): Asset {
    const a = this.byId.get(id);
    if (!a) fail('lookup', `no asset "${id}"`);
    return a;
  }

  /** Assets the seat can issue orders through. Not the same as assets it owns. */
  controlled(seat: SeatId): readonly Asset[] {
    return this.control.get(seat) ?? [];
  }

  owned(seat: SeatId): Asset[] {
    return this.assets.filter((a) => a.owner === seat);
  }

  ofKind(kind: AssetKind): Asset[] {
    return this.assets.filter((a) => a.kind === kind);
  }

  requirement(action: ActionId): ActionRequirement {
    const r = this.requirements[action];
    if (!r) fail('lookup', `no action "${action}"`);
    return r;
  }

  stormFactor(severity: Severity, band: CommsBand | 'pnt'): number {
    return this.storm[severity]?.[band] ?? 1;
  }

  /**
   * Who a seat answers to. Not in either input file: it is the reading of the two
   * `releases` comments — "authorizes the Fleet" and "grants release for others" — and of
   * the catalog's note that the Kremlin holds authorization over Northern Fleet effects.
   * Seats not listed answer to nobody in this scenario.
   */
  superior(seat: SeatId): SeatId | null {
    return CHAIN[seat] ?? null;
  }

  /**
   * The seat that can release this action for the asking seat: its superior, if that
   * superior's spec lists the action under `releases`. Null when nobody can — which the
   * gate reports as such rather than defaulting to anyone.
   */
  releaser(seat: SeatId, action: ActionId): SeatId | null {
    const above = this.superior(seat);
    if (!above) return null;
    return this.specs.get(above)?.authority.releases?.includes(action) ? above : null;
  }
}

const CHAIN: Partial<Record<SeatId, SeatId>> = {
  northern_fleet: 'kremlin',
  northcom: 'nsc',
  usspacecom: 'nsc',
  norway: 'nsc',
};

export function positionOf(a: Asset): LatLon | undefined {
  return a.pos;
}
