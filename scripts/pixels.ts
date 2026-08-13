/**
 * Pixel measurement, with no image dependency.
 *
 * ImageMagick is not installed on this machine (build.md B3), so the PNG decoder here is
 * built on node's zlib. It handles exactly what Playwright emits: 8-bit, non-interlaced,
 * colour types 0/2/4/6.
 */

import { inflateSync } from 'node:zlib';

export interface Image {
  readonly width: number;
  readonly height: number;
  /** RGBA, 4 bytes per pixel. */
  readonly data: Uint8Array;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function decodePng(buffer: Uint8Array): Image {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (buffer[i] !== PNG_SIGNATURE[i]) throw new Error('not a PNG');
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Uint8Array[] = [];

  while (offset < buffer.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      buffer[offset + 4] ?? 0,
      buffer[offset + 5] ?? 0,
      buffer[offset + 6] ?? 0,
      buffer[offset + 7] ?? 0,
    );
    const start = offset + 8;

    if (type === 'IHDR') {
      width = view.getUint32(start);
      height = view.getUint32(start + 4);
      bitDepth = buffer[start + 8] ?? 0;
      colorType = buffer[start + 9] ?? 0;
      const interlace = buffer[start + 12] ?? 0;
      if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
      if (interlace !== 0) throw new Error('interlaced PNG not supported');
    } else if (type === 'IDAT') {
      idat.push(buffer.subarray(start, start + length));
    } else if (type === 'IEND') {
      break;
    }

    offset = start + length + 4;
  }

  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported colour type ${colorType}`);

  const merged = Buffer.concat(idat.map((c) => Buffer.from(c)));
  const raw = new Uint8Array(inflateSync(merged));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const line = new Uint8Array(stride);
  const prior = new Uint8Array(stride);

  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++] ?? 0;
    for (let i = 0; i < stride; i++) {
      const value = raw[src + i] ?? 0;
      const a = i >= channels ? (line[i - channels] ?? 0) : 0;
      const b = prior[i] ?? 0;
      const c = i >= channels ? (prior[i - channels] ?? 0) : 0;
      let recon: number;
      switch (filter) {
        case 1:
          recon = value + a;
          break;
        case 2:
          recon = value + b;
          break;
        case 3:
          recon = value + ((a + b) >> 1);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          recon = value + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          recon = value;
      }
      line[i] = recon & 0xff;
    }
    src += stride;

    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      if (channels === 1) {
        const v = line[s] ?? 0;
        out[d] = v;
        out[d + 1] = v;
        out[d + 2] = v;
        out[d + 3] = 255;
      } else if (channels === 2) {
        const v = line[s] ?? 0;
        out[d] = v;
        out[d + 1] = v;
        out[d + 2] = v;
        out[d + 3] = line[s + 1] ?? 255;
      } else {
        out[d] = line[s] ?? 0;
        out[d + 1] = line[s + 1] ?? 0;
        out[d + 2] = line[s + 2] ?? 0;
        out[d + 3] = channels === 4 ? (line[s + 3] ?? 255) : 255;
      }
    }
    prior.set(line);
  }

  return { width, height, data: out };
}

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function pixelAt(image: Image, x: number, y: number): Rgb {
  const i = (Math.round(y) * image.width + Math.round(x)) * 4;
  return { r: image.data[i] ?? 0, g: image.data[i + 1] ?? 0, b: image.data[i + 2] ?? 0 };
}

export function hex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function channelLuminance(c8: number): number {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance. */
export function luminance({ r, g, b }: Rgb): number {
  return (
    0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
  );
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** HSV saturation and value, 0..1. */
export function saturation({ r, g, b }: Rgb): { s: number; v: number } {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  return { s: max === 0 ? 0 : (max - min) / max, v: max };
}

/**
 * Fraction of columns showing a luminance step between row `y-1` and row `y`, sampled in
 * the vanishing-point corridor.
 *
 * This is the primitive the invariant check actually wants. "Where is the strongest edge
 * in this image" is not the question — at 390 the frame is mostly structure, and the
 * chunky sun is a stack of hard stepped rows — the question is "is there a real boundary
 * at 58%, and is it the strongest one locally". Both are answered by comparing coverage at
 * the expected row against coverage at its neighbours.
 */
export function edgeCoverage(
  image: Image,
  y: number,
  centreFrac = 0.5,
  span = 0.08,
  /** Manhattan RGB distance. Colour, not luminance — see the note below. */
  stepThreshold = 16,
): number {
  const { width, height } = image;
  if (y < 1 || y >= height) return 0;
  const from = Math.max(0, Math.floor(width * (centreFrac - span / 2)));
  const to = Math.min(width, Math.ceil(width * (centreFrac + span / 2)));
  const cols = to - from;
  if (cols < 4) return 0;
  let votes = 0;
  for (let x = from; x < to; x++) {
    const a = pixelAt(image, x, y - 1);
    const b = pixelAt(image, x, y);
    // Colour distance, not luminance. Mid-transition the horizon can be a hue boundary
    // with almost no luminance step — Act III→IV at 390 crosses at #413545 / #2c2b3d,
    // which is 39 in colour distance but only 0.015 in luminance. A luminance-only test
    // calls that "no boundary" and fails a horizon that is exactly where it should be.
    if (Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) >= stepThreshold) {
      votes += 1;
    }
  }
  return votes / cols;
}

/** The row of strongest coverage within +/- `radius` of `expected`. */
export function strongestNear(
  image: Image,
  expected: number,
  radius: number,
  centreFrac = 0.5,
  span = 0.08,
): { y: number; coverage: number } {
  let best = { y: expected, coverage: -1 };
  for (let y = Math.round(expected - radius); y <= Math.round(expected + radius); y++) {
    const coverage = edgeCoverage(image, y, centreFrac, span);
    if (coverage > best.coverage) best = { y, coverage };
  }
  return best;
}

export interface Region {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly area: number;
  readonly hex: string;
}

/**
 * Connected regions of saturated colour. Backs the Act II "no saturation outside the
 * permitted sources" rule and the Act III "≥20 distinct sources" count.
 */
export function chromaRegions(
  image: Image,
  options: { minSat?: number; minValue?: number; minArea?: number } = {},
): Region[] {
  const minSat = options.minSat ?? 0.5;
  const minValue = options.minValue ?? 0.35;
  const minArea = options.minArea ?? 12;
  const { width, height } = image;
  const mask = new Uint8Array(width * height);

  for (let i = 0; i < width * height; i++) {
    const px = {
      r: image.data[i * 4] ?? 0,
      g: image.data[i * 4 + 1] ?? 0,
      b: image.data[i * 4 + 2] ?? 0,
    };
    const { s, v } = saturation(px);
    mask[i] = s >= minSat && v >= minValue ? 1 : 0;
  }

  const regions: Region[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 1) continue;
    mask[start] = 2;
    stack.length = 0;
    stack.push(start);
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    let area = 0;
    let sr = 0;
    let sg = 0;
    let sb = 0;

    while (stack.length > 0) {
      const index = stack.pop() as number;
      const x = index % width;
      const y = (index - x) / width;
      area += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      sr += image.data[index * 4] ?? 0;
      sg += image.data[index * 4 + 1] ?? 0;
      sb += image.data[index * 4 + 2] ?? 0;

      const neighbours = [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1,
      ];
      for (const n of neighbours) {
        if (n >= 0 && mask[n] === 1) {
          mask[n] = 2;
          stack.push(n);
        }
      }
    }

    if (area >= minArea) {
      regions.push({
        x: minX,
        y: minY,
        w: maxX - minX + 1,
        h: maxY - minY + 1,
        area,
        hex: hex({
          r: Math.round(sr / area),
          g: Math.round(sg / area),
          b: Math.round(sb / area),
        }),
      });
    }
  }

  return regions.sort((a, b) => b.area - a.area);
}
