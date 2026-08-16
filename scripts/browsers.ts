/**
 * Cross-engine and mobile conformance.
 *
 * Every other check in this tree runs headless Chromium at deviceScaleFactor 1. That has
 * been the largest untested surface in the project, because the build leans on features
 * whose support is genuinely uneven — `mix-blend-mode`, `isolation`, `color-mix`,
 * `backdrop-filter`, SVG `feColorMatrix` — and on a canvas raster pipeline that has only
 * ever been observed in one engine.
 *
 * Three engines x three profiles. The assertions are deliberately *structural* rather than
 * pixel-exact: engines disagree about antialiasing and font rasterisation by design, so
 * comparing screenshots byte-for-byte across them would fail for reasons that are not
 * defects. What must hold everywhere:
 *
 *   1. The page boots and `__frontier.ready` goes true.
 *   2. The horizon/VP invariant holds — the whole composition is registered to it.
 *   3. A real tonal boundary exists at 58% in the VP corridor, measured off the pixels.
 *      This is what catches a blank or broken raster: a canvas that failed to paint has no
 *      boundary anywhere, and the DOM assertions above would still pass.
 *   4. The frame is not blank — enough distinct colours to be an actual scene.
 *   5. Copy reveals, and the scroll cue is present and legible.
 *   6. No console errors, no page errors.
 *   7. The load-bearing CSS features are actually supported, reported per engine.
 *
 * **On Safari:** Playwright's WebKit is the Safari *engine*, not Safari. It is the closest
 * automatable proxy and catches engine-level breakage, but it is not proof about a specific
 * Safari build — notably it does not model Lockdown Mode, or features Apple ships behind a
 * flag. Treated as strong evidence, not certainty. The version pairing is noted in the run
 * header so the gap is visible rather than assumed away.
 */

import { firefox, webkit, chromium, type Browser, type BrowserType } from 'playwright';

import { VP_FRAC, horizonPx, vpPx } from '../src/config.ts';
import { Report, fmtP, gotoP, serveDist, type ConsoleIssue } from './lib.ts';
import { decodePng, edgeCoverage } from './pixels.ts';

interface Engine {
  readonly name: string;
  readonly type: BrowserType;
}

const ENGINES: readonly Engine[] = [
  { name: 'chromium', type: chromium },
  { name: 'webkit', type: webkit },
  { name: 'firefox', type: firefox },
];

interface Profile {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly touch: boolean;
}

/**
 * The desktop profile is the one every other check uses. The two mobile profiles exist
 * because dpr 1 is the case the build has always been measured at, and it is the *only*
 * case where `roundToDevicePx` is a no-op — at dpr 2 and 3 it rounds to a third and a half
 * of a CSS pixel, which is where a transform can start resampling a layer if the maths is
 * wrong.
 */
const PROFILES: readonly Profile[] = [
  { name: 'desktop 1440x900 @1x', width: 1440, height: 900, dpr: 1, touch: false },
  { name: 'mobile 390x844 @3x', width: 390, height: 844, dpr: 3, touch: true },
  { name: 'tablet 768x1024 @2x', width: 768, height: 1024, dpr: 2, touch: true },
];

/** Checkpoints spanning all four acts and all three transitions. */
const SWEEP = [0, 0.06, 0.18, 0.32, 0.46, 0.6, 0.74, 0.9, 1.0];

/**
 * How far the anchor may sit from its whole-pixel target, in CSS px.
 *
 * Engines snap layout to their own fixed-point grid — Chromium to 1/64 px, Firefox to 1/60
 * (app units). 0.05 clears the coarser of the two with 3x margin while still failing a
 * misregistration a third of a pixel wide, which is the point: `invariant.ts` uses 1/64
 * because it only ever runs in Chromium, and this has to hold for whichever grid the engine
 * chose.
 */
const ANCHOR_TOLERANCE_PX = 0.05;

