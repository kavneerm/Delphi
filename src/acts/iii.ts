/**
 * Act III — The Open Frontier. art-direction.md §6.
 *
 * The shot: same street, same viewpoint. The city is as dense as Act II, but you can see
 * the sky, the road reaches the horizon, there are people in it, and the light belongs to
 * everyone.
 *
 * This act carries the thesis. It uses **the identical cyan and magenta as Act II** — no
 * new palette — scattered through tower windows, terrace lights, market awnings, canal
 * reflections, lanterns and the things people are carrying, instead of owned by two
 * monoliths. Concentration versus distribution, argued in light rather than in copy.
 *
 * `docs/review-checklist.md` §4 is explicit that *counting* saturated regions measures the
 * grid rather than the art — adjacent windows merge on the pixel grid and the count halves
 * without anything changing. The measure that means what §1 claims is **spatial spread**:
 * what fraction of the frame's width carries any saturation. Act II covers 9–10 of 20
 * columns; Act III must cover 20 of 20. Every saturated source below is therefore placed
 * with respect to a column band, not scattered and hoped over.
 *
 * Substrate: the palette-indexed art buffer (`docs/plans/pixel-substrate.md`). `draw` /
 * `drawLocked` / `parts[].draw` paint art pixels and are what the scroll path renders.
 * The `free` / `locked` / `parts[].markup` strings beside them are the reduced-motion
 * path — `src/reduced.ts` still renders SVG only — and both are driven from the same spec
 * arrays, so the two describe one scene rather than two that drift apart.
 */

import type { ActDefinition, Geometry, SlotArt } from './types.ts';
import type { Buf } from '../art/buffer.ts';
import type { Wind } from './shared.ts';
import { gradientRamp, multiply, over, parseHex } from '../art/palette.ts';
import { cloudTones, drawBandedSun, drawCloudBand } from '../art/sky.ts';
import {
  circle,
  clearsVP,
  depthScale,
  groundY,
  line,
  meander,
  roadCentre,
  roadHalf,
  setPixelGrid,
  shade,
  shadeHue,
  tint,
  windingRoad,
} from './shared.ts';

/** art-direction.md §6, verbatim. Nothing here is invented and nothing is Act III's alone. */
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
const CANAL_DEPTH = 0.4;

/**
 * Act III's light, for `shadeHue`.
 *
 * `shade()` alone multiplies toward black, which holds the hue fixed and makes a facade
 * read as one colour at three brightnesses — measured, that is most of why the palette came
 * out shallow. Here a shadowed plane takes colour from the violet dusk above it and a lit
 * plane from the low warm sun at the vanishing point, which is the whole reason the frame
 * reads as lit from one place.
 */
const COOL = '#3D2E5C';
const WARM = '#FFC98C';
function hue(hex: string, amount: number): string {
  return shadeHue(hex, amount, COOL, WARM);
}

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

/** Deterministic integer hash of three ints. Same family as the sky's, no floats carried. */
function hash3(a: number, b: number, c: number): number {
  let x = (Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791)) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0);
}

/** 0..1 from `hash3`. */
function unit(a: number, b: number, c: number): number {
  return hash3(a, b, c) / 4294967296;
}

// ---------------------------------------------------------------------------
// Aerial perspective, in discrete bands
//
// A per-object haze tint is the obvious way to do distance, and it costs one palette
// entry per tone per object: 45 towers x 8 tones is 360 entries against a ceiling of 255,
// so it does not merely overrun the budget, it throws. Quantising distance into a handful
// of bands costs `bands x tones` instead — and it is what the reference city actually
// looks like, which is a stack of flat silhouettes at four or five separations rather than
// a continuous fog.
// ---------------------------------------------------------------------------

/** Haze applied to each of the three tower ranks and the four mid-rise depth bands. */
const TOWER_HAZE = [0.56, 0.36, 0.17] as const;
const MID_HAZE = [0.3, 0.22, 0.14, 0.06] as const;

interface Tones {
  readonly body: number;
  readonly lit: number;
  readonly dark: number;
  readonly roof: number;
  readonly garden: number;
  readonly gardenLit: number;
}

/** One rank's six surface tones, interned once and reused by every tower in the rank. */
function bandTones(buf: Buf, haze: number, label: string): Tones {
  const body = tint(P.tower, P.skyHorizon, haze);
  return {
    body: buf.tone(body, `${label} body`),
    lit: buf.tone(hue(body, -0.34), `${label} lit`),
    dark: buf.tone(hue(body, 0.3), `${label} dark`),
    roof: buf.tone(hue(body, 0.44), `${label} roof`),
    garden: buf.tone(tint(P.green, P.skyHorizon, haze), `${label} garden`),
    gardenLit: buf.tone(tint(P.greenLight, P.skyHorizon, haze), `${label} garden lit`),
  };
}

interface WindowTones {
  readonly warm: number;
  readonly cyan: number;
  readonly magenta: number;
  readonly dim: number;
}

/**
 * Window light, hazed to the same band as the facade carrying it.
 *
 * The saturated hues are Act II's, unchanged — `#00E5FF` and `#FF2D95`. They are pulled
 * toward the horizon glow by the same amount as the wall around them, because a pane that
 * stayed at full chroma four ranks back would read as nearer than the building it is in.
 */
function windowTones(buf: Buf, haze: number, label: string): WindowTones {
  return {
    warm: buf.tone(tint(P.warm, P.skyHorizon, haze * 0.6), `${label} window warm`),
    cyan: buf.tone(tint(P.cyan, P.skyHorizon, haze * 0.55), `${label} window cyan`),
    magenta: buf.tone(tint(P.magenta, P.skyHorizon, haze * 0.55), `${label} window magenta`),
    dim: buf.tone(tint(hue(P.tower, -0.2), P.skyHorizon, haze), `${label} window dim`),
  };
}

// ---------------------------------------------------------------------------
// Composition specs. Both emitters read these, so the buffer scene and the
// reduced-motion scene are the same scene.
// ---------------------------------------------------------------------------

interface Tower {
  readonly cx: number;
  readonly halfW: number;
  readonly base: number;
  readonly height: number;
  readonly rank: 0 | 1 | 2;
  readonly seed: number;
  readonly cols: number;
  readonly rows: number;
  readonly garden: boolean;
  /** 0 none, 1 antenna mast, 2 water tank, 3 both. */
  readonly mast: number;
  /** Upper setback as a fraction of the height, or 0. */
  readonly setback: number;
}

/**
 * The skyline: many towers of varied height, none dominant, none exceeding the frame.
 *
 * Three ranks rather than one row. A single row of equal-tone boxes reads as a bar chart;
 * the references stack three or four separations of the same city, each hazier and shorter
 * than the one in front, which is what gives a skyline depth without any of it being
 * bigger than the rest. Heights are capped so every top stands clear of the frame — that
 * is the structural difference from Act II, where the monoliths deliberately run off the
 * top.
 */
function towerField(geo: Geometry): Tower[] {
  const { w, h, horizon } = geo;
  const below = h - horizon;
  const ceiling = horizon - h * 0.07;
  const out: Tower[] = [];

  /**
   * Every dimension here is measured against the ground-to-horizon distance, not the frame
   * width — including the spacing, which sets the count.
   *
   * Taking widths from `geo.w` and heights from `below` looks harmless and is not: the two
   * scale independently across the viewport set, so the same code drew 6:1 towers at
   * 1440x900 and 20:1 pins at 390x844. It was two different cities from one spec. Pitch in
   * the same unit keeps the *density* constant too, so the narrow viewport gets fewer,
   * correctly-proportioned towers rather than the same count crushed together.
   */
  const ranks = [
    { pitch: 0.17, seed: 9001, wMin: 0.048, wSpan: 0.042, hMin: 0.3, hSpan: 0.36, rank: 0 as const },
    { pitch: 0.23, seed: 9203, wMin: 0.07, wSpan: 0.056, hMin: 0.46, hSpan: 0.48, rank: 1 as const },
    // The near rank's tallest must land *under* the ceiling rather than on it. At a span
    // that reaches it, every tall tower clips to the same line and the skyline grows a
    // flat top — the "none dominant" rule broken in the opposite direction from Act II's.
    { pitch: 0.31, seed: 9403, wMin: 0.095, wSpan: 0.076, hMin: 0.6, hSpan: 0.5, rank: 2 as const },
  ];

  for (const spec of ranks) {
    const pitch = below * spec.pitch;
    const n = Math.max(3, Math.ceil(w / pitch) + 1);
    for (let i = 0; i < n; i++) {
      const cx = (i + 0.5) * pitch + (unit(spec.seed, i, 1) - 0.5) * pitch * 0.72;
      const halfW = (below * (spec.wMin + unit(spec.seed, i, 2) * spec.wSpan)) / 2;
      if (!clearsVP(geo, cx, halfW)) continue;
      // The setback stands on top of the shaft, so the ceiling applies to the two of them
      // together. Capping the shaft alone let a setback tower run off the top of the frame
      // — which is Act II's move, and the one thing §6 says this skyline may not do.
      const setback = unit(spec.seed, i, 6) > 0.55 ? 0.22 + unit(spec.seed, i, 7) * 0.16 : 0;
      const height = Math.min(
        below * (spec.hMin + unit(spec.seed, i, 3) * spec.hSpan),
        ceiling / (1 + setback),
      );
      const rows = Math.max(3, Math.round(height / (below * 0.085)));
      out.push({
        cx,
        halfW,
        base: horizon,
        height,
        rank: spec.rank,
        seed: spec.seed + i * 17,
        cols: spec.rank === 0 ? 2 : 3,
        rows,
        // Rooftop gardens are the act's green caps, and they read at every rank — a garden
        // only on the near towers would make the far city look like Act II's.
        garden: unit(spec.seed, i, 4) > 0.28,
        mast: Math.floor(unit(spec.seed, i, 5) * 4),
        setback,
      });
    }
  }
  return out;
}

