/**
 * check:engine — the gate says yes and no for the right reasons.
 *
 * No browser, no server: the engine is a pure module, and this runs it against the real
 * catalog and the real specs in milliseconds. Every case asserts the verdict *kind*, the
 * `because` code where it rejects, and a fragment of the reason — so a gate that refuses
 * for the wrong reason fails, not just one that refuses.
 *
 * Where a case turns on geometry (is this ship within 50 km of that one?), the expected
 * answer is derived from the catalog here rather than hard-coded, so editing a position in
 * assets.yaml moves the expectation with it instead of breaking a number in this file.
 *
 * Coverage is asserted too: every action and every seat must appear in at least one case.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Catalog, CatalogError } from '../engine/catalog.ts';
import { Engine } from '../engine/engine.ts';
import { distanceKm, passWindow } from '../engine/geo.ts';
import { HumanModel, NullModel, RemoteModel } from '../engine/model.ts';
import type {
  ActionId, Because, CatalogRaw, Decision, Order, SeatId, Spec, Verdict,
} from '../engine/types.ts';
import { Report } from './lib.ts';

const raw = JSON.parse(readFileSync(resolve('engine/assets.json'), 'utf8')) as CatalogRaw;
const specs = JSON.parse(readFileSync(resolve('engine/specs.json'), 'utf8')) as Spec[];

const report = new Report('engine');
const seatsCovered = new Set<string>();
const actionsCovered = new Set<string>();

function fresh(severity: 'G4' | 'G5' | 'carrington' = 'G4'): Engine {
  return new Engine(raw, specs, { severity });
}

interface Expect {
  kind: Verdict['kind'];
  because?: Because;
  reason?: string;          // substring
  asset?: string | string[];
  release_by?: SeatId;
  to?: SeatId;
}

function expect(label: string, v: Verdict, e: Expect): void {
  const got = `${v.kind}${'because' in v ? '/' + v.because : ''}: "${v.reason}"`;
  report.assert(v.kind === e.kind, `${label}: expected ${e.kind}, got ${got}`);
  if (e.because) report.assert(v.kind === 'reject' && v.because === e.because, `${label}: expected because=${e.because}, got ${got}`);
  if (e.reason) report.assert(v.reason.includes(e.reason), `${label}: reason should mention "${e.reason}", got ${got}`);
  if (e.asset !== undefined) {
    const want = Array.isArray(e.asset) ? e.asset : [e.asset];
    const has = (v.kind === 'allow' || v.kind === 'pending') ? v.asset : null;
    report.assert(has !== null && want.includes(has), `${label}: expected asset in [${want.join(', ')}], got ${has}`);
  }
  if (e.release_by) report.assert(v.kind === 'pending' && v.release_by === e.release_by, `${label}: expected release_by=${e.release_by}, got ${got}`);
  if (e.to) report.assert(v.kind === 'recommend' && v.to === e.to, `${label}: expected recommend to=${e.to}, got ${got}`);
}

function order(engine: Engine, o: Order, label: string, e: Expect): Verdict {
  seatsCovered.add(o.seat);
  actionsCovered.add(o.action);
  const v = engine.order(o);
  expect(label, v, e);
  return v;
}

// ---------------------------------------------------------------- 1. out of character

{
  const e = fresh();
  order(e, { seat: 'norway', action: 'hold' }, 'norway hold', { kind: 'allow' });
  order(e, { seat: 'civilians', action: 'hold' }, 'civilians (no spec) hold', { kind: 'reject', because: 'spec', reason: 'no spec' });
  order(e, { seat: 'obs' as SeatId, action: 'hold' }, 'observer', { kind: 'reject', because: 'spec', reason: 'holds no seat' });
  order(e, { seat: 'iridium', action: 'jam' }, 'iridium jam (not in any tier)', { kind: 'reject', because: 'spec', reason: 'does not permit' });
  order(e, { seat: 'nsc', action: 'kinetic' }, 'nsc kinetic (releases it, cannot order it)', { kind: 'reject', because: 'spec', reason: 'does not permit' });

  // recommend_only routes to whoever can release, else to the superior
  order(e, { seat: 'norway', action: 'jam', target_id: 'pechenga_ew_site' }, 'norway jam is recommend-only', { kind: 'recommend', to: 'nsc' });
  order(e, { seat: 'northern_fleet', action: 'public_attribution' }, 'fleet public_attribution is recommend-only', { kind: 'recommend', to: 'kremlin' });
  order(e, { seat: 'northcom', action: 'kinetic' }, 'northcom kinetic is recommend-only', { kind: 'recommend', to: 'nsc' });
  report.assert(e.log.ofType('recommendation').length === 3, 'each recommendation is logged');
}

// ---------------------------------------------------------------- 2. out of platforms

{
  const e = fresh();
  order(e, { seat: 'northern_fleet', action: 'kinetic', target_id: 'svalsat_1' }, 'fleet kinetic — no seat holds the effect',
    { kind: 'reject', because: 'assets', reason: 'no controlled asset with kinetic_asat' });
  order(e, { seat: 'usspacecom', action: 'jam', target_id: 'svalsat_ground' }, 'usspacecom jam — permitted but nothing to jam with',
    { kind: 'reject', because: 'assets', reason: 'no controlled asset with jam_gnss' });

  // controls_constellation is a seat clause: two satellites in one band
  const bands = (seat: SeatId) => {
    const m = new Map<string, number>();
    for (const a of e.catalog.owned(seat)) if (a.kind === 'satellite') m.set(a.band ?? '?', (m.get(a.band ?? '?') ?? 0) + 1);
    return [...m.values()].some((n) => n >= 2);
  };
  order(e, { seat: 'starlink', action: 'geofence_or_throttle' }, 'starlink geofence', bands('starlink') ? { kind: 'allow' } : { kind: 'reject', because: 'assets' });
  order(e, { seat: 'iridium', action: 'geofence_or_throttle' }, 'iridium geofence', bands('iridium') ? { kind: 'allow' } : { kind: 'reject', because: 'assets', reason: 'not a constellation' });

  // owner_has telemetry: own it, or be a co-tenant
  order(e, { seat: 'norway', action: 'share_telemetry', target_id: 'svalsat_1' }, 'norway shares its own telemetry', { kind: 'allow' });
  order(e, { seat: 'usspacecom', action: 'share_telemetry', target_id: 'svalsat_1' }, 'usspacecom co-tenant on SvalSat-1', { kind: 'allow' });
  order(e, { seat: 'norway', action: 'share_telemetry', target_id: 'polar_relay' }, 'norway has no telemetry of Polar Relay',
    { kind: 'reject', because: 'assets', reason: 'holds no telemetry' });
  order(e, { seat: 'starlink', action: 'disclose_incident', target_id: 'barents_1' }, 'starlink discloses its own', { kind: 'allow' });
  order(e, { seat: 'china', action: 'share_telemetry', target_id: 'yuan_wang_6' }, 'china shares its own', { kind: 'allow' });
}

// ---------------------------------------------------------------- 3. wrong target

{
  const e = fresh();
  order(e, { seat: 'norway', action: 'board_vessel', target_id: 'svalsat_ground' }, 'boarding a ground station',
    { kind: 'reject', because: 'target', reason: 'targets a ship' });
  order(e, { seat: 'norway', action: 'board_vessel' }, 'boarding nothing', { kind: 'reject', because: 'target', reason: 'needs a ship' });
  order(e, { seat: 'northcom', action: 'request_commercial_priority', target_id: 'kalvoy_3' }, 'priority from Iridium', { kind: 'allow' });
  order(e, { seat: 'northcom', action: 'request_commercial_priority', target_id: 'svalsat_1' }, 'priority from Norway is not commercial',
    { kind: 'reject', because: 'target', reason: 'applies to starlink, iridium' });
  order(e, { seat: 'nsc', action: 'private_demarche' }, 'nsc démarche needs no platform', { kind: 'allow', reason: 'diplomatic' });
  order(e, { seat: 'kremlin', action: 'public_attribution' }, 'kremlin statement needs no platform', { kind: 'allow', reason: 'public' });
}

// ---------------------------------------------------------------- 4. out of reach

{
  const e = fresh();
  const kv = e.catalog.asset('kv_svalbard');
  const ships = e.catalog.ofKind('ship').filter((s) => s.id !== kv.id && s.pos);
  const far = ships.filter((s) => distanceKm(kv.pos!, s.pos!) > 50).sort((a, b) => distanceKm(kv.pos!, b.pos!) - distanceKm(kv.pos!, a.pos!))[0]!;
  const near = ships.filter((s) => distanceKm(kv.pos!, s.pos!) <= 50);
  const boarders = e.catalog.controlled('norway').filter((a) => a.effects.includes('boarding')).map((a) => a.id);

  order(e, { seat: 'norway', action: 'board_vessel', target_id: far.id }, `boarding ${far.name} at ${Math.round(distanceKm(kv.pos!, far.pos!))} km`,
    { kind: 'reject', because: 'range', reason: 'range 50 km' });
  report.assert(near.length > 0, 'catalog has at least one ship within 50 km of KV Svalbard to board');
  if (near.length) {
    order(e, { seat: 'norway', action: 'board_vessel', target_id: near[0]!.id }, `boarding ${near[0]!.name} nearby`,
      { kind: 'allow', asset: boarders });
    report.assert(e.log.ofType('exposed').some((x) => x.asset === near[0]!.id && x.to === 'all'), 'a boarding exposes the vessel to everyone');
  }

  // A named jammer out of reach is a range reject, not a silent substitution.
  order(e, { seat: 'northern_fleet', action: 'jam', target_id: 'svalsat_ground', asset_id: 'pechenga_ew_site' }, 'jam SvalSat from Pechenga',
    { kind: 'reject', because: 'range', reason: '300 km' });

  // Unnamed: the engine picks the nearest jammer in reach, or says none is.
  const sval = e.catalog.asset('svalsat_ground');
  const jammers = e.catalog.controlled('northern_fleet').filter((a) => a.pos && a.effects.some((x) => x.startsWith('jam_')));
  const inReach = jammers.filter((a) => distanceKm(a.pos!, sval.pos!) <= (a.range_km ?? 200));
  order(e, { seat: 'northern_fleet', action: 'jam', target_id: 'svalsat_ground' }, 'jam SvalSat with whatever can',
    inReach.length ? { kind: 'allow', asset: inReach.map((a) => a.id) } : { kind: 'reject', because: 'range' });
  if (inReach.length) report.assert(e.log.activeEffects(e.t).length === 1, 'an allowed jam starts an effect');
}

// ---------------------------------------------------------------- 5. pass windows and downlink

{
  const e = fresh();
  const sar = e.catalog.controlled('norway').find((a) => a.kind === 'satellite' && a.sensors.includes('sar'))!;
  report.assert(sar !== undefined, 'norway controls a SAR satellite to task');
  const area = { lat: 78.0, lon: 19.0, radius_km: 25 };          // Storfjorden
  // -1 sentinels: an initial value of 0 silently satisfied the loop when the satellite was
  // (wrongly) always in pass, and the case passed for the wrong reason.
  let tOut = -1, tIn = -1;
  for (let t = 0; t < 400; t++) { if (!passWindow(sar, t).inPass) { tOut = t; break; } }
  for (let t = 0; t < 400; t++) { if (passWindow(sar, t).inPass) { tIn = t; break; } }
  report.assert(tOut >= 0 && tIn >= 0, `${sar.name} must have both in-pass and out-of-pass minutes (got in=${tIn}, out=${tOut})`);

  e.t = tOut;
  order(e, { seat: 'norway', action: 'task_imagery_pass', area }, `imagery at ${tOut} min, no pass`,
    { kind: 'reject', because: 'range', reason: 'next pass' });
  e.t = tIn;
  order(e, { seat: 'norway', action: 'task_imagery_pass', area }, `imagery at ${tIn} min, in pass`, { kind: 'allow', asset: sar.id });

  // Dependencies are alternatives: one cable cut leaves SvalSat up, both take it down.
  const sval = e.catalog.asset('svalsat_ground');
  e.markDown('svalbard_cable_1');
  report.assert(!e.storm.isDown(sval), 'SvalSat stays up on one cable');
  order(e, { seat: 'norway', action: 'task_imagery_pass', area }, 'imagery with one cable cut', { kind: 'allow' });
  e.markDown('svalbard_cable_2');
  report.assert(e.storm.isDown(sval), 'SvalSat is down with both cables cut');
  // Norway also has Ny-Ålesund and Andøya, which do not hang off the cables — so its
  // downlink survives, and the catalog is right that it does. To see the cut bite, take the
  // other stations down too; that is what a seat with only SvalSat would face.
  order(e, { seat: 'norway', action: 'task_imagery_pass', area }, 'imagery with both cables cut, mainland up', { kind: 'allow' });
  for (const st of e.catalog.assets) if (st.kind === 'ground' && st.pos && st.comms.includes('fiber') && st.id !== sval.id) e.markDown(st.id);
  order(e, { seat: 'norway', action: 'task_imagery_pass', area }, 'imagery with every other station down',
    { kind: 'reject', because: 'comms', reason: 'fibre' });
  e.restore('svalbard_cable_1');
  report.assert(!e.storm.isDown(sval), 'restoring one cable brings SvalSat back');
  order(e, { seat: 'norway', action: 'task_imagery_pass', area }, 'imagery after one cable restored', { kind: 'allow', asset: sar.id });

  // Dazzle needs the target satellite over the laser.
  const laser = e.catalog.asset('kola_laser_site');
  const eye = e.catalog.asset('arctic_eye');
  let tEye = 0;
  for (let t = 0; t < 400; t++) { if (passWindow(eye, t).inPass) { tEye = t; break; } }
  e.t = tEye;
  order(e, { seat: 'northern_fleet', action: 'dazzle', target_id: eye.id, asset_id: laser.id }, 'dazzle Arctic Eye in pass',
    { kind: 'pending', release_by: 'kremlin', asset: laser.id });
}

// ---------------------------------------------------------------- 6. blinded or muted

{
  const e = fresh('G5');
  // Something a seat controls whose every band the storm crushes.
  const weak = e.catalog.assets.find((a) =>
    a.comms.length > 0 && a.comms.every((b) => ['ku_band_leo', 'hf', 'l_band_narrow'].includes(b)) &&
    [...e.catalog.control.entries()].some(([, list]) => list.includes(a)),
  );
  report.assert(weak !== undefined, 'catalog has a controlled asset on storm-vulnerable bands only');
  if (weak) {
    const seat = [...e.catalog.control.entries()].find(([, list]) => list.includes(weak))![0];
    const pct = Math.round(e.storm.comms(weak, 0) * 100);
    report.assert(pct < 50, `${weak.name} under G5 is ${pct}% — below threshold`);
    const v = e.order({ seat, action: 'maneuver', asset_id: weak.id });
    seatsCovered.add(seat); actionsCovered.add('maneuver');
    const permitted = e.catalog.specs.get(seat)?.authority.unilateral.includes('maneuver');
    if (permitted) expect(`${seat} maneuver ${weak.name} under G5`, v, { kind: 'reject', because: 'comms', reason: `comms ${pct}%` });
    else report.assert(v.kind === 'reject', `${seat} cannot maneuver; verdict ${v.kind}`);
  }

  // Fibre does not care about the storm.
  report.assert(e.storm.comms(e.catalog.asset('svalsat_ground'), 0) >= 0.95, 'SvalSat on fibre rides out a G5');

  // A jammer in range multiplies in.
  const g4 = fresh('G4');
  const target = g4.catalog.assets.find((a) => a.pos && a.comms.includes('l_band_narrow'))!;
  const before = g4.storm.comms(target, 0);
  g4.startEffect('northern_fleet', 'jam_gnss', 'pechenga_ew_site', undefined, { ...target.pos!, radius_km: 50 });
  const after = g4.storm.comms(target, 0);
  report.assert(after <= before, `jamming in range does not raise comms (${before.toFixed(2)} -> ${after.toFixed(2)})`);
  g4.endEffect('jam_gnss', 'pechenga_ew_site');
  report.assert(g4.storm.comms(target, 0) === before, 'ending the effect restores comms');
}

// ---------------------------------------------------------------- 7. release

{
  const e = fresh();
  order(e, { seat: 'norway', action: 'terrestrial_response', target_id: 'barentsburg' }, 'norway terrestrial_response',
    { kind: 'pending', release_by: 'nsc' });
  report.assert(e.pendingReleases().length === 1, 'the request is held');
  report.assert(e.log.ofType('release_requested').length === 1, 'the request is logged');

  const wrong = e.grant('kremlin', 'norway', 'terrestrial_response');
  expect('kremlin cannot release for norway', wrong, { kind: 'reject', because: 'spec', reason: 'cannot release' });
  report.assert(e.pendingReleases().length === 1, 'a wrong grant leaves the request held');

  const right = e.grant('nsc', 'norway', 'terrestrial_response');
  expect('nsc releases for norway', right, { kind: 'allow', reason: 'released by nsc' });
  report.assert(e.pendingReleases().length === 0, 'a right grant clears it');
  report.assert(e.log.ofType('release_granted').length === 1, 'the grant is logged');

  // Release-tier actions still need a platform. The design note's table says cyber_ground
  // is held by no seat in the base scenario, and rpo_inspect only by Kosmos — so these are
  // out of platforms, not out of character, and the reason says which.
  order(e, { seat: 'northern_fleet', action: 'ground_cyber', target_id: 'longyearbyen_gateway' }, 'fleet cyber — permitted, no platform',
    { kind: 'reject', because: 'assets', reason: 'no controlled asset with cyber_ground' });
  order(e, { seat: 'usspacecom', action: 'counter_rpo', target_id: 'kosmos_2xxx' }, 'usspacecom counter_rpo — permitted, no platform',
    { kind: 'reject', because: 'assets', reason: 'no controlled asset with rpo_inspect' });
  report.assert(!e.stateOf('longyearbyen_gateway').down, 'a rejected cyber order did nothing');

  // The fleet does hold an inspector, and the Kremlin holds its release.
  order(e, { seat: 'northern_fleet', action: 'counter_rpo', target_id: 'svalsat_1' }, 'fleet counter_rpo with Kosmos',
    { kind: 'pending', release_by: 'kremlin', asset: 'kosmos_2xxx' });
  e.deny('kremlin', 'northern_fleet', 'counter_rpo', 'too attributable');
  report.assert(e.pendingReleases().length === 0 && e.log.ofType('release_denied').length === 1, 'a denial clears and logs');
  report.assert(e.log.activeEffects(e.t).length === 0, 'a denied inspection started nothing');
}

// ---------------------------------------------------------------- 8. what a seat can see

{
  const e = fresh();
  const hidden = e.catalog.assets.filter((a) => a.hidden);
  report.assert(hidden.length === 2, `catalog hides ${hidden.length} assets (expected the two submarines)`);
  const sub = hidden.find((a) => a.owner === 'northern_fleet')!;
  const sees = (seat: SeatId, id: string) => e.observe(seat).contacts.some((c) => c.id === id) || e.observe(seat).own_assets.some((c) => c.id === id);

  report.assert(!sees('norway', sub.id), `norway cannot see ${sub.name} before exposure`);
  report.assert(sees('northern_fleet', sub.id), `the fleet sees its own ${sub.name}`);
  e.expose(sub.id, ['norway'], 'p8_norway');
  report.assert(sees('norway', sub.id), `norway sees ${sub.name} after a P-8 finds it`);
  report.assert(!sees('china', sub.id), 'china still does not');

  report.assert(!sees('norway', 'polar_relay'), 'nato_secret cannot see the classified relay');
  report.assert(sees('northcom', 'polar_relay'), 'ts_sci can');
  report.assert(e.observe('norway').feeds.length === 5, 'norway observes through its five feeds');
  report.assert(e.observe('nsc').own_assets.length === 0, 'nsc has authority and no platforms');
}

// ---------------------------------------------------------------- 9. models and the clock

{
  const e = fresh();
  const seen: Decision[] = [];
  e.attach('norway', { async decide() { const d: Decision = { action: 'hold', params: {}, rationale: 'stub' }; seen.push(d); return d; } });
  await e.tick(0);
  report.assert(seen.length === 1, 'a due seat is polled on the first tick');
  await e.tick(10);
  report.assert(seen.length === 1, 'not polled again inside its 45-minute clock');
  await e.tick(45);
  report.assert(seen.length === 2, 'polled again when the clock is due');
  e.inject('cable fault reported at SvalSat', ['norway']);
  await e.tick(46);
  report.assert(seen.length === 3, 'an inject wakes a seat that listens for them');
  report.assert(e.log.ofType('decision').filter((d) => d.seat === 'norway').length === 3, "every one of norway's decisions is logged with its verdict");

  // Every other seat ran a NullModel and was polled too; count only what happens after the
  // human takes over.
  const human = new HumanModel();
  e.attach('northern_fleet', human);
  const fleetBefore = e.log.ofType('decision').filter((d) => d.seat === 'northern_fleet').length;
  await e.tick(100);
  await e.tick(200);
  report.assert(e.log.ofType('decision').filter((d) => d.seat === 'northern_fleet').length === fleetBefore, 'a human seat is never polled');
  human.submit({ action: 'hold', params: {} });
  report.assert(human.pending === 1, 'a human order queues until asked for');

  const nul = await new NullModel().decide();
  report.assert(nul.action === 'hold', 'NullModel holds');

  const fakeFetch = (body: unknown, ok = true): typeof fetch =>
    (async () => ({ ok, status: ok ? 200 : 500, json: async () => body })) as unknown as typeof fetch;
  const good = new RemoteModel('http://model.invalid/decide', e.catalog.actions, { fetchImpl: fakeFetch({ action: 'maneuver', params: { asset_id: 'kv_svalbard' } }) });
  const req = { seat: 'norway' as const, spec: e.catalog.specs.get('norway')!, posture: 'Balanced' as const, observation: e.observe('norway'), history: [] };
  const d1 = await good.decide(req);
  report.assert(d1.action === 'maneuver' && d1.params.asset_id === 'kv_svalbard' && good.lastError === null, 'RemoteModel passes a valid decision through');
  const bad = new RemoteModel('http://model.invalid/decide', e.catalog.actions, { fetchImpl: fakeFetch({ action: 'launch_nukes' }) });
  const d2 = await bad.decide(req);
  report.assert(d2.action === 'hold' && (bad.lastError ?? '').includes('unknown action'), 'RemoteModel holds on an unknown action and says why');
  const down = new RemoteModel('http://model.invalid/decide', e.catalog.actions, { fetchImpl: fakeFetch({}, false) });
  const d3 = await down.decide(req);
  report.assert(d3.action === 'hold' && (down.lastError ?? '').includes('HTTP 500'), 'RemoteModel holds on a server error');
  const dead = new RemoteModel('http://model.invalid/decide', e.catalog.actions, { fetchImpl: (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch });
  const d4 = await dead.decide(req);
  report.assert(d4.action === 'hold' && (dead.lastError ?? '').includes('ECONNREFUSED'), 'RemoteModel holds when the model is unreachable');
}

// ---------------------------------------------------------------- 10. the catalog refuses what it does not understand

{
  const tamper = (fn: (r: CatalogRaw, s: Spec[]) => void, label: string, mention: string) => {
    const r = structuredClone(raw), s = structuredClone(specs);
    fn(r, s);
    let msg = '';
    try { new Catalog(r, s); } catch (err) { msg = err instanceof CatalogError ? err.message : `not a CatalogError: ${String(err)}`; }
    report.assert(msg.includes(mention), `${label}: expected the loader to name "${mention}", got "${msg || 'no error'}"`);
  };
  tamper((r) => { (r.ships[0] as unknown as Record<string, unknown>)['displacement_t'] = 4000; }, 'unknown ship field', 'displacement_t');
  tamper((r) => { r.control.norway.push('hms_nonexistent'); }, 'control names a ghost', 'hms_nonexistent');
  tamper((r) => { (r.ships[0] as unknown as Record<string, unknown>)['owner'] = 'atlantis'; }, 'unknown owner', 'atlantis');
  tamper((_, s) => { s[0]!.authority.unilateral.push('summon_kraken' as ActionId); }, 'spec names an unknown action', 'summon_kraken');
  tamper((_, s) => { s[0]!.authority.requires_release.push(s[0]!.authority.unilateral[0]!); }, 'action in two tiers', 'more than one authority tier');
  tamper((r) => { r.storm_factors.G5['ku_band_leo'] = 1.5; }, 'storm factor out of range', 'expected 0..1');
  report.assert(new Catalog(raw, specs).assets.length === 51, `the real catalog loads all 51 assets`);
}

// ---------------------------------------------------------------- coverage

{
  const c = new Catalog(raw, specs);
  for (const a of c.actions) report.assert(actionsCovered.has(a), `no case exercises action "${a}"`);
  for (const s of c.control.keys()) report.assert(seatsCovered.has(s), `no case exercises seat "${s}"`);
}

report.finish();
