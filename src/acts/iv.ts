/**
 * Act IV — The Frontier Returns. art-direction.md §7.
 *
 * Act I's street, at a different hour. `TOWN` here is byte-identical to `i.ts` by design:
 * same buildings, same marks, same placements, so the loop reads as one place seen twice.
 * What separates the two acts is the **light**, not the geography — art-direction §7 was
 * amended to say exactly that, after §4 gave Act I these same three buildings.
 *
 * So the differences are all optical:
 *   1. cooled palette — a violet band pushed between the blue zenith and the warm strip,
 *      and the warm strip compressed into the bottom 22% of the sky rather than the
 *      bottom 36%. Later, quieter, and unmistakably not the same hour.
 *   2. no sun disc — a stepped horizon glow, sun not risen.
 *   3. fewer windows lit, and the unlit ones drawn as dark panes rather than omitted.
 *   4. the road is wider (0.26 against Act I's 0.24) and the land takes more of the frame.
 *   5. thinner, higher, sparser cloud bands, and a clear strip of open sky above the glow.
 *
 * Slot 0 is a single tumbleweed and one bird. Nothing else (§7).
 *
 * On where the ground lives: as in Act I, the base plane, road, ruts and cast shadows are
 * in slot 7's **locked** group. A ground plane spans every depth at once, so putting it in
 * a near slot occludes everything behind it, and anything converging on the VP has to be
 * VP-registered anyway. Slot 1 keeps only what is genuinely nearer than the buildings.
 *
 * The SVG `free` / `locked` / `parts[].markup` strings are kept alongside the draw
 * callbacks — `src/reduced.ts` still renders markup only, so deleting them would empty
 * this act out under prefers-reduced-motion. Same arrangement as `i.ts`.
 */

import type { ActDefinition, Geometry, SlotArt } from './types.ts';
import type { Buf } from '../art/buffer.ts';
import { bayer } from '../art/buffer.ts';
import { gradientRamp, ramp } from '../art/palette.ts';
import { cloudTones, drawCloudBand } from '../art/sky.ts';
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
  shadeHue,
  tint,
  windowGrid,
} from './shared.ts';

/**
 * Act I's palette, cooled.
 *
 * The rest is pulled toward blue-violet, and one stop that Act I does not have —
 * `skyViolet` — is inserted between the night sky and the warm strip. That band is what
 * actually carries "earlier": Act I goes blue → warm over 32% of the sky, this goes
 * blue → violet → warm over the same distance, and the warm never gets as bright.
 *
 * **Two of art-direction §7's three named hexes survive, and the third does not.** §7 names
 * zenith `#16243F`, mid `#B86F52` and horizon `#F2A65A`. The first two are kept literally.
 * `#F2A65A` is gone: the horizon strip is `#D98F5E` and the stop above it `#C1795A`, for the
 * reason argued on `skyLower` below. That contradicts the spec as written, so **§7 needs the
 * same kind of amendment §3 and §4 already carry** — this comment is not a licence to ignore
 * it. The change is deliberate and measured, not drift, but it is a spec change and should
 * be recorded as one rather than left buried in an act file.
 */
const P = {
  skyZenith: '#16243F',
  skyUpper: '#405080',
  /** The cool band Act I does not have. */
  skyViolet: '#7E5C96',
  skyMid: '#B86F52',
  /**
   * The lowest strip of sky is deliberately *duller* than Act I's.
   *
   * Act I ends its ramp on `#FFD9A0`, so its whole horizon is bright and the sun disc is a
   * shape cut out of an already-warm band. Act IV has no disc, so all of its warmth has to
   * be **local** — a horizon that is uniformly bright leaves the glow nothing to be
   * brighter than, and the first pass rendered exactly that: a pale wash across the whole
   * width with no source. Muting the strip is what lets the glow read as light coming from
   * one place under the horizon.
   */
  skyLower: '#C1795A',
  skyHorizon: '#D98F5E',
  glow: '#FFCE93',
  /** Amber, not white. A near-white core desaturates into the haze and reads as fog. */
  glowCore: '#FFE0A8',
  mesa: '#5F5170',
  midGround: '#96705A',
  desert: '#B08A62',
  desertShadow: '#6E5344',
  road: '#A47F5A',
  town: '#33272B',
  window: '#FFE2A4',
  accent: '#FF5E3A',
  castShadow: '#405080',
  /** Cloud bodies. Slate and mauve, not salmon — the light has not reached them yet. */
  cloudHigh: '#5A5A82',
  cloudMid: '#6E6390',
  cloudLow: '#8A6270',
} as const;

const TOWN_LINE = shade(P.town, 0.2);
const RIM = '#7A4E3C';
const RIM_FAR = '#63403A';
/** Wider than Act I's 0.24 — the road opens back up and the land takes more frame. */
const ROAD_NEAR_HALF = 0.26;

/**
 * Shadows shift toward the pre-dawn sky, lights toward the horizon glow.
 *
 * `shadeHue`'s defaults are Act I's dawn pair. Act IV's cool is its own sky-blue and its
 * warm is the glow rather than a risen sun, so every plane in the act is lit by the two
 * colours actually present in its sky.
 */
function shadeIV(hex: string, amount: number): string {
  return shadeHue(hex, amount, P.castShadow, P.glow);
}

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
  { side: -1, d: 0.36, width: 0.14, height: 0.5, falseFront: true, cols: 3, rows: 2, seed: 13 },
  { side: 1, d: 0.62, width: 0.17, height: 0.52, falseFront: false, cols: 3, rows: 2, seed: 29 },
  { side: -1, d: 1.06, width: 0.2, height: 0.6, falseFront: true, cols: 4, rows: 2, seed: 31 },
];

/** Windows lit, against Act I's 0.52-0.81. The town is barely awake (§7). */
const WINDOW_LIT = 0.34;

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

/** Deterministic 2D hash, 0..1. No Math.random anywhere — build() is pure in geo. */
function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed, 1442695041)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Horizontal extent of a convex polygon at one stage-y, or null if the row misses it.
 *
 * The ground is painted a row at a time so that road, dunes and cast shadows can be
 * expressed as *offsets into a ramp* rather than as flat fills laid over it — see
 * `drawGroundPlane`. Testing membership per row is what that needs.
 */
function spanAt(
  points: readonly (readonly [number, number])[],
  y: number,
): readonly [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as readonly [number, number];
    const b = points[(i + 1) % points.length] as readonly [number, number];
    if (a[1] === b[1]) continue;
    if (y < Math.min(a[1], b[1]) || y >= Math.max(a[1], b[1])) continue;
    const x = a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
    if (x < lo) lo = x;
    if (x > hi) hi = x;
  }
  return hi >= lo ? [lo, hi] : null;
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
    density: WINDOW_LIT,
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

