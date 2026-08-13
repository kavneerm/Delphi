/**
 * Geometry helpers shared by every act. One perspective model, one road, one set of
 * shape builders — so four acts read as the same place seen at four moments rather than
 * four drawings that happen to share a horizon.
 */

import type { Geometry } from './types.ts';

/**
 * Chunky pixel-art grid.
 *
 * Every coordinate every helper in this file emits is snapped to a multiple of `PIXEL`,
 * so edges land on chunk boundaries and read as large pixels rather than as vector
 * outlines. Set once per build() from the stage box — deterministic given geo, which is
 * what the asset contract requires of build().
 *
 * ~7px at 1440 wide, scaling down with the viewport so the chunk reads at the same size
 * relative to the composition at every breakpoint.
 */
let PIXEL = 7;
/**
 * The grid is anchored to the horizon and the vanishing point, not to the origin.
 *
 * This matters: snapping to a grid rooted at y=0 moves the horizon by up to half a chunk,
 * which breaks the one structural invariant the whole build rests on. Anchoring the grid
 * to the anchors means the horizon and the VP always land exactly on grid lines, and every
 * other edge in the composition aligns to them — which is also what a pixel artist would
 * do by hand.
 */
let ORIGIN_X = 0;
let ORIGIN_Y = 0;

export function setPixelGrid(geo: Geometry): void {
  PIXEL = Math.max(2, Math.round(geo.w / 200));
  ORIGIN_X = geo.vp;
  ORIGIN_Y = geo.horizon;
}

export function pixel(): number {
  return PIXEL;
}

/** Snap an x coordinate to the grid, which is rooted at the vanishing point. */
export function snapX(value: number): number {
  return ORIGIN_X + Math.round((value - ORIGIN_X) / PIXEL) * PIXEL;
}

/** Snap a y coordinate to the grid, which is rooted at the horizon. */
export function snapY(value: number): number {
  return ORIGIN_Y + Math.round((value - ORIGIN_Y) / PIXEL) * PIXEL;
}

/** Snap a length, never below one chunk — a sub-chunk shape would anti-alias away. */
export function snapSize(value: number): number {
  return Math.max(PIXEL, Math.round(value / PIXEL) * PIXEL);
}

/** Where the ground plane sits at depth `d`. d=0 is the vanishing point, d=1 the viewer. */
export function groundY(geo: Geometry, d: number): number {
  const bottom = geo.h * 1.06;
  return geo.horizon + (bottom - geo.horizon) * Math.max(d, 0.0001);
}

/**
 * Scale of a constant-height object at depth `d`. In a one-point perspective this is
 * exactly its distance below the horizon, normalised — which is why buildings, fence
 * posts and figures all shrink at the same rate without any of them being special-cased.
 */
export function depthScale(geo: Geometry, d: number): number {
  return (groundY(geo, d) - geo.horizon) / (geo.h - geo.horizon);
}

/** Half-width of the road at depth `d`. Both edges terminate exactly at the VP. */
export function roadHalf(geo: Geometry, d: number, nearFrac = 0.3, farFrac = 0.004): number {
  return geo.w * (farFrac + (nearFrac - farFrac) * d);
}

/**
 * Half-width of the corridor either side of the vanishing point that no structure may
 * cross, as a fraction of stage width.
 *
 * art-direction §2 requires the VP visible in every act — including Act II, where the road
 * is walled off short of it. It is also what `check:invariant` measures the rendered
 * horizon in, since it is the one column guaranteed unoccluded in every act.
 */
export const VP_KEEP_CLEAR = 0.055;

/** True if `x` (absolute px) is clear of the vanishing-point corridor. */
export function clearsVP(geo: Geometry, x: number, halfWidth = 0): boolean {
  const centre = geo.w * 0.5;
  const guard = geo.w * VP_KEEP_CLEAR;
  return Math.abs(x - centre) - halfWidth > guard;
}

/**
 * A winding road.
 *
 * The centre line meanders, but the meander **tapers to zero at the vanishing point**, so
 * both edges still terminate exactly there — art-direction §2, which a straight road
 * satisfied for free and a winding one has to be built to satisfy.
 */
export interface Wind {
  /** Peak lateral swing at the near edge, as a fraction of stage width. */
  readonly amplitude: number;
  /** Half-waves between the viewer and the vanishing point. */
  readonly frequency: number;
  readonly phase: number;
}

/** Centre of the road at depth `d`. Everything that flanks the road measures from this. */
export function roadCentre(geo: Geometry, d: number, wind?: Wind): number {
  if (!wind) return geo.vp;
  const t = Math.min(Math.max(d, 0), 1);
  // Cubic taper: the swing dies out well before the horizon, so the last stretch reads as
  // genuinely converging rather than as a curve clipped at a point.
  const taper = t * t * t;
  return (
    geo.vp + Math.sin(t * Math.PI * wind.frequency + wind.phase) * geo.w * wind.amplitude * taper
  );
}

