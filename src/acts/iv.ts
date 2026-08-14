/**
 * Act IV — The Frontier Returns. art-direction.md §7.
 *
 * Act I's composition and palette, cooled: bluer, earlier, pre-dawn rather than dawn. It
 * must be recognisable as the same place, and it must read as *earlier* than Act I, not
 * later. The argument is that the choice is still open.
 *
 * Three changes from Act I:
 *   1. the town is sparser — two or three buildings, not a full street
 *   2. the road is wider and the open land beyond it takes more of the frame
 *   3. no sun disc yet — a glow at the horizon, sun not risen
 *
 * Slot 0 is a single tumbleweed and one bird. Nothing else.
 */

import type { ActDefinition, Geometry, SlotArt } from './types.ts';
import {
  circle,
  clearsVP,
  depthScale,
  groundY,
  line,
  outlined,
  poly,
  r,
  rect,
  roadHalf,
  setPixelGrid,
  shade,
  tint,
  windowGrid,
} from './shared.ts';

/** Act I's palette, cooled. Slightly bluer, slightly earlier. */
const P = {
  skyZenith: '#16243F',
  skyUpper: '#405080',
  skyMid: '#B86F52',
  skyLower: '#F2A65A',
  skyHorizon: '#FFD9A0',
  glow: '#FFCE93',
  mesa: '#5F5170',
  midGround: '#96705A',
  desert: '#B08A62',
  desertShadow: '#6E5344',
  town: '#33272B',
  window: '#FFE2A4',
  accent: '#FF5E3A',
  castShadow: '#405080',
} as const;

const TOWN_LINE = shade(P.town, 0.2);
const RIM = '#7A4E3C';
/** Wider than Act I's 0.2 — the road opens back up and the land takes more frame. */
const ROAD_NEAR_HALF = 0.26;

interface Building {
  readonly side: -1 | 1;
  readonly d: number;
  readonly width: number;
  readonly height: number;
  readonly falseFront: boolean;
  readonly cols: number;
  readonly rows: number;
  readonly seed: number;
}

/**
 * Eight buildings, forming a street rather than three towers in open desert.
 *
 * Two changes from the original three, both at the client's direction and both about
 * matching the reference: **shorter** — heights drop from 0.82-1.10 of the ground plane to
 * 0.40-0.62, so these read as two-storey frontier buildings rather than blocks — and
 * **denser**, alternating sides down the road so the eye is led to the vanishing point by a
 * continuous receding wall. Wider relative to their height, too, which is what a false-front
 * street actually looks like.
 *
 * Act I and Act IV share these marks exactly, so the loop reads as one place seen twice.
 * Change one and you must change the other.
 */
const TOWN: readonly Building[] = [
  { side: -1, d: 0.2, width: 0.1, height: 0.4, falseFront: true, cols: 2, rows: 1, seed: 7 },
  { side: 1, d: 0.25, width: 0.11, height: 0.44, falseFront: false, cols: 2, rows: 1, seed: 11 },
  { side: -1, d: 0.36, width: 0.14, height: 0.5, falseFront: true, cols: 3, rows: 2, seed: 13 },
  { side: 1, d: 0.45, width: 0.15, height: 0.45, falseFront: false, cols: 3, rows: 2, seed: 19 },
  { side: -1, d: 0.62, width: 0.17, height: 0.57, falseFront: true, cols: 3, rows: 2, seed: 23 },
  { side: 1, d: 0.75, width: 0.18, height: 0.52, falseFront: false, cols: 3, rows: 2, seed: 29 },
  { side: -1, d: 1.02, width: 0.2, height: 0.62, falseFront: true, cols: 4, rows: 2, seed: 31 },
  { side: 1, d: 1.16, width: 0.21, height: 0.56, falseFront: false, cols: 4, rows: 2, seed: 37 },
];

function facade(geo: Geometry, b: Building): { x: number; width: number; base: number; height: number } {
  const scale = depthScale(geo, b.d);
  const base = groundY(geo, b.d);
  const inner = geo.vp + b.side * roadHalf(geo, b.d, ROAD_NEAR_HALF, 0);
  const width = geo.w * b.width * scale;
  const height = (geo.h - geo.horizon) * b.height * scale;
  return { x: b.side === -1 ? inner - width : inner, width, base, height };
}

