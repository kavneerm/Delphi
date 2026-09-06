// Two-body Keplerian propagation and a north-polar projection.
//
// The engine owns the real world state; the UI only needs a ground track that is
// geometrically honest enough to read. Circular LEO and a Molniya ellipse both
// fall out of the same solver, which is why this is Keplerian rather than a
// hard-coded circle.

const MU = 398600.4418; // km^3/s^2
const R_EARTH = 6378.137; // km
const OMEGA_EARTH = 7.2921159e-5; // rad/s
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Newton on Kepler's equation. Converges in a handful of steps for e < 0.9. */
function eccentricAnomaly(M, e) {
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 30; i++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const d = f / fp;
    E -= d;
    if (Math.abs(d) < 1e-11) break;
  }
  return E;
}

/**
 * Sub-satellite point at sim time t.
 *
 * Element keys are the engine's (`a_km`, `e`, `inc_deg`, `raan_deg`, `argp_deg`,
 * `m0_deg`, `epoch_s`) so ui/data/assets.json can be a straight copy of
 * engine.world.initial_state() with no translation layer to get wrong.
 *
 * @param {{a_km:number,e:number,inc_deg:number,raan_deg:number,argp_deg:number,m0_deg:number,epoch_s?:number}} el
 */
export function subpoint(el, t) {
  const a = el.a_km;
  const n = Math.sqrt(MU / (a * a * a));
  const M = el.m0_deg * D2R + n * (t - (el.epoch_s ?? 0));
  const E = eccentricAnomaly(((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), el.e);
  const nu = 2 * Math.atan2(
    Math.sqrt(1 + el.e) * Math.sin(E / 2),
    Math.sqrt(1 - el.e) * Math.cos(E / 2),
  );
  const r = a * (1 - el.e * Math.cos(E));

  const u = nu + el.argp_deg * D2R; // argument of latitude
  const inc = el.inc_deg * D2R;
  const raan = el.raan_deg * D2R;

  const cu = Math.cos(u);
  const su = Math.sin(u);
  const x = r * (Math.cos(raan) * cu - Math.sin(raan) * su * Math.cos(inc));
  const y = r * (Math.sin(raan) * cu + Math.cos(raan) * su * Math.cos(inc));
  const z = r * (su * Math.sin(inc));

  const lat = Math.asin(z / r) * R2D;
  let lon = (Math.atan2(y, x) - OMEGA_EARTH * t) * R2D;
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  return { lat, lon, altKm: r - R_EARTH, periodS: (2 * Math.PI) / n };
}

/**
 * Ground track sampled over a window around t, split where it leaves the map.
 *
 * The window is a fraction of the orbital period rather than a fixed number of
 * minutes: 40 minutes is a third of a LEO orbit but five per cent of a Molniya
 * one, so a fixed window draws the HEO nodes as near-straight stubs.
 */
export function groundTrack(el, t, { arcFraction = 0.45, samples = 220, latMin = 45 } = {}) {
  const a = el.a_km;
  const period = 2 * Math.PI * Math.sqrt((a * a * a) / MU);
  const halfWindow = (period * arcFraction) / 2;
  const stepS = (2 * halfWindow) / samples;
  const beforeS = halfWindow;
  const afterS = halfWindow;
  const segs = [];
  let cur = [];
  let prevLon = null;
  for (let dt = -beforeS; dt <= afterS; dt += stepS) {
    const p = subpoint(el, t + dt);
    const inside = p.lat >= latMin;
    // A jump across the antimeridian is a projection artefact, not a break in
    // the track; on a polar projection it is continuous, so only break on the
    // map edge.
    if (!inside) {
      if (cur.length > 1) segs.push(cur);
      cur = [];
      prevLon = null;
      continue;
    }
    cur.push({ ...p, dt });
    prevLon = p.lon;
  }
  if (cur.length > 1) segs.push(cur);
  return { segs, now: subpoint(el, t) };
}

/**
 * North-polar azimuthal equidistant projection.
 * lon0 is put at the top of the frame; 20E keeps Svalbard upright.
 */
export function makeProjection({ w, h, latMin = 45, lon0 = 20, pad = 8 }) {
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.min(w, h) / 2 - pad;
  const span = 90 - latMin;
  return {
    R,
    cx,
    cy,
    latMin,
    project(lat, lon) {
      const r = (R * (90 - lat)) / span;
      const th = (lon - lon0) * D2R;
      return [cx + r * Math.sin(th), cy - r * Math.cos(th)];
    },
    inside(lat) {
      return lat >= latMin;
    },
  };
}
