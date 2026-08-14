/**
 * Frame budget for the write pass (brief §7).
 *
 * Measures `window.__writePass` — the cost of the work this build actually does per frame —
 * not wall-clock frame deltas. Frame deltas in headless Chromium are dominated by CDP
 * round-trips and rAF throttling; measuring them once reported p50 273ms and "76% of frames
 * over budget", all of it artifact (docs/review-checklist.md §9).
 *
 * **p99 and max are the gates, never p50.** Under a canvas substrate the per-frame work is
 * transform writes and nothing else, so p50 stays around a tenth of a millisecond however
 * badly the raster performs. The cost lives entirely in the frames where an act enters and
 * its layers are rastered. A p50 gate would read green through any regression that matters.
 *
 * Act entry is deliberately included. `goto` teleports, so every act change rebuilds every
 * layer at once — the worst case a real scroll can produce, and the number the raster
 * architecture has to survive.
 */

import { CHECKPOINTS, VIEWPORTS } from '../src/config.ts';
import { Report, gotoP, launch, openPage, serveDist } from './lib.ts';

/** Typical frames: pure transform writes, so this should be nowhere near it. */
const P99_BUDGET_MS = 4;
/** The worst frame — an act entry with its full raster — must still fit inside one frame. */
const MAX_BUDGET_MS = 16;

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[index] ?? 0;
}

async function main(): Promise<void> {
  const report = new Report('write-pass budget');
  const server = await serveDist();
  const browser = await launch();

  try {
    for (const vp of VIEWPORTS) {
      const { page } = await openPage(browser, server.url, vp, { query: '?perf=1&nocopy=1' });

      // Discard load-time samples: the first paint builds every layer of act 0 and is not
      // representative of steady state. It is measured separately below.
      await page.evaluate(() => {
        (window as unknown as { __writePass: number[] }).__writePass.length = 0;
      });

      for (const p of CHECKPOINTS) await gotoP(page, p);
      // Back through the acts the other way, so every transition is entered from both
      // directions — a layer built on the way down is a different code path from one
      // rebuilt on the way back up.
      for (const p of [...CHECKPOINTS].reverse()) await gotoP(page, p);

      const samples = (await page.evaluate(
        () => (window as unknown as { __writePass: number[] }).__writePass,
      )) as number[];

      const sorted = [...samples].sort((a, b) => a - b);
      const p50 = percentile(sorted, 0.5);
      const p95 = percentile(sorted, 0.95);
      const p99 = percentile(sorted, 0.99);
      const max = sorted[sorted.length - 1] ?? 0;
      const over = sorted.filter((s) => s > MAX_BUDGET_MS).length;

      console.log(
        `${vp.name}  ${samples.length} frames  p50 ${p50.toFixed(2)}ms  p95 ${p95.toFixed(2)}ms  ` +
          `p99 ${p99.toFixed(2)}ms  max ${max.toFixed(2)}ms  over-budget ${over}`,
      );

      report.assert(
        samples.length > 100,
        `${vp.name}: only ${samples.length} frames sampled — the harness is not driving the page`,
      );
      report.assert(
        p99 <= P99_BUDGET_MS,
        `${vp.name}: write-pass p99 is ${p99.toFixed(2)}ms, budget ${P99_BUDGET_MS}ms`,
      );
      report.assert(
        max <= MAX_BUDGET_MS,
        `${vp.name}: worst write pass is ${max.toFixed(2)}ms, budget ${MAX_BUDGET_MS}ms ` +
          `(an act entry rasters every layer at once)`,
      );

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