function buildingMarkup(geo: Geometry, b: Building): string {
  const { x, width, base, height } = facade(geo, b);
  const roofY = base - height;
  const body = tint(P.town, P.skyHorizon, Math.max(0, (1 - b.d) * 0.26));
  let out = rect(x, roofY, width, height, body);

  if (b.falseFront) {
    const parapet = height * 0.15;
    out += rect(x - width * 0.03, roofY - parapet, width * 1.06, parapet, body);
    out += rect(x - width * 0.03, roofY - parapet, width * 1.06, parapet * 0.24, shade(body, 0.3));
  } else {
    const pitch = height * 0.13;
    out += poly(
      [
        [x - width * 0.05, roofY],
        [x + width / 2, roofY - pitch],
        [x + width * 1.05, roofY],
      ],
      shade(body, 0.3),
    );
  }

  const awning = width * 0.24;
  const awningX = b.side === -1 ? x + width - awning : x;
  out += rect(awningX, base - height * 0.3, awning, height * 0.045, shade(body, 0.32));

  // Fewer windows lit than Act I — it is earlier, and the town is barely awake.
  out += windowGrid({
    x: x + width * 0.12,
    y: roofY + height * 0.2,
    w: width * 0.76,
    h: height * 0.44,
    cols: b.cols,
    rows: b.rows,
    fill: P.window,
    density: 0.34,
    seed: b.seed,
  });

  const roofSeed = b.seed * 2654435761;
  if (roofSeed % 3 !== 0) {
    const cw = width * 0.09;
    const cx = x + width * (0.2 + ((roofSeed >>> 7) % 50) / 100);
    out += rect(cx, roofY - height * 0.13, cw, height * 0.13, body);
  }

  // Rim light, but from a glow rather than a disc — dimmer and cooler than Act I's.
  const rimW = Math.max(width * 0.018, 2.5);
  const rimX = b.side === -1 ? x + width - rimW : x;
  out += rect(rimX, roofY, rimW, height, tint(RIM, P.glow, 0.32));

  return out;
}

