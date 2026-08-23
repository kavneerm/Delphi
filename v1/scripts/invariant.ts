/**
 * The horizon / vanishing-point invariant (brief §6, art-direction §2).
 *
 * Asserted three ways at every checkpoint × every viewport:
 *   1. DOM  — #anchor-horizon sits at exactly 58% of the stage box and #anchor-vp at 50%,
 *             and neither moves by so much as a sub-pixel across the 15 checkpoints.
 *   2. DOM  — every [data-vp-locked] layer has an identity transform, so VP-registered
 *             geometry is structurally incapable of drifting.
 *   3. Pixel — a real tonal boundary exists at 58% in the vanishing-point corridor, and
 *             it is the strongest boundary anywhere near there.
 *
 * The pixel pass is what the DOM pass cannot do: prove the art is registered to the
 * anchor rather than merely that the anchor exists.
 */

import { CHECKPOINTS, HORIZON_FRAC, VIEWPORTS, VP_FRAC, horizonPx, vpPx } from '../src/config.ts';
import { Report, fmtP, gotoP, launch, openPage, serveDist } from './lib.ts';
import { decodePng, edgeCoverage, strongestNear } from './pixels.ts';

interface AnchorReport {
  stage: { width: number; height: number; top: number };
  horizon: { top: number; fraction: number } | null;
  vp: { left: number; fraction: number } | null;
  lockedTransforms: string[];
}

const IDENTITY = new Set(['none', 'matrix(1, 0, 0, 1, 0, 0)']);
/**
 * Chromium snaps layout to LayoutUnit, a 1/64px grid, so `top: 58%` of 1024px resolves to
 * 593.90625 rather than 593.92. That is the finest the anchor can be positioned; a
 * tolerance below it would be asserting against the browser rather than against the build.
 */
const LAYOUT_QUANTUM = 1 / 64;
/** Movement between checkpoints, though, must be exactly nothing. */
const DRIFT_EPSILON = 1e-6;
/** The rendered horizon may sit a pixel off through antialiasing at fractional heights. */
const PIXEL_EPSILON = 2.5;

async function main(): Promise<void> {
  const report = new Report('horizon / vanishing-point invariant');
  const server = await serveDist();
  const browser = await launch();

  try {
    for (const vp of VIEWPORTS) {
      const { page } = await openPage(browser, server.url, vp);
      const expectedHorizon = horizonPx(vp.height);
      const expectedVp = vpPx(vp.width);
      let firstTop: number | null = null;
      let firstLeft: number | null = null;

      // The anchors are whole pixels, so `58%` is now expressed as "the pixel nearest to
      // 58%". That is a substantive claim and gets its own assertion rather than being
      // absorbed into a widened tolerance on the one below — the tolerance there stays at
      // the browser's layout quantum, exactly as it was.
      report.assert(
        Math.abs(expectedHorizon / vp.height - HORIZON_FRAC) <= 0.5 / vp.height,
        `${vp.name}: horizon pixel ${expectedHorizon} is ${(expectedHorizon / vp.height * 100).toFixed(4)}% ` +
          `of ${vp.height}, more than half a pixel from 58%`,
      );
      report.assert(
        Math.abs(expectedVp / vp.width - VP_FRAC) <= 0.5 / vp.width,
        `${vp.name}: VP pixel ${expectedVp} is ${(expectedVp / vp.width * 100).toFixed(4)}% ` +
          `of ${vp.width}, more than half a pixel from 50%`,
      );

      for (const p of CHECKPOINTS) {
        const where = `${vp.name} p=${fmtP(p)}`;
        await gotoP(page, p);
        const a = (await page.evaluate(() => window.__frontier?.anchors())) as AnchorReport;

        report.assert(a?.horizon != null, `${where}: #anchor-horizon missing`);
        report.assert(a?.vp != null, `${where}: #anchor-vp missing`);
        if (!a?.horizon || !a.vp) continue;

        // 1. absolute position, to within the browser's layout grid
        report.assert(
          Math.abs(a.horizon.top - expectedHorizon) <= LAYOUT_QUANTUM,
          `${where}: horizon at ${a.horizon.top.toFixed(5)}px (${(a.horizon.fraction * 100).toFixed(4)}%), want ${expectedHorizon.toFixed(5)}px (58%)`,
        );
        report.assert(
          Math.abs(a.vp.left - expectedVp) <= LAYOUT_QUANTUM,
          `${where}: VP at ${a.vp.left.toFixed(5)}px (${(a.vp.fraction * 100).toFixed(4)}%), want ${expectedVp.toFixed(5)}px (50%)`,
        );

        // 1b. identical across every checkpoint — this is the invariant proper, and here
        // the tolerance really is zero.
        if (firstTop === null) firstTop = a.horizon.top;
        else {
          report.assert(
            Math.abs(a.horizon.top - firstTop) < DRIFT_EPSILON,
            `${where}: horizon moved to ${a.horizon.top.toFixed(5)}px, was ${firstTop.toFixed(5)}px at p=0.00`,
          );
        }
        if (firstLeft === null) firstLeft = a.vp.left;
        else {
          report.assert(
            Math.abs(a.vp.left - firstLeft) < DRIFT_EPSILON,
            `${where}: VP moved to ${a.vp.left.toFixed(5)}px, was ${firstLeft.toFixed(5)}px at p=0.00`,
          );
        }

        // 2. VP-registered geometry is never transformed
        report.assert(
          a.lockedTransforms.length > 0,
          `${where}: no [data-vp-locked] layers present — the invariant has no witness`,
        );
        for (const [i, t] of a.lockedTransforms.entries()) {
          report.assert(
            IDENTITY.has(t),
            `${where}: locked layer ${i} has transform "${t}", want identity`,
          );
        }

        // 3. the art is registered to the anchor, measured off the pixels
        const png = await page.screenshot();
        const image = decodePng(png);

        // A real boundary exists at 58%, across most of the corridor.
        const atHorizon = Math.max(
          edgeCoverage(image, Math.round(expectedHorizon), VP_FRAC),
          edgeCoverage(image, Math.ceil(expectedHorizon), VP_FRAC),
          edgeCoverage(image, Math.floor(expectedHorizon), VP_FRAC),
        );
        report.assert(
          atHorizon >= 0.55,
          `${where}: only ${(atHorizon * 100).toFixed(0)}% of the VP corridor shows a tonal boundary at y=${expectedHorizon.toFixed(1)} (58%) — the art is not registered to the anchor`,
        );

        // …and nothing nearby is a stronger boundary, which would mean it sits off-anchor.
        const strongest = strongestNear(image, expectedHorizon, PIXEL_EPSILON + 4, VP_FRAC);
        report.assert(
          Math.abs(strongest.y - expectedHorizon) <= PIXEL_EPSILON,
          `${where}: strongest boundary near the horizon is at y=${strongest.y} (${(strongest.coverage * 100).toFixed(0)}% coverage), want ${expectedHorizon.toFixed(1)} (58%)`,
        );
      }

      console.log(
        `${vp.name}: horizon ${firstTop?.toFixed(3)}px of ${vp.height} = ` +
          `${(((firstTop ?? 0) / vp.height) * 100).toFixed(3)}%, VP ${firstLeft?.toFixed(3)}px of ${vp.width}`,
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