interface MidRise {
  readonly cx: number;
  readonly halfW: number;
  readonly base: number;
  readonly height: number;
  readonly band: number;
  readonly seed: number;
  readonly terraces: number;
  readonly side: -1 | 1;
}

/** Slot 4: the wall is gone. Terraced, planted mid-rise flanking a road that runs through. */
function midRiseField(geo: Geometry): MidRise[] {
  const { w, h, horizon, bleed } = geo;
  const below = h - horizon;
  const out: MidRise[] = [];
  const count = 24;
  for (let i = 0; i < count; i++) {
    const side: -1 | 1 = i % 2 === 0 ? -1 : 1;
    const d = 0.05 + (i / count) * 0.55;
    const sc = depthScale(geo, d);
    // Sized against `below` for the same reason the towers are — see `towerField`.
    const halfW = (below * (0.15 + unit(31, i, 1) * 0.13) * sc) / 2;
    const height = below * (0.42 + unit(31, i, 2) * 0.55) * sc;
    const cx =
      roadCentre(geo, d, WIND) +
      side * (roadHalf(geo, d, ROAD_NEAR_HALF, 0) + halfW + w * (0.01 + unit(31, i, 3) * 0.26) * sc);
    // Nothing may occlude the vanishing point — the road has to reach the horizon.
    if (cx < -bleed || cx > w + bleed || !clearsVP(geo, cx, halfW)) continue;
    out.push({
      cx,
      halfW,
      base: groundY(geo, d),
      height,
      band: Math.min(MID_HAZE.length - 1, Math.floor((d / 0.6) * MID_HAZE.length)),
      seed: 400 + i * 7,
      terraces: 3,
      side,
    });
  }
  return out;
}

interface LowRise {
  readonly x: number;
  readonly width: number;
  readonly height: number;
  readonly lit: boolean;
}

/**
 * A low-rise mass along the horizon, behind everything in slot 5.
 *
 * Without it the towers grow straight out of the ground plane and the city reads as a row
 * of posts standing in a field. The references all put a continuous band of small roofs at
 * the horizon and let the towers rise out of *that*.
 */
function lowRiseField(geo: Geometry): LowRise[] {
  const { w, h, horizon, bleed } = geo;
  const below = h - horizon;
  const full = w + bleed * 2;
  const out: LowRise[] = [];
  for (let i = 0; i < 84; i++) {
    const width = w * (0.008 + unit(1207, i, 1) * 0.016);
    const x = -bleed + ((full + width) * i) / 84 - width / 2;
    // The road runs through this band to the vanishing point, so the band opens for it. A
    // continuous low-rise wall here would close the one thing Act III exists to leave open
    // (§2, and it is exactly what Act II's wall does).
    if (!clearsVP(geo, x + width / 2, width / 2)) continue;
    out.push({
      x,
      width,
      height: below * (0.035 + unit(1207, i, 2) * 0.075),
      lit: unit(1207, i, 3) > 0.55,
    });
  }
  return out;
}

interface Hedge {
  readonly x: number;
  readonly base: number;
  readonly width: number;
  readonly thickness: number;
}

/**
 * Hedge rows across the park, following the perspective.
 *
 * Long thin marks give the green band a grain and a direction; without them it is one flat
 * wedge whichever way it is tinted.
 */
function hedgeField(geo: Geometry): Hedge[] {
  const { h, horizon } = geo;
  const below = h - horizon;
  const out: Hedge[] = [];
  for (let i = 0; i < 26; i++) {
    const d = 0.07 + unit(881, i, 1) * 0.46;
    const sc = depthScale(geo, d);
    const side: -1 | 1 = i % 2 === 0 ? -1 : 1;
    const from =
      roadCentre(geo, d, WIND) + side * roadHalf(geo, d, ROAD_NEAR_HALF, 0) * (1.6 + unit(881, i, 2) * 4);
    const width = below * (0.3 + unit(881, i, 3) * 0.9) * sc;
    if (!clearsVP(geo, from + (side * width) / 2, width / 2)) continue;
    out.push({
      x: Math.min(from, from + side * width),
      base: groundY(geo, d),
      width,
      thickness: below * 0.03 * sc,
    });
  }
  return out;
}

interface ParkTree {
  readonly x: number;
  readonly base: number;
  readonly height: number;
  readonly width: number;
  readonly seed: number;
  /** Which of the two haze bands this tree belongs to. */
  readonly far: boolean;
}

/**
 * The park: trees scattered from the road margins out to the frame edges.
 *
 * Without them the whole band between the horizon and the paving is one flat green wedge —
 * about a sixth of the frame carrying one colour and no detail.
 *
 * Screen position first, world position never. The natural form — pick a lateral distance
 * from the road and multiply by the depth scale — cannot reach the sides of the frame at
 * shallow depth, because that is exactly what perspective means, and every tree ends up in
 * a narrow file beside the road with the outer thirds of the park empty. Choosing where the
 * tree lands *on the frame* and rejecting anything that would stand in the road fills the
 * park, and the size still comes from the depth, so the perspective holds.
 */
function parkTreeField(geo: Geometry): ParkTree[] {
  const { w, h, horizon, bleed } = geo;
  const below = h - horizon;
  const full = w + bleed * 2;
  const out: ParkTree[] = [];
  for (let i = 0; i < 120; i++) {
    const d = 0.07 + unit(77, i, 1) * 0.52;
    const sc = depthScale(geo, d);
    const x = -bleed + full * unit(77, i, 2);
    if (Math.abs(x - roadCentre(geo, d, WIND)) < roadHalf(geo, d, ROAD_NEAR_HALF, 0) * 1.5) continue;
    if (x < -bleed || x > w + bleed) continue;
    if (!clearsVP(geo, x, below * 0.04 * sc)) continue;
    out.push({
      x,
      base: groundY(geo, d),
      height: below * (0.2 + unit(77, i, 3) * 0.14) * sc,
      width: below * 0.08 * sc,
      seed: 77 + i,
      far: d < 0.26,
    });
  }
  return out;
}

interface StreetTree {
  readonly x: number;
  readonly base: number;
  readonly height: number;
  readonly width: number;
  readonly seed: number;
}

interface Stall {
  readonly x: number;
  readonly base: number;
  readonly width: number;
  readonly height: number;
  readonly canopy: 'cyan' | 'magenta';
  readonly seed: number;
}

function streetField(geo: Geometry): { trees: StreetTree[]; stalls: Stall[] } {
  const { w, h, horizon } = geo;
  const below = h - horizon;
  const trees: StreetTree[] = [];
  const stalls: Stall[] = [];
  const count = 18;
  for (let i = 0; i < count; i++) {
    const side: -1 | 1 = i % 2 === 0 ? -1 : 1;
    const d = 0.14 + (i / count) * 0.48;
    const sc = depthScale(geo, d);
    const gy = groundY(geo, d);
    const x =
      roadCentre(geo, d, WIND) +
      side * (roadHalf(geo, d, ROAD_NEAR_HALF, 0) + w * (0.012 + unit(53, i, 1) * 0.02) * sc);
    if (!clearsVP(geo, x, w * 0.03 * sc)) continue;
    trees.push({ x, base: gy, height: below * 0.34 * sc, width: w * 0.032 * sc, seed: 600 + i * 11 });
    if (unit(53, i, 2) > 0.42) {
      stalls.push({
        x: x + side * w * 0.05 * sc,
        base: gy,
        width: w * 0.05 * sc,
        height: below * 0.08 * sc,
        // Alternating rather than rolled, so the two hues are spread across the width
        // instead of clustering wherever the hash happened to land (review-checklist §4).
        canopy: i % 2 === 0 ? 'magenta' : 'cyan',
        seed: 700 + i * 13,
      });
    }
  }
  return { trees, stalls };
}

interface NearBuilding {
  readonly x: number;
  readonly width: number;
  readonly base: number;
  readonly height: number;
  readonly side: -1 | 1;
  readonly seed: number;
  readonly d: number;
}