function castShadow(geo: Geometry, b: Building): string {
  const { x, width, base } = facade(geo, b);
  const scale = depthScale(geo, b.d);
  const length = (geo.h - geo.horizon) * 1.15 * scale;
  const spread = ((x + width / 2 - geo.vp) / geo.w) * length * 0.75;
  return poly(
    [
      [x, base],
      [x + width, base],
      [x + width + spread, base + length],
      [x + spread, base + length],
    ],
    P.castShadow,
  );
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

  // ---- slot 7 — sky, ground, road, glow (no sun disc) ----------------------
  const roadPoints: (readonly [number, number])[] = [
    [vp - roadHalf(geo, 1.0, ROAD_NEAR_HALF, 0), h + bleed],
    [vp, horizon],
    [vp, horizon],
    [vp + roadHalf(geo, 1.0, ROAD_NEAR_HALF, 0), h + bleed],
  ];

  let ruts = '';
  for (const k of [-0.6, -0.2, 0.2, 0.6] as const) {
    ruts += line(
      vp + roadHalf(geo, 1.0, ROAD_NEAR_HALF, 0) * k,
      h + bleed,
      vp,
      horizon,
      shade(P.desert, 0.16),
      2,
      ' stroke-opacity="0.4"',
    );
  }

  const glowR = h * 0.16;
  const sky: SlotArt = {
    verb: 'crossfade',
    free:
      `<defs><linearGradient id="iv-sky" x1="0" y1="0" x2="0" y2="${r(horizon)}" gradientUnits="userSpaceOnUse">` +
      `<stop offset="0%" stop-color="${P.skyZenith}"/>` +
      `<stop offset="34%" stop-color="${P.skyUpper}"/>` +
      `<stop offset="68%" stop-color="${P.skyMid}"/>` +
      `<stop offset="88%" stop-color="${P.skyLower}"/>` +
      `<stop offset="100%" stop-color="${P.skyHorizon}"/>` +
      `</linearGradient>` +
      `</defs>` +
      rect(left, -bleed, full, horizon + bleed, 'url(#iv-sky)'),
    locked:
      // The glow where the sun will rise: concentric stepped bands, not a radial
      // gradient. Only the sky ramp is smooth (§3, amended).
      [0.28, 0.52, 0.78, 1.05, 1.4]
        .map((k, i) =>
          rect(
            vp - glowR * k * 1.7,
            horizon - glowR * k,
            glowR * k * 3.4,
            glowR * k,
            P.glow,
            ` fill-opacity="${(0.4 - i * 0.07).toFixed(2)}"`,
          ),
        )
        .reverse()
        .join('') +
      rect(left, horizon, full, below + bleed, P.desert) +
      poly(
        [
          [left, horizon],
          [w + bleed, horizon],
          [w + bleed, horizon + below * 0.1],
          [left, horizon + below * 0.16],
        ],
        tint(P.desert, P.skyHorizon, 0.14),
      ) +
      poly(
        [
          [left, horizon + below * 0.54],
          [w * 0.34, horizon + below * 0.44],
          [w * 0.44, horizon + below * 0.76],
          [left, horizon + below * 0.94],
        ],
        P.desertShadow,
        ' fill-opacity="0.34"',
      ) +
      poly(
        [
          [w * 0.7, horizon + below * 0.48],
          [w + bleed, horizon + below * 0.38],
          [w + bleed, horizon + below * 0.82],
          [w * 0.62, horizon + below * 0.68],
        ],
        P.desertShadow,
        ' fill-opacity="0.34"',
      ) +
      poly(roadPoints, shade(P.desert, 0.1)) +
      ruts +
      `<g style="mix-blend-mode:multiply" opacity="0.34">` +
      TOWN.map((b) => castShadow(geo, b)).join('') +
      `</g>`,
  };

  // ---- slot 6 — haze --------------------------------------------------------
  const hazeBand = h * 0.06;
  const haze: SlotArt = {
    verb: 'crossfade',
    // Flat band, hard edges. §3 permits a smooth gradient in the slot 7 sky and
    // nowhere else; a ramped haze is the exact thing the pixel register forbids.
    free: rect(left, horizon - hazeBand, full, hazeBand * 2, P.skyHorizon, ' fill-opacity="0.26"'),
  };

  // ---- slot 5 — the same three mesas, in the same places -------------------
  // The loop has to be recognisable as one place. Same positions as Act I, cooler tone.
  const mesaSpec = [
    { cx: 0.2, top: 0.245, halfW: 0.155, lean: 0.016 },
    { cx: 0.8, top: 0.225, halfW: 0.142, lean: -0.014 },
    { cx: 0.375, top: 0.115, halfW: 0.058, lean: 0.006 },
  ] as const;

  let mesas = '';
  for (const m of mesaSpec) {
    const cx = w * m.cx;
    const topY = horizon - h * m.top;
    const halfTop = w * m.halfW * 0.66;
    const halfBottom = w * m.halfW;
    const skew = w * m.lean;
    const stepX = halfTop * 0.28;
    const stepY = h * m.top * 0.13;
    mesas += poly(
      [
        [cx - halfBottom, horizon + bleed],
        [cx - halfTop + skew, topY + stepY],
        [cx - stepX + skew, topY + stepY],
        [cx - stepX + skew, topY],
        [cx + halfTop + skew, topY],
        [cx + halfBottom, horizon + bleed],
      ],
      P.mesa,
    );
    const away = Math.sign(cx - vp) || 1;
    mesas += poly(
      [
        [cx + away * halfBottom, horizon + bleed],
        [cx + away * halfTop + skew, topY],
        [cx + away * halfTop * 0.42 + skew, topY],
        [cx + away * halfBottom * 0.46, horizon + bleed],
      ],
      shade(P.mesa, 0.24),
    );
  }

  const ridge: SlotArt = {
    verb: 'rise',
    clipBottom: horizon,
    travelPx: h * 0.28,
    free: mesas,
  };

  // ---- slot 4 — scrub and the fence, thinner than Act I --------------------
  let scrub = '';
  for (let i = 0; i < 18; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const d = 0.05 + ((i * 11) % 29) / 52;
    const y = groundY(geo, d);
    const s = depthScale(geo, d);
    const spread = ((i * 37) % 100) / 100;
    const x = vp + side * (roadHalf(geo, d, ROAD_NEAR_HALF, 0) + w * (0.05 + spread * 1.9) * s);
    if (x < left || x > w + bleed || !clearsVP(geo, x, w * 0.03 * s)) continue;
    const bw = w * 0.03 * s;
    const bh = below * 0.06 * s;
    scrub += poly(
      [
        [x - bw, y],
        [x - bw * 0.28, y - bh],
        [x + bw * 0.34, y - bh * 0.72],
        [x + bw, y],
      ],
      P.midGround,
    );
  }

  // A few posts remain; the rails are down. Earlier, and less settled.
  let fence = '';
  for (const side of [-1, 1] as const) {
    for (let i = 1; i <= 9; i++) {
      const d = Math.pow(i / 9, 2.2) * 0.66;
      const y = groundY(geo, d);
      const s = depthScale(geo, d);
      const x = vp + side * (roadHalf(geo, d, ROAD_NEAR_HALF, 0) + w * 0.26 * s);
      const postH = below * 0.05 * s;
      if (x < left || x > w + bleed || !clearsVP(geo, x)) continue;
      fence += rect(x - Math.max(w * 0.0015 * s, 0.5), y - postH, Math.max(w * 0.003 * s, 1), postH, P.midGround);
    }
  }

  const far: SlotArt = {
    verb: 'rise',
    clipBottom: groundY(geo, 0.72),
    travelPx: below * 0.85,
    free: scrub,
    locked: fence,
  };

  // ---- slots 3 and 2 — the sparse town -------------------------------------
  const mid: SlotArt = {
    verb: 'extrude',
    clipBottom: groundY(geo, 0.62),
    free: outlined(
      TOWN.filter((b) => b.d < 0.6)
        .map((b) => buildingMarkup(geo, b))
        .join(''),
      TOWN_LINE,
      1.5,
    ),
  };

  const near: SlotArt = {
    verb: 'extrude',
    clipBottom: h + bleed,
    free: outlined(
      TOWN.filter((b) => b.d >= 0.6)
        .map((b) => buildingMarkup(geo, b))
        .join(''),
      TOWN_LINE,
      2.5,
    ),
  };

  // ---- slot 1 — near ground -------------------------------------------------
  let foreground = '';
  for (let i = 0; i < 10; i++) {
    const t = ((i * 41) % 100) / 100;
    const x = w * (0.02 + t * 0.96);
    const y = h - below * (0.005 + (((i * 17) % 7) / 7) * 0.06);
    const s = w * (0.004 + (((i * 13) % 5) / 5) * 0.006);
    foreground += poly(
      [
        [x - s, y],
        [x - s * 0.4, y - s * 0.75],
        [x + s * 0.5, y - s * 0.6],
        [x + s, y],
      ],
      shade(P.desert, 0.34),
    );
  }

  const ground: SlotArt = { verb: 'crossfade', free: foreground };

  // ---- slot 0 — a single tumbleweed. One bird. Nothing else. ---------------
  const tumbleweed = (cx: number, cy: number, rad: number): string => {
    const x = w * cx;
    const y = h * cy;
    const rr = h * rad;
    let out = circle(x, y, rr * 0.55, P.desertShadow);
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      out += line(
        x + Math.cos(a) * rr * 0.2,
        y + Math.sin(a) * rr * 0.2,
        x + Math.cos(a * 1.7) * rr,
        y + Math.sin(a * 1.7) * rr,
        P.desertShadow,
        Math.max(rr * 0.14, 2),
      );
    }
    return out;
  };

  const birdArt = bird(w * 0.44, h * 0.2, h * 0.017, P.town);

  // One accent: a lamp still burning on the last building, as in Act I.
  const lampHost = TOWN[TOWN.length - 1] as Building;
  const lampFacade = facade(geo, lampHost);
  const lampR = Math.max(w * 0.0055, 3.2);
  const lamp =
    circle(lampFacade.x + lampFacade.width * 0.86, lampFacade.base - lampFacade.height * 0.34, lampR, P.accent) +
    circle(lampFacade.x + lampFacade.width * 0.86, lampFacade.base - lampFacade.height * 0.34, lampR * 0.5, P.window);

  return [
    {
      verb: 'drift',
      free: birdArt,
      parts: [{ markup: tumbleweed(0.38, 0.9, 0.04), rate: 0.44 }],
    },
    ground,
    { ...near, free: near.free + lamp },
    mid,
    far,
    ridge,
    haze,
    sky,
  ];
}

export const ACT_IV: ActDefinition = {
  id: 'iv',
  name: 'The Frontier Returns',
  build,
};
