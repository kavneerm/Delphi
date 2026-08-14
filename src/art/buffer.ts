/**
 * The art buffer: a grid of palette indices, one entry per art pixel.
 *
 * Coordinates coming in are **stage CSS pixels**, the same space the acts have always
 * composed in, and are converted to art cells here. That is deliberate: an act should
 * describe where things are in the world, and exactly one place in the codebase should
 * know how big an art pixel is.
 *
 * Every edge lands on a cell boundary by construction, which is what the old chunk-grid
 * snapping in src/acts/shared.ts was approximating. The difference is that snapping a
 * vector still hands the rasteriser a shape it can antialias; here there is no sub-pixel
 * to lose, because a pixel is the smallest thing that exists.
 */

import { ART_SCALE } from '../config.ts';
import { TRANSPARENT, type Palette, type Rgb } from './palette.ts';

/**
 * 8x8 ordered Bayer matrix, 0..63.
 *
 * 8x8 rather than 4x4, and the reason is measured. A 4x4 matrix quantises coverage to
 * sixteenths, so a smoothly varying density crosses a threshold every ~6% and, because the
 * pattern is regular, one whole Bayer position lights up across the entire width at once.
 * That is a hard full-width contour. check:invariant caught it as "strongest boundary near
 * the horizon is at y=516 (100% coverage), want 522" — a band edge two art cells above the
 * horizon, strong enough to outrank the horizon itself.
 *
 * 8x8 makes the steps 1/64, so a contour changes 1.6% of pixels instead of 6.25% and stops
 * being a boundary at all. It also makes the sky ramp read less mechanically.
 */
const BAYER = [
  0, 32, 8, 40, 2, 34, 10, 42,
  48, 16, 56, 24, 50, 18, 58, 26,
  12, 44, 4, 36, 14, 46, 6, 38,
  60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41,
  51, 19, 59, 27, 49, 17, 57, 25,
  15, 47, 7, 39, 13, 45, 5, 37,
  63, 31, 55, 23, 61, 29, 53, 21,
];
const BAYER_N = 8;
const BAYER_LEVELS = 64;

export class Buf {
  /** Dimensions in art pixels. */
  readonly w: number;
  readonly h: number;
  readonly idx: Uint8Array;
  /** Buffer origin as a positive stage-px overdraw: stage x = -ox maps to art x = 0. */
  readonly ox: number;
  readonly oy: number;
  readonly palette: Palette;

  /**
   * Rows that must never be dithered.
   *
   * check:invariant measures a tonal boundary at the horizon by counting how many columns
   * of the vanishing-point corridor show a colour step at that row. A dithered horizon
   * alternates two tones along the row and destroys that reading — the check would fail on
   * a horizon that is exactly where it should be, which is the measurement-asking-the-
   * wrong-question failure documented in docs/review-checklist.md §1.
   */
  private readonly noDither = new Set<number>();

  constructor(palette: Palette, w: number, h: number, ox: number, oy: number) {
    this.palette = palette;
    this.ox = ox;
    this.oy = oy;
    this.w = w;
    this.h = h;
    this.idx = new Uint8Array(w * h);
  }

  /** Stage px -> art cell. Rounds, so a shape stays centred on where it was authored. */
  ax(stageX: number): number {
    return Math.round((stageX + this.ox) / ART_SCALE);
  }

  ay(stageY: number): number {
    return Math.round((stageY + this.oy) / ART_SCALE);
  }

  /** Art cell -> stage px of the cell's top-left corner. */
  sx(artX: number): number {
    return artX * ART_SCALE - this.ox;
  }

  sy(artY: number): number {
    return artY * ART_SCALE - this.oy;
  }

  protectRow(stageY: number): void {
    this.noDither.add(this.ay(stageY));
  }

  /**
   * Intern a colour and get its index.
   *
   * There is no alpha in the buffer, by design. A translucent fill is resolved to the tone
   * it would have produced — `tone(tint(background, ink, 0.34))` rather than a 34% ink —
   * which is both how pixel art actually works and what keeps the palette countable. A
   * buffer with alpha would make "which colours does this act use" unanswerable again.
   */
  tone(hex: string, label = ''): number {
    return this.palette.index(hex, label);
  }

