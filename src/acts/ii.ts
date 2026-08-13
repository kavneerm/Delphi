/**
 * Act II — The Closed Frontier. art-direction.md §5.
 *
 * The shot: same street, same viewpoint. The town has been built upward and inward. Two
 * towers own the sky, the road is walled, and the only colour in the world belongs to
 * whoever owns the towers.
 *
 * The saturation rule is the argument. Cyan and magenta appear only on the two monoliths,
 * the blimp ad panels, and the road's reflection of those two sources — reflected, never
 * owned. Every human-scale element is grey. One warm window in the slums would destroy it.
 *
 * Ground plane, road and reflections live in slot 7's locked layer for the same reason as
 * Act I: slot 1 paints in front of slots 2–5, and anything registered to the VP can never
 * be transformed.
 */

import type { ActDefinition, Geometry, SlotArt } from './types.ts';
import type { Wind } from './shared.ts';
import {
  circle,
  depthScale,
  groundY,
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
  skyZenith: '#4A4A52',
  skyMid: '#8A7A6A',
  skyHorizon: '#B5A08A',
  monolith: '#1A1D24',
  cyan: '#00E5FF',
  magenta: '#FF2D95',
  slumA: '#5A5A5E',
  slumB: '#6E6E72',
  slumC: '#4A4A4E',
  slumWindow: '#8A8A80',
  blimp: '#3A3A3E',
  sun: '#8A7A6A',
  road: '#45454F',
  ground: '#4A4A50',
} as const;

const SLUM_LINE = shade(P.slumC, 0.2);
const ROAD_NEAR_HALF = 0.2;
/**
 * The road is walled part-way to the vanishing point. Depth runs from the VP (d=0) toward
 * the viewer (d=1), so the original 0.7 put the wall almost on top of the viewer and left
 * the road occupying the bottom 8% of the frame. 0.5 gives a wall with real road in front
 * of it and keeps the VP visible above it (§2).
 *
 * Slums further away than this are drawn *with* the wall in slot 4, not in slots 2–3 —
 * those paint in front of slot 4, so a slum behind the wall would otherwise paint over the
 * thing that is supposed to be blocking the view of it.
 */
const WALL_DEPTH = 0.5;

/**
 * The road weaves — but here the weave is squeezed rather than open: a tighter, shorter
 * wavelength than Act III's, hemmed by the slums, and it runs into a wall before it can
 * straighten out.
 */
const WIND: Wind = { amplitude: 0.075, frequency: 2.4, phase: -0.5 };
interface Slum {
  readonly side: -1 | 1;
  readonly d: number;
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  /** How far the upper floors overhang the road. The crowding is the point. */
  readonly lean: number;
}

/** Accreted, irregular, leaning over the road. Where Act I had gaps, this has none. */
const SLUMS: readonly Slum[] = [
  { side: -1, d: 0.14, width: 0.075, height: 0.78, seed: 3, lean: 0.28 },
  { side: 1, d: 0.16, width: 0.075, height: 0.7, seed: 5, lean: 0.24 },
  { side: -1, d: 0.23, width: 0.085, height: 0.92, seed: 7, lean: 0.32 },
  { side: 1, d: 0.26, width: 0.085, height: 0.84, seed: 11, lean: 0.28 },
  { side: -1, d: 0.34, width: 0.095, height: 1.02, seed: 13, lean: 0.34 },
  { side: 1, d: 0.38, width: 0.095, height: 0.94, seed: 17, lean: 0.3 },
  { side: -1, d: 0.5, width: 0.105, height: 1.14, seed: 19, lean: 0.36 },
  { side: 1, d: 0.55, width: 0.105, height: 1.06, seed: 23, lean: 0.32 },
  { side: -1, d: 0.72, width: 0.095, height: 1.26, seed: 29, lean: 0.4 },
  { side: 1, d: 0.8, width: 0.095, height: 1.2, seed: 31, lean: 0.36 },
  { side: -1, d: 1.02, width: 0.1, height: 1.4, seed: 37, lean: 0.44 },
  { side: 1, d: 1.12, width: 0.1, height: 1.34, seed: 41, lean: 0.4 },
];

