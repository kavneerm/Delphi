/**
 * Parallax contract (build.md A1.7).
 *
 * Asserts, at every checkpoint × every viewport:
 *   1. every drift layer has zero Y translation — vertical drift does not exist;
 *   2. the ratios between slot X-displacements match the §3 rate table within 1%;
 *   3. drift amplitude across the page matches rate × DRIFT_BASE_PX, scaled to viewport;
 *   4. travel layers move in Y only while the segment is a transition.
 *
 * Reading the transform matrices beats reading screenshots: it does not depend on how
 * few checkpoints happen to land mid-transition, and it cannot be fooled by art that
 * looks like it moved.
 */

import { CHECKPOINTS, SLOT_RATES, VIEWPORTS, driftAmplitude } from '../src/config.ts';
import { cam } from '../src/timeline.ts';
import { Report, fmtP, gotoP, launch, openPage, serveDist, translation } from './lib.ts';

interface LayerMetric {
  act: number;
  verb: string;
  drift: string;
  travel: string;
  opacity: string;
  locked: string | null;
}

interface Metrics {
  geometry: { w: number; h: number; horizon: number; vp: number };
  slots: { slot: number; rate: number | null; layers: LayerMetric[] }[];
}

interface State {
  p: number;
  c: number;
  phase: 'hold' | 'transition';
  t: number;
}

const RATIO_TOLERANCE = 0.01;
const ABSOLUTE_TOLERANCE_PX = 0.05;

async function main(): Promise<void> {
  const report = new Report('parallax contract');
  const server = await serveDist();
  const browser = await launch();

  try {
    for (const vp of VIEWPORTS) {
      const { page } = await openPage(browser, server.url, vp);
      const amplitude = driftAmplitude(vp.width);
      let sweepLogged = false;

      for (const p of CHECKPOINTS) {
        const where = `${vp.name} p=${fmtP(p)}`;
        await gotoP(page, p);
        const metrics = (await page.evaluate(() => window.__frontier?.metrics())) as Metrics;
        const state = (await page.evaluate(() => window.__frontier?.state())) as State;

        report.assert(
          metrics.slots.length === SLOT_RATES.length,
          `${where}: ${metrics.slots.length} slots present, want ${SLOT_RATES.length}`,
        );

        const observed: (number | null)[] = [];

        for (const slot of metrics.slots) {
          const rate = SLOT_RATES[slot.slot] ?? 0;
          const expectedX = (state.c - 0.5) * rate * amplitude;
          let slotX: number | null = null;

          report.assert(
            slot.layers.length > 0,
            `${where}: slot ${slot.slot} has no resident layer`,
          );

          for (const layer of slot.layers) {
            const drift = translation(layer.drift);
            const travel = translation(layer.travel);

            // 1. no vertical drift, ever
            report.assert(
              Math.abs(drift.y) < ABSOLUTE_TOLERANCE_PX,
              `${where}: slot ${slot.slot} act ${layer.act} drift has Y=${drift.y.toFixed(3)}px, want 0`,
            );

            // 3. absolute amplitude
            report.assert(
              Math.abs(drift.x - expectedX) < 0.6,
              `${where}: slot ${slot.slot} act ${layer.act} driftX=${drift.x.toFixed(3)}px, want ${expectedX.toFixed(3)}px`,
            );
            slotX = drift.x;

            // 4. travel only moves during a transition
            if (state.phase === 'hold') {
              report.assert(
                Math.abs(travel.y) < ABSOLUTE_TOLERANCE_PX &&
                  Math.abs(travel.x) < ABSOLUTE_TOLERANCE_PX,
                `${where}: slot ${slot.slot} act ${layer.act} travel is ${layer.travel} during a hold, want identity`,
              );
            }

            // VP-registered geometry never moves
            if (layer.locked !== null) {
              const locked = translation(layer.locked);
              report.assert(
                Math.abs(locked.x) < ABSOLUTE_TOLERANCE_PX &&
                  Math.abs(locked.y) < ABSOLUTE_TOLERANCE_PX,
                `${where}: slot ${slot.slot} locked layer translated to ${locked.x},${locked.y}`,
              );
            }
          }

          observed.push(slotX);
        }

        // 2. relative rates. Skip where the camera sits at the midpoint and every
        // displacement is legitimately zero.
        const reference = observed[3];
        const referenceRate = SLOT_RATES[3] ?? 1;
        if (reference !== null && reference !== undefined && Math.abs(reference) > 0.5) {
          for (let slot = 0; slot < observed.length; slot++) {
            const value = observed[slot];
            const rate = SLOT_RATES[slot] ?? 0;
            if (value === null || value === undefined) continue;
            const wantRatio = rate / referenceRate;
            const gotRatio = value / reference;
            report.assert(
              Math.abs(gotRatio - wantRatio) <= RATIO_TOLERANCE * Math.max(wantRatio, 1),
              `${where}: slot ${slot} drift ratio vs slot 3 is ${gotRatio.toFixed(4)}, want ${wantRatio.toFixed(4)}`,
            );
          }
        }

        if (!sweepLogged && p === 1.0) {
          const sweep = SLOT_RATES.map((r) => (r * amplitude).toFixed(1)).join('  ');
          console.log(`${vp.name}: amplitude ${amplitude.toFixed(2)}px  sweep 0..7  ${sweep}`);
          sweepLogged = true;
        }
      }

      await page.context().close();
    }
  } finally {
    await browser.close();
    await server.close();
  }

  console.log(`cam(0)=${cam(0).toFixed(4)}  cam(0.5)=${cam(0.5).toFixed(4)}  cam(1)=${cam(1).toFixed(4)}`);
  report.finish();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
