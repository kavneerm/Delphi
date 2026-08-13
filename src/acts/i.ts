/**
 * Act I — The Frontier, dawn. art-direction.md §4.
 *
 * The shot: standing at the near end of the street, looking down it. Road running past the
 * last building into open land, sun rising exactly where the road disappears. Nothing
 * blocks the way out.
 *
 * The town is three buildings, at Act IV's placements — client direction. What separates
 * this act from Act IV is the light, not the density: a risen sun against a horizon glow,
 * a warm palette against a cooled one, more windows lit, a narrower road.
 *
 * On where the ground lives. The brief's slot table puts "near ground, road surface,
 * shadows" in slot 1, which paints *in front of* slots 2–5. A ground plane spans every
 * depth at once, so putting its fill in a near slot occludes everything behind it — and
 * anything converging on the VP has to be VP-registered anyway. Base plane, road, ruts and
 * cast shadows therefore live in slot 7's locked group; slot 1 keeps only what is genuinely
 * nearer than the buildings.
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
  rect,
  roadHalf,
  setPixelGrid,
  shade,
  tint,
  windowGrid,
} from './shared.ts';

const P = {
  skyZenith: '#1B2A4A',
  skyUpper: '#4A5B8C',
  skyMid: '#C97B5A',
  skyLower: '#F2A65A',
  skyHorizon: '#FFD9A0',
  sunCore: '#FFE8B0',
  sunRim: '#FF9E4F',
  mesa: '#6B5B7B',
  midGround: '#A87C5F',
  desert: '#C89A6B',
  desertHigh: '#D8AC7C',
  desertShadow: '#7A5C4A',
  road: '#BC8F63',
  rut: '#A87C5F',
  town: '#3E2E2E',
  window: '#FFE8B0',
  accent: '#FF5E3A',
  castShadow: '#4A5B8C',
} as const;

const TOWN_LINE = shade(P.town, 0.2);
const RIM = '#8A5A3E';
const RIM_FAR = '#6E4636';
const ROAD_NEAR_HALF = 0.24;

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

/** Three buildings, matching Act IV's marks so the loop reads as one place. */
const TOWN: readonly Building[] = [
  { side: -1, d: 0.34, width: 0.13, height: 0.82, falseFront: true, cols: 2, rows: 2, seed: 13 },
  { side: 1, d: 0.62, width: 0.15, height: 0.96, falseFront: false, cols: 3, rows: 3, seed: 23 },
  { side: -1, d: 1.04, width: 0.17, height: 1.1, falseFront: true, cols: 3, rows: 4, seed: 29 },
];

function facade(
  geo: Geometry,
  b: Building,
): { x: number; width: number; base: number; height: number } {
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
  // Aerial perspective: the further the facade, the more haze between it and the viewer.
  const body = tint(P.town, P.skyHorizon, Math.max(0, (1 - b.d) * 0.3));
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

  // Porch awning on the road side, and the post holding it up.
  const awning = width * 0.24;
  const awningX = b.side === -1 ? x + width - awning : x;
  const awningY = base - height * 0.3;
  out += rect(awningX, awningY, awning, height * 0.045, shade(body, 0.32));
  out += rect(
    b.side === -1 ? awningX : awningX + awning - width * 0.02,
    awningY,
    width * 0.02,
    height * 0.3,
    shade(body, 0.36),
  );

  out += windowGrid({
    x: x + width * 0.12,
    y: roofY + height * 0.2,
    w: width * 0.76,
    h: height * 0.44,
    cols: b.cols,
    rows: b.rows,
    fill: P.window,
    density: 0.52 + ((b.seed * 37) % 30) / 100,
    seed: b.seed,
  });

  // Roof furniture, so the skyline is not a row of flat-topped boxes. Deterministic.
  const roofSeed = b.seed * 2654435761;
  if (roofSeed % 3 !== 0) {
    const cw = width * 0.09;
    const cx = x + width * (0.2 + ((roofSeed >>> 7) % 50) / 100);
    out += rect(cx, roofY - height * 0.13, cw, height * 0.13, body);
    out += rect(cx - cw * 0.2, roofY - height * 0.15, cw * 1.4, height * 0.025, shade(body, 0.3));
  }

  // Rim light: the sun is at the VP, so the road-facing vertical edge catches it. The
  // third of §3's three tonal steps, flat, no gradient.
  const rimW = Math.max(width * 0.018, 2.5);
  const rimTone = tint(b.d < 0.6 ? RIM_FAR : RIM, P.sunRim, 0.55);
  out += rect(b.side === -1 ? x + width - rimW : x, roofY, rimW, height, rimTone);

  return out;
}

