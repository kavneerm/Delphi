/**
 * Sky: cloud fields and a banded sun.
 *
 * This is the largest single lever on how the frame reads. Measured against the client's
 * references, our sky was a bare ramp: 56 colours covering 99% of the frame against their
 * 188, and 1.8% of pixels in fine detail against their 18.4%. An empty gradient has no
 * detail to have. Clouds are what break it into shapes, and they carry most of the palette
 * depth and most of the fine detail with them.
 *
 * Everything here is deterministic — integer hashes, no `Math.random` — because `build()`
 * is required to be a pure function of the stage box (docs/asset-contract.md) and because
 * two builds have to be diffable pixel for pixel.
 */

import { bayer, type Buf } from './buffer.ts';
import { parseHex, type Palette, type Rgb } from './palette.ts';

/** Deterministic 2D hash, 0..1. */
function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed, 1442695041)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  // `>>> 0` on the XOR too: `^` yields a *signed* 32-bit int in JS, so without it half of
  // these come back negative, fbm sits around zero instead of a half, and nothing ever
  // crosses the coverage threshold. It renders as an empty sky rather than as an error.
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * A precomputed noise lattice.
 *
 * The naive form — hashing four corners inside the per-pixel sampler — costs twelve
 * integer hashes per pixel across three octaves, and measured 6.8ms for a single cloud
 * band. Three bands would have blown the whole frame budget on the sky alone.
 *
 * The lattice itself is tiny: at scale 17 over a 524-wide buffer it is 31x21 cells. Hashing
 * it once per octave and interpolating from the array turns the per-pixel cost into four
 * array reads.
 */
class Lattice {
  private readonly w: number;
  private readonly h: number;
  private readonly values: Float32Array;

  constructor(w: number, h: number, seed: number) {
    this.w = w + 2;
    this.h = h + 2;
    this.values = new Float32Array(this.w * this.h);
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) this.values[y * this.w + x] = hash2(x, y, seed);
    }
  }

  at(x: number, y: number): number {
    const x0 = x < 0 ? 0 : x >= this.w ? this.w - 1 : x;
    const y0 = y < 0 ? 0 : y >= this.h ? this.h - 1 : y;
    return this.values[y0 * this.w + x0] ?? 0;
  }

  /** Raw row access, for callers that have already bounded their indices. */
  get stride(): number {
    return this.w;
  }

  get raw(): Float32Array {
    return this.values;
  }

  /** Bilinear sample with smoothstep, so cloud edges curve rather than show the lattice. */
  sample(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const n00 = this.at(x0, y0);
    const n10 = this.at(x0 + 1, y0);
    const n01 = this.at(x0, y0 + 1);
    const n11 = this.at(x0 + 1, y0 + 1);
    return (n00 * (1 - sx) + n10 * sx) * (1 - sy) + (n01 * (1 - sx) + n11 * sx) * sy;
  }
}

const OCTAVES = [
  { freq: 1, amp: 0.5 },
  { freq: 2.07, amp: 0.25 },
  { freq: 4.28, amp: 0.125 },
] as const;
const OCTAVE_TOTAL = 0.875;

export interface CloudBand {
  /** Top and bottom of the band, in stage px. */
  readonly top: number;
  readonly bottom: number;
  /** Cell size of the noise lattice, in art pixels. Larger = bigger clouds. */
  readonly scale: number;
  /** Vertical squash: clouds are wider than they are tall. */
  readonly squash: number;
  /** 0..1. How much of the band is cloud. */
  readonly coverage: number;
  readonly seed: number;
  /** Base tone, and the lit tone the sun-facing side reaches. */
  readonly shadow: string;
  readonly body: string;
  readonly lit: string;
  readonly rim: string;
}

/**
 * Paint one band of cloud.
 *
 * Shape comes from thresholding an fbm field; tone comes from how far *inside* the shape a
 * pixel is, so the edge reads as a rim and the interior as mass. Two extra touches carry
 * most of the character:
 *
 *   - the threshold rises toward the top and bottom of the band, so clouds thin out at the
 *     band's edges instead of being cut off by a straight line;
 *   - the lit tone is applied by proximity to the sun rather than uniformly, which is what
 *     makes a sunset sky read as lit from one point rather than tinted overall.
 */
