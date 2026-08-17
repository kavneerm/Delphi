/**
 * Frame budget for the write pass (brief §7).
 *
 * Measures `window.__writePass` — the cost of the work this build actually does per frame —
 * not wall-clock frame deltas. Frame deltas in headless Chromium are dominated by CDP
 * round-trips and rAF throttling; measuring them once reported p50 273ms and "76% of frames
 * over budget", all of it artifact (docs/review-checklist.md §9).
 *
 * ---------------------------------------------------------------------------------------
 * This check was rewritten. The old one gated on **p99 of a sample that was 93% idle
 * frames**, and the full diagnosis is in docs/plans/perf-check.md. The short version, all
 * measured over five runs of identical code at 1440x900:
 *
 *     p99 across runs: 13.40..18.90ms   sd 2.20ms   <- the statistic it gated on
 *     max across runs: 26.20..26.90ms   sd 0.29ms   <- the statistic that was stable
 *     sample count:    294..330                     <- and the denominator moved
 *
 * Roughly 16 frames of ~300 did any work at all; the rest was the page idling through
 * `gotoP`'s 220ms waits. Which rank `p99` selected therefore depended on how many idle
 * frames happened to be recorded, so a 5.5ms swing came out of scheduling rather than out
 * of the build. Four things follow, and this file is built around them:
 *
 *   1. **Percentiles over a padded sample are meaningless.** Idle and working frames are
 *      separated explicitly here, and every reported statistic says which population it is
 *      over. p99 is still printed, because it is informative — it is simply not a gate.
 *
 *   2. **Gate on properties of the work, not of the sampling.** `max` and the count of
 *      over-budget frames are properties of what the build does. They were the stable
 *      numbers before and they are the gates now.
 *
 *   3. **Drive it like a reader.** The old check only teleported between checkpoints, which
 *      forces every layer of an act to build in one frame *and* then hands the page 220ms
 *      of slack. Neither resembles scrolling, and — worse — a teleport harness structurally
 *      cannot observe an amortisation or prewarm strategy working, which is why
 *      `preraster-lookahead` measured as "no effect" and was wrongly reverted. Continuous
 *      wheel scrolling is the primary measurement; the teleport sweep is kept as a
 *      separately-reported worst case.
 *
 *   4. **Repeat.** Every measurement runs `RUNS` times and gates on the **median run**, so
 *      one scheduling artifact cannot decide the build. The spread is printed, because a
 *      wide spread is itself a finding.
 *
 * What this still does not measure: the compositor work that `putImageData` and canvas
 * insertion trigger after our code returns, and actually-dropped frames. `__writePass` is
 * the cost of our own pass and nothing else. That is a real limit, not an oversight — see
 * the note on rAF deltas above.
 */

import { CHECKPOINTS, VIEWPORTS } from '../src/config.ts';
import { Report, gotoP, launch, openPage, serveDist } from './lib.ts';
import type { Page } from 'playwright';

/**
 * The worst single frame must fit inside one 60Hz frame. This is the gate that matters:
 * a frame over 16.7ms is a frame the reader does not get.
 */
const MAX_BUDGET_MS = 16;

/**
 * Frames allowed to exceed MAX_BUDGET_MS during a full read of the page.
 *
 * Zero. A hitch at an act transition is exactly the moment the composition is asking to be
 * looked at, and it is the moment this build historically dropped frames.
 */
const OVER_BUDGET_ALLOWED = 0;

/**
 * Steady state, over *every* frame including idle ones. Scrolling that is not entering an
 * act does no raster at all, so this stays near zero; it is here to catch work leaking into
 * the per-frame path, which is a different failure from an act-entry spike.
 */
const MEDIAN_BUDGET_MS = 1;

/** A frame doing no real work. Anything below this is the page idling, not the build. */
const IDLE_MS = 0.5;

/** Repeats per measurement. Odd, so the median is an observed run rather than an average. */
const RUNS = 3;

interface Stats {
  readonly n: number;
  readonly idle: number;
  readonly working: number;
  readonly median: number;
  readonly p99: number;
  readonly max: number;
  readonly over: number;
  /** Median cost of the frames that did work. The number the amortisation is tuning. */
  readonly workMedian: number;
}