/** The shadow a building throws toward the viewer, the sun being at the vanishing point. */
function castShadow(geo: Geometry, b: Building): string {
  const { x, width, base } = facade(geo, b);
  const scale = depthScale(geo, b.d);
  // Long, and mostly toward the viewer: the sun is low and directly at the VP, so the
  // lateral component is small. A wide splay reads as a grey slab beside the building.
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

/** A bird: chunk staircases, never a curve. §3 forbids curves and sub-chunk detail alike. */
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
  const sunR = h * 0.09;

  // ---- slot 7 — sky, sun, ground plane, road, ruts, shadows ----------------
  const roadPoints: (readonly [number, number])[] = [
    [vp - roadHalf(geo, 1.0, ROAD_NEAR_HALF, 0), h + bleed],
    [vp, horizon],
    [vp, horizon],
    [vp + roadHalf(geo, 1.0, ROAD_NEAR_HALF, 0), h + bleed],
  ];

  let ruts = '';
  for (const k of [-0.62, -0.2, 0.2, 0.62] as const) {
    ruts += line(
      vp + roadHalf(geo, 1.0, ROAD_NEAR_HALF, 0) * k,
      h + bleed,
      vp,
      horizon,
      P.rut,
      2,
      ' fill-opacity="0.45"',
    );
  }

  const sky: SlotArt = {
    verb: 'crossfade',
    // The only smooth gradient in the build (§3).
    free:
      `<defs><linearGradient id="i-sky" x1="0" y1="0" x2="0" y2="${horizon}" gradientUnits="userSpaceOnUse">` +
      `<stop offset="0%" stop-color="${P.skyZenith}"/>` +
      `<stop offset="32%" stop-color="${P.skyUpper}"/>` +
      `<stop offset="64%" stop-color="${P.skyMid}"/>` +
      `<stop offset="84%" stop-color="${P.skyLower}"/>` +
      `<stop offset="100%" stop-color="${P.skyHorizon}"/>` +
      `</linearGradient></defs>` +
      rect(left, -bleed, full, horizon + bleed, 'url(#i-sky)'),
    // Everything registered to an anchor, in paint order: the sun rises *behind* the
    // ground plane, so the plane follows it. All of it is horizon- or VP-registered and
    // therefore never transformed.
    locked:
      circle(vp, horizon, sunR * 1.13, P.sunRim) +
      circle(vp, horizon, sunR, P.sunCore) +
      rect(left, horizon, full, below + bleed, P.desert) +
      // Base, highlight, shadow — the three steps §3 permits.
      poly(
        [
          [left, horizon],
          [w + bleed, horizon],
          [w + bleed, horizon + below * 0.1],
          [left, horizon + below * 0.16],
        ],
        P.desertHigh,
      ) +
      poly(
        [
          [left, horizon + below * 0.52],
          [w * 0.36, horizon + below * 0.42],
          [w * 0.48, horizon + below * 0.74],
          [left, horizon + below * 0.92],
        ],
        P.desertShadow,
        ' fill-opacity="0.34"',
      ) +
      poly(
        [
          [w * 0.68, horizon + below * 0.46],
          [w + bleed, horizon + below * 0.36],
          [w + bleed, horizon + below * 0.8],
          [w * 0.6, horizon + below * 0.66],
        ],
        P.desertShadow,
        ' fill-opacity="0.34"',
      ) +
      poly(roadPoints, P.road) +
      ruts +
      `<g style="mix-blend-mode:multiply" opacity="0.4">` +
      TOWN.map((b) => castShadow(geo, b)).join('') +
      `</g>`,
  };

  // ---- slot 6 — haze -------------------------------------------------------
  const hazeBand = h * 0.06;
  const haze: SlotArt = {
    verb: 'crossfade',
    // Flat band, hard edges. §3 permits a smooth gradient in the slot 7 sky and nowhere
    // else; a ramped haze is the exact thing the pixel register forbids.
    free: rect(left, horizon - hazeBand, full, hazeBand * 2, P.skyHorizon, ' fill-opacity="0.3"'),
  };

  // ---- slot 5 — three mesas, tallest at 20vw and 80vw, none across the VP ---
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
    // Flat top with one step down, battered sides. Two tones, no stroke (§3 slots 4–5).
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

  // ---- slot 4 — scrub, and the fence line running to the VP -----------------
  let scrub = '';
  for (let i = 0; i < 30; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const d = 0.05 + ((i * 11) % 29) / 52;
    const y = groundY(geo, d);
    const sc = depthScale(geo, d);
    const spread = ((i * 37) % 100) / 100;
    const x = vp + side * (roadHalf(geo, d, ROAD_NEAR_HALF, 0) + w * (0.05 + spread * 1.9) * sc);
    if (x < left || x > w + bleed || !clearsVP(geo, x, w * 0.03 * sc)) continue;
    const bw = w * 0.03 * sc;
    const bh = below * 0.06 * sc;
    scrub += poly(
      [
        [x - bw, y],
        [x - bw * 0.28, y - bh],
        [x + bw * 0.34, y - bh * 0.72],
        [x + bw, y],
      ],
      P.midGround,
    );
    scrub += poly(
      [
        [x + bw * 0.1, y],
        [x + bw * 0.34, y - bh * 0.72],
        [x + bw, y],
      ],
      shade(P.midGround, 0.28),
    );
  }

  // Posts march toward the VP; the rails converge on it exactly.
  let fence = '';
  for (const side of [-1, 1] as const) {
    for (let i = 1; i <= 16; i++) {
      const d = Math.pow(i / 16, 2.2) * 0.66;
      const y = groundY(geo, d);
      const sc = depthScale(geo, d);
      const x = vp + side * (roadHalf(geo, d, ROAD_NEAR_HALF, 0) + w * 0.3 * sc);
      const postH = below * 0.05 * sc;
      if (x < left || x > w + bleed || !clearsVP(geo, x)) continue;
      fence += rect(x - w * 0.0015 * sc, y - postH, w * 0.003 * sc, postH, P.midGround);
    }
    const nd = 0.66;
    const ns = depthScale(geo, nd);
    const nx = vp + side * (roadHalf(geo, nd, ROAD_NEAR_HALF, 0) + w * 0.3 * ns);
    const ny = groundY(geo, nd);
    fence += line(nx, ny - below * 0.05 * ns, vp, horizon, P.midGround, 1.2, ' fill-opacity="0.8"');
    fence += line(nx, ny - below * 0.018 * ns, vp, horizon, P.midGround, 1.2, ' fill-opacity="0.5"');
  }

  const far: SlotArt = {
    verb: 'rise',
    clipBottom: groundY(geo, 0.72),
    travelPx: below * 0.85,
    free: scrub,
    locked: fence,
  };

  // ---- street furniture, so the middle distance is not an empty wedge -------
  let streetProps = '';
  for (const [d, side, kind] of [
    [0.36, -1, 'rail'],
    [0.6, 1, 'barrel'],
    [0.66, 1, 'trough'],
    [1.02, -1, 'barrel'],
  ] as const) {
    const sc = depthScale(geo, d);
    const gy = groundY(geo, d);
    const px = vp + side * (roadHalf(geo, d, ROAD_NEAR_HALF, 0) * 0.82);
    const tone = shade(tint(P.town, P.skyHorizon, Math.max(0, (1 - d) * 0.3)), 0.15);
    if (kind === 'rail') {
      const railW = w * 0.055 * sc;
      const railH = below * 0.075 * sc;
      streetProps += rect(px - railW / 2, gy - railH, w * 0.0035 * sc, railH, tone);
      streetProps += rect(px + railW / 2, gy - railH, w * 0.0035 * sc, railH, tone);
      streetProps += rect(px - railW / 2, gy - railH, railW, below * 0.008 * sc, tone);
    } else if (kind === 'barrel') {
      const bw = w * 0.016 * sc;
      const bh = below * 0.055 * sc;
      streetProps += rect(px - bw / 2, gy - bh, bw, bh, tone);
      streetProps += rect(px - bw * 0.56, gy - bh * 0.72, bw * 1.12, bh * 0.1, shade(tone, 0.3));
    } else {
      const tw = w * 0.05 * sc;
      streetProps += rect(px - tw / 2, gy - below * 0.03 * sc, tw, below * 0.03 * sc, tone);
    }
  }

  // ---- slots 3 and 2 — the town --------------------------------------------
  const mid: SlotArt = {
    verb: 'extrude',
    clipBottom: groundY(geo, 0.62),
    free: outlined(
      TOWN.filter((b) => b.d < 0.6)
        .map((b) => buildingMarkup(geo, b))
        .join('') + streetProps,
      TOWN_LINE,
      1.5,
    ),
  };

  // One accent, the last thing the eye finds: a lamp still lit over the nearest porch.
  const lampHost = TOWN.filter((b) => b.d >= 0.6).reduce((a, b) => (b.d > a.d ? b : a));
  const lampFacade = facade(geo, lampHost);
  const lampX = lampFacade.x + lampFacade.width * 0.86;
  const lampY = lampFacade.base - lampFacade.height * 0.34;
  const lampR = Math.max(w * 0.0055, 3.2);
  const lamp =
    line(lampX, lampY - lampR * 2.6, lampX, lampY - lampR, P.town, Math.max(lampR * 0.5, 1.5)) +
    circle(lampX, lampY, lampR, P.accent) +
    circle(lampX, lampY, lampR * 0.5, P.window);

  const near: SlotArt = {
    verb: 'extrude',
    clipBottom: h + bleed,
    free:
      outlined(
        TOWN.filter((b) => b.d >= 0.6)
          .map((b) => buildingMarkup(geo, b))
          .join(''),
        TOWN_LINE,
        2.5,
      ) + lamp,
  };

  // ---- slot 1 — only things genuinely nearer than the buildings -------------
  // Nothing full-width here: a band across this slot occludes every structure behind it.
  let foreground = '';
  for (let i = 0; i < 14; i++) {
    const t = ((i * 41) % 100) / 100;
    const x = w * (0.02 + t * 0.96);
    const y = h - below * (0.005 + (((i * 17) % 7) / 7) * 0.06);
    const sz = w * (0.004 + (((i * 13) % 5) / 5) * 0.006);
    foreground += poly(
      [
        [x - sz, y],
        [x - sz * 0.4, y - sz * 0.75],
        [x + sz * 0.5, y - sz * 0.6],
        [x + sz, y],
      ],
      shade(P.desert, 0.34),
    );
  }
  for (let i = 0; i < 9; i++) {
    const x = w * (0.06 + (((i * 29) % 100) / 100) * 0.88);
    const y = h - below * (0.002 + (((i * 23) % 5) / 5) * 0.03);
    foreground += circle(x, y, w * 0.0035, P.desertShadow, ' fill-opacity="0.7"');
  }

  const ground: SlotArt = { verb: 'crossfade', free: foreground };

  // ---- slot 0 — tumbleweeds, motes, birds ----------------------------------
  const tumbleweed = (cx: number, cy: number, rad: number, spin: number): string => {
    const x = w * cx;
    const y = h * cy;
    const rr = h * rad;
    let out = circle(x, y, rr * 0.55, P.desertShadow);
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + spin;
      out += line(
        x + Math.cos(a) * rr * 0.2,
        y + Math.sin(a) * rr * 0.2,
        x + Math.cos(a * 1.7 + spin) * rr,
        y + Math.sin(a * 1.7 + spin) * rr,
        P.desertShadow,
        Math.max(rr * 0.14, 2),
      );
    }
    return out;
  };

  let props = '';
  // Dust motes. Dim — anything brighter reads as a flare over a facade, and the look is
  // printed, not rendered.
  for (let i = 0; i < 20; i++) {
    const x = w * (((i * 37) % 100) / 100);
    const y = horizon + below * (((i * 61) % 100) / 100) * 0.95;
    props += circle(x, y, h * 0.0015, P.skyHorizon, ' fill-opacity="0.09"');
  }
  for (const [cx, cy, sc] of [
    [0.38, 0.22, 1],
    [0.46, 0.175, 0.78],
    [0.55, 0.245, 0.88],
  ] as const) {
    props += bird(w * cx, h * cy, h * 0.018 * sc, P.town);
  }

  return [
    {
      verb: 'drift',
      free: props,
      // Two tumbleweeds crossing at different speeds (§4 slot 0). Two shapes in one markup
      // string share one transform and cannot differ.
      parts: [
        { markup: tumbleweed(0.36, 0.93, 0.042, 0), rate: 0.5 },
        { markup: tumbleweed(0.6, 0.82, 0.024, 1.1), rate: 0.28 },
      ],
    },
    ground,
    near,
    mid,
    far,
    ridge,
    haze,
    sky,
  ];
}

export const ACT_I: ActDefinition = {
  id: 'i',
  name: 'The Frontier',
  build,
};
