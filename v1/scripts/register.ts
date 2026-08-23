/**
 * The pixel register: is every art cell actually a solid ART_SCALE x ART_SCALE block?
 *
 * This one assertion catches four unrelated failures that nothing else catches together:
 *
 *   1. non-integer canvas upscale     — cells come out alternately 3 and 4 device px
 *   2. fractional layer transforms    — the compositor resamples and every edge blends
 *   3. sub-art-pixel overlays         — a 1px CSS grain over a 3px grid
 *   4. fractional clip edges          — a soft seam along the one line the art registers to
 *
 * Each of those is invisible on inspection and reads, if it reads at all, as "the art is a
 * bit soft" — which then gets misattributed to the art rather than the pipeline. Counting
 * non-uniform cells turns all four into a number.
 *
 * Measured with ?frozen=1, which zeroes every transform. Without it each slot's grid sits
 * at its own drift offset, and slots whose offsets differ by a non-multiple of ART_SCALE
 * are out of phase with each other by construction — the cells are still individually
 * uniform, but they no longer share one grid, so a whole-frame scan cannot see it. Freezing
 * puts every slot on the same phase, which is the only state in which the question has a
 * single answer.
 *
 * Slots that have not yet moved to the canvas substrate still render SVG and will not be
 * cell-uniform. `--max-fail <pct>` is the migration allowance; it must reach 0.
 */

import { ART_SCALE, CHECKPOINTS, VIEWPORTS } from '../src/config.ts';
import { Report, fmtP, gotoP, launch, openPage, serveDist } from './lib.ts';
import { decodePng, hex, pixelAt, type Image } from './pixels.ts';

/** Only checkpoints in the middle of a hold — mid-transition two acts overlap at partial
 *  opacity, and a crossfade legitimately produces per-pixel blends. */
const HOLD_CHECKPOINTS = CHECKPOINTS.filter(
  (p) => (p > 0.02 && p < 0.11) || (p > 0.26 && p < 0.39) || (p > 0.54 && p < 0.67) || p > 0.81,
);

function option(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = Number(process.argv[i + 1]);
  return Number.isFinite(value) ? value : fallback;
}

interface CellScan {
  readonly cells: number;
  readonly broken: number;
  readonly worst: { x: number; y: number; colours: string[] } | null;
}

/**
 * Scan the frame on the art grid.
 *
 * `originX`/`originY` are the phase of the grid in device pixels: art cell boundaries sit
 * at `origin + k * ART_SCALE`. The grid is anchored to the vanishing point and the
 * horizon, not to the frame origin — a grid rooted at 0,0 would be half a cell out
 * wherever the anchors are not themselves multiples of ART_SCALE, and would report every
 * cell broken while the art was perfectly registered.
 */
function scanCells(image: Image, originX: number, originY: number): CellScan {
  let cells = 0;
  let broken = 0;
  let worst: CellScan['worst'] = null;

  const startX = originX % ART_SCALE;
  const startY = originY % ART_SCALE;

  for (let y = startY; y + ART_SCALE <= image.height; y += ART_SCALE) {
    for (let x = startX; x + ART_SCALE <= image.width; x += ART_SCALE) {
      cells += 1;
      const first = pixelAt(image, x, y);
      let uniform = true;
      for (let dy = 0; dy < ART_SCALE && uniform; dy++) {
        for (let dx = 0; dx < ART_SCALE; dx++) {
          const px = pixelAt(image, x + dx, y + dy);
          // Exact equality would fire on the paper grain, which is a deliberate ±2/255
          // artifact of the printed sheet and not a register violation.
          if (
            Math.abs(px.r - first.r) + Math.abs(px.g - first.g) + Math.abs(px.b - first.b) >
            12
          ) {
            uniform = false;
            break;
          }
        }
      }
      if (!uniform) {
        broken += 1;
        if (!worst) {
          const colours: string[] = [];
          for (let dy = 0; dy < ART_SCALE; dy++) {
            for (let dx = 0; dx < ART_SCALE; dx++) colours.push(hex(pixelAt(image, x + dx, y + dy)));
          }
          worst = { x, y, colours };
        }
      }
    }
  }
  return { cells, broken, worst };
}

async function main(): Promise<void> {
  const maxFailPct = option('max-fail', 0);
  const report = new Report(`pixel register (allowance ${maxFailPct}%)`);
  const server = await serveDist();
  const browser = await launch();

  try {
    for (const vp of VIEWPORTS) {
      const { page } = await openPage(browser, server.url, vp, { query: '?nocopy=1&frozen=1' });

      const frozen = (await page.evaluate(() => window.__frontier?.frozen === true)) as boolean;
      report.assert(frozen, `${vp.name}: ?frozen=1 had no effect — transforms are still live`);

      const origin = (await page.evaluate(() => window.__frontier?.gridOrigin())) as {
        x: number;
        y: number;
      };

      for (const p of HOLD_CHECKPOINTS) {
        await gotoP(page, p);
        const image = decodePng(await page.screenshot());
        const scan = scanCells(image, origin.x, origin.y);
        const pct = (scan.broken / scan.cells) * 100;
        console.log(
          `${vp.name} p=${fmtP(p)}  ${scan.broken}/${scan.cells} cells not uniform (${pct.toFixed(2)}%)` +
            (scan.worst ? `  first at ${scan.worst.x},${scan.worst.y}: ${scan.worst.colours.join(' ')}` : ''),
        );
        report.assert(
          pct <= maxFailPct,
          `${vp.name} p=${fmtP(p)}: ${pct.toFixed(2)}% of art cells are not uniform, allowance ${maxFailPct}%` +
            (scan.worst ? ` — first at ${scan.worst.x},${scan.worst.y} [${scan.worst.colours.join(' ')}]` : ''),
        );
      }

      await page.context().close();
    }
  } finally {
    await browser.close();
    await server.close();
  }

  report.finish();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