/**
 * Buffer version of `buildingMarkup`. Same composition, painted as pixels.
 *
 * Returns the tones it used, so the caller can outline the group's *silhouette* rather
 * than every internal tone boundary.
 */
function drawBuilding(buf: Buf, geo: Geometry, b: Building): number[] {
  const { x, width, base, height } = facade(geo, b);
  const roofY = base - height;
  const body = tint(P.town, P.skyHorizon, Math.max(0, (1 - b.d) * 0.26));
  // Hue-shifted planes: shadowed faces take colour from the pre-dawn sky and go violet,
  // lit ones take colour from the horizon glow and go amber. Multiples of one hue read as
  // one flat colour at three brightnesses, which is most of why the palette measured
  // shallow before the substrate landed.
  const iBody = buf.tone(body, 'town body');
  const iBodyLit = buf.tone(shadeIV(body, -0.2), 'town body lit');
  const iRoof = buf.tone(shadeIV(body, 0.34), 'roof');
  const iAwning = buf.tone(shadeIV(body, 0.46), 'awning');
  const iPost = buf.tone(shadeIV(body, 0.6), 'post');
  const iWindow = buf.tone(P.window, 'window');
  const iWindowWarm = buf.tone(tint(P.window, P.accent, 0.28), 'window warm');
  // Unlit panes. Act I omits these; here they are most of the facade, because at this hour
  // most of the town is dark and a dark pane is still a mark on the wall. It is also where
  // the facade's fine detail comes from once the lit count drops to a third.
  const iWindowDark = buf.tone(shadeIV(body, 0.72), 'window dark');
  const iBoard = buf.tone(shadeIV(body, 0.15), 'board');
  const iRim = buf.tone(tint(b.d < 0.6 ? RIM_FAR : RIM, P.glow, 0.32), 'rim');

  buf.rect(x, roofY, width, height, iBody);
  // Clapboard. A frontier facade is boards, and at this scale one darker cell every few
  // columns is what a board reads as — the references all carry it. It is also the only
  // structure inside the largest flat regions in the frame: on the buffer a bare facade is
  // a single colour hundreds of cells wide, which is most of what the coarse-detail
  // measurement was seeing.
  const cell = buf.sx(1) - buf.sx(0);
  const boardStep = Math.max(cell * 2, width / 9);
  for (let bx = x + boardStep; bx < x + width - cell; bx += boardStep) {
    buf.rect(bx, roofY, cell, height, iBoard);
  }
  // Weathering: scattered single cells of the board tone across the whole facade. At a
  // low Bayer density these land isolated rather than clumped, which is what a
  // sun-bleached plank wall looks like and what keeps the largest silhouettes in the
  // frame from being one unbroken colour.
  buf.rectDither(x, roofY, width, height, iBoard, 0.13);
  // The upper part of the facade catches more sky light than the lower, feathered into it
  // rather than banded: a hard horizontal edge across a flat wall reads as a stripe painted
  // on the building instead of as light falling on it.
  buf.rect(x, roofY, width, height * 0.2, iBodyLit);
  buf.rectDither(x, roofY + height * 0.2, width, height * 0.22, iBodyLit, (t) => 1 - t);

  if (b.falseFront) {
    const parapet = height * 0.15;
    buf.rect(x - width * 0.03, roofY - parapet, width * 1.06, parapet, iBody);
    buf.rect(x - width * 0.03, roofY - parapet, width * 1.06, parapet * 0.24, iRoof);
  } else {
    const pitch = height * 0.13;
    buf.poly(
      [
        [x - width * 0.05, roofY],
        [x + width / 2, roofY - pitch],
        [x + width * 1.05, roofY],
      ],
      iRoof,
    );
  }

  const awning = width * 0.24;
  const awningX = b.side === -1 ? x + width - awning : x;
  const awningY = base - height * 0.3;
  buf.rect(awningX, awningY, awning, height * 0.045, iAwning);
  buf.rect(
    b.side === -1 ? awningX : awningX + awning - width * 0.02,
    awningY,
    width * 0.02,
    height * 0.3,
    iPost,
  );

  // Window grid, same hash and geometry as the SVG version — but every cell gets a pane,
  // lit or dark, where the SVG version skips the dark ones entirely.
  const gx = x + width * 0.12;
  const gy = roofY + height * 0.2;
  const gw = width * 0.76;
  const gh = height * 0.44;
  const cellW = gw / b.cols;
  const cellH = gh / b.rows;
  const paneW = cellW * 0.46;
  const paneH = cellH * 0.42;
  for (let row = 0; row < b.rows; row++) {
    for (let col = 0; col < b.cols; col++) {
      const hash = ((row * 73856093) ^ (col * 19349663) ^ (b.seed * 83492791)) >>> 0;
      const lit = (hash % 1000) / 1000 <= WINDOW_LIT;
      buf.rect(
        gx + col * cellW + (cellW - paneW) / 2,
        gy + row * cellH + (cellH - paneH) / 2,
        paneW,
        paneH,
        lit ? ((hash >>> 7) % 3 === 0 ? iWindowWarm : iWindow) : iWindowDark,
      );
    }
  }

  const roofSeed = b.seed * 2654435761;
  if (roofSeed % 3 !== 0) {
    const cw = width * 0.09;
    const cx = x + width * (0.2 + ((roofSeed >>> 7) % 50) / 100);
    buf.rect(cx, roofY - height * 0.13, cw, height * 0.13, iBody);
    buf.rect(cx - cw * 0.2, roofY - height * 0.15, cw * 1.4, height * 0.025, iRoof);
  }

  // Rim light on the road-facing edge: the glow is at the VP, so that edge catches it —
  // but from below the horizon, so it is dimmer and cooler than Act I's.
  buf.rect(
    b.side === -1 ? x + width - Math.max(width * 0.018, 2.5) : x,
    roofY,
    Math.max(width * 0.018, 2.5),
    height,
    iRim,
  );

  return [iBody, iBodyLit, iRoof, iAwning, iPost, iWindow, iWindowWarm, iWindowDark, iBoard, iRim];
}

/** The shadow a building throws toward the viewer. Same geometry as Act I's. */
function castShadowPoints(geo: Geometry, b: Building): (readonly [number, number])[] {
  const { x, width, base } = facade(geo, b);
  const scale = depthScale(geo, b.d);
  const length = (geo.h - geo.horizon) * 1.15 * scale;
  const spread = ((x + width / 2 - geo.vp) / geo.w) * length * 0.75;
  return [
    [x, base],
    [x + width, base],
    [x + width + spread, base + length],
    [x + spread, base + length],
  ];
}

function castShadow(geo: Geometry, b: Building): string {
  return poly(castShadowPoints(geo, b), P.castShadow);
}