/**
 * How far it may move *between* checkpoints. In Chromium this is exactly zero and
 * `invariant.ts` asserts that. Firefox is not zero, and the reason is worth stating,
 * because "loosen it until it passes" is how a real drift gets shipped.
 *
 * At p=1.00 Firefox reports the horizon as 489.99998474121094 where it reported 490 at
 * every other checkpoint, and 593.9999847412109 where it reported 594. Both deltas are
 * **exactly 2^-16 = 1.52587890625e-05** — the same absolute value at two different
 * magnitudes. Real drift scales with the value or varies with scroll position; a constant
 * absolute delta is the signature of a fixed-point-to-float conversion, and Firefox takes a
 * different path at the scroll extreme where the sticky stage resolves against the
 * container's bottom edge rather than `top: 0`.
 *
 * So this is one value reported two ways, not two values. 1e-3 sits 65x above that
 * artifact and two orders of magnitude below the ~0.1px that would be visible, so a drift
 * that matters still fails by a wide margin.
 */
const DRIFT_TOLERANCE_PX = 1e-3;

/** Features the build genuinely depends on. Reported per engine, and asserted. */
const FEATURES: readonly { readonly label: string; readonly test: string }[] = [
  { label: 'mix-blend-mode', test: 'mix-blend-mode: multiply' },
  { label: 'isolation', test: 'isolation: isolate' },
  { label: 'color-mix', test: 'color: color-mix(in srgb, #fff 50%, #000)' },
  { label: 'backdrop-filter', test: 'backdrop-filter: blur(4px)' },
  { label: 'clip-path inset', test: 'clip-path: inset(0px 0px 10px 0px)' },
  { label: 'image-rendering', test: 'image-rendering: pixelated' },
  { label: 'svh units', test: 'height: 100svh' },
  { label: 'text-wrap balance', test: 'text-wrap: balance' },
];

