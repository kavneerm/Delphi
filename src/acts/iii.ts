/**
 * Act III — The Open Frontier. art-direction.md §6.
 *
 * The shot: same street, same viewpoint. The city is as dense as Act II, but you can see
 * the sky, the road reaches the horizon, there are people in it, and the light belongs to
 * everyone.
 *
 * This act carries the thesis. It uses **the identical cyan and magenta as Act II** — no
 * new palette — scattered through windows, signs, gardens and canals instead of owned by
 * two towers. Concentration versus distribution, argued in light rather than in copy.
 * §9 requires those hues across ≥20 distinct sources.
 */

import type { ActDefinition, Geometry, SlotArt } from './types.ts';
import type { Wind } from './shared.ts';
import {
  blockCircle,
  circle,
  clearsVP,
  meander,
  depthScale,
  groundY,
  line,
  outlined,
  poly,
  r,
  rect,
  roadCentre,
  roadHalf,
  windingRoad,
  setPixelGrid,
  shade,
  tint,
} from './shared.ts';

const P = {
  skyZenith: '#1E1B3A',
  skyUpper: '#3D2E5C',
  skyMid: '#7A4A7E',
  skyLower: '#E8825E',
  skyHorizon: '#FFC98C',
  tower: '#2A2440',
  warm: '#FFD98A',
  cyan: '#00E5FF',
  magenta: '#FF2D95',
  green: '#3DA871',
  greenLight: '#6ECF9E',
  greenShadow: '#1F7A52',
  water: '#4FC3D9',
  violet: '#C05EE8',
  mote: '#FFE9A8',
  road: '#8A7A5E',
} as const;

const LINE = shade(P.tower, 0.2);
const ROAD_NEAR_HALF = 0.2;
/** The canal crosses the street at 40% depth (§6 slots 3–2). */
const CANAL_DEPTH = 0.34;

/**
 * The road weaves through the landscape rather than ruling straight to the horizon. The
 * swing tapers to nothing at the vanishing point, so both edges still terminate exactly
 * there (§2). Everything that flanks the road measures from `roadCentre`, not from `vp`.
 */
const WIND: Wind = { amplitude: 0.115, frequency: 1.6, phase: 0.7 };

/** Deterministic PRNG. build() must be a pure function of geo. */
function rng(seed: number): () => number {
  let hash = (seed * 2654435761) >>> 0;
  return () => {
    hash = (hash * 1664525 + 1013904223) >>> 0;
    return (hash >>> 8) / 0x1000000;
  };
}

/**
 * Window light: warm, with cyan and magenta scattered irregularly through it. Every
 * saturated pane here is one of the ≥20 distributed sources the thesis requires.
 */
function windows(
  x: number,
  y: number,
  w: number,
  h: number,
  cols: number,
  rows: number,
  seed: number,
  scale: number,
): string {
  const next = rng(seed);
  const cellW = w / cols;
  const cellH = h / rows;
  let out = '';
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const roll = next();
      if (roll > 0.72) continue;
      // Roughly one pane in six is cyan or magenta — the same two hues Act II hoarded.
      const tone = roll < 0.09 ? P.cyan : roll < 0.17 ? P.magenta : P.warm;
      out += rect(
        x + col * cellW + cellW * 0.22,
        y + row * cellH + cellH * 0.24,
        Math.max(cellW * 0.52, 1.2 * scale),
        Math.max(cellH * 0.46, 1.2 * scale),
        tone,
      );
    }
  }
  return out;
}