export function drawCloudBand(
  buf: Buf,
  band: CloudBand,
  sun: { x: number; y: number },
): void {
  // A ramp rather than four discrete tones, dithered between adjacent steps.
  //
  // Hard tone boundaries make a cloud a flat blob: measured, the sky went to 0.0% of pixels
  // in fine detail, *worse* than the bare gradient it replaced, because a gradient at least
  // dithers. The references get both their painterly edges and most of their fine-detail
  // score from dithering between cloud tones, so that is what this does.
  const ramp = [
    buf.tone(band.shadow, 'cloud shadow'),
    buf.tone(mixHex(band.shadow, band.body, 0.5), 'cloud shadow-body'),
    buf.tone(band.body, 'cloud body'),
    buf.tone(mixHex(band.body, band.lit, 0.5), 'cloud body-lit'),
    buf.tone(band.lit, 'cloud lit'),
    buf.tone(band.rim, 'cloud rim'),
  ];

  const y0 = Math.max(0, buf.ay(band.top));
  const y1 = Math.min(buf.h, buf.ay(band.bottom));
  const sunAx = buf.ax(sun.x);
  const sunAy = buf.ay(sun.y);
  if (y1 <= y0) return;

  const rows = y1 - y0;
  const lattices = OCTAVES.map(
    (o, i) =>
      new Lattice(
        Math.ceil((buf.w / band.scale) * o.freq) + 1,
        Math.ceil(((rows / band.scale) * band.squash + 1) * o.freq) + 1,
        band.seed + i * 101,
      ),
  );
  /**
   * The whole field for this band, computed once.
   *
   * Row terms are hoisted out of the inner loop: for a given row and octave the lattice row
   * indices and the vertical smoothstep are constant, so the per-pixel work drops to two
   * array reads and a lerp per octave. Sampling naively — recomputing floor/frac on both
   * axes per pixel per octave — cost 3.3ms per band, and three bands in each of two acts
   * resident through a transition would not fit in a frame.
   */
  const field = new Float32Array(buf.w * rows);
  for (let i = 0; i < OCTAVES.length; i++) {
    const o = OCTAVES[i] as (typeof OCTAVES)[number];
    const lattice = lattices[i] as Lattice;
    const xStep = (o.freq / band.scale) as number;
    const yStep = ((o.freq * band.squash) / band.scale) as number;
    // Direct array reads: the lattice is sized to cover the band, so the clamping in
    // `at()` is dead weight in the hot loop and measured as most of its cost.
    const raw = lattice.raw;
    const stride = lattice.stride;
    for (let r = 0; r < rows; r++) {
      const ly = r * yStep;
      const ly0 = Math.floor(ly);
      const fy = ly - ly0;
      const sy = fy * fy * (3 - 2 * fy);
      const rowA = ly0 * stride;
      const rowB = rowA + stride;
      const rowOffset = r * buf.w;
      for (let x = 0; x < buf.w; x++) {
        const lx = x * xStep;
        const lx0 = lx | 0;
        const fx = lx - lx0;
        const sx = fx * fx * (3 - 2 * fx);
        const a = raw[rowA + lx0] as number;
        const b = raw[rowA + lx0 + 1] as number;
        const c = raw[rowB + lx0] as number;
        const d = raw[rowB + lx0 + 1] as number;
        field[rowOffset + x] =
          (field[rowOffset + x] as number) +
          ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy) * o.amp;
      }
    }
  }
  // Normalise sun distance against the buffer width so the falloff reads the same at every
  // viewport rather than shrinking with the frame.
  const reach = buf.w * 0.55;

  for (let y = y0; y < y1; y++) {
    const t = (y - y0) / Math.max(1, y1 - y0 - 1);
    // Thin at both edges of the band, densest through the middle.
    const edgeFade = Math.sin(Math.PI * Math.min(1, Math.max(0, t))) ** 0.7;
    const threshold = 1 - band.coverage * edgeFade;
    if (threshold >= 1) continue;

    for (let x = 0; x < buf.w; x++) {
      const n = (field[(y - y0) * buf.w + x] ?? 0) / OCTAVE_TOTAL;
      if (n <= threshold) continue;

      // How far inside the shape this pixel sits, 0 at the edge and 1 well within.
      const depth = Math.min(1, (n - threshold) / Math.max(0.06, 1 - threshold));
      const dx = (x - sunAx) / reach;
      const dy = (y - sunAy) / reach;
      const nearSun = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy));

      // One continuous value: bright at the sun-facing rim, dark deep inside a cloud that
      // faces away. Then dithered onto the ramp, so every boundary breaks up.
      const rimness = 1 - Math.min(1, depth / 0.35);
      const shade = Math.min(
        1,
        Math.max(0, nearSun * 0.95 + rimness * 0.55 - depth * 0.35),
      );
      const exact = shade * (ramp.length - 1);
      const low = Math.min(ramp.length - 1, Math.floor(exact));
      const high = Math.min(ramp.length - 1, low + 1);
      const pick = exact - low > bayer(x, y) ? high : low;
      buf.set(x, y, ramp[pick] as number);
    }
  }
}

