/**
 * Seams: the scene must be complete when the reader arrives, not shortly after.
 *
 * The raster is amortised at roughly one unit per frame (`Stage.sync`), which is what keeps
 * any single frame inside its budget. The cost of that trade is a race: an act needs ~16
 * units, and a hard flick can cross a transition in fewer frames than that. Lose the race
 * and slots arrive late — buildings fading up after the ground they stand on, a sky that
 * is not there yet. `check:perf` cannot see this at all; a frame that renders half a scene
 * is a *fast* frame.
 *
 * `prewarmActs` is the mitigation: during a hold, the next act in the direction of travel
 * is rastered ahead, using frames that cost ~0.1ms. This asserts the mitigation works.
 *
 * The measurement is deliberately not a screenshot diff. Two arrivals at the "same" p are
 * never at quite the same p — Lenis is still settling — so a pixel comparison fails for
 * reasons that are not defects. What is unambiguous is **whether the layers exist**: count
 * the painted layers at the instant of arrival, then again once the stage reports settled.
 * If those numbers differ, the reader saw a scene still being assembled.
 */

import { VIEWPORTS } from '../src/config.ts';
import { Report, fmtP, gotoP, launch, openPage, serveDist } from './lib.ts';
import type { Page } from 'playwright';

/**
 * Where to flick to. Each is an act hold, reached from the top of the page in one throw —
 * the worst case, because every act between here and there has to be built on the way.
 */
const TARGETS = [0.32, 0.6, 0.9];

/** One wheel event this large is a flick, not a scroll. */
const FLICK_STEPS = 6;

interface Snapshot {
  readonly painted: number;
  readonly settled: boolean;
  readonly act: number;
}

/** Layers currently carrying a canvas, counted only where they can actually be seen. */
async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    let painted = 0;
    for (const layer of document.querySelectorAll<HTMLElement>('.layer')) {
      if (Number(getComputedStyle(layer).opacity) < 0.01) continue;
      painted += layer.querySelectorAll('canvas, svg').length;
    }
    return {
      painted,
      settled: window.__frontier?.settled?.() !== false,
      act: (window.__frontier?.state() as { act?: number } | undefined)?.act ?? -1,
    };
  });
}

async function flickTo(page: Page, target: number): Promise<void> {
  const max = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  const current = await page.evaluate(() => window.scrollY);
  const distance = target * max - current;
  // Several large events with no pause between them: one giant event is coalesced into a
  // single jump, which is a teleport wearing a wheel's clothes.
  for (let i = 0; i < FLICK_STEPS; i++) {
    await page.mouse.wheel(0, distance / FLICK_STEPS);
  }
}

async function main(): Promise<void> {
  const report = new Report('seams under fast scroll');
  const server = await serveDist();
  const browser = await launch();

  try {
    for (const vp of VIEWPORTS) {
      for (const target of TARGETS) {
        const { page, issues } = await openPage(browser, server.url, vp);

        // Reference: the same position reached calmly, with the stage settled. This is the
        // complete scene, and the number the flick has to match.
        await gotoP(page, target);
        const settledRef = await snapshot(page);
        report.assert(
          settledRef.painted > 0,
          `${vp.name} p=${fmtP(target)}: reference has no painted layers at all`,
        );

        // Now do it the other way: back to the top, then throw the page at the target.
        await gotoP(page, 0);
        await flickTo(page, target);

        // Sample the moment the reader *reaches the act*, not a fixed instant after the
        // throw. Lenis is still easing when the flick is issued, so a fixed sample can land
        // before the page has arrived and would compare two different places.
        await page
          .waitForFunction(
            (want) =>
              ((window.__frontier?.state() as { act?: number } | undefined)?.act ?? -1) === want,
            settledRef.act,
            { timeout: 5_000 },
          )
          .catch(() => undefined);
        const onArrival = await snapshot(page);

        // …and again once the stage says it is done, to prove the flick reached the same
        // place and the comparison is like-for-like.
        await page
          .waitForFunction(() => window.__frontier?.settled?.() !== false, null, {
            timeout: 5_000,
          })
          .catch(() => undefined);
        const afterSettle = await snapshot(page);

        console.log(
          `${vp.name} flick->${fmtP(target)}  on arrival ${onArrival.painted} layers ` +
            `(act ${onArrival.act}, settled ${onArrival.settled})  ` +
            `after settle ${afterSettle.painted} (act ${afterSettle.act})  ` +
            `reference ${settledRef.painted}`,
        );

        report.assert(
          afterSettle.act === settledRef.act,
          `${vp.name} p=${fmtP(target)}: flick landed in act ${afterSettle.act}, reference ` +
            `was act ${settledRef.act} — the comparison is not like-for-like`,
        );

        report.assert(
          onArrival.painted >= afterSettle.painted,
          `${vp.name} p=${fmtP(target)}: ${onArrival.painted} layers painted on arrival but ` +
            `${afterSettle.painted} once settled — the reader arrived to a scene still being ` +
            `assembled, and watched ${afterSettle.painted - onArrival.painted} layer(s) ` +
            `appear afterwards`,
        );

        for (const issue of issues) {
          report.assert(false, `${vp.name} p=${fmtP(target)}: ${issue.kind} — ${issue.text}`);
        }

        await page.context().close();
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