function drawBird(buf: Buf, x: number, y: number, size: number, index: number): void {
  const t = Math.max(size * 0.22, 2);
  buf.line(x - size, y, x - size * 0.34, y - size * 0.5, index, t);
  buf.line(x - size * 0.34, y - size * 0.5, x, y, index, t);
  buf.line(x, y, x + size * 0.34, y - size * 0.5, index, t);
  buf.line(x + size * 0.34, y - size * 0.5, x + size, y, index, t);
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

/**
 * The glow where the sun has not yet risen — **stepped bands, never a radial gradient**.
 *
 * A squashed radial field is quantised to eight discrete levels and ordered-dithered
 * between them, so every pixel is one of eight interned tones and the transitions read as
 * broken bands rather than as a smooth falloff. Level 0 is *not painted at all*, which is
 * what lets the outermost edge dither away into the sky instead of ending on an oval.
 *
 * It never touches the horizon row or anything below it: the field is evaluated only for
 * art rows strictly above `buf.ay(horizon)`, so the tonal step check:invariant reads across
 * the vanishing-point corridor is between glow and ground, undithered on the ground side.
 */
/**
 * Scatter one tone into the cells that already hold another.
 *
 * Clipping by *index* rather than by shape is the only way to texture a polygon on this
 * substrate: `rectDither` takes a rectangle, and a rectangle over a battered mesa drops
 * loose dots into the open sky either side of it. Working from what is already painted
 * means the speckle is bounded by the silhouette exactly, whatever shape that is.
 */
function speckleTone(
  buf: Buf,
  to: number,
  /** The two source tones and how much of each to convert. Two explicit sources rather
   *  than a list: iterating and destructuring a pair array per cell measured 2.7x slower
   *  than the two scans it was meant to replace. */
  lit: number,
  litDensity: number,
  dark: number,
  darkDensity: number,
  seed: number,
  /** Stage-y bounds. Scanning the whole grid for a band that occupies a third of it was
   *  the same waste `Buf.outline` was measured for and bounded away from. */
  fromY: number,
  toY: number,
): void {
  const y0 = Math.max(0, buf.ay(fromY));
  const y1 = Math.min(buf.h, buf.ay(toY));
  for (let y = y0; y < y1; y++) {
    const row = y * buf.w;
    for (let x = 0; x < buf.w; x++) {
      const at = buf.idx[row + x];
      if (at === lit) {
        if (hash2(x, y, seed) < litDensity) buf.idx[row + x] = to;
      } else if (at === dark) {
        if (hash2(x, y, seed) < darkDensity) buf.idx[row + x] = to;
      }
    }
  }
}

function drawHorizonGlow(
  buf: Buf,
  vp: number,
  horizon: number,
  radiusX: number,
  radiusY: number,
  tones: readonly number[],
): void {
  const levels = tones.length;
  const cx = buf.ax(vp);
  const cy = buf.ay(horizon);
  const rx = Math.max(1, radiusX / (buf.sx(1) - buf.sx(0)));
  const ry = Math.max(1, radiusY / (buf.sy(1) - buf.sy(0)));
  const top = Math.max(0, Math.ceil(cy - ry));

  for (let y = top; y < Math.min(buf.h, cy); y++) {
    const dy = (cy - y) / ry;
    for (let x = Math.max(0, Math.ceil(cx - rx)); x < Math.min(buf.w, Math.ceil(cx + rx)); x++) {
      const dx = (x - cx) / rx;
      const v = 1 - Math.sqrt(dx * dx + dy * dy);
      if (v <= 0) continue;
      const exact = v * levels;
      const low = Math.floor(exact);
      let pick = exact - low > bayer(x, y) ? low + 1 : low;
      // Grain inside the flat core, where the field has saturated and the dither has
      // nothing left to mix. Kept clear of the horizon for the same reason as the
      // striations below.
      if (cy - y >= 4 && hash2(x, y, 3313) < 0.22) pick -= 1;
      // Striations, crowding toward the horizon. Both Act 1 references draw their light
      // source this way — a bright field crossed by darker horizontal bars — and it is what
      // stops a large soft source reading as fog. The bars are art rows, so the striping is
      // on the grid by construction, and it holds the whole thing to *bands*.
      //
      // Never within four art rows of the horizon, though. A striation is a full-width
      // tonal step across the vanishing-point corridor, which is precisely what
      // check:invariant measures the horizon by; one three rows up would tie with the
      // horizon on coverage, and `strongestNear` scans upward and takes the first, so the
      // check would report the anchor three rows high on art that is exactly registered.
      const period = 3 + Math.round(dy * 5);
      if (cy - y >= 4 && y % period === 0) pick -= 1;
      if (pick <= 0) continue;
      buf.set(x, y, tones[Math.min(levels, pick) - 1] as number);
    }
  }
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

  /** The two dune shadows, as polygons — the same marks Act I lays on this plane. */
  const dunes: readonly (readonly (readonly [number, number])[])[] = [
    [
      [left, horizon + below * 0.54],
      [w * 0.34, horizon + below * 0.44],
      [w * 0.44, horizon + below * 0.76],
      [left, horizon + below * 0.94],
    ],
    [
      [w * 0.7, horizon + below * 0.48],
      [w + bleed, horizon + below * 0.38],
      [w + bleed, horizon + below * 0.82],
      [w * 0.62, horizon + below * 0.68],
    ],
  ];

  /**
   * The whole ground plane in one pass, as ramp indices rather than as stacked fills.
   *
   * Act I paints this as a dithered vertical ramp with flat polygons laid over it — a dune
   * shadow, a road, four ruts, eight cast shadows — and each of those flat fills is a large
   * region of exactly one colour. That is where its coarseness comes from: measured, Act IV
   * on the SVG substrate had a 25th-percentile flat run of **63px at 1440**, against a 14px
   * bound, and almost all of it was road and dune.
   *
   * Here every one of those marks is an **offset into one of two ramps** instead. The road
   * selects a second ramp; dunes, ruts, the near-horizon highlight and the cast shadows all
   * push the index further down the ramp they are already on. Two consequences, both of
   * which the checks see:
   *
   *   - **Nothing is flat.** The index is dithered between adjacent steps and perturbed by a
   *     seeded per-cell grit term, so the plane carries sand texture everywhere, which is
   *     what the reference ground actually looks like.
   *   - **The palette does not grow.** Act I's cast shadows go through `polyBlend`, which
   *     interns a new entry per distinct surface crossed; with a textured ground that would
   *     be dozens of entries. An index offset costs nothing, and both ramps carry seven
   *     steps of headroom past the range the plane itself uses, so a shadow has somewhere
   *     to go.
   *
   * Grit is held to ±2 steps deliberately. On these ramps one step is ~13 in Manhattan RGB:
   * ±1 is below the run-detector's tolerance of 14 and would not break a run at all, ±2 sits
   * just above it, and ±4 would start reading as noise rather than as sand.
   */
  const drawGroundPlane = (buf: Buf): void => {
    const cell = buf.sx(1) - buf.sx(0);
    // 26 steps, of which the plane itself uses 0..18. The rest is headroom for shadow.
    const sand = gradientRamp(
      buf.palette,
      [
        // The sun is under the horizon, so the plane is lit only where it is furthest
        // away: warm and pale at the horizon, cooling and darkening the whole way to the
        // viewer's feet. The first pass ramped between two warm tans and read as noon.
        { at: 0, hex: tint(P.desert, P.glow, 0.28) },
        { at: 0.1, hex: tint(P.desert, P.glow, 0.06) },
        // The middle of the plain is held light on purpose. It is the one large area the
        // low light still reaches, and it is what keeps the frame off the floor of the
        // value scale: darkening it along with everything else read correctly as pre-dawn
        // but collapsed 90% of the frame into the two darkest bands.
        { at: 0.28, hex: shade(P.desert, 0.04) },
        { at: 0.48, hex: shade(tint(P.desert, P.castShadow, 0.12), 0.18) },
        { at: 0.72, hex: shade(tint(P.desert, P.castShadow, 0.3), 0.4) },
        { at: 1, hex: shade(tint(P.desert, P.castShadow, 0.5), 0.6) },
      ],
      26,
      'iv-sand',
    );
    // 18 steps, of which the road uses 0..12.
    const road = gradientRamp(
      buf.palette,
      [
        // Packed dirt takes its colour from the sky rather than from the sand, so the road
        // runs cooler and a little lighter than the plane it is cut into. That difference
        // is what makes it read as a road at all — on the first pass both were warm tans
        // within a few units of each other and the street disappeared into the desert.
        { at: 0, hex: tint(P.road, P.glow, 0.54) },
        { at: 0.28, hex: tint(P.road, P.glow, 0.24) },
        { at: 0.7, hex: shade(tint(P.road, P.skyViolet, 0.3), 0.1) },
        { at: 1, hex: shade(tint(P.road, P.castShadow, 0.48), 0.42) },
      ],
      18,
      'iv-road',
    );
    const SAND_SPAN = 18;
    const ROAD_SPAN = 12;

    const horizonRow = buf.ay(horizon);
    const bottom = h * 1.06;
    const shadows = TOWN.map((b) => castShadowPoints(geo, b));
    const rutKs = [-0.62, -0.34, 0.34, 0.62] as const;

    for (let cy = Math.max(0, horizonRow); cy < buf.h; cy++) {
      const sy = buf.sy(cy) + cell / 2;
      // Ramp position, 0 at the horizon and 1 at the bottom of the buffer.
      const t = Math.min(1, Math.max(0, (sy - horizon) / (h + bleed - horizon)));
      const d = Math.max(0, (sy - horizon) / (bottom - horizon));

      // The horizon row is the one row that must stay a clean tonal step: check:invariant
      // reads the horizon as a boundary across the vanishing-point corridor, and a dither
      // there puts the same tone on both sides in alternating columns. Flat fill, no
      // dither, no grit — the same reason Buf.vRamp honours protectRow.
      if (cy === horizonRow) {
        buf.fillCells(0, cy, buf.w, cy + 1, sand[0] as number);
        continue;
      }

      const halfRoad = w * ROAD_NEAR_HALF * d;
      // Grit fades in over the first rows below the horizon: distant ground is smoothed by
      // the air between, and it keeps every competing boundary well clear of the anchor.
      const grain = Math.min(1, Math.max(0, (cy - horizonRow - 4) / 9));

      /**
       * The row's polygon membership, flattened, with each set's union bounds.
       *
       * Testing every cell against ten polygons is the whole cost of this pass, and it
       * showed up where it always does — not in a frame-rate reading but in `check:perf`'s
       * act-entry max, which went 25.8ms to 60.1ms. Almost every cell is outside every
       * shadow, so one comparison against the union bounds skips the inner loop for them.
       */
      let duneLo = Infinity;
      let duneHi = -Infinity;
      const duneFlat: number[] = [];
      for (const quad of dunes) {
        const s = spanAt(quad, sy);
        if (!s) continue;
        duneFlat.push(s[0], s[1]);
        if (s[0] < duneLo) duneLo = s[0];
        if (s[1] > duneHi) duneHi = s[1];
      }
      let shLo = Infinity;
      let shHi = -Infinity;
      const shFlat: number[] = [];
      for (const quad of shadows) {
        const s = spanAt(quad, sy);
        if (!s) continue;
        shFlat.push(s[0], s[1]);
        if (s[0] < shLo) shLo = s[0];
        if (s[1] > shHi) shHi = s[1];
      }

      // Ragged road edge, one cell either way, so the shoulder is not a ruled line.
      const edgeJitter = (hash2(0, cy, 5501) - 0.5) * 2.2 * cell;
      const rHalf = halfRoad + edgeJitter;
      const roadOn = halfRoad > cell * 0.5 && rHalf > 0;
      const roadFrom = roadOn ? Math.max(0, buf.ax(vp - rHalf)) : buf.w;
      const roadTo = roadOn ? Math.min(buf.w, buf.ax(vp + rHalf)) : buf.w;
      const rutHalf = Math.max(cell, halfRoad * 0.035);
      // Highlight band along the top of the plane — Act I's `desertHigh` polygon, as a
      // lift of the ramp index rather than a flat fill. Linear in x, so it is two
      // coefficients rather than a per-cell expression.
      const hlBase = horizon + below * (0.13 - (0.05 * left) / full);
      const hlSlope = (below * 0.05) / full;
      const hlFeather = below * 0.09;
      const sandBase = t * SAND_SPAN;
      const roadBase = t * ROAD_SPAN;
      // The row's eight Bayer thresholds, once. `bayer()` is two modulos and a lookup, and
      // this pass calls it for every cell of 40% of the frame.
      const thr = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => bayer(i, cy));
      const rowOffset = cy * buf.w;
      let sxp = buf.sx(0) + cell / 2;

      for (let cx = 0; cx < buf.w; cx++, sxp += cell) {
        const onRoad = cx >= roadFrom && cx < roadTo;
        const steps = onRoad ? road : sand;
        let pos = onRoad ? roadBase : sandBase;

        if (onRoad) {
          // Wheel ruts. They are functions of the road half-width, which is a function of
          // depth, so they converge exactly on the vanishing point by construction.
          for (const k of rutKs) {
            if (Math.abs(sxp - (vp + halfRoad * k)) < rutHalf) {
              pos += 2.2;
              break;
            }
          }
        } else {
          // Highlight along the far edge of the plane, and the two dune shadows.
          // Feathered, not stepped. A hard `if` here draws a full-width horizontal line
          // across the plane at the band's edge — the one mark in the frame that reads as
          // ruled rather than as ground. A fractional shift dithers instead, because the
          // index is dithered on its way to a step anyway.
          const highlight = hlBase + hlSlope * sxp;
          if (sy < highlight) {
            pos -= 1.3 * Math.min(1, (highlight - sy) / hlFeather);
          }
          if (sxp >= duneLo && sxp <= duneHi) {
            for (let i = 0; i < duneFlat.length; i += 2) {
              if (sxp >= (duneFlat[i] as number) && sxp <= (duneFlat[i + 1] as number)) {
                pos += 4.6;
                break;
              }
            }
          }
        }

        // Cast shadows. Softer than Act I's 0.4 multiply — the light is below the horizon,
        // so what throws them is a glow rather than a disc.
        if (sxp >= shLo && sxp <= shHi) {
          for (let i = 0; i < shFlat.length; i += 2) {
            if (sxp >= (shFlat[i] as number) && sxp <= (shFlat[i + 1] as number)) {
              pos += 2.6;
              break;
            }
          }
        }

        // Sand grit: two steps up or down, roughly a third of the plane.
        const g = hash2(cx, cy, 9173);
        if (g < 0.27 * grain) pos += 2;
        else if (g < 0.54 * grain) pos -= 2;
        else if (g < 0.6 * grain) pos += 4;

        const limit = steps.length - 1;
        const clamped = pos < 0 ? 0 : pos > limit ? limit : pos;
        const low = clamped | 0;
        const pick =
          clamped - low > (thr[cx & 7] as number) && low < limit ? low + 1 : low;
        // Written straight into the index array. Both coordinates are loop bounds, so the
        // guard in `Buf.set` cannot fire, and this layer draws no outline, so it does not
        // need the drawn-extent bookkeeping that `set` also does.
        buf.idx[rowOffset + cx] = steps[pick] as number;
      }
    }
  };

  const sky: SlotArt = {
    verb: 'crossfade',
    /**
     * The sky, as a banded ramp rather than a smooth gradient — 30 dithered steps, where a
     * literal gradient over 174 art rows would cost ~174 of the act's 255 palette entries.
     *
     * The stop list is where "earlier" actually lives. Act I reaches its warm mid at 64% of
     * the way down; this holds blue to 34%, spends 34–72% in violet, and only opens into
     * warm over the last 28%. Same structure, an hour and a half earlier.
     */
    draw: (buf) => {
      /**
       * Stops and step count are chosen so that **every adjacent pair of steps is at least
       * ~16 apart in Manhattan RGB**, and that is a measured constraint rather than a
       * stylistic one.
       *
       * A dither only breaks a flat run where the two steps it mixes actually differ. The
       * first version of this ramp ran 30 steps through six stops, which put `skyUpper` and
       * `skyViolet` — 73 units apart — across six steps at 12 per step, and `skyMid` and
       * `skyLower` (27 apart) across four at 7. Both segments came out as solid rows the
       * full width of the frame however hard they were dithered. Measured at 390x844: the
       * band holding them carried **6.2%** of its pixels in single-cell runs against 35% for
       * the ground.
       *
       * Twenty-two steps over four stops, with `skyViolet` pushed away from `skyUpper` and
       * the near-duplicate `skyLower` dropped, gives every segment 16-32 per step. Nothing
       * about the sky's colours or proportions changed; only their spacing — and that alone
       * took the frame from 22.9% to 29.2% of its pixels in single-cell runs.
       *
       * A per-cell jitter on top of this was tried and **removed**: at 18% density it added
       * 0.6 points, at 9% it added 0.2, and it cost the sky its clean banding. The spacing
       * was the whole fix; the grain was measuring itself.
       */
      const steps = gradientRamp(
        buf.palette,
        [
          { at: 0, hex: P.skyZenith },
          { at: 0.34, hex: P.skyUpper },
          { at: 0.62, hex: P.skyViolet },
          { at: 0.84, hex: P.skyMid },
          { at: 1, hex: P.skyHorizon },
        ],
        22,
        'iv-sky',
      );
      buf.vRamp(left, -bleed, full, horizon + bleed, steps);

      // Three cloud bands, all lit from the vanishing point — which is where the glow is,
      // so the frame reads as lit from one place even with no sun in it.
      //
      // Against Act I's: **thinner** (squash 5.4/6.2/8.4 against 3.4/4.2/6.5, so each cloud
      // is flatter and more streak than mass), **higher** (the lowest band stops at 0.9 of
      // the way down rather than 0.99, leaving a clear strip of open sky for the glow to
      // occupy), and **sparser** (coverage 0.46/0.5/0.42 against 0.58/0.72/0.62). Quieter
      // sky, and it is the glow rather than the cloud deck that carries the horizon.
      const sun = { x: vp, y: horizon };
      for (const spec of [
        {
          top: -bleed,
          bottom: horizon * 0.36,
          scale: 30,
          squash: 5.4,
          coverage: 0.46,
          seed: 1201,
          // Slate against the blue zenith. Drawn in the sky's own tone a cloud is
          // invisible however correctly it is drawn.
          base: P.cloudHigh,
          sky: P.skyUpper,
          lit: P.skyViolet,
        },
        {
          top: horizon * 0.3,
          bottom: horizon * 0.66,
          scale: 21,
          squash: 6.2,
          coverage: 0.5,
          seed: 907,
          base: P.cloudMid,
          sky: P.skyViolet,
          // Mauve, not gold: at this altitude the light is still under the horizon, and a
          // gold-lit mid deck reads as Act I's dawn rather than as the hour before it.
          lit: '#B08098',
        },
        {
          top: horizon * 0.62,
          bottom: horizon * 0.9,
          scale: 14,
          squash: 8.4,
          coverage: 0.42,
          seed: 613,
          // Darker than the glow it sits over, so the low deck silhouettes against it
          // rather than washing out.
          base: P.cloudLow,
          sky: P.skyMid,
          lit: P.glow,
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
     * Everything registered to an anchor, in paint order: the glow sits *behind* the ground
     * plane, so the plane follows it.
     */
    drawLocked: (buf) => {
      drawHorizonGlow(
        buf,
        vp,
        horizon,
        w * 0.46,
        glowR * 0.74,
        ramp(buf.palette, tint(P.skyHorizon, P.glow, 0.3), P.glowCore, 9, 'iv-glow'),
      );
      drawGroundPlane(buf);
    },
    // The only smooth gradient in the build (§3). Reduced-motion path only.
    free:
      `<defs><linearGradient id="iv-sky" x1="0" y1="0" x2="0" y2="${r(horizon)}" gradientUnits="userSpaceOnUse">` +
      `<stop offset="0%" stop-color="${P.skyZenith}"/>` +
      `<stop offset="34%" stop-color="${P.skyUpper}"/>` +
      `<stop offset="62%" stop-color="${P.skyViolet}"/>` +
      `<stop offset="82%" stop-color="${P.skyMid}"/>` +
      `<stop offset="93%" stop-color="${P.skyLower}"/>` +
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
      poly(dunes[0] as (readonly [number, number])[], P.desertShadow, ' fill-opacity="0.34"') +
      poly(dunes[1] as (readonly [number, number])[], P.desertShadow, ' fill-opacity="0.34"') +
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
    /**
     * Solid band at a constant layer opacity — not a dither.
     *
     * This is the one place in the act where alpha is load-bearing rather than decorative.
     * The horizon has to remain *measurable through* the haze: check:invariant reads it as
     * a tonal step across the vanishing-point corridor. A uniform wash tints both sides
     * equally and leaves the step intact; a dither lands the haze tone on one side and not
     * the other in alternating rows, which turns every art row boundary near the horizon
     * into a stronger boundary than the horizon itself.
     */
    alpha: 0.16,
    draw: (buf) => {
      // Weaker and less coloured than Act I's, because of what sits under it. This band is
      // centred on the horizon, so it lies exactly across the glow; at 0.26 in a mauve it
      // desaturated the one warm thing in the act and the glow read as fog. It is here to
      // add distance, not hue.
      buf.rect(
        left,
        horizon - hazeBand,
        full,
        hazeBand * 2,
        buf.tone(tint(P.skyLower, P.skyViolet, 0.18), 'haze'),
      );
    },
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
    draw: (buf) => {
      const iMesa = buf.tone(P.mesa, 'mesa');
      const iMesaShade = buf.tone(shadeIV(P.mesa, 0.3), 'mesa shade');
      // The cap catches the glow, but only just — a fifth of the lift Act I's sunlit cap
      // gets, because the source is under the horizon.
      const iMesaLit = buf.tone(shadeIV(tint(P.mesa, P.glow, 0.14), -0.12), 'mesa lit');
      const iMesaGrit = buf.tone(shadeIV(P.mesa, 0.15), 'mesa grit');
      for (const m of mesaSpec) {
        const cx = w * m.cx;
        const topY = horizon - h * m.top;
        const halfTop = w * m.halfW * 0.66;
        const halfBottom = w * m.halfW;
        const skew = w * m.lean;
        const stepX = halfTop * 0.28;
        const stepY = h * m.top * 0.13;
        buf.poly(
          [
            [cx - halfBottom, horizon + bleed],
            [cx - halfTop + skew, topY + stepY],
            [cx - stepX + skew, topY + stepY],
            [cx - stepX + skew, topY],
            [cx + halfTop + skew, topY],
            [cx + halfBottom, horizon + bleed],
          ],
          iMesa,
        );
        buf.rect(
          cx - halfTop * 0.92 + skew,
          topY,
          halfTop * 1.84,
          Math.max(h * m.top * 0.05, 2),
          iMesaLit,
        );
        // Strata: a mesa face is bedded rock, and two bands of it stop the wedge reading as
        // one flat purple mass. Drawn as polygons that follow the batter of the sides, not
        // as a dithered rectangle — a rectangle is not clipped to the silhouette and puts a
        // band of loose dots in the open sky either side of the mesa.
        for (const [at, thick] of [
          [0.34, 0.09],
          [0.63, 0.06],
        ] as const) {
          const halfA = halfTop + (halfBottom - halfTop) * at;
          const halfB = halfTop + (halfBottom - halfTop) * (at + thick);
          const yA = topY + (horizon - topY) * at;
          const yB = topY + (horizon - topY) * (at + thick);
          buf.poly(
            [
              [cx - halfA + skew * (1 - at), yA],
              [cx + halfA + skew * (1 - at), yA],
              [cx + halfB + skew * (1 - at - thick), yB],
              [cx - halfB + skew * (1 - at - thick), yB],
            ],
            iMesaShade,
          );
          // Weathered lower edge. The band below a stratum is rubble, not a ruled line —
          // and this dithers *inside* the silhouette because the mesa only ever widens
          // going down, so a rect of the band's own width cannot escape it.
          buf.rectDither(
            cx - halfB * 0.94 + skew * (1 - at - thick),
            yB,
            halfB * 1.88,
            (horizon - topY) * 0.09,
            iMesaShade,
            (k) => 0.62 - 0.62 * k,
          );
        }
        const away = Math.sign(cx - vp) || 1;
        buf.poly(
          [
            [cx + away * halfBottom, horizon + bleed],
            [cx + away * halfTop + skew, topY],
            [cx + away * halfTop * 0.42 + skew, topY],
            [cx + away * halfBottom * 0.46, horizon + bleed],
          ],
          iMesaShade,
        );
      }
      // Rock, once the masses are down. Three mesas at 390 are ~14% of the frame in two
      // flat tones; broken up they carry their own weathering instead of reading as cut
      // paper against the sky.
      // Bounded to *above* the horizon, not to the mesa polygons' `horizon + bleed`.
      //
      // `speckleTone` writes `buf.idx` directly and so does not honour `Buf.protectRow` the
      // way `vRamp` and `rectDither` do. It is the one path in this act that could dither
      // the protected row. Today that is harmless — `ridge` clips at the horizon, so the row
      // is thrown away, and the mesas clear the VP corridor anyway — but "harmless because
      // two unrelated things happen to be true" is how the horizon gets broken later by an
      // edit to neither. `toY` is exclusive, so passing `horizon` stops one row short of it.
      const mesaTop = horizon - h * 0.26;
      speckleTone(buf, iMesaGrit, iMesa, 0.2, iMesaShade, 0.14, 6421, mesaTop, horizon);
    },
    free: mesas,
  };

  // ---- slot 4 — scrub, the fence, and the poles running to the VP ----------
  let scrub = '';
  for (let i = 0; i < 24; i++) {
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

  // A few posts remain; the rails hang lower than Act I's. Earlier, and less settled.
  let fence = '';
  for (const side of [-1, 1] as const) {
    for (let i = 1; i <= 12; i++) {
      const d = Math.pow(i / 12, 2.2) * 0.66;
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
    draw: (buf) => {
      const iScrub = buf.tone(P.midGround, 'scrub');
      const iScrubShade = buf.tone(shadeIV(P.midGround, 0.3), 'scrub shade');
      for (let i = 0; i < 24; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const d = 0.05 + ((i * 11) % 29) / 52;
        const y = groundY(geo, d);
        const s = depthScale(geo, d);
        const spread = ((i * 37) % 100) / 100;
        const x = vp + side * (roadHalf(geo, d, ROAD_NEAR_HALF, 0) + w * (0.05 + spread * 1.9) * s);
        if (x < left || x > w + bleed || !clearsVP(geo, x, w * 0.03 * s)) continue;
        const bw = w * 0.03 * s;
        const bh = below * 0.06 * s;
        buf.poly(
          [
            [x - bw, y],
            [x - bw * 0.28, y - bh],
            [x + bw * 0.34, y - bh * 0.72],
            [x + bw, y],
          ],
          iScrub,
        );
        buf.poly(
          [
            [x + bw * 0.1, y],
            [x + bw * 0.34, y - bh * 0.72],
            [x + bw, y],
          ],
          iScrubShade,
        );
      }
    },
    drawLocked: (buf) => {
      const iPost = buf.tone(P.midGround, 'fence');
      // The rails were `stroke-opacity` over the ground. Resolved to tones against the
      // desert rather than dithered: a one-cell rail dithered at 50% would simply
      // disappear for half its length.
      const iRail = buf.tone(tint(P.desert, P.midGround, 0.72), 'rail');
      for (const side of [-1, 1] as const) {
        for (let i = 1; i <= 12; i++) {
          const d = Math.pow(i / 12, 2.2) * 0.66;
          const y = groundY(geo, d);
          const s = depthScale(geo, d);
          const x = vp + side * (roadHalf(geo, d, ROAD_NEAR_HALF, 0) + w * 0.26 * s);
          const postH = below * 0.05 * s;
          if (x < left || x > w + bleed || !clearsVP(geo, x)) continue;
          buf.rect(x - w * 0.0015 * s, y - postH, w * 0.003 * s, postH, iPost);
        }
        // One rail, not Act I's two — the fence is half down. It still terminates exactly
        // at the vanishing point, which is why it is in the locked layer.
        const nd = 0.66;
        const ns = depthScale(geo, nd);
        const nx = vp + side * (roadHalf(geo, nd, ROAD_NEAR_HALF, 0) + w * 0.26 * ns);
        const ny = groundY(geo, nd);
        buf.line(nx, ny - below * 0.032 * ns, vp, horizon, iRail, 1.2);
      }

      // Telegraph poles receding to the vanishing point.
      //
      // The single most reference-evocative element on the ground plane, and cheap: a run
      // of verticals at diminishing scale is what tells the eye how far away the horizon
      // is. VP-registered, so they live in the locked layer and converge exactly. Act I
      // has them at these same marks — it is the same street.
      const iPole = buf.tone(tint(P.town, P.skyHorizon, 0.14), 'pole');
      const iPoleLit = buf.tone(tint(RIM, P.glow, 0.34), 'pole lit');
      const iWire = buf.tone(tint(P.desert, P.town, 0.46), 'wire');
      const poles: { x: number; top: number }[] = [];
      for (const side of [-1, 1] as const) {
        for (let i = 1; i <= 11; i++) {
          const d = Math.pow(i / 11, 2.05) * 1.06;
          const s = depthScale(geo, d);
          const gy = groundY(geo, d);
          const x = vp + side * (roadHalf(geo, d, ROAD_NEAR_HALF, 0) + w * 0.055 * s);
          if (x < left || x > w + bleed || !clearsVP(geo, x)) continue;
          const poleH = below * 0.42 * s;
          const poleW = Math.max(w * 0.0035 * s, 1);
          const top = gy - poleH;
          buf.rect(x - poleW / 2, top, poleW, poleH, iPole);
          // The glow is at the VP, so the road-facing edge catches what light there is.
          buf.rect(x - side * poleW * 0.5, top, Math.max(poleW * 0.45, 1), poleH, iPoleLit);
          const armW = w * 0.022 * s;
          buf.rect(x - armW / 2, top + poleH * 0.06, armW, Math.max(poleH * 0.022, 1), iPole);
          buf.rect(x - armW * 0.35, top + poleH * 0.17, armW * 0.7, Math.max(poleH * 0.018, 1), iPole);
          poles.push({ x, top: top + poleH * 0.06 });
        }
      }
      for (let i = 0; i + 1 < poles.length; i++) {
        const a = poles[i] as { x: number; top: number };
        const b = poles[i + 1] as { x: number; top: number };
        if (Math.sign(a.x - vp) !== Math.sign(b.x - vp)) continue;
        const sag = Math.abs(b.top - a.top) * 0.18 + Math.abs(b.x - a.x) * 0.035;
        const mid = { x: (a.x + b.x) / 2, y: (a.top + b.top) / 2 + sag };
        buf.line(a.x, a.top, mid.x, mid.y, iWire, 1);
        buf.line(mid.x, mid.y, b.x, b.top, iWire, 1);
      }
    },
    free: scrub,
    locked: fence,
  };

  // ---- street furniture, so the middle distance is not an empty wedge -------
  const propSpec = [
    [0.36, -1, 'rail'],
    [0.6, 1, 'barrel'],
    [0.66, 1, 'trough'],
    [1.02, -1, 'barrel'],
  ] as const;

  let streetProps = '';
  for (const [d, side, kind] of propSpec) {
    const s = depthScale(geo, d);
    const gy = groundY(geo, d);
    const px = vp + side * (roadHalf(geo, d, ROAD_NEAR_HALF, 0) * 0.82);
    const tone = shade(tint(P.town, P.skyHorizon, Math.max(0, (1 - d) * 0.26)), 0.15);
    if (kind === 'rail') {
      const railW = w * 0.055 * s;
      const railH = below * 0.075 * s;
      streetProps += rect(px - railW / 2, gy - railH, w * 0.0035 * s, railH, tone);
      streetProps += rect(px + railW / 2, gy - railH, w * 0.0035 * s, railH, tone);
      streetProps += rect(px - railW / 2, gy - railH, railW, below * 0.008 * s, tone);
    } else if (kind === 'barrel') {
      const bw = w * 0.016 * s;
      const bh = below * 0.055 * s;
      streetProps += rect(px - bw / 2, gy - bh, bw, bh, tone);
      streetProps += rect(px - bw * 0.56, gy - bh * 0.72, bw * 1.12, bh * 0.1, shade(tone, 0.3));
    } else {
      const tw = w * 0.05 * s;
      streetProps += rect(px - tw / 2, gy - below * 0.03 * s, tw, below * 0.03 * s, tone);
    }
  }

  /** Street furniture, so the middle distance is not an empty wedge. */
  const drawStreetProps = (buf: Buf): number[] => {
    const used: number[] = [];
    for (const [d, side, kind] of propSpec) {
      const s = depthScale(geo, d);
      const gy = groundY(geo, d);
      const px = vp + side * (roadHalf(geo, d, ROAD_NEAR_HALF, 0) * 0.82);
      const tone = shade(tint(P.town, P.skyHorizon, Math.max(0, (1 - d) * 0.26)), 0.15);
      const iTone = buf.tone(tone, 'street prop');
      const iDark = buf.tone(shadeIV(tone, 0.34), 'street prop dark');
      used.push(iTone, iDark);
      if (kind === 'rail') {
        const railW = w * 0.055 * s;
        const railH = below * 0.075 * s;
        buf.rect(px - railW / 2, gy - railH, w * 0.0035 * s, railH, iTone);
        buf.rect(px + railW / 2, gy - railH, w * 0.0035 * s, railH, iTone);
        buf.rect(px - railW / 2, gy - railH, railW, below * 0.008 * s, iTone);
      } else if (kind === 'barrel') {
        const bw = w * 0.016 * s;
        const bh = below * 0.055 * s;
        buf.rect(px - bw / 2, gy - bh, bw, bh, iTone);
        buf.rect(px - bw * 0.56, gy - bh * 0.72, bw * 1.12, bh * 0.1, iDark);
      } else {
        const tw = w * 0.05 * s;
        buf.rect(px - tw / 2, gy - below * 0.03 * s, tw, below * 0.03 * s, iTone);
      }
    }
    return used;
  };

  // ---- slots 3 and 2 — the town --------------------------------------------
  const mid: SlotArt = {
    verb: 'extrude',
    clipBottom: groundY(geo, 0.62),
    draw: (buf) => {
      const tones = new Set<number>();
      for (const b of TOWN.filter((x) => x.d < 0.6)) {
        for (const t of drawBuilding(buf, geo, b)) tones.add(t);
      }
      for (const t of drawStreetProps(buf)) tones.add(t);
      // Outline the group's silhouette, not every internal tone boundary.
      buf.outline(tones, buf.tone(TOWN_LINE, 'town line'));
    },
    free: outlined(
      TOWN.filter((b) => b.d < 0.6)
        .map((b) => buildingMarkup(geo, b))
        .join('') + streetProps,
      TOWN_LINE,
      1.5,
    ),
  };

  // One accent: a lamp still burning on the last building, as in Act I.
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
    draw: (buf) => {
      const tones = new Set<number>();
      for (const b of TOWN.filter((x) => x.d >= 0.6)) {
        for (const t of drawBuilding(buf, geo, b)) tones.add(t);
      }
      buf.outline(tones, buf.tone(TOWN_LINE, 'town line'));
      // The last thing the eye finds: one lamp still burning over the nearest porch. It is
      // the only saturated mark in the act, which is what makes it findable.
      buf.line(
        lampX,
        lampY - lampR * 2.6,
        lampX,
        lampY - lampR,
        buf.tone(P.town, 'lamp arm'),
        Math.max(lampR * 0.5, 1.5),
      );
      buf.disc(lampX, lampY, lampR, buf.tone(P.accent, 'lamp glow'));
      buf.disc(lampX, lampY, lampR * 0.5, buf.tone(P.window, 'lamp core'));
    },
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
  // Nothing full-width here: a band across this slot paints in front of slots 2-5 and
  // occludes the whole scene (build.md B11 — it has caused this exact bug three times).
  let foreground = '';
  for (let i = 0; i < 12; i++) {
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

  const ground: SlotArt = {
    verb: 'crossfade',
    draw: (buf) => {
      const iStone = buf.tone(shadeIV(P.desert, 0.4), 'stone');
      const iStoneLit = buf.tone(shadeIV(P.desert, -0.14), 'stone lit');
      // Floor of two art cells, and it is load-bearing at 390x844.
      //
      // These stones are `w * 0.004..0.010` wide and 0.75 of that tall, which at 390 is
      // 1.2-2.9 CSS px against a 3px cell. `Buf.poly`'s scanline finds no row centre inside
      // a shape that short, so **all twelve rendered zero pixels** and slot 1 was nine
      // pebbles. That is the sub-cell-shape-culled failure of review-checklist.md §6 —
      // the one that deleted every mote in Act III — and `buffer.ts` states the rule it
      // breaks: a shape narrower than one art pixel still exists, it becomes one art pixel.
      // At 1440 the floor is 6px against a smallest natural size of 5.8, so nothing moves.
      const cell = buf.sx(1) - buf.sx(0);
      for (let i = 0; i < 12; i++) {
        const t = ((i * 41) % 100) / 100;
        const x = w * (0.02 + t * 0.96);
        const y = h - below * (0.005 + (((i * 17) % 7) / 7) * 0.06);
        const s = Math.max(w * (0.004 + (((i * 13) % 5) / 5) * 0.006), cell * 2);
        buf.poly(
          [
            [x - s, y],
            [x - s * 0.4, y - s * 0.75],
            [x + s * 0.5, y - s * 0.6],
            [x + s, y],
          ],
          iStone,
        );
        // One lit facet, on the side the glow is on. Two tones is the difference between a
        // stone and a grey blob at this size.
        buf.poly(
          [
            [x - s * 0.4, y - s * 0.75],
            [x + s * 0.5, y - s * 0.6],
            [x + s * 0.1, y - s * 0.35],
          ],
          iStoneLit,
        );
      }
      // Was fill-opacity over the desert; resolved to a tone, because these are two or
      // three cells across and dithering one at 70% deletes part of it.
      const iPebble = buf.tone(tint(P.desert, P.desertShadow, 0.7), 'pebble');
      for (let i = 0; i < 9; i++) {
        const x = w * (0.06 + (((i * 29) % 100) / 100) * 0.88);
        const y = h - below * (0.002 + (((i * 23) % 5) / 5) * 0.03);
        buf.disc(x, y, w * 0.0035, iPebble);
      }
    },
    free: foreground,
  };

  // ---- slot 0 — a single tumbleweed. One bird. Nothing else (§7). ----------
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

  const drawTumbleweed = (cx: number, cy: number, rad: number) => (buf: Buf) => {
    const x = w * cx;
    const y = h * cy;
    const rr = h * rad;
    const index = buf.tone(P.desertShadow, 'tumbleweed');
    const lit = buf.tone(shadeIV(P.desertShadow, -0.3), 'tumbleweed lit');
    buf.disc(x, y, rr * 0.55, index);
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      buf.line(
        x + Math.cos(a) * rr * 0.2,
        y + Math.sin(a) * rr * 0.2,
        x + Math.cos(a * 1.7) * rr,
        y + Math.sin(a * 1.7) * rr,
        i % 3 === 0 ? lit : index,
        Math.max(rr * 0.14, 2),
      );
    }
  };

  const birdArt = bird(w * 0.44, h * 0.2, h * 0.017, P.town);

  return [
    {
      verb: 'drift',
      draw: (buf) => {
        drawBird(buf, w * 0.44, h * 0.2, h * 0.017, buf.tone(P.town, 'bird'));
      },
      free: birdArt,
      parts: [
        {
          draw: drawTumbleweed(0.38, 0.9, 0.04),
          markup: tumbleweed(0.38, 0.9, 0.04),
          rate: 0.44,
        },
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

export const ACT_IV: ActDefinition = {
  id: 'iv',
  name: 'The Frontier Returns',
  build,
};