/**
 * Polygon for a winding road, sampled down its length. `farD` lets Act II stop the road
 * at its wall instead of at the vanishing point.
 */
export function windingRoad(
  geo: Geometry,
  nearHalf: number,
  wind: Wind | undefined,
  options: { farD?: number; nearD?: number; steps?: number; widen?: number } = {},
): (readonly [number, number])[] {
  const farD = options.farD ?? 0;
  const nearD = options.nearD ?? 1;
  const steps = options.steps ?? 26;
  const widen = options.widen ?? 1;
  const left: (readonly [number, number])[] = [];
  const right: (readonly [number, number])[] = [];

  for (let i = 0; i <= steps; i++) {
    const d = farD + ((nearD - farD) * i) / steps;
    const centre = roadCentre(geo, d, wind);
    const half = roadHalf(geo, d, nearHalf, 0) * widen;
    const y = i === steps ? geo.h + geo.bleed : groundY(geo, d);
    left.push([centre - half, y]);
    right.push([centre + half, y]);
  }
  return [...left, ...right.reverse()];
}

/**
 * A meandering band crossing the frame — a river or canal. Weaves vertically as it
 * crosses, so it reads as cut through the land rather than ruled across it.
 */
export function meander(
  geo: Geometry,
  baseY: number,
  thickness: number,
  amplitude: number,
  frequency: number,
  phase = 0,
  steps = 30,
): (readonly [number, number])[] {
  const from = -geo.bleed;
  const span = geo.w + geo.bleed * 2;
  const top: (readonly [number, number])[] = [];
  const bottom: (readonly [number, number])[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = from + span * t;
    const y = baseY + Math.sin(t * Math.PI * frequency + phase) * amplitude;
    // Nearer stretches of the band read thicker, as perspective requires.
    const k = thickness * (0.72 + 0.56 * Math.abs(Math.sin(t * Math.PI * frequency + phase)));
    top.push([x, y]);
    bottom.push([x, y + k]);
  }
  return [...top, ...bottom.reverse()];
}

export function rect(x: number, y: number, w: number, h: number, fill: string, extra = ''): string {
  // Width and height are derived from the snapped edges, so a rect's far edge lands on
  // the grid too — snapping position and size independently lets them drift apart.
  const x0 = snapX(x);
  const y0 = snapY(y);
  const x1 = snapX(x + Math.max(w, 0));
  const y1 = snapY(y + Math.max(h, 0));
  return `<rect x="${x0}" y="${y0}" width="${Math.max(x1 - x0, PIXEL)}" height="${Math.max(y1 - y0, PIXEL)}" fill="${fill}"${extra}/>`;
}

export function poly(points: readonly (readonly [number, number])[], fill: string, extra = ''): string {
  // Vertices alone are not enough: the rasteriser joins two snapped vertices with a smooth
  // one-device-pixel staircase, which is sub-chunk and reads as an anti-aliased diagonal.
  // Walking each edge in chunk steps puts the whole outline on the grid.
  const out: string[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i] as readonly [number, number];
    const b = points[(i + 1) % n] as readonly [number, number];
    const ax = snapX(a[0]);
    const ay = snapY(a[1]);
    const bx = snapX(b[0]);
    const by = snapY(b[1]);
    out.push(`${ax},${ay}`);
    const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay)) / PIXEL;
    if (steps <= 1) continue;
    let px0 = ax;
    let py0 = ay;
    for (let k = 1; k < steps; k++) {
      const t = k / steps;
      const nx = snapX(ax + (bx - ax) * t);
      const ny = snapY(ay + (by - ay) * t);
      if (nx === px0 && ny === py0) continue;
      // L-shaped step: move on one axis, then the other, so every edge is axis-aligned.
      if (Math.abs(bx - ax) >= Math.abs(by - ay)) {
        out.push(`${nx},${py0}`);
        out.push(`${nx},${ny}`);
      } else {
        out.push(`${px0},${ny}`);
        out.push(`${nx},${ny}`);
      }
      px0 = nx;
      py0 = ny;
    }
  }
  return `<polygon points="${out.join(' ')}" fill="${fill}"${extra}/>`;
}

/**
 * A circle drawn as stacked chunk rows, so its edge steps instead of curving. An <svg>
 * <circle> anti-aliases no matter what shape-rendering says about it, and one smooth
 * curve in a frame of hard edges is the thing that reads as wrong.
 */