/** A tree: trunk plus two flat canopy steps. No gradients on objects (§3). */
function tree(x: number, base: number, height: number, width: number, seed: number): string {
  const next = rng(seed);
  const trunkW = Math.max(width * 0.14, 1.2);
  let out = rect(x - trunkW / 2, base - height * 0.42, trunkW, height * 0.42, shade(P.green, 0.62));
  const cy = base - height * 0.66;
  const rx = width * (0.46 + next() * 0.16);
  const ry = height * (0.3 + next() * 0.1);
  // Canopy as three chunk clusters — two tones plus a shadow, no curves.
  out += blockCircle(x, cy, Math.max(rx, ry) * 0.92, P.green);
  out += blockCircle(x - rx * 0.26, cy - ry * 0.28, Math.max(rx, ry) * 0.56, P.greenLight);
  out += blockCircle(x + rx * 0.3, cy + ry * 0.22, Math.max(rx, ry) * 0.4, P.greenShadow);
  return out;
}

/** A bird: two chunk staircases, no curve. §3 forbids both curves and sub-chunk detail. */
function bird(x: number, y: number, size: number, tone: string): string {
  const t = Math.max(size * 0.22, 2);
  return (
    line(x - size, y, x - size * 0.34, y - size * 0.5, tone, t) +
    line(x - size * 0.34, y - size * 0.5, x, y, tone, t) +
    line(x, y, x + size * 0.34, y - size * 0.5, tone, t) +
    line(x + size * 0.34, y - size * 0.5, x + size, y, tone, t)
  );
}