function slumMarkup(geo: Geometry, s: Slum): string {
  const scale = depthScale(geo, s.d);
  const base = groundY(geo, s.d);
  const inner = roadCentre(geo, s.d, WIND) + s.side * roadHalf(geo, s.d, ROAD_NEAR_HALF, 0);
  const width = geo.w * s.width * scale;
  const height = (geo.h - geo.horizon) * s.height * scale;
  const x = s.side === -1 ? inner - width : inner;

  const fade = Math.max(0, (1 - s.d) * 0.34);
  const tones = [P.slumA, P.slumB, P.slumC].map((t) => tint(t, P.skyMid, fade));
  let out = '';
  let hash = (s.seed * 2654435761) >>> 0;
  const next = (): number => {
    hash = (hash * 1664525 + 1013904223) >>> 0;
    return (hash >>> 8) / 0x1000000;
  };

  // Stacked improvised floors, each offset and each leaning further over the road. Six
  // to nine of them, no two the same width — the silhouette has to read as accretion.
  const floors = 6 + Math.floor(next() * 4);
  let y = base;
  for (let i = 0; i < floors; i++) {
    const fh = (height / floors) * (0.72 + next() * 0.6);
    const grow = i / floors;
    const overhang = width * s.lean * grow * (0.5 + next() * 0.5);
    const fx = s.side === -1 ? x - overhang * 0 : x - overhang;
    const fw = width + overhang;
    const tone = tones[Math.floor(next() * tones.length)] ?? P.slumA;
    out += rect(fx, y - fh, fw, fh, tone);
    out += rect(fx, y - fh, fw, Math.max(fh * 0.06, 1), shade(tone, 0.3));

    // Dim windows. Never saturated — that is the whole argument.
    const cols = 2 + Math.floor(next() * 2);
    for (let c = 0; c < cols; c++) {
      if (next() > 0.62) continue;
      const ww = fw * 0.15;
      const wh = fh * 0.3;
      out += rect(fx + fw * (0.12 + c * 0.3), y - fh * 0.7, ww, wh, P.slumWindow);
    }

    // Tarps and awnings jutting into the street.
    if (next() > 0.55) {
      const tw = width * (0.3 + next() * 0.35);
      const tx = s.side === -1 ? fx + fw : fx - tw;
      out += poly(
        [
          [tx, y - fh * 0.9],
          [tx + tw, y - fh * 0.72],
          [tx + tw, y - fh * 0.5],
          [tx, y - fh * 0.62],
        ],
        shade(tone, 0.42),
      );
    }
    y -= fh;
  }

  // Antennas and pipework on the roof.
  const masts = 1 + Math.floor(next() * 3);
  for (let i = 0; i < masts; i++) {
    const mx = x + width * next();
    const mh = height * (0.06 + next() * 0.14);
    out += rect(mx, y - mh, Math.max(width * 0.012, 1), mh, P.slumC);
    if (next() > 0.6) {
      out += rect(mx - width * 0.03, y - mh, width * 0.07, Math.max(mh * 0.06, 1), P.slumC);
    }
  }
  const pipeX = s.side === -1 ? x + width * 0.88 : x + width * 0.06;
  out += rect(pipeX, y, Math.max(width * 0.03, 1.5), base - y, shade(P.slumC, 0.25));

  return out;
}