  set(x: number, y: number, index: number): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.idx[y * this.w + x] = index;
  }

  get(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return TRANSPARENT;
    return this.idx[y * this.w + x] ?? TRANSPARENT;
  }

  /** Fill in art-cell coordinates. Everything else routes through this. */
  fillCells(x0: number, y0: number, x1: number, y1: number, index: number): void {
    const lo = Math.max(0, Math.min(x0, x1));
    const hi = Math.min(this.w, Math.max(x0, x1));
    const top = Math.max(0, Math.min(y0, y1));
    const bottom = Math.min(this.h, Math.max(y0, y1));
    for (let y = top; y < bottom; y++) {
      this.idx.fill(index, y * this.w + lo, y * this.w + hi);
    }
  }

  /**
   * Fill a rectangle given in stage px.
   *
   * A shape narrower than one art pixel still exists — it becomes one art pixel. Culling
   * it instead is how every music mote in Act III came to render as zero pixels
   * (docs/review-checklist.md §6); the rule that a length rounds *up* to the minimum is
   * older than that bug and was simply not implemented.
   */
  rect(x: number, y: number, w: number, h: number, index: number): void {
    const x0 = this.ax(x);
    const y0 = this.ay(y);
    const x1 = Math.max(x0 + 1, this.ax(x + Math.max(w, 0)));
    const y1 = Math.max(y0 + 1, this.ay(y + Math.max(h, 0)));
    this.fillCells(x0, y0, x1, y1, index);
  }

  /**
   * A vertical ramp between palette steps, dithered at the band edges.
   *
   * This is what replaces an SVG linear gradient. `steps` is a ramp from palette.ramp();
   * `dither` mixes adjacent steps across a band boundary so the transition reads smooth at
   * viewing distance while every pixel remains exactly one palette entry.
   */
  vRamp(
    x: number,
    y: number,
    w: number,
    h: number,
    steps: readonly number[],
    options: { dither?: boolean } = {},
  ): void {
    if (steps.length === 0) return;
    const x0 = Math.max(0, this.ax(x));
    const x1 = Math.min(this.w, Math.max(x0 + 1, this.ax(x + w)));
    const y0 = this.ay(y);
    const y1 = Math.max(y0 + 1, this.ay(y + h));
    const span = y1 - y0;
    const dither = options.dither ?? true;

    for (let cy = Math.max(0, y0); cy < Math.min(this.h, y1); cy++) {
      const t = span <= 1 ? 0 : (cy - y0) / (span - 1);
      const exact = t * (steps.length - 1);
      const low = Math.min(steps.length - 1, Math.floor(exact));
      const high = Math.min(steps.length - 1, low + 1);
      const frac = exact - low;
      const loIndex = steps[low] ?? TRANSPARENT;
      const hiIndex = steps[high] ?? loIndex;

      if (!dither || low === high || frac === 0 || this.noDither.has(cy)) {
        this.idx.fill(loIndex, cy * this.w + x0, cy * this.w + x1);
        continue;
      }
      // Ordered dither: the threshold varies per (x, y) so the boundary breaks up into a
      // stable pattern rather than a hard line or a noise field.
      const rowBase = (cy % BAYER_N) * BAYER_N;
      for (let cx = x0; cx < x1; cx++) {
        const threshold = ((BAYER[rowBase + (cx % BAYER_N)] ?? 0) + 0.5) / BAYER_LEVELS;
        this.idx[cy * this.w + cx] = frac > threshold ? hiIndex : loIndex;
      }
    }
  }

  /**
   * Scanline polygon fill, in stage px.
   *
   * Replaces src/acts/shared.ts `poly()`, which walked each edge in chunk steps emitting
   * L-shaped intermediate points to stop the rasteriser drawing a smooth diagonal. On a
   * real pixel grid that machinery is unnecessary: a scanline fill produces a hard stepped
   * edge because there is nothing finer than a pixel to step by.
   */
  poly(points: readonly (readonly [number, number])[], index: number): void {
    this.scan(points, (x, y) => {
      this.idx[y * this.w + x] = index;
    });
  }

  /**
   * Partial coverage by ordered dither — how pixel art does translucency.
   *
   * A layer's buffer is opaque indices with no alpha, and it sits on its own canvas, so a
   * translucent fill cannot composite against the layer below the way `fill-opacity` did.
   * Scattering the colour at `density` coverage on a Bayer threshold gives the same read at
   * viewing distance, is what the reference art actually does, and keeps every pixel a
   * single palette entry.
   */
  rectDither(
    x: number,
    y: number,
    w: number,
    h: number,
    index: number,
    /** Constant coverage, or a function of vertical position through the band (0..1). */
    density: number | ((t: number) => number),
  ): void {
    const x0 = Math.max(0, this.ax(x));
    const y0 = Math.max(0, this.ay(y));
    const x1 = Math.min(this.w, Math.max(x0 + 1, this.ax(x + Math.max(w, 0))));
    const y1 = Math.min(this.h, Math.max(y0 + 1, this.ay(y + Math.max(h, 0))));
    const span = Math.max(1, y1 - y0 - 1);
    for (let cy = y0; cy < y1; cy++) {
      const d =
        typeof density === 'number'
          ? Math.max(0, Math.min(1, density))
          : Math.max(0, Math.min(1, density((cy - y0) / span)));
      // Protected rows stay undithered, for the same reason vRamp respects them: the
      // horizon is measured as a tonal step across the vanishing-point corridor, and a
      // dither that lands the same tone on both sides of it in some columns erases the
      // step there. Measured: a 30%-dithered haze band took horizon coverage at 390x844
      // from 100% to 50%, against a 55% floor, and moved the strongest boundary one art
      // cell low. The old 30%-opacity wash could not do that — it tinted both sides
      // equally and left the step intact.
      if (this.noDither.has(cy)) continue;
      const rowBase = (cy % BAYER_N) * BAYER_N;
      for (let cx = x0; cx < x1; cx++) {
        const threshold = ((BAYER[rowBase + (cx % BAYER_N)] ?? 0) + 0.5) / BAYER_LEVELS;
        if (d > threshold) this.idx[cy * this.w + cx] = index;
      }
    }
  }

  /**
   * Fill a polygon by transforming whatever is already underneath it.
   *
   * This is how a multiply blend survives the move to an indexed buffer. On the SVG
   * substrate a cast shadow was a `mix-blend-mode: multiply` group; here each covered
   * pixel is looked up, multiplied, and re-interned. The result is exact rather than
   * approximated by a single flat tone, and the palette cost is bounded by the number of
   * distinct surfaces the shape actually crosses — four or five, not one per pixel —
   * because the mapping is memoised per destination index.
   *
   * (The SVG version of this was silently broken for a while: `mix-blend-mode` was written
   * as an SVG attribute, which is not a thing, so the shadows composited as plain alpha.
   * There is no attribute to get wrong here.)
   */
  polyBlend(
    points: readonly (readonly [number, number])[],
    blend: (dst: Rgb) => Rgb,
  ): void {
    const cache = new Map<number, number>();
    const resolve = (dst: number): number => {
      const hit = cache.get(dst);
      if (hit !== undefined) return hit;
      const out = this.palette.index(blend(this.palette.at(dst)), 'blend');
      cache.set(dst, out);
      return out;
    };
    this.scan(points, (x, y) => {
      const at = y * this.w + x;
      const dst = this.idx[at] ?? TRANSPARENT;
      if (dst === TRANSPARENT) return;
      this.idx[at] = resolve(dst);
    });
  }

  /** Walk every cell inside a polygon. `poly` and `polyBlend` share this. */
  private scan(
    points: readonly (readonly [number, number])[],
    visit: (x: number, y: number) => void,
  ): void {
    if (points.length < 3) return;
    const xs = points.map((p) => this.ax(p[0]));
    const ys = points.map((p) => this.ay(p[1]));
    const top = Math.max(0, Math.min(...ys));
    const bottom = Math.min(this.h, Math.max(...ys) + 1);
    const crossings: number[] = [];

    for (let y = top; y < bottom; y++) {
      crossings.length = 0;
      const centre = y + 0.5;
      for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        const ay = ys[i] as number;
        const by = ys[j] as number;
        if (ay === by) continue;
        if (centre < Math.min(ay, by) || centre >= Math.max(ay, by)) continue;
        const ax = xs[i] as number;
        const bx = xs[j] as number;
        crossings.push(ax + ((centre - ay) / (by - ay)) * (bx - ax));
      }
      if (crossings.length < 2) continue;
      crossings.sort((a, b) => a - b);
      for (let k = 0; k + 1 < crossings.length; k += 2) {
        const from = Math.max(0, Math.round(crossings[k] as number));
        const to = Math.min(this.w, Math.round(crossings[k + 1] as number));
        for (let x = from; x < to; x++) visit(x, y);
      }
    }
  }

  /**
   * A disc, drawn as stacked rows so its edge steps rather than curving.
   *
   * Rows are laid out from one top edge and stepped by exactly one cell, so they are
   * contiguous by construction — snapping each row independently is what made the trees
   * read as venetian blinds.
   */
  disc(cx: number, cy: number, radius: number, index: number): void {
    const acx = (cx + this.ox) / ART_SCALE;
    const acy = (cy + this.oy) / ART_SCALE;
    const r = Math.max(0.5, radius / ART_SCALE);
    const top = Math.round(acy - r);
    const rows = Math.max(1, Math.round(r * 2));
    for (let i = 0; i < rows; i++) {
      const y = top + i;
      const dy = y + 0.5 - acy;
      const half = Math.sqrt(Math.max(r * r - dy * dy, 0));
      const from = Math.round(acx - Math.max(half, 0.5));
      const to = Math.max(from + 1, Math.round(acx + Math.max(half, 0.5)));
      this.fillCells(from, y, to, y + 1, index);
    }
  }

  /** A one-cell-thick staircase between two stage-px points. */
  line(x1: number, y1: number, x2: number, y2: number, index: number, thickness = 1): void {
    const ax1 = this.ax(x1);
    const ay1 = this.ay(y1);
    const ax2 = this.ax(x2);
    const ay2 = this.ay(y2);
    const dx = ax2 - ax1;
    const dy = ay2 - ay1;
    const steps = Math.max(1, Math.max(Math.abs(dx), Math.abs(dy)));
    const t = Math.max(1, Math.round(thickness / ART_SCALE));
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    for (let i = 0; i <= steps; i++) {
      const x = ax1 + Math.round((dx * i) / steps);
      const y = ay1 + Math.round((dy * i) / steps);
      if (horizontal) this.fillCells(x, y, x + 1, y + t, index);
      else this.fillCells(x, y, x + t, y + 1, index);
    }
  }

  /**
   * Outline every boundary of `index` against a different value.
   *
   * Replaces `outlined()`, which wrapped markup in a stroked <g> and therefore stroked
   * every rect inside it — including each row of a stacked disc, which is what made the
   * trees read as venetian blinds. Working on the finished pixels instead means the
   * outline follows the silhouette and nothing else.
   */
  outline(inside: number | Iterable<number>, strokeIndex: number, options: { bottom?: boolean } = {}): void {
    const bottom = options.bottom ?? true;
    const set = typeof inside === 'number' ? new Set([inside]) : new Set(inside);
    const source = this.idx.slice();
    const isInside = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
      return set.has(source[y * this.w + x] ?? TRANSPARENT);
    };
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (!isInside(x, y)) continue;
        // Passing the whole group's tones means the outline follows the silhouette and
        // does not trace every internal tone change — which is the bug `outlined()` had:
        // it stroked every rect it wrapped, including each row of a stacked disc, and the
        // trees came out looking like venetian blinds.
        const edge =
          !isInside(x - 1, y) ||
          !isInside(x + 1, y) ||
          !isInside(x, y - 1) ||
          (bottom && !isInside(x, y + 1));
        if (edge) this.idx[y * this.w + x] = strokeIndex;
      }
    }
  }

  /** Expand into RGBA, ready for putImageData. */
  toImageData(rgba: Uint32Array, out?: Uint8ClampedArray): Uint8ClampedArray {
    const bytes = out ?? new Uint8ClampedArray(this.w * this.h * 4);
    const words = new Uint32Array(bytes.buffer, bytes.byteOffset, this.w * this.h);
    for (let i = 0; i < words.length; i++) {
      words[i] = rgba[this.idx[i] as number] ?? 0;
    }
    return bytes;
  }
}

/** Art-buffer dimensions for a stage box, with the origins that keep anchors on cells. */
export function bufferSize(
  stageW: number,
  stageH: number,
  ox: number,
  oy: number,
): { w: number; h: number } {
  return {
    w: Math.ceil((stageW + ox * 2) / ART_SCALE),
    h: Math.ceil((stageH + oy * 2) / ART_SCALE),
  };
}