/** Slots 3–2: buildings with real gaps, courtyards and light between them. */
function nearField(geo: Geometry): NearBuilding[] {
  const { w } = geo;
  const out: NearBuilding[] = [];
  const next = rng(71);
  let i = 0;
  for (const [side, d, wide] of [
    [-1, 0.68, 0.1],
    [1, 0.78, 0.11],
    [-1, 0.98, 0.12],
    [1, 1.12, 0.13],
  ] as const) {
    const sc = depthScale(geo, d);
    const gy = groundY(geo, d);
    const width = w * wide * sc;
    const height = (geo.h - geo.horizon) * (0.8 + next() * 0.4) * sc;
    const inner =
      roadCentre(geo, d, WIND) + side * (roadHalf(geo, d, ROAD_NEAR_HALF, 0) + w * 0.02 * sc);
    out.push({
      x: side === -1 ? inner - width : inner,
      width,
      base: gy,
      height,
      side,
      seed: 800 + i * 29,
      d,
    });
    i += 1;
  }
  return out;
}

interface Figure {
  readonly x: number;
  readonly base: number;
  readonly height: number;
  readonly carry: 'none' | 'cyan' | 'magenta' | 'warm';
  readonly seed: number;
}

/**
 * People at ground level, in silhouette, small, several (§6 slot 1).
 *
 * A few are carrying something lit. That is the thesis at human scale: in Act II every
 * saturated thing is on a tower and nothing a person holds is coloured at all.
 */