export function blockCircle(cx: number, cy: number, rad: number, fill: string, extra = ''): string {
  const px = PIXEL;
  // Rows are laid out from one snapped top edge and stepped by exactly one chunk, so they
  // are contiguous by construction. Snapping each row's y independently leaves 1px gaps
  // wherever the centre is not itself on the grid, and the shape reads as venetian blinds.
  // A shape smaller than one chunk still exists — it is one chunk. Culling sub-chunk rows
  // silently deleted every mote in Act III and the heads off its distant figures.
  if (rad < px) {
    return `<g stroke="none"><rect x="${snapX(cx - px / 2)}" y="${snapY(cy - px / 2)}" width="${px}" height="${px}" fill="${fill}"${extra}/></g>`;
  }
  const top = snapY(cy - rad);
  const rowCount = Math.max(1, Math.round((rad * 2) / px));
  // stroke:none on the group — `outlined()` applies a stroke to every rect it wraps, and
  // on a stack of adjacent rows that draws a line between each pair. The shape reads as
  // venetian blinds instead of as a disc.
  let out = '<g stroke="none">';
  for (let i = 0; i < rowCount; i++) {
    const y = top + i * px;
    const dy = y + px / 2 - cy;
    const half = Math.sqrt(Math.max(rad * rad - dy * dy, 0));
    const rx0 = snapX(cx - Math.max(half, px / 2));
    const rx1 = snapX(cx + Math.max(half, px / 2));
    out += `<rect x="${rx0}" y="${y}" width="${Math.max(rx1 - rx0, px)}" height="${px}" fill="${fill}"${extra}/>`;
  }
  return `${out}</g>`;
}

export function circle(cx: number, cy: number, rad: number, fill: string, extra = ''): string {
  return blockCircle(cx, cy, rad, fill, extra);
}

/**
 * A line drawn as a staircase of chunks. A real <line> renders a smooth diagonal, which
 * is exactly the thing pixel art does not do.
 */
export function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string,
  width: number,
  extra = '',
): string {
  const px = PIXEL;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / px));
  const thick = snapSize(width);
  // `line` draws rects, so a caller's stroke-opacity would silently do nothing. Translate
  // it. This is why the wheel ruts and fence rails were rendering at full strength.
  const attrs = extra.replace(/stroke-opacity=/g, 'fill-opacity=');
  let out = '<g stroke="none">';
  let lastX = NaN;
  let lastY = NaN;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const sx = snapX(x1 + dx * t);
    const sy = snapY(y1 + dy * t);
    if (sx === lastX && sy === lastY) continue;
    lastX = sx;
    lastY = sy;
    out += `<rect x="${sx}" y="${sy}" width="${Math.abs(dx) > Math.abs(dy) ? px : thick}" height="${Math.abs(dx) > Math.abs(dy) ? thick : px}" fill="${stroke}"${attrs}/>`;
  }
  return `${out}</g>`;
}

/** Round to 2dp. SVG payload is bundle bytes, and 2dp is well below a pixel. */
export function r(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Blend two hex colours. `amount` 0 = a, 1 = b. Used for aerial perspective. */
export function tint(a: string, b: string, amount: number): string {
  const na = parseInt(a.slice(1), 16);
  const nb = parseInt(b.slice(1), 16);
  const mix = (sa: number, sb: number): number =>
    Math.max(0, Math.min(255, Math.round(sa + (sb - sa) * amount)));
  const out = [
    mix((na >> 16) & 255, (nb >> 16) & 255),
    mix((na >> 8) & 255, (nb >> 8) & 255),
    mix(na & 255, nb & 255),
  ];
  return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Darken a hex colour toward black by `amount` (0..1). Used for cel shadow steps. */
export function shade(hexColor: string, amount: number): string {
  const n = parseInt(hexColor.slice(1), 16);
  const to = (c: number): number => Math.max(0, Math.min(255, Math.round(c * (1 - amount))));
  const out = [to((n >> 16) & 255), to((n >> 8) & 255), to(n & 255)];
  return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * A grid of lit window rectangles on a facade. Buildings are silhouettes with lit
 * windows and no interior detail (art-direction §4).
 */
export function windowGrid(options: {
  x: number;
  y: number;
  w: number;
  h: number;
  cols: number;
  rows: number;
  fill: string;
  /** 0..1 — deterministic thinning, so some windows are dark. */
  density?: number;
  seed?: number;
}): string {
  const { x, y, w, h, cols, rows, fill } = options;
  const density = options.density ?? 0.7;
  const seed = options.seed ?? 1;
  const cellW = w / cols;
  const cellH = h / rows;
  const paneW = cellW * 0.46;
  const paneH = cellH * 0.42;
  let out = '';
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      // Deterministic hash — build() must be a pure function of geo.
      const hash = ((row * 73856093) ^ (col * 19349663) ^ (seed * 83492791)) >>> 0;
      if ((hash % 1000) / 1000 > density) continue;
      out += rect(
        x + col * cellW + (cellW - paneW) / 2,
        y + row * cellH + (cellH - paneH) / 2,
        paneW,
        paneH,
        fill,
      );
    }
  }
  return out;
}

/** Wrapper that applies a cel outline to a group. Slots 2–3 only; slots 4–5 have none. */
export function outlined(markup: string, stroke: string, width: number): string {
  // Whole chunks, and mitred rather than rounded: a rounded join is a curve (§3).
  return (
    `<g stroke="${stroke}" stroke-width="${snapSize(width)}" stroke-linejoin="miter" ` +
    `shape-rendering="crispEdges">${markup}</g>`
  );
}