/**
 * The sun as horizontal bands rather than a flat disc.
 *
 * Both the Act 1 references draw the sun this way: a bright core crossed by darker
 * striations that thicken toward the bottom, which is what stops a large light source
 * reading as a plain circle. The rows are art rows, so the striping is on the grid by
 * construction.
 */
export function drawBandedSun(
  buf: Buf,
  cx: number,
  cy: number,
  radius: number,
  core: number,
  band: number,
  rim: number,
): void {
  const acx = buf.ax(cx);
  const acy = buf.ay(cy);
  const ar = Math.max(1, Math.round(radius / (buf.sx(1) - buf.sx(0))));

  for (let dy = -ar; dy <= ar; dy++) {
    const y = acy + dy;
    if (y < 0 || y >= buf.h) continue;
    const half = Math.sqrt(Math.max(ar * ar - dy * dy, 0));
    if (half < 0.5) continue;
    const from = Math.round(acx - half);
    const to = Math.round(acx + half);

    // Striations thicken and crowd toward the lower half — the reference reads as the sun
    // sinking into haze rather than as a uniformly striped ball.
    const v = (dy + ar) / (2 * ar);
    const period = Math.max(2, Math.round(3 + (1 - v) * 5));
    const striated = v > 0.35 && (y % period === 0 || (v > 0.7 && y % period === 1));

    for (let x = from; x <= to; x++) {
      const edge = Math.abs(x - acx) > half - 1.2;
      buf.set(x, y, edge ? rim : striated ? band : core);
    }
  }
}

function mixHex(a: string, b: string, k: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const c = (x: number, y: number): number =>
    Math.max(0, Math.min(255, Math.round(x + (y - x) * k)));
  return `#${[c(pa.r, pb.r), c(pa.g, pb.g), c(pa.b, pb.b)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Convenience: build a cloud band's four tones from one hue by tinting toward the sky. */
export function cloudTones(
  palette: Palette,
  base: string,
  sky: string,
  litColour: string,
): { shadow: string; body: string; lit: string; rim: string } {
  const mix = (a: Rgb, b: Rgb, k: number): string => {
    const c = (x: number, y: number): number => Math.round(x + (y - x) * k);
    return `#${[c(a.r, b.r), c(a.g, b.g), c(a.b, b.b)]
      .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'))
      .join('')}`;
  };
  void palette;
  const b = parseHex(base);
  const s = parseHex(sky);
  const l = parseHex(litColour);
  // Body pulls only slightly toward the sky. At 0.38 the cloud landed within a few units
  // of the gradient behind it and was invisible in the render while measuring as "drawn".
  return {
    shadow: mix(b, s, 0.0),
    body: mix(b, s, 0.18),
    lit: mix(b, l, 0.5),
    rim: mix(b, l, 0.82),
  };
}