function figureField(geo: Geometry, count: number, dFrom: number, dTo: number, seed: number): Figure[] {
  const below = geo.h - geo.horizon;
  const out: Figure[] = [];
  for (let i = 0; i < count; i++) {
    const d = dFrom + ((dTo - dFrom) * ((i * 7) % count)) / count;
    const sc = depthScale(geo, d);
    const side = unit(seed, i, 1) > 0.5 ? 1 : -1;
    const x =
      roadCentre(geo, d, WIND) +
      side * roadHalf(geo, d, ROAD_NEAR_HALF, 0) * (0.25 + unit(seed, i, 2) * 0.7);
    const roll = unit(seed, i, 3);
    out.push({
      x,
      base: groundY(geo, d),
      height: below * 0.105 * sc,
      carry: roll < 0.18 ? 'cyan' : roll < 0.34 ? 'magenta' : roll < 0.52 ? 'warm' : 'none',
      seed: seed + i * 23,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Buffer emitters
// ---------------------------------------------------------------------------

/**
 * A grid of lit panes.
 *
 * Roughly one pane in five is cyan or magenta, and the roll is on a hash of (row, col,
 * seed) so the scatter is irregular rather than striped — a regular saturated column reads
 * as signage. Panes round *up* to one art pixel: culling a sub-resolution pane is the bug
 * that rendered this act's music motes as zero pixels at every viewport
 * (`docs/review-checklist.md` §6), and it is the same helper mistake either way.
 */
function drawWindows(
  buf: Buf,
  x: number,
  y: number,
  width: number,
  height: number,
  cols: number,
  rows: number,
  seed: number,
  tones: WindowTones,
): void {
  if (width <= 0 || height <= 0 || cols < 1 || rows < 1) return;
  const cellW = width / cols;
  const cellH = height / rows;
  const paneW = Math.max(cellW * 0.46, 0.1);
  const paneH = Math.max(cellH * 0.4, 0.1);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const roll = unit(seed, row, col);
      if (roll > 0.74) continue;
      const tone =
        roll < 0.1 ? tones.cyan : roll < 0.2 ? tones.magenta : roll < 0.31 ? tones.dim : tones.warm;
      buf.rect(
        x + col * cellW + (cellW - paneW) / 2,
        y + row * cellH + (cellH - paneH) / 2,
        paneW,
        paneH,
        tone,
      );
    }
  }
}

/**
 * Air in front of a rank, as a dither of horizon glow over the buildings themselves.
 *
 * The obvious version of this is a full-width band of glow dithered across the frame
 * behind each rank, and it is wrong in a way that no amount of looking would reveal:
 * `check:invariant` reads the horizon as a tonal step across the vanishing-point corridor,
 * counting how many columns show one. A 50%-coverage dither of a tone 66 units from the
 * sky puts a step of that size in most columns at **every** art row boundary near the
 * horizon, so a row six pixels high scores the same 100% coverage as the horizon and,
 * being lower, wins the tie. Measured: the horizon was reported at y=516 of 522 at 1440,
 * y=487 of 490 at 390, on a horizon that was exactly right.
 *
 * Hazing only the buildings fixes it at the root rather than by loosening anything. It is
 * also the more truthful model: the air between the viewer and a far tower is what makes
 * the tower paler, and hazing sky with sky was always a no-op.
 */
interface Air {
  readonly tone: number;
  /** Height of the haze band above the tower's base, in stage px. */
  readonly band: number;
  readonly max: number;
}

/** One tower. Slots 4–5 carry no stroke (§3 Line), so nothing is outlined here. */
function drawTower(
  buf: Buf,
  geo: Geometry,
  t: Tower,
  tones: Tones,
  panes: WindowTones,
  air: Air | null,
): void {
  const { h, horizon, vp, bleed } = geo;
  const below = h - horizon;
  const x = t.cx - t.halfW;
  const width = t.halfW * 2;
  const top = t.base - t.height;
  // The sun is at the vanishing point, so the VP-facing vertical face catches the light
  // and the outer face falls away. One light direction for the whole frame.
  const towardVP = t.cx < vp ? 1 : -1;
  const edge = Math.max(width * 0.16, 1);

  buf.rect(x, top, width, t.height + bleed, tones.body);
  buf.rect(towardVP === 1 ? x + width - edge : x, top, edge, t.height + bleed, tones.lit);
  buf.rect(towardVP === 1 ? x : x + width - edge * 0.6, top, edge * 0.6, t.height + bleed, tones.dark);
  buf.rect(x, top, width, Math.max(t.height * 0.02, 1), tones.roof);

  // Air, before the windows: the lights stay crisp through it, which is what keeps the
  // distributed saturation legible at the back of the frame.
  if (air) {
    const yTop = Math.max(top, t.base - air.band);
    buf.rectDither(x, yTop, width, t.base - yTop, air.tone, (k) => air.max * k * k);
  }

  // Setback: an upper block narrower than the shaft. Half the towers have one, which is
  // what stops the skyline being a row of equal rectangles.
  let capY = top;
  let capHalf = t.halfW;
  if (t.setback > 0) {
    const sbH = t.height * t.setback;
    const sbHalf = t.halfW * 0.62;
    capY = top - sbH;
    capHalf = sbHalf;
    buf.rect(t.cx - sbHalf, capY, sbHalf * 2, sbH, tones.body);
    buf.rect(
      towardVP === 1 ? t.cx + sbHalf - edge * 0.7 : t.cx - sbHalf,
      capY,
      edge * 0.7,
      sbH,
      tones.lit,
    );
    buf.rect(t.cx - sbHalf, capY, sbHalf * 2, Math.max(sbH * 0.06, 1), tones.roof);
    drawWindows(buf, t.cx - sbHalf * 0.8, capY + sbH * 0.14, sbHalf * 1.6, sbH * 0.7, 2, 3, t.seed + 3, panes);
  }

  // Rooftop garden: the green cap §6 asks for, as a planter slab plus stepped bushes.
  if (t.garden) {
    const slab = Math.max(below * 0.012, 1);
    buf.rect(t.cx - capHalf * 1.1, capY - slab, capHalf * 2.2, slab, tones.garden);
    const bushes = capHalf > below * 0.02 ? 3 : 2;
    for (let g = 0; g < bushes; g++) {
      const bx = t.cx - capHalf * 0.7 + (g * capHalf * 1.4) / Math.max(1, bushes - 1);
      const br = Math.max(below * 0.011, 1);
      buf.disc(bx, capY - slab - br * 0.5, br, g % 2 === 0 ? tones.gardenLit : tones.garden);
    }
  }

  // Masts and tanks. One vertical art pixel is a legitimate mark on this substrate and is
  // most of what makes the reference skylines read as inhabited rather than extruded.
  if (t.mast === 1 || t.mast === 3) {
    const mastH = below * (0.06 + (t.seed % 5) * 0.012);
    const mw = Math.max(buf.sx(1) - buf.sx(0), 1);
    buf.rect(t.cx - mw / 2, capY - mastH, mw, mastH, tones.dark);
    buf.rect(t.cx - mw * 1.6, capY - mastH * 0.62, mw * 3.2, mw, tones.dark);
    buf.rect(t.cx - mw / 2, capY - mastH, mw, mw, panes.magenta);
  }
  if (t.mast === 2 || t.mast === 3) {
    const tankW = Math.max(t.halfW * 0.5, 1);
    const tankH = Math.max(below * 0.018, 1);
    buf.rect(t.cx + t.halfW * 0.2, capY - tankH, tankW, tankH, tones.dark);
    buf.rect(t.cx + t.halfW * 0.2, capY - tankH, tankW, Math.max(tankH * 0.3, 1), tones.roof);
  }

  drawWindows(
    buf,
    x + width * 0.12,
    top + t.height * 0.06,
    width * 0.76,
    t.height * 0.86,
    t.cols,
    t.rows,
    t.seed,
    panes,
  );
}

interface TreeTones {
  readonly trunk: number;
  readonly body: number;
  readonly light: number;
  readonly shadow: number;
}

function treeTones(buf: Buf, haze: number, label: string): TreeTones {
  return {
    trunk: buf.tone(tint(hue(P.greenShadow, 0.5), P.skyHorizon, haze), `${label} trunk`),
    body: buf.tone(tint(P.green, P.skyHorizon, haze), `${label} canopy`),
    light: buf.tone(tint(P.greenLight, P.skyHorizon, haze), `${label} canopy lit`),
    shadow: buf.tone(tint(hue(P.greenShadow, 0.18), P.skyHorizon, haze), `${label} canopy shade`),
  };
}

/**
 * A tree: trunk, then a canopy of overlapping discs.
 *
 * Lobes rather than one disc, and the lit lobe sits on the vanishing-point side, so the
 * canopy has a light direction and a broken silhouette instead of being a green ball.
 */
function drawTree(
  buf: Buf,
  geo: Geometry,
  x: number,
  base: number,
  height: number,
  width: number,
  seed: number,
  tones: TreeTones,
): void {
  const trunkW = Math.max(width * 0.16, 1);
  buf.rect(x - trunkW / 2, base - height * 0.46, trunkW, height * 0.46, tones.trunk);
  const cy = base - height * 0.68;
  // Per-tree size jitter, so a row of street trees is not a row of identical stamps.
  const rad = Math.max(width * 0.52, height * 0.3) * (0.84 + unit(seed, 3, 11) * 0.34);
  const towardVP = x < geo.vp ? 1 : -1;
  buf.disc(x, cy, rad, tones.body);
  buf.disc(x - towardVP * rad * 0.52, cy + rad * 0.34, rad * 0.6, tones.shadow);
  buf.disc(x + towardVP * rad * 0.46, cy - rad * 0.3, rad * 0.62, tones.light);
  // Two small outlying lobes, so the outline is not a circle.
  buf.disc(x + towardVP * rad * 0.9, cy + rad * 0.18, rad * 0.34, tones.body);
  buf.disc(x - towardVP * rad * 0.5, cy - rad * 0.72, rad * 0.32, tones.light);
}

interface FigureTones {
  readonly body: number;
  readonly head: number;
  readonly carry: Record<'cyan' | 'magenta' | 'warm', number>;
}

function drawFigure(buf: Buf, f: Figure, tones: FigureTones): void {
  const ph = f.height;
  const pw = Math.max(ph * 0.3, 1);
  buf.rect(f.x - pw / 2, f.base - ph * 0.74, pw, ph * 0.48, tones.body);
  buf.disc(f.x, f.base - ph * 0.84, Math.max(pw * 0.4, 0.6), tones.head);
  // Two legs with a gap, so a walking figure is not a domino.
  buf.rect(f.x - pw * 0.44, f.base - ph * 0.3, Math.max(pw * 0.3, 0.6), ph * 0.3, tones.body);
  buf.rect(f.x + pw * 0.14, f.base - ph * 0.3, Math.max(pw * 0.3, 0.6), ph * 0.3, tones.body);
  if (f.carry !== 'none') {
    buf.rect(
      f.x + pw * 0.5,
      f.base - ph * 0.5,
      Math.max(pw * 0.34, 0.6),
      Math.max(ph * 0.14, 0.6),
      tones.carry[f.carry],
    );
  }
}

// ---------------------------------------------------------------------------
// SVG emitters — the reduced-motion path only. Same specs, no dithering.
// ---------------------------------------------------------------------------





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

function drawBird(buf: Buf, x: number, y: number, size: number, index: number): void {
  const t = Math.max(size * 0.22, 2);
  buf.line(x - size, y, x - size * 0.34, y - size * 0.5, index, t);
  buf.line(x - size * 0.34, y - size * 0.5, x, y, index, t);
  buf.line(x, y, x + size * 0.34, y - size * 0.5, index, t);
  buf.line(x + size * 0.34, y - size * 0.5, x + size, y, index, t);
}

// ---------------------------------------------------------------------------

function build(geo: Geometry): readonly SlotArt[] {
  setPixelGrid(geo);
  const { w, h, horizon, vp, bleed } = geo;
  const left = -bleed;
  const full = w + bleed * 2;
  const below = h - horizon;
  const sunR = h * 0.075;

  // Every element of the composition is a spec array, and both emitters read the same one.
  // Anything generated inline inside a `draw` callback exists on the scroll path and not in
  // reduced motion, which is how the low-rise horizon band, the hedge rows and 120 park
  // trees came to be missing from a path this file's header claims is the same scene.
  const TOWERS = towerField(geo);
  const LOWRISE = lowRiseField(geo);
  const HEDGES = hedgeField(geo);
  const PARK = parkTreeField(geo);
  const MIDRISE = midRiseField(geo);
  const STREET = streetField(geo);
  const NEAR = nearField(geo);
  const MID_FIGURES = figureField(geo, 9, 0.22, 0.6, 17);
  const NEAR_FIGURES = figureField(geo, 10, 0.62, 1.08, 41);

  // ---- slot 7 — dusk sky, sun, ground, road --------------------------------
  const roadPoints = windingRoad(geo, ROAD_NEAR_HALF, WIND);
  /** Planted margins, following the same weave one-and-a-half road-widths out (§6 slot 1). */
  const marginPoints = windingRoad(geo, ROAD_NEAR_HALF, WIND, { widen: 1.7 });
  /** Where the paving gives way to parkland, as a straight but not level edge. */
  // Park as far as the canal, paved plaza this side of it — so the water is the thing that
  // divides them rather than an arbitrary line drawn across the ground.
  const paveLeftY = horizon + below * 0.54;
  const paveRightY = horizon + below * 0.46;
  const paveBottom = Math.max(paveLeftY, paveRightY);
  const parkLeft: (readonly [number, number])[] = [
    [left, horizon + below * 0.06],
    [w * 0.34, horizon + below * 0.03],
    [w * 0.27, paveLeftY],
    [left, paveLeftY],
  ];
  const parkRight: (readonly [number, number])[] = [
    [w * 0.68, horizon + below * 0.035],
    [w + bleed, horizon + below * 0.07],
    [w + bleed, paveRightY],
    [w * 0.74, paveRightY],
  ];

  const sky: SlotArt = {
    verb: 'crossfade',
    /**
     * The sky, banded and dithered rather than smoothly ramped.
     *
     * §3 permits one smooth vertical gradient here and nowhere else, and on the SVG
     * substrate that is what this was. An indexed buffer cannot hold it: a true gradient
     * over ~174 art rows costs one palette entry per row, most of the act's budget, for
     * one layer. 30 dithered steps cost 30 — and the dither between adjacent steps is
     * where a large share of the act's fine detail comes from, because 58% of the frame
     * is sky and a flat gradient contributes none.
     */
    draw: (buf) => {
      const steps = gradientRamp(
        buf.palette,
        [
          { at: 0, hex: P.skyZenith },
          { at: 0.22, hex: P.skyUpper },
          { at: 0.46, hex: P.skyMid },
          { at: 0.72, hex: P.skyLower },
          { at: 1, hex: P.skyHorizon },
        ],
        // 28 steps, not more. The act's palette runs to ~230 of the 255 available, and a
        // ramp is the cheapest place to find headroom: the two `polyBlend` regions each map
        // every ramp tone they cross into a new entry, so a step removed here is worth two
        // or three entries in total.
        28,
        'iii-sky',
      );
      buf.vRamp(left, -bleed, full, horizon + bleed, steps);

      /**
       * Three cloud decks — the clean, lit counterpart to Act II's smog.
       *
       * Act II's sky is a lid: heavy grey mass, high coverage, no gap to the light. This
       * one is the same construction with the opposite settings — lower coverage, warmer
       * lit tones, and the brightest band lowest, right against the horizon glow, so the
       * decks open toward the sun rather than closing over it. That contrast is the act's
       * argument stated in the sky before a single building is drawn.
       */
      const sun = { x: vp, y: horizon };
      for (const spec of [
        {
          top: -bleed,
          bottom: horizon * 0.4,
          scale: 25,
          squash: 3.6,
          coverage: 0.46,
          seed: 3301,
          // Violet against the indigo zenith. A cloud painted in the tone behind it is
          // invisible however correctly it is drawn.
          base: '#6B5A96',
          sky: P.skyUpper,
          lit: P.skyMid,
        },
        {
          top: horizon * 0.3,
          bottom: horizon * 0.76,
          scale: 18,
          squash: 4.4,
          coverage: 0.5,
          seed: 2207,
          base: '#9E5C88',
          sky: P.skyMid,
          lit: P.skyHorizon,
        },
        {
          top: horizon * 0.7,
          bottom: horizon * 0.985,
          scale: 12,
          squash: 6.2,
          coverage: 0.44,
          seed: 1613,
          base: '#D77A66',
          sky: P.skyLower,
          lit: '#FFEFCC',
        },
      ]) {
        drawCloudBand(
          buf,
          {
            top: spec.top,
            bottom: spec.bottom,
            scale: spec.scale,
            squash: spec.squash,
            coverage: spec.coverage,
            seed: spec.seed,
            ...cloudTones(buf.palette, spec.base, spec.sky, spec.lit),
          },
          sun,
        );
      }
    },
    /**
     * Everything registered to an anchor, in paint order: the sun sits *behind* the ground
     * plane, so the plane follows it, and the road converges on the vanishing point so it
     * can never be transformed.
     *
     * Translucent fills are resolved to the tone they produce — `tint(background, ink,
     * alpha)` — because the buffer has no alpha. Same result, and the palette stays
     * countable.
     */
    drawLocked: (buf) => {
      drawBandedSun(
        buf,
        vp,
        horizon,
        sunR,
        buf.tone('#FFEFCC', 'sun core'),
        buf.tone(tint('#FFEFCC', P.skyLower, 0.5), 'sun band'),
        buf.tone(P.skyLower, 'sun rim'),
      );

      // The city floor as a dithered aerial-perspective ramp, not one flat fill. This is
      // ~40% of the frame; a single fill contributes one colour and zero detail to it.
      buf.vRamp(
        left,
        horizon,
        full,
        below + bleed,
        gradientRamp(
          buf.palette,
          [
            /**
             * The first two art rows are the far bank in shadow — and they are also what
             * makes the horizon *measurable*.
             *
             * `check:invariant` reads the horizon as a tonal step across the vanishing-point
             * corridor, and it shoots **with the copy layer**, whose scrim sits at 80%
             * opacity for this act (`src/copy.ts`). An 80% scrim divides every step under it
             * by five, so a horizon that is a comfortable 75-unit step bare measures 15
             * under the column and falls under the 16-unit threshold in every covered
             * column. Measured: 47% corridor coverage at 390x844 against a 55% floor, on a
             * horizon that was exactly where it should be. Hazing the far ground almost to
             * the sky tone — which is what parkland four miles off actually looks like — is
             * what took it there, so the fix is a shadowed bank at the horizon rather than a
             * washed one, and the haze resumes one row later.
             */
            { at: 0, hex: tint(hue(P.green, 0.32), P.skyHorizon, 0.44) },
            { at: 0.06, hex: tint(P.green, P.skyHorizon, 0.62) },
            { at: 0.22, hex: tint(P.green, P.skyHorizon, 0.4) },
            { at: 0.45, hex: tint(P.green, P.skyHorizon, 0.14) },
            { at: 0.72, hex: P.green },
            { at: 1, hex: hue(P.greenShadow, 0.24) },
          ],
          16,
          'iii-ground',
        ),
      );

      /**
       * Parkland flanking the approach, as a multiply into the ramp rather than a flat
       * polygon over it.
       *
       * A flat fill here would delete the ramp's dither across two large regions and take
       * the frame's fine detail with it. Blending keeps every dithered pixel and costs one
       * palette entry per ramp step it crosses — and both masses share the blend, so they
       * share those entries.
       */
      const parkInk = parseHex(hue(P.greenShadow, 0.34));
      const parkBlend = (dst: ReturnType<typeof parseHex>) => over(multiply(parkInk, dst), dst, 0.55);
      buf.polyBlend(parkLeft, parkBlend);
      buf.polyBlend(parkRight, parkBlend);

      // Paving, nearer the viewer. Its own ramp rather than a tone, for the same reason.
      const paveSteps = gradientRamp(
        buf.palette,
        [
          { at: 0, hex: tint(P.road, P.skyHorizon, 0.34) },
          { at: 0.45, hex: P.road },
          { at: 1, hex: hue(P.road, 0.26) },
        ],
        12,
        'iii-pave',
      );
      buf.poly(
        [
          [left, paveLeftY],
          [w + bleed, paveRightY],
          [w + bleed, paveBottom],
          [left, paveBottom],
        ],
        paveSteps[0] as number,
      );
      buf.vRamp(left, paveBottom, full, h + bleed - paveBottom, paveSteps);
      // Where paving meets parkland, dithered along the slant rather than ruled across it.
      // A hard edge here reads as a wall lying on the ground; a straight `rectDither` band
      // would put the transition on a level line and lose the slant, so it is stepped in
      // narrow vertical strips that follow the edge.
      const soften = below * 0.08;
      const strips = 96;
      for (let i = 0; i < strips; i++) {
        const x0 = left + (full * i) / strips;
        const edgeY = paveLeftY + (paveRightY - paveLeftY) * ((x0 - left) / full);
        buf.rectDither(x0, edgeY - soften, full / strips + 1, soften, paveSteps[0] as number, (k) => k * k * 0.9);
      }
      // Paving joints: one art row every few rows, warm side up. Cheap, and it is what
      // stops a large flat plane reading as paper.
      const joint = buf.tone(hue(P.road, 0.42), 'pave joint');
      for (let i = 1; i <= 7; i++) {
        const t = i / 8;
        const y = paveBottom + (h + bleed - paveBottom) * t * t;
        buf.rect(left, y, full, Math.max(below * 0.002, 1), joint);
      }

      // Planted margins, then the road on top of them.
      /**
       * Margin, mown verge, road — three concentric bands of the same weave.
       *
       * The lit verge is a *narrower* `windingRoad`, not a slice of the wide one.
       * `windingRoad` returns `[...leftEdge, ...rightEdge.reverse()]`, so taking the first
       * half hands `Buf.poly` the left edge polyline alone, which it closes with a straight
       * chord back to the vanishing point and fills — a crescent covering ~1100 art cells,
       * 63% of them outside the margin band entirely, and the road does not paint over it.
       * Nesting the bands puts the lighter tone exactly where the verge is at every depth.
       */
      buf.poly(marginPoints, buf.tone(tint(P.green, P.skyHorizon, 0.16), 'margin'));
      buf.poly(
        windingRoad(geo, ROAD_NEAR_HALF, WIND, { widen: 1.32 }),
        buf.tone(tint(P.greenLight, P.skyHorizon, 0.2), 'margin lit'),
      );
      buf.poly(roadPoints, buf.tone(P.road, 'road'));

      // Unpaved centre: two wheel ruts converging exactly on the vanishing point, and a
      // dithered crown between them. Both are VP-registered, which is why the whole ground
      // plane lives in the locked layer rather than in slot 1 (§6 slot 1, and
      // review-checklist §2 — a full-width band in slot 1 erases the scene behind it).
      const rutTone = buf.tone(tint(P.road, hue(P.road, 0.3), 0.7), 'rut');
      for (const k of [-0.5, -0.16, 0.16, 0.5] as const) {
        buf.line(
          roadCentre(geo, 1, WIND) + roadHalf(geo, 1, ROAD_NEAR_HALF, 0) * k,
          h + bleed,
          vp,
          horizon,
          rutTone,
          2,
        );
      }

      // Long shadows thrown toward the viewer by the near buildings, multiplied into
      // whatever they cross rather than laid over it as one flat tone.
      const castInk = parseHex(P.skyUpper);
      for (const b of NEAR) {
        const length = below * 0.5 * depthScale(geo, b.d);
        const spread = ((b.x + b.width / 2 - vp) / w) * length * 1.1;
        buf.polyBlend(
          [
            [b.x, b.base],
            [b.x + b.width, b.base],
            [b.x + b.width + spread, b.base + length],
            [b.x + spread, b.base + length],
          ],
          (dst) => over(multiply(castInk, dst), dst, 0.3),
        );
      }
    },
    // The one smooth gradient in the build (§3) — reduced-motion path only.
  };

  // ---- slot 6 — clean warm haze, no particulate ----------------------------
  const hazeBand = h * 0.06;
  const haze: SlotArt = {
    verb: 'crossfade',
    /**
     * A uniform wash, not a dither.
     *
     * This is the one place in the act where alpha is load-bearing. `check:invariant`
     * reads the horizon as a tonal step across the vanishing-point corridor; a wash tints
     * both sides equally and leaves the step intact, whereas a 32%-coverage dither lands
     * the haze tone on one side and not the other in alternating rows and turns every art
     * row boundary near the horizon into a stronger boundary than the horizon itself.
     * Measured on Act I, at 100% coverage two art cells high.
     */
    alpha: 0.32,
    draw: (buf) => {
      buf.rect(left, horizon - hazeBand, full, hazeBand * 2, buf.tone(P.skyHorizon, 'haze'));
    },
  };

  // ---- slot 5 — many towers, varied heights, none dominant -----------------
  /**
   * No `travelPx` override — `Stage.defaultTravel` gives `clipBottom + bleed`, which is
   * the distance that actually clears the clip line.
   *
   * The override this replaces was `h * 0.3`, copied from Act I's mesas (`i.ts`), which
   * top out ~219px above the horizon. Act III's ceiling is `horizon - h*0.07`, so a tower
   * can stand 489px above it — 2.2x the travel budget. `rise` holds `opacity: 1`
   * throughout (`src/stage.ts`), so the shortfall does not fade out: roughly a quarter of
   * the frame height of skyline stands at full opacity when the transition ends and then
   * hard-cuts when the layer is dropped. That is `docs/review-checklist.md` §7's first
   * travel bug verbatim — "travel shorter than the art's extent above its clip line leaks
   * the incoming act above the horizon" — and `defaultTravel` is documented as the floor
   * an override must clear, which this one did not.
   */
  const ridge: SlotArt = {
    verb: 'rise',
    clipBottom: horizon,
    draw: (buf) => {
      const tones = TOWER_HAZE.map((v, i) => bandTones(buf, v, `tower ${i}`));
      const panes = TOWER_HAZE.map((v, i) => windowTones(buf, v, `tower ${i}`));

      const lowTone = buf.tone(tint(P.tower, P.skyHorizon, 0.68), 'lowrise');
      const lowRoof = buf.tone(tint(P.tower, P.skyHorizon, 0.78), 'lowrise roof');
      const lowLight = buf.tone(tint(P.warm, P.skyHorizon, 0.62), 'lowrise light');
      for (const b of LOWRISE) {
        buf.rect(b.x, horizon - b.height, b.width, b.height + bleed, lowTone);
        buf.rect(b.x, horizon - b.height, b.width, Math.max(b.height * 0.12, 1), lowRoof);
        if (b.lit) {
          buf.rect(
            b.x + b.width * 0.3,
            horizon - b.height * 0.6,
            Math.max(b.width * 0.22, 1),
            Math.max(b.height * 0.16, 1),
            lowLight,
          );
        }
      }

      // Back to front, so the near rank overlaps the hazier one behind it. Each rank's
      // buildings take a dither of horizon glow up their lower storeys, so the separation
      // reads as air between the layers rather than as a flat tint applied to each.
      for (const rank of [0, 1, 2] as const) {
        const air: Air | null =
          rank === 2
            ? null
            : {
                tone: buf.tone(tint(P.skyHorizon, P.skyLower, 0.2 + rank * 0.22), `rank ${rank} air`),
                band: below * (0.62 - rank * 0.2),
                max: 0.62 - rank * 0.24,
              };
        for (const t of TOWERS) {
          if (t.rank !== rank) continue;
          drawTower(buf, geo, t, tones[rank] as Tones, panes[rank] as WindowTones, air);
        }
      }
    },
  };

  // ---- slot 4 — no wall. Mid-rise, terraced, planted. ----------------------
  const far: SlotArt = {
    verb: 'rise',
    clipBottom: groundY(geo, 0.62),
    draw: (buf) => {
      const tones = MID_HAZE.map((v, i) => bandTones(buf, v, `mid ${i}`));
      const panes = MID_HAZE.map((v, i) => windowTones(buf, v, `mid ${i}`));
      const planters = MID_HAZE.map((v, i) => buf.tone(tint(P.greenLight, P.skyHorizon, v), `mid ${i} planter`));
      for (const b of MIDRISE) {
        const band = Math.min(MID_HAZE.length - 1, b.band);
        const t = tones[band] as Tones;
        const pane = panes[band] as WindowTones;
        const towardVP = b.cx < vp ? 1 : -1;
        for (let s = 0; s < b.terraces; s++) {
          const halfW = b.halfW * (1 - s * 0.18);
          const stepH = b.height / b.terraces;
          const y = b.base - stepH * (s + 1);
          buf.rect(b.cx - halfW, y, halfW * 2, stepH + 1, t.body);
          // Lit face toward the sun at the vanishing point, shadowed face away from it.
          buf.rect(
            towardVP === 1 ? b.cx + halfW - Math.max(halfW * 0.3, 1) : b.cx - halfW,
            y,
            Math.max(halfW * 0.3, 1),
            stepH + 1,
            t.lit,
          );
          buf.rect(
            towardVP === 1 ? b.cx - halfW : b.cx + halfW - Math.max(halfW * 0.22, 1),
            y,
            Math.max(halfW * 0.22, 1),
            stepH + 1,
            t.dark,
          );
          // Every terrace is planted — the deck slab, then a run of low bushes on it.
          buf.rect(b.cx - halfW, y, halfW * 2, Math.max(stepH * 0.14, 1), t.garden);
          const bushes = 3;
          for (let g = 0; g < bushes; g++) {
            const bx = b.cx - halfW * 0.72 + (g * halfW * 1.44) / (bushes - 1);
            buf.disc(bx, y, Math.max(halfW * 0.18, 0.8), g % 2 === 0 ? (planters[band] as number) : t.gardenLit);
          }
          drawWindows(
            buf,
            b.cx - halfW * 0.78,
            y + stepH * 0.28,
            halfW * 1.56,
            stepH * 0.6,
            2,
            2,
            b.seed + s * 5,
            pane,
          );
        }
      }
      // Two tone sets at two haze depths, not one per tree: a per-tree tint costs a
      // palette entry per tree, and there are 120 of them.
      const parkFar = treeTones(buf, 0.42, 'park tree far');
      const parkNear = treeTones(buf, 0.2, 'park tree');
      for (const g of HEDGES) {
        buf.rect(g.x, g.base - g.thickness, g.width, g.thickness, parkFar.shadow);
        buf.rect(g.x, g.base - g.thickness, g.width, Math.max(g.thickness * 0.4, 1), parkFar.light);
      }
      for (const t of PARK) {
        drawTree(buf, geo, t.x, t.base, t.height, t.width, t.seed, t.far ? parkFar : parkNear);
      }
    },
  };

  // ---- slots 3 and 2 — street level ----------------------------------------
  const canalY = groundY(geo, CANAL_DEPTH);
  const canalScale = depthScale(geo, CANAL_DEPTH);
  // Wide enough to read as water crossing the frame. At 20% it rendered as a blue line
  // between the near buildings and could not be told from a kerb.
  const canalH = below * 0.32 * canalScale;
  const canalAmp = below * 0.075;
  const canalPath = meander(geo, canalY, canalH, canalAmp, 2.2, 0.4);
  const canalWave = (x: number): number =>
    canalY + Math.sin(((x + bleed) / (w + bleed * 2)) * Math.PI * 2.2 + 0.4) * canalAmp;
  const bridgeHalf = roadHalf(geo, CANAL_DEPTH, ROAD_NEAR_HALF, 0) * 1.3;
  const bridgeX = roadCentre(geo, CANAL_DEPTH, WIND);
  const bridgeY = canalWave(bridgeX);

  const mid: SlotArt = {
    verb: 'extrude',
    clipBottom: groundY(geo, 0.64),
    draw: (buf) => {
      const silhouette = new Set<number>();
      const iWater = buf.tone(P.water, 'canal');
      const iWaterDeep = buf.tone(hue(P.water, 0.3), 'canal deep');
      const iWaterLit = buf.tone(tint(P.water, '#FFFFFF', 0.4), 'canal lit');
      const iBankTop = buf.tone(hue(P.road, 0.24), 'canal bank far');
      const iBankNear = buf.tone(hue(P.road, 0.38), 'canal bank near');

      buf.poly(meander(geo, canalY - canalH * 0.24, canalH * 0.26, canalAmp, 2.2, 0.4), iBankTop);
      buf.poly(canalPath, iWater);
      buf.poly(meander(geo, canalY + canalH * 0.62, canalH * 0.4, canalAmp, 2.2, 0.4), iWaterDeep);
      buf.poly(meander(geo, canalY + canalH * 0.96, canalH * 0.28, canalAmp, 2.2, 0.4), iBankNear);

      /**
       * The canal surface: broken ripple dashes, and reflections of the city above it.
       *
       * The reflections are the thesis at ground level. In Act II the wet road carries the
       * two monoliths' colour and nothing else — one source, reflected. Here the same two
       * hues arrive from all along the skyline, so the water is lit in short unrelated
       * strokes across the whole width rather than in two vertical streaks.
       */
      const iReflectCyan = buf.tone(tint(P.water, P.cyan, 0.65), 'canal cyan');
      const iReflectMagenta = buf.tone(tint(P.water, P.magenta, 0.42), 'canal magenta');
      const iReflectWarm = buf.tone(tint(P.water, P.warm, 0.5), 'canal warm');
      const dashes = 84;
      for (let i = 0; i < dashes; i++) {
        const x = left + (full * i) / dashes + unit(131, i, 1) * full * 0.008;
        const surface = canalWave(x);
        const depth = unit(131, i, 2);
        const y = surface + canalH * (0.08 + depth * 0.78);
        const len = full * (0.004 + unit(131, i, 3) * 0.012);
        const roll = unit(131, i, 4);
        const tone =
          roll < 0.14
            ? iReflectCyan
            : roll < 0.26
              ? iReflectMagenta
              : roll < 0.42
                ? iReflectWarm
                : roll < 0.7
                  ? iWaterLit
                  : iWaterDeep;
        buf.rect(x, y, len, Math.max(canalH * 0.06, 1), tone);
      }

      /**
       * The footbridge, on the road axis.
       *
       * Drawn as a *lifted* span with piers standing in the water, not as a slab lying on
       * it. The first version took its deck tone from the road darkened a little, and at
       * `#7b6c56` against a `#8a7a5e` road it was measurably present and visually absent —
       * a bridge you could only find by sampling pixels. A structure has to differ from
       * what it crosses in value, not only in tone.
       */
      const iDeck = buf.tone(tint(P.warm, hue(P.road, 0.34), 0.52), 'bridge deck');
      const iDeckLit = buf.tone(tint(P.warm, hue(P.road, 0.1), 0.28), 'bridge deck lit');
      const iRail = buf.tone(hue(P.road, 0.52), 'bridge rail');
      const deckY = bridgeY - canalH * 0.1;
      const deckT = Math.max(canalH * 0.2, 2);
      // Piers first, so the deck sits on them.
      for (const k of [-0.62, -0.2, 0.2, 0.62] as const) {
        buf.rect(
          bridgeX + bridgeHalf * k,
          deckY + deckT,
          Math.max(bridgeHalf * 0.05, 1),
          canalH * 0.95,
          iRail,
        );
      }
      // Approach ramps at both banks, then the span between them.
      buf.poly(
        [
          [bridgeX - bridgeHalf * 1.35, bridgeY + canalH * 1.2],
          [bridgeX - bridgeHalf * 0.9, deckY],
          [bridgeX - bridgeHalf * 0.9, deckY + deckT],
          [bridgeX - bridgeHalf * 1.35, bridgeY + canalH * 1.2 + deckT],
        ],
        iDeck,
      );
      buf.poly(
        [
          [bridgeX + bridgeHalf * 0.9, deckY],
          [bridgeX + bridgeHalf * 1.35, bridgeY + canalH * 1.2],
          [bridgeX + bridgeHalf * 1.35, bridgeY + canalH * 1.2 + deckT],
          [bridgeX + bridgeHalf * 0.9, deckY + deckT],
        ],
        iDeck,
      );
      buf.rect(bridgeX - bridgeHalf * 0.95, deckY, bridgeHalf * 1.9, deckT, iDeck);
      buf.rect(bridgeX - bridgeHalf * 0.95, deckY, bridgeHalf * 1.9, Math.max(deckT * 0.34, 1), iDeckLit);
      // Handrail and its posts, one art pixel each.
      const railY = deckY - canalH * 0.42;
      buf.rect(bridgeX - bridgeHalf * 0.95, railY, bridgeHalf * 1.9, Math.max(canalH * 0.08, 1), iRail);
      for (let i = 0; i <= 8; i++) {
        const px = bridgeX - bridgeHalf * 0.95 + (bridgeHalf * 1.9 * i) / 8;
        buf.rect(px, railY, Math.max(bridgeHalf * 0.02, 1), canalH * 0.42, iRail);
      }
      silhouette.add(iDeck);
      silhouette.add(iDeckLit);
      silhouette.add(iRail);

      // Trees and market stalls along both margins.
      const trees = treeTones(buf, 0.14, 'street tree');
      const iStall = buf.tone(hue(P.tower, -0.12), 'stall');
      const iStallDark = buf.tone(hue(P.tower, 0.16), 'stall dark');
      const iGoods = buf.tone(P.warm, 'stall goods');
      const iCanopyCyan = buf.tone(P.cyan, 'awning cyan');
      const iCanopyMagenta = buf.tone(P.magenta, 'awning magenta');
      const iCanopyStripe = buf.tone(tint(P.warm, '#FFFFFF', 0.35), 'awning stripe');
      for (const t of STREET.trees) {
        drawTree(buf, geo, t.x, t.base, t.height, t.width, t.seed, trees);
      }
      silhouette.add(trees.trunk);
      silhouette.add(trees.body);
      silhouette.add(trees.light);
      silhouette.add(trees.shadow);

      for (const s of STREET.stalls) {
        buf.rect(s.x - s.width / 2, s.base - s.height, s.width, s.height, iStall);
        buf.rect(s.x - s.width / 2, s.base - s.height * 0.34, s.width, s.height * 0.34, iStallDark);
        buf.rect(s.x - s.width * 0.4, s.base - s.height * 0.72, s.width * 0.8, s.height * 0.3, iGoods);
        const canopy = s.canopy === 'cyan' ? iCanopyCyan : iCanopyMagenta;
        buf.poly(
          [
            [s.x - s.width * 0.68, s.base - s.height],
            [s.x + s.width * 0.68, s.base - s.height],
            [s.x + s.width * 0.5, s.base - s.height * 1.36],
            [s.x - s.width * 0.5, s.base - s.height * 1.36],
          ],
          canopy,
        );
        // Striped awning: alternating art-pixel columns, which is how a stripe exists at
        // this size at all. A stripe drawn as a fraction of the canopy would be sub-pixel
        // at the far end of the street and would vanish rather than round up.
        const stripes = 5;
        for (let k = 0; k < stripes; k += 2) {
          const sx = s.x - s.width * 0.62 + (k * s.width * 1.24) / stripes;
          buf.rect(sx, s.base - s.height * 1.34, Math.max((s.width * 1.24) / stripes, 1), s.height * 0.32, iCanopyStripe);
        }
        silhouette.add(iStall);
        silhouette.add(iStallDark);
        silhouette.add(canopy);
      }

      const figures: FigureTones = {
        body: buf.tone(hue(P.tower, 0.08), 'figure'),
        head: buf.tone(hue(P.tower, -0.1), 'figure head'),
        carry: {
          cyan: buf.tone(P.cyan, 'carry cyan'),
          magenta: buf.tone(P.magenta, 'carry magenta'),
          warm: buf.tone(P.warm, 'carry warm'),
        },
      };
      for (const f of MID_FIGURES) drawFigure(buf, f, figures);
      silhouette.add(figures.body);
      silhouette.add(figures.head);

      // Outline the group's silhouette, not every internal tone change — and not the
      // canal, whose "silhouette" is a band across the whole frame and would come out as
      // a ruled line rather than as a bank.
      buf.outline(silhouette, buf.tone(LINE, 'street line'));
    },
  };

  // ---- slot 2 — near buildings, with real gaps between them ----------------
  const near: SlotArt = {
    verb: 'extrude',
    clipBottom: h + bleed,
    draw: (buf) => {
      const silhouette = new Set<number>();
      const t = bandTones(buf, 0.02, 'near');
      const pane = windowTones(buf, 0.02, 'near');
      const iCourt = buf.tone(hue(P.tower, 0.34), 'courtyard');
      const iCourtLight = buf.tone(tint(P.warm, P.tower, 0.42), 'courtyard light');
      const iAwning = buf.tone(P.magenta, 'near awning');
      const iAwningAlt = buf.tone(P.cyan, 'near awning alt');
      const iLantern = buf.tone(P.warm, 'lantern');
      const trees = treeTones(buf, 0.02, 'near tree');

      for (const b of NEAR) {
        const sc = depthScale(geo, b.d);
        const towardVP = b.x + b.width / 2 < vp ? 1 : -1;
        const top = b.base - b.height;
        buf.rect(b.x, top, b.width, b.height, t.body);
        // Upper storeys catch more sky, feathered into the wall rather than banded: a hard
        // horizontal edge across a flat facade reads as a stripe painted on the building
        // rather than as light falling on it.
        buf.rect(b.x, top, b.width, b.height * 0.16, t.lit);
        buf.rectDither(b.x, top + b.height * 0.16, b.width, b.height * 0.2, t.lit, (k) => 1 - k);
        buf.rect(
          towardVP === 1 ? b.x + b.width - Math.max(b.width * 0.06, 1) : b.x,
          top,
          Math.max(b.width * 0.06, 1),
          b.height,
          t.lit,
        );
        buf.rect(
          towardVP === 1 ? b.x : b.x + b.width - Math.max(b.width * 0.05, 1),
          top,
          Math.max(b.width * 0.05, 1),
          b.height,
          t.dark,
        );

        // A courtyard cut into the mass, lit from within — the visual opposite of Act II's
        // slums, which have no gaps at all.
        const cx = b.x + b.width * (b.side === -1 ? 0.3 : 0.42);
        buf.rect(cx, b.base - b.height * 0.36, b.width * 0.26, b.height * 0.36, iCourt);
        buf.rect(cx + b.width * 0.04, b.base - b.height * 0.3, b.width * 0.18, b.height * 0.26, iCourtLight);

        // Planted roof, with a parapet under it.
        const slab = below * 0.018 * sc;
        buf.rect(b.x - b.width * 0.03, top - slab, b.width * 1.06, slab, t.garden);
        buf.rect(b.x - b.width * 0.03, top - slab * 0.35, b.width * 1.06, Math.max(slab * 0.35, 1), t.gardenLit);
        for (let g = 0; g < 4; g++) {
          buf.disc(
            b.x + b.width * (0.14 + g * 0.24),
            top - slab,
            Math.max(b.width * 0.05, 1),
            g % 2 === 0 ? t.gardenLit : t.garden,
          );
        }

        drawWindows(
          buf,
          b.x + b.width * 0.08,
          top + b.height * 0.2,
          b.width * 0.84,
          b.height * 0.52,
          3,
          5,
          b.seed,
          pane,
        );

        // Awning over the road-facing frontage, and a lantern hung off it.
        const aw = b.width * 0.34;
        const ax = b.side === -1 ? b.x + b.width - aw : b.x;
        const ay = b.base - b.height * 0.24;
        buf.poly(
          [
            [ax, ay],
            [ax + aw, ay],
            [ax + aw * 0.86, ay + Math.max(b.height * 0.05, 1)],
            [ax + aw * 0.14, ay + Math.max(b.height * 0.05, 1)],
          ],
          b.side === -1 ? iAwning : iAwningAlt,
        );
        buf.rect(
          b.side === -1 ? ax + aw * 0.9 : ax,
          ay,
          Math.max(b.width * 0.02, 1),
          b.height * 0.24,
          t.dark,
        );
        buf.disc(
          b.side === -1 ? ax + aw * 0.06 : ax + aw * 0.94,
          ay + b.height * 0.06,
          Math.max(b.width * 0.022, 1),
          iLantern,
        );

        silhouette.add(t.body);
        silhouette.add(t.lit);
        silhouette.add(t.dark);
        silhouette.add(t.garden);
        silhouette.add(t.gardenLit);
        silhouette.add(b.side === -1 ? iAwning : iAwningAlt);

        // A street tree in front of each frontage, on the road side.
        drawTree(
          buf,
          geo,
          b.x + b.width * (b.side === -1 ? 1.06 : -0.06),
          b.base,
          below * 0.34 * sc,
          w * 0.036 * sc,
          b.seed + 5,
          trees,
        );
      }
      silhouette.add(trees.trunk);
      silhouette.add(trees.body);
      silhouette.add(trees.light);
      silhouette.add(trees.shadow);
      buf.outline(silhouette, buf.tone(shade(LINE, 0.15), 'near line'));
    },
  };

  // ---- slot 1 — people at ground level, and near planting ------------------
  // Nothing full-width here: slot 1 paints in front of slots 2–5, so a band across it
  // erases the whole scene behind it (review-checklist §2 — three times).
  const ground: SlotArt = {
    verb: 'crossfade',
    draw: (buf) => {
      const figures: FigureTones = {
        body: buf.tone(hue(P.tower, 0.02), 'near figure'),
        head: buf.tone(hue(P.tower, -0.16), 'near figure head'),
        carry: {
          cyan: buf.tone(P.cyan, 'carry cyan'),
          magenta: buf.tone(P.magenta, 'carry magenta'),
          warm: buf.tone(P.warm, 'carry warm'),
        },
      };
      for (const f of NEAR_FIGURES) drawFigure(buf, f, figures);

      // Grass tufts on the planted margins, near enough to be individual blades.
      const iTuft = buf.tone(hue(P.green, 0.12), 'tuft');
      const iTuftLit = buf.tone(hue(P.greenLight, -0.1), 'tuft lit');
      for (let i = 0; i < 46; i++) {
        const d = 0.62 + unit(313, i, 1) * 0.46;
        const sc = depthScale(geo, d);
        const side = i % 2 === 0 ? -1 : 1;
        const x =
          roadCentre(geo, d, WIND) +
          side * roadHalf(geo, d, ROAD_NEAR_HALF, 0) * (1.02 + unit(313, i, 2) * 0.55);
        if (x < left || x > w + bleed) continue;
        const gy = groundY(geo, d);
        const th = below * 0.026 * sc;
        for (let k = -1; k <= 1; k++) {
          buf.line(
            x + k * th * 0.4,
            gy,
            x + k * th * 0.9,
            gy - th * (0.7 + Math.abs(k) * 0.25),
            k === 0 ? iTuftLit : iTuft,
            1,
          );
        }
      }
    },
  };

  // ---- slot 0 — music motes, leaves, birds ---------------------------------
  /**
   * Music renders as rising warm particles with a slight lateral drift, emitted from two
   * or three ground-level points. Never notation — that would look like clip art (§6).
   *
   * These were the act's canonical sub-pixel failure: drawn at `fill-opacity` between 0.85
   * and 0.10 on a helper that culled anything below its resolution, they rendered as
   * **zero pixels at every viewport**. Two fixes, both structural. The fade is resolved to
   * a *tone* against the sky rather than expressed as coverage — a one-cell mote dithered
   * at 10% is simply deleted — and `buf.disc` rounds a sub-cell radius up to one art pixel
   * instead of discarding it.
   */
  const MOTE_SOURCES = [
    [0.33, 0.86],
    [0.66, 0.8],
    [0.5, 0.92],
  ] as const;
  const MOTE_STEPS = 26;

  const drawMotes = (buf: Buf): void => {
    // Four fade steps, interned once. The mote is warm against a violet sky, so it fades
    // toward the sky rather than toward grey.
    const fade = [0, 1, 2, 3].map((k) =>
      buf.tone(tint(P.mote, P.skyMid, 0.18 + k * 0.22), `mote fade ${k}`),
    );
    for (let s = 0; s < MOTE_SOURCES.length; s++) {
      const [ex, ey] = MOTE_SOURCES[s] as readonly [number, number];
      for (let i = 0; i < MOTE_STEPS; i++) {
        const t = i / MOTE_STEPS;
        const x =
          w * ex + (unit(211, s, i) - 0.5) * w * 0.09 + Math.sin(t * 5.5 + s) * w * 0.022;
        const y = h * ey - below * 1.05 * t;
        const rad = Math.max(h * 0.0035 * (1 - t * 0.5), 1);
        buf.disc(x, y, rad, fade[Math.min(3, Math.floor(t * 4))] as number);
      }
    }
  };

  const drawBirds = (buf: Buf): void => {
    const iBird = buf.tone(P.violet, 'bird');
    for (const [cx, cy, sc] of [
      [0.42, 0.2, 1],
      [0.5, 0.16, 0.8],
      [0.58, 0.225, 0.9],
      [0.31, 0.235, 0.7],
    ] as const) {
      drawBird(buf, w * cx, h * cy, h * 0.016 * sc, iBird);
    }
  };

  /** Leaves, blown across at their own rate. Two clusters, so they can differ. */
  const drawLeaves = (seed: number, count: number, band: number) => (buf: Buf) => {
    const tones = [
      buf.tone(P.greenLight, 'leaf'),
      buf.tone(hue(P.green, -0.2), 'leaf warm'),
      buf.tone(tint(P.greenLight, P.warm, 0.5), 'leaf gold'),
    ];
    for (let i = 0; i < count; i++) {
      const x = left + full * unit(seed, i, 1);
      const y = horizon + below * (band + unit(seed, i, 2) * 0.5);
      const s = Math.max(h * 0.006, 1);
      buf.rect(x, y, s * 1.7, s * 0.7, tones[i % 3] as number);
      buf.rect(x + s * 0.5, y - s * 0.5, s * 0.7, s * 0.6, tones[(i + 1) % 3] as number);
    }
  };


  let motesMarkup = '';
  for (let s = 0; s < MOTE_SOURCES.length; s++) {
    const [ex, ey] = MOTE_SOURCES[s] as readonly [number, number];
    for (let i = 0; i < MOTE_STEPS; i++) {
      const t = i / MOTE_STEPS;
      const x = w * ex + (unit(211, s, i) - 0.5) * w * 0.09 + Math.sin(t * 5.5 + s) * w * 0.022;
      const y = h * ey - below * 1.05 * t;
      motesMarkup += circle(
        x,
        y,
        Math.max(h * 0.0035 * (1 - t * 0.5), 1),
        tint(P.mote, P.skyMid, 0.18 + Math.min(3, Math.floor(t * 4)) * 0.22),
      );
    }
  }
  for (const [cx, cy, sc] of [
    [0.42, 0.2, 1],
    [0.5, 0.16, 0.8],
    [0.58, 0.225, 0.9],
    [0.31, 0.235, 0.7],
  ] as const) {
    motesMarkup += bird(w * cx, h * cy, h * 0.016 * sc, P.violet);
  }

  return [
    {
      verb: 'drift',
      draw: (buf) => {
        drawMotes(buf);
        drawBirds(buf);
      },
      parts: [
        { draw: drawLeaves(521, 14, 0.05), rate: 0.42 },
        { draw: drawLeaves(929, 11, 0.42), rate: 0.22 },
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

export const ACT_III: ActDefinition = {
  id: 'iii',
  name: 'Open Frontier',
  build,
};
