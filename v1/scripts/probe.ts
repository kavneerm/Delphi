/**
 * Pixel prober for the visual-critic (build.md B3). Replaces the ImageMagick calls in
 * .claude/agents/visual-critic.md, which are not available on this machine.
 *
 *   npm run probe -- sample   shots/1440x900_0.00.png 720 522
 *   npm run probe -- horizon  shots/1440x900_0.00.png
 *   npm run probe -- contrast shots/bd-1440x900_0.32.png 780 120 520 300
 *
 * `contrast` must be pointed at a bd-* backdrop shot (npm run shots -- --backdrop), which
 * is rendered with the copy layer hidden. Measuring a normal shot finds the glyphs and
 * reports #F5F0E8 against itself, which is 1:1 and means nothing.
 *
 * The bd-* shots hide the scrim along with the text, so pass --scrim <hex> --alpha <0..1>
 * to composite the act's scrim over the sampled backdrop before measuring. Without it you
 * are measuring the bare scene, which is not what sits behind the glyphs.
 *   npm run probe -- chroma   shots/1440x900_0.32.png --min-sat 0.5
 *   npm run probe -- column   shots/1440x900_0.00.png 720        # every colour change
 */

import { readFileSync } from 'node:fs';
import {
  chromaRegions,
  contrastRatio,
  decodePng,
  edgeCoverage,
  hex,
  luminance,
  pixelAt,
  saturation,
  strongestNear,
  type Image,
  type Rgb,
} from './pixels.ts';

/** art-direction §8: copy colour is constant across every act. */
const COPY: Rgb = { r: 0xf5, g: 0xf0, b: 0xe8 };

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function option(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : num(process.argv[index + 1], fallback);
}

function load(path: string | undefined): Image {
  if (!path) throw new Error('missing <png> argument');
  return decodePng(new Uint8Array(readFileSync(path)));
}

function main(): void {
  const [, , command, path, ...rest] = process.argv;

  switch (command) {
    case 'sample': {
      const image = load(path);
      const x = num(rest[0], 0);
      const y = num(rest[1], 0);
      const px = pixelAt(image, x, y);
      const { s, v } = saturation(px);
      console.log(
        `${hex(px)}  rgb(${px.r}, ${px.g}, ${px.b})  ` +
          `lum ${luminance(px).toFixed(4)}  sat ${s.toFixed(3)}  val ${v.toFixed(3)}  @ ${x},${y}`,
      );
      break;
    }

    case 'horizon': {
      // Same method as scripts/invariant.ts, so the two never disagree: measure whether a
      // real boundary sits at 58% in the VP corridor, and whether anything nearby is a
      // stronger one. "Where is the strongest edge in the image" is a different question
      // and gives a different — wrong — answer once structures fill the frame.
      const image = load(path);
      const expected = image.height * 0.58;
      const coverage = Math.max(
        edgeCoverage(image, Math.round(expected)),
        edgeCoverage(image, Math.ceil(expected)),
        edgeCoverage(image, Math.floor(expected)),
      );
      const strongest = strongestNear(image, expected, 7);
      const ok = coverage >= 0.55 && Math.abs(strongest.y - expected) <= 2.5;
      console.log(
        `${ok ? 'PASS' : 'FAIL'}  boundary at y=${expected.toFixed(1)} (58%) covers ` +
          `${(coverage * 100).toFixed(0)}% of the VP corridor; strongest nearby is ` +
          `y=${strongest.y} at ${(strongest.coverage * 100).toFixed(0)}%`,
      );
      if (!ok) process.exit(1);
      break;
    }

    case 'contrast': {
      const image = load(path);
      // Composite the act's scrim over the backdrop, since the backdrop pass hides it.
      const scrimHex = (() => {
        const i = process.argv.indexOf('--scrim');
        return i < 0 ? null : (process.argv[i + 1] ?? null);
      })();
      const scrimAlpha = option('alpha', 0);
      const scrim: Rgb | null = scrimHex
        ? {
            r: parseInt(scrimHex.slice(1, 3), 16),
            g: parseInt(scrimHex.slice(3, 5), 16),
            b: parseInt(scrimHex.slice(5, 7), 16),
          }
        : null;
      const composite = (c: Rgb): Rgb =>
        scrim
          ? {
              r: Math.round(c.r * (1 - scrimAlpha) + scrim.r * scrimAlpha),
              g: Math.round(c.g * (1 - scrimAlpha) + scrim.g * scrimAlpha),
              b: Math.round(c.b * (1 - scrimAlpha) + scrim.b * scrimAlpha),
            }
          : c;
      const x = Math.max(0, num(rest[0], 0));
      const y = Math.max(0, num(rest[1], 0));
      const w = num(rest[2], image.width - x);
      const h = num(rest[3], image.height - y);
      let worst = Infinity;
      let worstAt = { x, y };
      let worstPx: Rgb = { r: 0, g: 0, b: 0 };
      for (let py = y; py < Math.min(y + h, image.height); py++) {
        for (let px = x; px < Math.min(x + w, image.width); px++) {
          const sample = composite(pixelAt(image, px, py));
          const ratio = contrastRatio(COPY, sample);
          if (ratio < worst) {
            worst = ratio;
            worstAt = { x: px, y: py };
            worstPx = sample;
          }
        }
      }
      const verdict = worst >= 4.5 ? 'PASS' : 'FAIL';
      console.log(
        `${verdict}  worst contrast ${worst.toFixed(2)}:1 for #F5F0E8 over ${hex(worstPx)} ` +
          `at ${worstAt.x},${worstAt.y}  (region ${x},${y} ${w}x${h}, floor 4.5:1)`,
      );
      if (worst < 4.5) process.exit(1);
      break;
    }

    case 'chroma': {
      const image = load(path);
      const regions = chromaRegions(image, {
        minSat: option('min-sat', 0.5),
        minValue: option('min-value', 0.35),
        minArea: option('min-area', 12),
      });
      console.log(`${regions.length} distinct saturated regions`);
      for (const r of regions.slice(0, Number(option('limit', 40)))) {
        console.log(
          `  ${r.hex}  ${String(r.area).padStart(7)}px  bbox ${r.x},${r.y} ${r.w}x${r.h}`,
        );
      }
      if (regions.length > option('limit', 40)) {
        console.log(`  … and ${regions.length - option('limit', 40)} more`);
      }
      break;
    }

    case 'column': {
      const image = load(path);
      const x = num(rest[0], Math.floor(image.width / 2));
      let last = '';
      for (let y = 0; y < image.height; y++) {
        const value = hex(pixelAt(image, x, y));
        if (value !== last) {
          console.log(`  y=${String(y).padStart(4)}  ${value}`);
          last = value;
        }
      }
      break;
    }

    default:
      console.log(
        [
          'usage: npm run probe -- <command> <png> [args]',
          '',
          '  sample   <png> <x> <y>              hex, rgb, luminance, saturation',
          '  horizon  <png>                      is the horizon registered to 58%?',
          '  contrast <png> <x> <y> <w> <h> [--scrim #RRGGBB --alpha 0.8]',
          '                                      worst-case contrast of #F5F0E8 in a region;',
          '                                      point at a bd-* shot and pass the act scrim',
          '  chroma   <png> [--min-sat 0.5]      count + bbox of saturated regions',
          '  column   <png> <x>                  every colour change down a column',
        ].join('\n'),
      );
      process.exit(command ? 1 : 0);
  }
}

main();
