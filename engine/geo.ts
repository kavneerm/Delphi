/**
 * Distance and pass windows.
 *
 * Distance is haversine on the sphere, which is accurate to well under a percent at these
 * ranges and is all a 50 km boarding limit or a 300 km jammer needs.
 *
 * Pass windows are a *model*, and this file says so once, here, so nobody has to rediscover
 * it: a low-orbit satellite gets a period derived from its altitude (Kepler)
 * or stated in hours, a phase fixed by its id, and a ten-minute window over the target
 * once per orbit. That is enough to produce the reject the design note wants — "Arctic Eye
 * next pass over Storfjorden 14:40Z" — and it is deterministic, so a check can assert it.
 * It is not orbital mechanics. HEO relays and MEO navigation are treated as continuously
 * available, which matches what the catalog says about their coverage.
 */

import type { Asset, LatLon } from './types.ts';

const EARTH_RADIUS_KM = 6371;
const MU_KM3_S2 = 398600.4418;         // Earth's gravitational parameter
const LEO_WINDOW_MIN = 10;

export function distanceKm(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Period in minutes from the orbit block: the stated value if there is one, else Kepler. */
export function periodMinutes(orbit: NonNullable<Asset['orbit']>): number {
  if (orbit.period_h) return orbit.period_h * 60;
  const alt = orbit.altitude_km ?? ((orbit.perigee_km ?? 0) + (orbit.apogee_km ?? 0)) / 2;
  const a = EARTH_RADIUS_KM + alt;
  return (2 * Math.PI * Math.sqrt(a ** 3 / MU_KM3_S2)) / 60;
}

/** FNV-1a, so a satellite's phase is fixed by its id and two runs agree. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/**
 * Whether a satellite makes discrete passes. Decided by altitude, never by `band`: the
 * catalog draws a 700 km sun-synchronous bird in the MEO band "for legibility", and keying
 * on that would make it permanently overhead. Anything under 2,000 km passes; HEO relays
 * and MEO navigation are continuous, which is what the catalog says about their coverage.
 */
export function isLowOrbit(orbit: NonNullable<Asset['orbit']>): boolean {
  const alt = orbit.altitude_km ?? ((orbit.perigee_km ?? 0) + (orbit.apogee_km ?? 0)) / 2;
  return alt > 0 && alt < 2000;
}

export interface Pass {
  inPass: boolean;
  /** Scenario minute the current or next window opens. */
  nextStart: number;
  /** Scenario minute it closes. */
  until: number;
}

/**
 * Whether `sat` can see the target at scenario minute `t`, and when it next can.
 * Satellites without an orbit block, and everything not in LEO, are always in pass.
 */
export function passWindow(sat: Asset, t: number): Pass {
  if (sat.kind !== 'satellite' || !sat.orbit || !isLowOrbit(sat.orbit)) {
    return { inPass: true, nextStart: t, until: Number.POSITIVE_INFINITY };
  }
  const period = periodMinutes(sat.orbit);
  const phase = (hash(sat.id) % Math.round(period * 60)) / 60;   // 0..period, to the second
  const sinceOpen = (((t - phase) % period) + period) % period;
  if (sinceOpen < LEO_WINDOW_MIN) {
    const start = t - sinceOpen;
    return { inPass: true, nextStart: start, until: start + LEO_WINDOW_MIN };
  }
  const nextStart = t + (period - sinceOpen);
  return { inPass: false, nextStart, until: nextStart + LEO_WINDOW_MIN };
}

/** Scenario minute → "14:40Z", given the scenario's T+0 clock in minutes after midnight. */
export function clock(t: number, t0Minutes: number): string {
  const m = ((t0Minutes + Math.round(t)) % 1440 + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}Z`;
}