function build(geo: Geometry): readonly SlotArt[] {
  setPixelGrid(geo);
  const { w, h, horizon, vp, bleed } = geo;
  const left = -bleed;
  const full = w + bleed * 2;
  const below = h - horizon;
  const sunR = h * 0.075;

  // ---- slot 7 — dusk sky, ground, road -------------------------------------
  // The sky is back: full height, more of it than Act II, and the sun is unoccluded.
  const roadPoints = windingRoad(geo, ROAD_NEAR_HALF, WIND);
  // Planted margins, following the same weave one-and-a-half road-widths out (§6 slot 1).
  const marginPoints = windingRoad(geo, ROAD_NEAR_HALF, WIND, { widen: 1.7 });

  const sky: SlotArt = {
    verb: 'crossfade',
    free:
      `<defs><linearGradient id="iii-sky" x1="0" y1="0" x2="0" y2="${r(horizon)}" gradientUnits="userSpaceOnUse">` +
      `<stop offset="0%" stop-color="${P.skyZenith}"/>` +
      `<stop offset="26%" stop-color="${P.skyUpper}"/>` +
      `<stop offset="54%" stop-color="${P.skyMid}"/>` +
      `<stop offset="80%" stop-color="${P.skyLower}"/>` +
      `<stop offset="100%" stop-color="${P.skyHorizon}"/>` +
      `</linearGradient></defs>` +
      rect(left, -bleed, full, horizon + bleed, 'url(#iii-sky)'),
    locked:
      circle(vp, horizon, sunR * 1.14, tint(P.skyLower, P.skyHorizon, 0.5)) +
      circle(vp, horizon, sunR, P.skyHorizon) +
      rect(left, horizon, full, below + bleed, shade(P.green, 0.5)) +
      // Paved ground nearer the viewer, parks beyond it — the city floor is not a lawn.
      poly(
        [
          [left, horizon + below * 0.34],
          [w + bleed, horizon + below * 0.28],
          [w + bleed, h + bleed],
          [left, h + bleed],
        ],
        shade(P.road, 0.42),
      ) +
      poly(
        [
          [left, horizon + below * 0.5],
          [w * 0.3, horizon + below * 0.44],
          [w * 0.24, h + bleed],
          [left, h + bleed],
        ],
        P.greenShadow,
      ) +
      poly(
        [
          [w * 0.76, horizon + below * 0.46],
          [w + bleed, horizon + below * 0.4],
          [w + bleed, h + bleed],
          [w * 0.82, h + bleed],
        ],
        P.greenShadow,
      ) +
      poly(marginPoints, P.green) +
      poly(roadPoints, P.road),
  };

  // ---- slot 6 — clean warm haze, no particulate ----------------------------
  const hazeBand = h * 0.06;
  const haze: SlotArt = {
    verb: 'crossfade',
    // Flat band, hard edges. §3 permits a smooth gradient in the slot 7 sky and
    // nowhere else; a ramped haze is the exact thing the pixel register forbids.
    free: rect(left, horizon - hazeBand, full, hazeBand * 2, P.skyHorizon, ' fill-opacity="0.32"'),
  };

  // ---- slot 5 — many towers, varied heights, none dominant -----------------
  // The tallest is shorter than Act II's monoliths, and none exceeds the frame. Rooftop
  // gardens read as green caps.
  let towers = '';
  const next5 = rng(97);
  for (let i = 0; i < 22; i++) {
    const cx = ((i + 0.5) / 22) * w + (next5() - 0.5) * w * 0.02;
    const tw = w * (0.032 + next5() * 0.03);
    if (!clearsVP(geo, cx, tw / 2)) continue;
    const th = below * (0.5 + next5() * 0.95);
    const top = horizon - th;
    towers += rect(cx - tw / 2, top, tw, th + bleed, P.tower);
    towers += rect(cx + tw * 0.22, top, tw * 0.28, th + bleed, shade(P.tower, 0.3));
    // Rooftop garden.
    towers += rect(cx - tw * 0.56, top - below * 0.016, tw * 1.12, below * 0.02, P.green);
    for (let g = 0; g < 3; g++) {
      towers += circle(
        cx - tw * 0.34 + g * tw * 0.34,
        top - below * 0.022,
        below * 0.011,
        g % 2 === 0 ? P.greenLight : P.green,
      );
    }
    towers += windows(cx - tw * 0.4, top + th * 0.06, tw * 0.8, th * 0.86, 3, Math.max(4, Math.round(th / (below * 0.075))), 200 + i * 13, 1);
  }

  const ridge: SlotArt = { verb: 'rise', clipBottom: horizon, free: towers };

  // ---- slot 4 — no wall. Mid-rise, terraced, planted. ----------------------
  let midrise = '';
  const next4 = rng(31);
  for (let i = 0; i < 16; i++) {
    const side: -1 | 1 = i % 2 === 0 ? -1 : 1;
    const d = 0.08 + (i / 16) * 0.5;
    const sc = depthScale(geo, d);
    const gy = groundY(geo, d);
    const bw = w * (0.05 + next4() * 0.04) * sc;
    const bh = below * (0.5 + next4() * 0.5) * sc;
    const bx = roadCentre(geo, d, WIND) + side * (roadHalf(geo, d, ROAD_NEAR_HALF, 0) + w * (0.03 + next4() * 0.28) * sc);
    // Nothing may occlude the vanishing point — the road has to reach the horizon.
    if (bx < left || bx > w + bleed || !clearsVP(geo, bx, bw / 2)) continue;
    // Terraces, each planted.
    const steps = 3;
    for (let t = 0; t < steps; t++) {
      const sw = bw * (1 - t * 0.2);
      const sh = bh / steps;
      const sy = gy - sh * (t + 1);
      midrise += rect(bx - sw / 2, sy, sw, sh, P.tower);
      midrise += rect(bx - sw / 2, sy, sw, Math.max(sh * 0.1, 1), P.green);
    }
    midrise += windows(bx - bw * 0.36, gy - bh * 0.92, bw * 0.72, bh * 0.8, 2, 4, 400 + i * 7, sc);
  }

  const far: SlotArt = {
    verb: 'rise',
    clipBottom: groundY(geo, 0.62),
    free: midrise,
  };

  // ---- slots 3 and 2 — street level ----------------------------------------
  // Trees along the road, a canal crossing at 40% depth, market stalls, awnings, a
  // footbridge. Buildings have gaps, courtyards, and light between them.
  const canalY = groundY(geo, CANAL_DEPTH);
  const canalScale = depthScale(geo, CANAL_DEPTH);
  const canalH = below * 0.2 * canalScale;
  const canalAmp = below * 0.075;
  const canalPath = meander(geo, canalY, canalH, canalAmp, 2.2, 0.4);
  let canal = poly(canalPath, P.water);
  // Banks follow the same meander, offset above and below.
  canal =
    poly(meander(geo, canalY - canalH * 0.2, canalH * 0.24, canalAmp, 2.2, 0.4), shade(P.road, 0.3)) +
    canal +
    poly(meander(geo, canalY + canalH * 0.94, canalH * 0.26, canalAmp, 2.2, 0.4), shade(P.road, 0.36)) +
    poly(meander(geo, canalY, Math.max(canalH * 0.16, 2), canalAmp, 2.2, 0.4), tint(P.water, '#FFFFFF', 0.35));
  // Footbridge over the canal, on the road axis.
  const bridgeHalf = roadHalf(geo, CANAL_DEPTH, ROAD_NEAR_HALF, 0) * 1.3;
  const bridgeX = roadCentre(geo, CANAL_DEPTH, WIND);
  const bridgeY = canalY + Math.sin(((bridgeX + bleed) / (w + bleed * 2)) * Math.PI * 2.2 + 0.4) * canalAmp;
  canal += poly(
    [
      [bridgeX - bridgeHalf, bridgeY + canalH * 1.1],
      [bridgeX - bridgeHalf * 0.6, bridgeY - canalH * 0.5],
      [bridgeX + bridgeHalf * 0.6, bridgeY - canalH * 0.5],
      [bridgeX + bridgeHalf, bridgeY + canalH * 1.1],
    ],
    shade(P.road, 0.25),
  );

  let midStreet = canal;
  const next3 = rng(53);
  for (let i = 0; i < 12; i++) {
    const side: -1 | 1 = i % 2 === 0 ? -1 : 1;
    const d = 0.16 + (i / 12) * 0.44;
    const sc = depthScale(geo, d);
    const gy = groundY(geo, d);
    const tx = roadCentre(geo, d, WIND) + side * (roadHalf(geo, d, ROAD_NEAR_HALF, 0) + w * 0.018 * sc);
    if (!clearsVP(geo, tx, w * 0.03 * sc)) continue;
    midStreet += tree(tx, gy, below * 0.34 * sc, w * 0.03 * sc, 600 + i * 11);
    // Market stalls with striped awnings — several carry a saturated canopy.
    if (next3() > 0.45) {
      const sw = w * 0.05 * sc;
      const sh = below * 0.08 * sc;
      const sx = tx + side * w * 0.05 * sc;
      const canopy = next3() > 0.5 ? P.magenta : P.cyan;
      midStreet += rect(sx - sw / 2, gy - sh, sw, sh, shade(P.tower, 0.1));
      midStreet += poly(
        [
          [sx - sw * 0.68, gy - sh],
          [sx + sw * 0.68, gy - sh],
          [sx + sw * 0.5, gy - sh * 1.34],
          [sx - sw * 0.5, gy - sh * 1.34],
        ],
        canopy,
      );
      midStreet += rect(sx - sw * 0.4, gy - sh * 0.7, sw * 0.8, sh * 0.3, P.warm);
    }
  }

  const mid: SlotArt = {
    verb: 'extrude',
    clipBottom: groundY(geo, 0.64),
    free: outlined(midStreet, LINE, 1.5),
  };

  // Near buildings with real gaps between them — the visual opposite of Act II's slums.
  let nearBuildings = '';
  const next2 = rng(71);
  for (const [side, d, wide] of [
    [-1, 0.72, 0.11],
    [1, 0.8, 0.115],
    [-1, 1.0, 0.125],
    [1, 1.12, 0.13],
  ] as const) {
    const sc = depthScale(geo, d);
    const gy = groundY(geo, d);
    const bw = w * wide * sc;
    const bh = below * (0.85 + next2() * 0.4) * sc;
    const bx = roadCentre(geo, d, WIND) + side * (roadHalf(geo, d, ROAD_NEAR_HALF, 0) + w * 0.02 * sc);
    const x = side === -1 ? bx - bw : bx;
    nearBuildings += rect(x, gy - bh, bw, bh, P.tower);
    // A courtyard gap cut into the mass, lit from within.
    nearBuildings += rect(x + bw * 0.36, gy - bh * 0.34, bw * 0.28, bh * 0.34, shade(P.tower, 0.45));
    nearBuildings += rect(x + bw * 0.4, gy - bh * 0.28, bw * 0.2, bh * 0.24, tint(P.warm, P.tower, 0.55));
    // Planted roof.
    nearBuildings += rect(x - bw * 0.03, gy - bh - below * 0.014 * sc, bw * 1.06, below * 0.016 * sc, P.green);
    nearBuildings += windows(x + bw * 0.08, gy - bh * 0.94, bw * 0.84, bh * 0.5, 3, 5, 800 + d * 100, sc);
    // Street trees in front.
    nearBuildings += tree(x + bw * (side === -1 ? 1.02 : -0.02), gy, below * 0.4 * sc, w * 0.036 * sc, 900 + d * 50);
  }

  const near: SlotArt = {
    verb: 'extrude',
    clipBottom: h + bleed,
    free: outlined(nearBuildings, LINE, 2.5),
  };

  // ---- slot 1 — people at ground level, in silhouette, small, several ------
  let people = '';
  const nextP = rng(17);
  for (let i = 0; i < 11; i++) {
    const d = 0.3 + nextP() * 0.75;
    const sc = depthScale(geo, d);
    const gy = groundY(geo, d);
    const side = nextP() > 0.5 ? 1 : -1;
    const px = roadCentre(geo, d, WIND) + side * roadHalf(geo, d, ROAD_NEAR_HALF, 0) * nextP() * 0.9;
    const ph = below * 0.1 * sc;
    const pw = ph * 0.3;
    const tone = shade(P.tower, 0.15);
    people += rect(px - pw / 2, gy - ph * 0.72, pw, ph * 0.72, tone);
    people += circle(px, gy - ph * 0.84, pw * 0.42, tone);
    people += rect(px - pw * 0.42, gy - ph * 0.3, pw * 0.32, ph * 0.3, tone);
    people += rect(px + pw * 0.1, gy - ph * 0.3, pw * 0.32, ph * 0.3, tone);
  }

  const ground: SlotArt = { verb: 'crossfade', free: people };

  // ---- slot 0 — music motes, leaves, birds ---------------------------------
  // Music renders as rising warm particles with a slight lateral drift, emitted from two
  // or three ground-level points. Never notation — that would look like clip art (§6).
  let motes = '';
  const nextM = rng(211);
  for (const [ex, ey] of [
    [0.33, 0.86],
    [0.66, 0.8],
    [0.5, 0.92],
  ] as const) {
    for (let i = 0; i < 26; i++) {
      const t = i / 26;
      const rise = below * 1.05 * t;
      const x = w * ex + (nextM() - 0.5) * w * 0.09 + Math.sin(t * 5.5) * w * 0.022;
      const y = h * ey - rise;
      const rad = Math.max(h * 0.0035 * (1 - t * 0.55), 1);
      motes += circle(x, y, rad, P.mote, ` fill-opacity="${(0.85 - t * 0.75).toFixed(2)}"`);
    }
  }
  for (let i = 0; i < 9; i++) {
    const x = w * nextM();
    const y = horizon + below * nextM() * 0.9;
    const s = h * 0.008;
    motes += rect(x, y, s * 1.6, s * 0.7, P.greenLight, ' fill-opacity="0.7"');
  }
  for (const [cx, cy, sc] of [
    [0.42, 0.2, 1],
    [0.5, 0.16, 0.8],
    [0.58, 0.225, 0.9],
  ] as const) {
    motes += bird(w * cx, h * cy, h * 0.016 * sc, P.violet);
  }

  return [
    { verb: 'drift', free: motes },
    ground,
    near,
    mid,
    far,
    ridge,
    haze,
    sky,
  ];
}

export const ACT_III: ActDefinition = {
  id: 'iii',
  name: 'Open Frontier',
  build,
};