function build(geo: Geometry): readonly SlotArt[] {
  setPixelGrid(geo);
  const { w, h, horizon, vp, bleed } = geo;
  const left = -bleed;
  const full = w + bleed * 2;
  const below = h - horizon;
  const sunR = h * 0.055;

  // ---- slot 7 — sky, ground, road, reflections -----------------------------
  // The gradient compresses toward the horizon: less sky than Act I, because the
  // monoliths have taken it.
  const wallBase = groundY(geo, WALL_DEPTH);
  const wallTop = horizon + below * 0.085;

  // The road is paved and wet, and it stops at the wall — it never reaches the VP.
  // Stops at the wall — this is the one act whose road never reaches the VP (§2).
  const roadPoints = windingRoad(geo, ROAD_NEAR_HALF, WIND, { farD: WALL_DEPTH });

  // Reflected saturation: darker and lower in chroma than its source, and traceable to a
  // source directly above it (§5). These streak down from the two monoliths.
  let reflections = '';
  for (const [cx, colour] of [
    [0.38, P.cyan],
    [0.62, P.magenta],
  ] as const) {
    const refl = tint(colour, P.road, 0.5);
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const nearX = roadCentre(geo, 1, WIND) + (w * cx - vp) * (1.9 + t * 0.5);
      const farX = roadCentre(geo, WALL_DEPTH, WIND) + (w * cx - vp) * 0.55;
      const wdt = w * (0.006 + t * 0.012);
      reflections += poly(
        [
          [farX - wdt * 0.3, wallBase],
          [farX + wdt * 0.3, wallBase],
          [nearX + wdt, h + bleed],
          [nearX - wdt, h + bleed],
        ],
        refl,
        ` fill-opacity="${(0.72 - t * 0.09).toFixed(2)}"`,
      );
    }
  }

  const sky: SlotArt = {
    verb: 'crossfade',
    free:
      `<defs><linearGradient id="ii-sky" x1="0" y1="0" x2="0" y2="${r(horizon)}" gradientUnits="userSpaceOnUse">` +
      `<stop offset="0%" stop-color="${P.skyZenith}"/>` +
      `<stop offset="58%" stop-color="${P.skyZenith}"/>` +
      `<stop offset="82%" stop-color="${P.skyMid}"/>` +
      `<stop offset="100%" stop-color="${P.skyHorizon}"/>` +
      `</linearGradient></defs>` +
      rect(left, -bleed, full, horizon + bleed, 'url(#ii-sky)'),
    locked:
      // Sun still at the VP, occluded to a dim disc barely brighter than the smog.
      // Barely brighter than the smog, but brighter. tint(skyMid, skyHorizon, 0.35) sat
      // *below* the sky gradient's own value at that height, so the disc read as a hole.
      circle(vp, horizon, sunR * 1.25, tint(P.skyHorizon, '#FFFFFF', 0.08), ' fill-opacity="0.5"') +
      circle(vp, horizon, sunR, tint(P.skyHorizon, '#FFFFFF', 0.16)) +
      rect(left, horizon, full, below + bleed, P.ground) +
      poly(roadPoints, P.road) +
      reflections,
  };

  // ---- slot 6 — particulate haze, denser than Act I -------------------------
  const hazeBand = h * 0.09;
  const haze: SlotArt = {
    verb: 'crossfade',
    // Flat band, hard edges. §3 permits a smooth gradient in the slot 7 sky and
    // nowhere else; a ramped haze is the exact thing the pixel register forbids.
    free: rect(left, horizon - hazeBand, full, hazeBand * 2, P.skyMid, ' fill-opacity="0.45"'),
  };

  // ---- slot 5 — the two monoliths ------------------------------------------
  // Flanking the VP at 38vw and 62vw, rising past the top of the frame — no visible tops.
  // They are the brightest objects on screen and they own all the colour.
  let monoliths = '';
  for (const [cx, glass] of [
    [0.38, P.cyan],
    [0.62, P.magenta],
  ] as const) {
    const centre = w * cx;
    const halfW = w * 0.082;
    const top = -bleed;
    monoliths += rect(centre - halfW, top, halfW * 2, horizon - top, P.monolith);
    // One flat shadow step on the face away from the street.
    const away = Math.sign(centre - vp) || 1;
    monoliths += rect(
      away === -1 ? centre - halfW : centre + halfW * 0.42,
      top,
      halfW * 0.58,
      horizon - top,
      shade(P.monolith, 0.35),
    );

    // A cold, regular window grid. Regularity is the point — nothing here is human.
    const cols = 6;
    const rows = 30;
    const gridW = halfW * 1.5;
    const gridX = centre - gridW / 2;
    const cellW = gridW / cols;
    const cellH = (horizon - top) / rows;
    for (let row = 2; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const hash = ((row * 73856093) ^ (col * 19349663) ^ (cx * 1000)) >>> 0;
        if (hash % 100 > 82) continue;
        monoliths += rect(
          gridX + col * cellW + cellW * 0.2,
          top + row * cellH + cellH * 0.25,
          cellW * 0.6,
          cellH * 0.5,
          glass,
        );
      }
    }
  }

  const ridge: SlotArt = {
    verb: 'rise',
    clipBottom: horizon,
    free: monoliths,
  };

  // ---- slot 4 — the wall closing the road ----------------------------------
  // Continuous, no gate. The VP stays visible above it.
  const wallH = wallBase - wallTop;
  let wall = rect(left, wallTop, full, wallH + 4, shade(P.slumC, 0.12));
  // Vertical panel joints — the wall is cast in sections, and the repetition is the point.
  for (let i = 0; i <= 22; i++) {
    const bx = left + (full / 22) * i;
    wall += rect(bx - w * 0.0015, wallTop, w * 0.003, wallH, shade(P.slumC, 0.32));
  }
  // Capping course, and the smog catching its upper edge.
  wall += rect(left, wallTop, full, wallH * 0.09, shade(P.slumC, 0.34));
  wall += rect(left, wallTop, full, Math.max(wallH * 0.018, 2), tint(P.slumB, P.skyHorizon, 0.3));
  // A darker plinth where it meets the ground, so it sits rather than floats.
  wall += rect(left, wallBase - wallH * 0.12, full, wallH * 0.12 + 4, shade(P.slumC, 0.42));
  // Stains running down from the capping — the only texture this surface gets.
  for (let i = 0; i < 26; i++) {
    const sx = left + ((i * 137.5) % 100) / 100 * full;
    const sw = w * (0.004 + ((i * 7) % 5) / 5 * 0.01);
    wall += rect(sx, wallTop, sw, wallH * (0.3 + ((i * 11) % 7) / 7 * 0.5), shade(P.slumC, 0.26));
  }

  const behindWall = SLUMS.filter((sl) => sl.d < WALL_DEPTH)
    .map((sl) => slumMarkup(geo, sl))
    .join('');

  const far: SlotArt = {
    verb: 'rise',
    clipBottom: wallBase,
    // Slums first, wall second: the wall must occlude what stands behind it.
    free: outlined(behindWall, SLUM_LINE, 1.5) + wall,
  };

  // ---- slots 3 and 2 — the slums -------------------------------------------
  const mid: SlotArt = {
    verb: 'extrude',
    clipBottom: groundY(geo, 0.8),
    free: outlined(
      SLUMS.filter((sl) => sl.d >= WALL_DEPTH && sl.d < 0.8)
        .map((sl) => slumMarkup(geo, sl))
        .join(''),
      SLUM_LINE,
      1.5,
    ),
  };

  const near: SlotArt = {
    verb: 'extrude',
    clipBottom: h + bleed,
    free: outlined(
      SLUMS.filter((sl) => sl.d >= 0.8)
        .map((sl) => slumMarkup(geo, sl))
        .join(''),
      SLUM_LINE,
      2.5,
    ),
  };

  // ---- slot 1 — near ground. Nothing full-width (build.md B11). -------------
  let foreground = '';
  for (let i = 0; i < 16; i++) {
    const t = ((i * 41) % 100) / 100;
    const x = w * (0.02 + t * 0.96);
    const y = h - below * (0.004 + (((i * 17) % 7) / 7) * 0.05);
    const s = w * (0.003 + (((i * 13) % 5) / 5) * 0.005);
    foreground += rect(x - s, y - s * 0.5, s * 2, s * 0.5, shade(P.road, 0.3));
  }

  const ground: SlotArt = { verb: 'crossfade', free: foreground };

  // ---- slot 0 — blimps and ash ---------------------------------------------
  // Invented glyph forms on the ad panels: original geometric constructions that read as
  // writing without being any real script (§5). Never real text in any language.
  const glyph = (gx: number, gy: number, size: number, seed: number, fill: string): string => {
    let hash = (seed * 2654435761) >>> 0;
    const next = (): number => {
      hash = (hash * 1664525 + 1013904223) >>> 0;
      return (hash >>> 8) / 0x1000000;
    };
    let out = '';
    const strokes = 3 + Math.floor(next() * 3);
    for (let i = 0; i < strokes; i++) {
      const vertical = next() > 0.45;
      const ox = gx + size * next() * 0.6;
      const oy = gy + size * next() * 0.6;
      if (vertical) {
        out += rect(ox, oy, Math.max(size * 0.1, 1), size * (0.3 + next() * 0.5), fill);
      } else {
        out += rect(ox, oy, size * (0.3 + next() * 0.6), Math.max(size * 0.1, 1), fill);
      }
    }
    return out;
  };

  const blimp = (cx: number, cy: number, len: number, panel: string, seed: number): string => {
    const bh = len * 0.34;
    // Blimp hull as stepped chunk bands rather than an ellipse.
    let out = '';
    const bands = 5;
    for (let i = 0; i < bands; i++) {
      const t = (i + 0.5) / bands;
      const bw = len * Math.sin(Math.PI * t);
      out += rect(cx - bw / 2, cy - bh / 2 + (bh / bands) * i, bw, bh / bands, P.blimp);
    }
    out += rect(cx - len * 0.36, cy + bh * 0.1, len * 0.72, bh * 0.22, shade(P.blimp, 0.3));
    out += rect(cx - len * 0.12, cy + bh * 0.42, len * 0.24, bh * 0.2, shade(P.blimp, 0.4));
    // The ad panel — one of only three places saturation is permitted.
    const pw = len * 0.46;
    const ph = bh * 0.44;
    out += rect(cx - pw / 2, cy - ph / 2, pw, ph, panel);
    for (let g = 0; g < 4; g++) {
      out += glyph(
        cx - pw / 2 + pw * 0.08 + g * pw * 0.23,
        cy - ph * 0.3,
        ph * 0.6,
        seed + g * 17,
        shade(panel, 0.62),
      );
    }
    return out;
  };

  // Ash falling. Grey, never warm.
  let ash = '';
  for (let i = 0; i < 40; i++) {
    const x = w * (((i * 37) % 100) / 100);
    const y = h * (((i * 61) % 100) / 100);
    ash += rect(x, y, Math.max(w * 0.0014, 1), Math.max(h * 0.005, 2), '#6E6E72', ' fill-opacity="0.4"');
  }

  return [
    {
      verb: 'drift',
      free: ash,
      // Three blimps at different depths and speeds, drifting horizontally.
      parts: [
        { markup: blimp(w * 0.24, h * 0.17, w * 0.2, P.magenta, 5), rate: 0.42 },
        { markup: blimp(w * 0.7, h * 0.09, w * 0.13, P.cyan, 23), rate: 0.26 },
        { markup: blimp(w * 0.52, h * 0.29, w * 0.09, P.magenta, 41), rate: 0.15 },
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

export const ACT_II: ActDefinition = {
  id: 'ii',
  name: 'Closed Frontier',
  build,
};