async function main(): Promise<void> {
  const report = new Report('cross-engine + mobile');
  const server = await serveDist();

  console.log(`WebKit here is Playwright's build, paired with this machine's Safari major.`);
  console.log(`It is the Safari engine, not Safari itself — see the header of this file.\n`);

  try {
    for (const engine of ENGINES) {
      let browser: Browser;
      try {
        browser = await engine.type.launch();
      } catch (err) {
        report.assert(false, `${engine.name}: failed to launch — ${String(err)}`);
        continue;
      }

      console.log(`── ${engine.name} ${browser.version()} ──`);

      try {
        for (const profile of PROFILES) {
          const where = `${engine.name} ${profile.name}`;
          const issues: ConsoleIssue[] = [];

          // Firefox does not implement isMobile/hasTouch emulation; asking for it throws
          // rather than degrading, so the flag is only passed to engines that have it.
          // The viewport and dpr — the parts that actually exercise the art maths — are
          // applied everywhere.
          const context = await browser.newContext({
            viewport: { width: profile.width, height: profile.height },
            deviceScaleFactor: profile.dpr,
            ...(profile.touch && engine.name !== 'firefox'
              ? { hasTouch: true, isMobile: engine.name === 'chromium' }
              : {}),
          });
          const page = await context.newPage();
          page.on('console', (m) => {
            if (m.type() === 'error') issues.push({ kind: 'error', text: m.text() });
          });
          page.on('pageerror', (e) => issues.push({ kind: 'pageerror', text: String(e) }));

          let booted = true;
          await page.goto(`${server.url}/`, { waitUntil: 'load' });
          try {
            await page.waitForFunction(() => window.__frontier?.ready === true, null, {
              timeout: 20_000,
            });
          } catch {
            booted = false;
          }
          report.assert(booted, `${where}: __frontier.ready never became true — the page did not boot`);

          if (!booted) {
            await context.close();
            continue;
          }

          // 7. feature support, reported before anything that might depend on it
          const support = await page.evaluate((features) => {
            const out: Record<string, boolean> = {};
            for (const f of features) {
              const [prop, ...rest] = f.test.split(':');
              out[f.label] = CSS.supports((prop ?? '').trim(), rest.join(':').trim());
            }
            return out;
          }, FEATURES);

          const missing = Object.entries(support)
            .filter(([, ok]) => !ok)
            .map(([k]) => k);
          console.log(
            `  ${profile.name}: ${missing.length === 0 ? 'all features supported' : `MISSING ${missing.join(', ')}`}`,
          );
          for (const f of FEATURES) {
            report.assert(
              support[f.label] === true,
              `${where}: CSS.supports(${f.test}) is false — the build depends on it`,
            );
          }

          const expectedHorizon = horizonPx(profile.height);
          const expectedVp = vpPx(profile.width);
          let firstTop: number | null = null;

          for (const p of SWEEP) {
            await gotoP(page, p);
            const a = await page.evaluate(() => window.__frontier?.anchors());

            report.assert(
              a?.horizon != null && a.vp != null,
              `${where} p=${fmtP(p)}: anchors missing`,
            );
            if (!a?.horizon || !a.vp) continue;

            // 2. the invariant, in this engine
            report.assert(
              Math.abs(a.horizon.top - expectedHorizon) <= ANCHOR_TOLERANCE_PX,
              `${where} p=${fmtP(p)}: horizon at ${a.horizon.top.toFixed(3)}px ` +
                `(${(a.horizon.fraction * 100).toFixed(3)}%), want ${expectedHorizon} (58%)`,
            );
            report.assert(
              Math.abs(a.vp.left - expectedVp) <= ANCHOR_TOLERANCE_PX,
              `${where} p=${fmtP(p)}: VP at ${a.vp.left.toFixed(3)}px, want ${expectedVp} (50%)`,
            );
            if (firstTop === null) firstTop = a.horizon.top;
            else {
              report.assert(
                Math.abs(a.horizon.top - firstTop) < DRIFT_TOLERANCE_PX,
                `${where} p=${fmtP(p)}: horizon moved to ${a.horizon.top} from ${firstTop} ` +
                  `(delta ${Math.abs(a.horizon.top - firstTop).toExponential(3)}px)`,
              );
            }
          }

          // 3 + 4. the pixels, at one act hold per act. A raster that silently failed in
          // this engine passes every DOM assertion above and fails here.
          for (const p of [0.06, 0.32, 0.6, 0.9]) {
            await gotoP(page, p);
            const image = decodePng(await page.screenshot());

            const coverage = Math.max(
              edgeCoverage(image, Math.round(expectedHorizon * profile.dpr), VP_FRAC),
              edgeCoverage(image, Math.ceil(expectedHorizon * profile.dpr), VP_FRAC),
              edgeCoverage(image, Math.floor(expectedHorizon * profile.dpr), VP_FRAC),
            );
            report.assert(
              coverage >= 0.5,
              `${where} p=${fmtP(p)}: only ${(coverage * 100).toFixed(0)}% of the VP corridor ` +
                `shows a tonal boundary at the horizon — the art did not render in this engine`,
            );

            // Distinct colours at 5 bits/channel. A blank or single-gradient frame cannot
            // reach this; a real scene clears it by an order of magnitude.
            const distinct = new Set<number>();
            for (let i = 0; i < image.data.length; i += 4 * 37) {
              const r = (image.data[i] ?? 0) >> 3;
              const g = (image.data[i + 1] ?? 0) >> 3;
              const b = (image.data[i + 2] ?? 0) >> 3;
              distinct.add((r << 10) | (g << 5) | b);
            }
            report.assert(
              distinct.size >= 40,
              `${where} p=${fmtP(p)}: only ${distinct.size} distinct colours — the frame is blank`,
            );
          }

          // 5. copy + cue
          await gotoP(page, 0);
          const cue = await page.evaluate(() => {
            const el = document.querySelector('[data-block="act1-scroll-cue"]');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {
              opacity: Number(getComputedStyle(el).opacity),
              text: (el.textContent ?? '').trim(),
              inView: r.top >= 0 && r.bottom <= window.innerHeight && r.width > 0,
            };
          });
          report.assert(cue !== null, `${where}: scroll cue not mounted`);
          report.assert(cue?.opacity === 1, `${where}: cue opacity ${cue?.opacity} at p=0, want 1`);
          report.assert(/keep scrolling/i.test(cue?.text ?? ''), `${where}: cue text "${cue?.text}"`);
          report.assert(cue?.inView === true, `${where}: cue is not fully in the viewport`);

          await gotoP(page, 0.6);
          const body = await page.evaluate(() => {
            const el = document.querySelector('[data-block="act3-body"]');
            return el ? Number(getComputedStyle(el).opacity) : -1;
          });
          report.assert(
            body >= 0.98,
            `${where}: act3-body opacity ${body} at p=0.60 — copy reveals are not running`,
          );

          // 6. clean console
          for (const issue of issues) {
            report.assert(false, `${where}: ${issue.kind} — ${issue.text}`);
          }

          await context.close();
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    await server.close();
  }

  console.log(
    `\n${ENGINES.length} engines x ${PROFILES.length} profiles x ${SWEEP.length} checkpoints.`,
  );
  report.finish();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