function summarise(samples: readonly number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (p: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  const work = sorted.filter((v) => v >= IDLE_MS);
  return {
    n: sorted.length,
    idle: sorted.length - work.length,
    working: work.length,
    median: at(0.5),
    p99: at(0.99),
    max: sorted[sorted.length - 1] ?? 0,
    over: sorted.filter((v) => v > MAX_BUDGET_MS).length,
    workMedian: work[Math.floor(work.length / 2)] ?? 0,
  };
}

/** The run whose `max` is the median of the runs' maxes. Gating on an observed run. */
function medianRun(runs: readonly Stats[]): Stats {
  const byMax = [...runs].sort((a, b) => a.max - b.max);
  return byMax[Math.floor(byMax.length / 2)] as Stats;
}

function spread(runs: readonly Stats[], pick: (s: Stats) => number): string {
  const values = runs.map(pick);
  return `${Math.min(...values).toFixed(1)}..${Math.max(...values).toFixed(1)}`;
}

async function reset(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __writePass: number[] }).__writePass.length = 0;
  });
}

async function collect(page: Page): Promise<number[]> {
  return (await page.evaluate(
    () => (window as unknown as { __writePass: number[] }).__writePass,
  )) as number[];
}

/**
 * What a reader does: wheel down the whole page and back up.
 *
 * The 16ms pause per tick lets the frame that the wheel event scheduled actually run.
 * Without it the events coalesce and the page is measured doing one big jump, which is the
 * teleport case again under a different name.
 */
async function scrollSweep(page: Page): Promise<number[]> {
  await reset(page);
  const max = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  const STEP = 100;
  for (let y = 0; y < max; y += STEP) {
    await page.mouse.wheel(0, STEP);
    await page.waitForTimeout(16);
  }
  for (let y = max; y > 0; y -= STEP) {
    await page.mouse.wheel(0, -STEP);
    await page.waitForTimeout(16);
  }
  return collect(page);
}

/** The synthetic worst case: every act entered from a standing start, both directions. */
async function teleportSweep(page: Page): Promise<number[]> {
  await reset(page);
  for (const p of CHECKPOINTS) await gotoP(page, p);
  for (const p of [...CHECKPOINTS].reverse()) await gotoP(page, p);
  return collect(page);
}

async function main(): Promise<void> {
  const report = new Report('write-pass budget');
  const server = await serveDist();
  const browser = await launch();

  try {
    for (const vp of VIEWPORTS) {
      for (const mode of ['scroll', 'teleport'] as const) {
        const runs: Stats[] = [];
        for (let r = 0; r < RUNS; r++) {
          const { page } = await openPage(browser, server.url, vp, {
            query: '?perf=1&nocopy=1',
          });
          const samples = mode === 'scroll' ? await scrollSweep(page) : await teleportSweep(page);
          runs.push(summarise(samples));
          await page.context().close();
        }

        const m = medianRun(runs);
        console.log(
          `${vp.name} ${mode.padEnd(8)} ${m.n} frames (${m.working} working, ${m.idle} idle)  ` +
            `median ${m.median.toFixed(2)}ms  work-median ${m.workMedian.toFixed(2)}ms  ` +
            `p99 ${m.p99.toFixed(2)}ms  max ${m.max.toFixed(2)}ms  over ${m.over}`,
        );
        console.log(
          `${' '.repeat(vp.name.length)} ${' '.repeat(8)} across ${RUNS} runs: ` +
            `max ${spread(runs, (s) => s.max)}ms, p99 ${spread(runs, (s) => s.p99)}ms ` +
            `(p99 is reported, never gated — see the header)`,
        );

        report.assert(
          m.n > 100,
          `${vp.name} ${mode}: only ${m.n} frames sampled — the harness is not driving the page`,
        );
        report.assert(
          m.working > 0,
          `${vp.name} ${mode}: no frame did any work — the page is not building anything, so ` +
            `this measurement is vacuous`,
        );

        // The gates. Both are properties of the work rather than of the sampling.
        if (mode === 'scroll') {
          report.assert(
            m.max <= MAX_BUDGET_MS,
            `${vp.name} scroll: worst write pass is ${m.max.toFixed(2)}ms, budget ` +
              `${MAX_BUDGET_MS}ms — a frame this long is a frame the reader does not get`,
          );
          report.assert(
            m.over <= OVER_BUDGET_ALLOWED,
            `${vp.name} scroll: ${m.over} frames over ${MAX_BUDGET_MS}ms, allowed ` +
              `${OVER_BUDGET_ALLOWED}`,
          );
          report.assert(
            m.median <= MEDIAN_BUDGET_MS,
            `${vp.name} scroll: median frame is ${m.median.toFixed(2)}ms, budget ` +
              `${MEDIAN_BUDGET_MS}ms — work is leaking into the per-frame path`,
          );
        }
      }
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
