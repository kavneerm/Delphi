/**
 * The indexed palette.
 *
 * Every art buffer holds palette indices rather than RGBA. The reason is not that this
 * makes off-palette colour impossible — it does not, because crossfades composite two acts
 * at partial opacity, the grain overlays, and the halftone multiplies, so the final frame
 * is guaranteed to contain colours no act declared. The reason is that a palette cannot be
 * recovered from a screenshot once those have touched it. Validating at the buffer is the
 * only place the question is answerable at all.
 *
 * Index 0 is transparent and is never a colour. That costs one entry and makes "nothing
 * drawn here" distinguishable from "black drawn here", which matters for every layer above
 * the sky.
 *
 * The 255-entry ceiling is a real constraint, not a formality, and it is what forces the
 * sky to be a banded ramp rather than a 300-step gradient. That is the correct pixel-art
 * answer anyway — see docs/art-direction.md §3 — but the ceiling is what makes it
 * non-negotiable rather than a matter of taste.
 */

export const TRANSPARENT = 0;
export const MAX_ENTRIES = 256;

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export function parseHex(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
}

/** Blend `src` over `dst` at `alpha`. Used to resolve fill-opacity at draw time. */
export function over(src: Rgb, dst: Rgb, alpha: number): Rgb {
  const a = Math.max(0, Math.min(1, alpha));
  return {
    r: Math.round(src.r * a + dst.r * (1 - a)),
    g: Math.round(src.g * a + dst.g * (1 - a)),
    b: Math.round(src.b * a + dst.b * (1 - a)),
  };
}

/** Multiply blend, for halftone and cast shadows. */
export function multiply(src: Rgb, dst: Rgb): Rgb {
  return {
    r: Math.round((src.r * dst.r) / 255),
    g: Math.round((src.g * dst.g) / 255),
    b: Math.round((src.b * dst.b) / 255),
  };
}

export class Palette {
  private readonly lookup = new Map<number, number>();
  private readonly entries: Rgb[] = [{ r: 0, g: 0, b: 0 }];
  /** Where each index came from, so an over-budget palette can be explained. */
  private readonly origin: string[] = ['(transparent)'];

  /** Intern a colour, returning its index. Idempotent. */
  index(colour: Rgb | string, label = ''): number {
    const rgb = typeof colour === 'string' ? parseHex(colour) : colour;
    const key = (rgb.r << 16) | (rgb.g << 8) | rgb.b;
    const existing = this.lookup.get(key);
    if (existing !== undefined) return existing;

    if (this.entries.length >= MAX_ENTRIES) {
      // Deliberately fatal. Silently snapping to the nearest existing entry would let a
      // palette drift past its budget invisibly, and the budget is the whole mechanism.
      throw new Error(
        `palette full at ${MAX_ENTRIES} entries; tried to add ${toHex(rgb)}${label ? ` (${label})` : ''}. ` +
          `Band a ramp or share a tone — see src/art/palette.ts.`,
      );
    }

    const next = this.entries.length;
    this.entries.push(rgb);
    this.origin.push(label || toHex(rgb));
    this.lookup.set(key, next);
    return next;
  }

  get size(): number {
    return this.entries.length;
  }

  at(index: number): Rgb {
    return this.entries[index] ?? { r: 0, g: 0, b: 0 };
  }

  /**
   * Packed little-endian RGBA, ready to index straight into an ImageData view.
   * Index 0 is fully transparent; everything else is opaque.
   */
  toRgba(): Uint32Array {
    const out = new Uint32Array(this.entries.length);
    for (let i = 1; i < this.entries.length; i++) {
      const { r, g, b } = this.entries[i] as Rgb;
      out[i] = (255 << 24) | (b << 16) | (g << 8) | r;
    }
    return out;
  }

  /** Every entry with the label it was first interned under. For check:palette. */
  describe(): { index: number; hex: string; label: string }[] {
    return this.entries.map((rgb, index) => ({
      index,
      hex: toHex(rgb),
      label: this.origin[index] ?? '',
    }));
  }
}

/**
 * A banded ramp through an arbitrary set of stops — the replacement for a multi-stop
 * `<linearGradient>`.
 *
 * `steps` tones are interned, sampled evenly across the stop list. Act I's sky has five
 * stops over 174 art rows; at 32 steps that is 32 palette entries instead of the ~174 a
 * literal gradient would need, and it is what the reference skies actually do.
 */
export function gradientRamp(
  palette: Palette,
  stops: readonly { at: number; hex: string }[],
  steps: number,
  label = 'sky',
): number[] {
  const sorted = [...stops].sort((a, b) => a.at - b.at);
  const out: number[] = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    let lower = sorted[0] as { at: number; hex: string };
    let upper = sorted[sorted.length - 1] as { at: number; hex: string };
    for (let s = 0; s + 1 < sorted.length; s++) {
      const a = sorted[s] as { at: number; hex: string };
      const b = sorted[s + 1] as { at: number; hex: string };
      if (t >= a.at && t <= b.at) {
        lower = a;
        upper = b;
        break;
      }
    }
    const span = upper.at - lower.at;
    const local = span <= 0 ? 0 : (t - lower.at) / span;
    const a = parseHex(lower.hex);
    const b = parseHex(upper.hex);
    out.push(
      palette.index(
        {
          r: Math.round(a.r + (b.r - a.r) * local),
          g: Math.round(a.g + (b.g - a.g) * local),
          b: Math.round(a.b + (b.b - a.b) * local),
        },
        `${label}[${i}]`,
      ),
    );
  }
  return out;
}

/**
 * A banded ramp between two colours.
 *
 * This is the primitive that replaces a CSS/SVG linear gradient. `steps` tones are
 * interned once; drawing code picks a step and, where a smoother read is wanted, dithers
 * between adjacent steps. A 24-step sky costs 24 palette entries where a true gradient
 * would cost one per row.
 */
export function ramp(
  palette: Palette,
  from: Rgb | string,
  to: Rgb | string,
  steps: number,
  label = 'ramp',
): number[] {
  const a = typeof from === 'string' ? parseHex(from) : from;
  const b = typeof to === 'string' ? parseHex(to) : to;
  const out: number[] = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    out.push(
      palette.index(
        {
          r: Math.round(a.r + (b.r - a.r) * t),
          g: Math.round(a.g + (b.g - a.g) * t),
          b: Math.round(a.b + (b.b - a.b) * t),
        },
        `${label}[${i}]`,
      ),
    );
  }
  return out;
}
