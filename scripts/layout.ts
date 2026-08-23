/**
 * check:layout — the page holds up in a real engine.
 *
 * Four things a build cannot tell you and a screenshot will not reliably show: nothing
 * overflows sideways at any viewport, text meets WCAG AA contrast in both themes, the page
 * asks nothing of any third party, and the horizon never crosses the headline.
 *
 * There is no scroll driving here and nothing to wait for. With no JavaScript on the page,
 * what the first paint shows is what the reader gets.
 */

import { chromium, type Browser, type Page } from 'playwright';
import { Report, serveDist } from './lib.ts';

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x3600', width: 1280, height: 3600 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844 },
];

/** WCAG AA: 4.5:1 for body text, 3:1 for large text (>=24px, or >=18.66px bold). */
const AA_NORMAL = 4.5;
const AA_LARGE = 3;

interface ContrastRow {
  selector: string;
  ratio: number;
  size: number;
  bold: boolean;
  color: string;
  bg: string;
}

async function contrast(page: Page): Promise<ContrastRow[]> {
  return page.evaluate(() => {
    const parse = (s: string): [number, number, number, number] => {
      const n = s.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
      return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 1];
    };
    const lum = (c: [number, number, number, number]): number => {
      const f = (v: number): number => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    /*
     * The effective background behind an element, composited the way the browser paints it.
     *
     * Stopping at the first background with any alpha at all is wrong and fails loudly: an
     * element coloured `--accent` sitting on a 10%-alpha `--accent` wash reports 1.00:1,
     * because the wash is compared against itself as though it were opaque. Layers are
     * collected up to the first fully opaque one, then composited bottom-up.
     */
    const bgOf = (el: Element): [number, number, number, number] => {
      const stack: [number, number, number, number][] = [];
      let node: Element | null = el;
      while (node) {
        const c = parse(getComputedStyle(node).backgroundColor);
        if (c[3] > 0) stack.push(c);
        if (c[3] >= 1) break;
        node = node.parentElement;
      }
      let out: [number, number, number, number] = [255, 255, 255, 1];
      for (let i = stack.length - 1; i >= 0; i--) {
        const c = stack[i];
        if (!c) continue;
        const a = c[3];
        out = [
          c[0] * a + out[0] * (1 - a),
          c[1] * a + out[1] * (1 - a),
          c[2] * a + out[2] * (1 - a),
          1,
        ];
      }
      return out;
    };

    const selectors = [
      '.hero-statement',
      '.turn-statement',
      '.lead',
      '.prose p',
      '.eyebrow',
      '.masthead-note',
      '.wordmark',
      '.colophon-line',
      '.colophon-mark',
      '.contact-placeholder',
    ];

    const rows: ContrastRow[] = [];
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        const cs = getComputedStyle(el);
        const fg = parse(cs.color);
        const bg = bgOf(el);
        const a = lum(fg);
        const b = lum(bg);
        rows.push({
          selector,
          ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          size: parseFloat(cs.fontSize),
          bold: Number(cs.fontWeight) >= 700,
          color: cs.color,
          bg: cs.backgroundColor,
        });
      }
    }
    return rows;
  }) as Promise<ContrastRow[]>;
}

function assertContrast(report: Report, label: string, rows: ContrastRow[]): void {
  for (const row of rows) {
    const large = row.size >= 24 || (row.bold && row.size >= 18.66);
    const need = large ? AA_LARGE : AA_NORMAL;
    report.assert(
      row.ratio >= need,
      `${label}: ${row.selector} contrast ${row.ratio.toFixed(2)}:1, want ${need}:1 (${row.color} on ${row.bg}, ${row.size}px)`,
    );
  }
}

async function main(): Promise<void> {
  const report = new Report('layout');
  const server = await serveDist();
  let browser: Browser | undefined;

  try {
    browser = await chromium.launch();

    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
      });
      const page = await context.newPage();

      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      const offOrigin: string[] = [];
      page.on('request', (r) => {
        if (!r.url().startsWith(server.url) && !r.url().startsWith('data:')) {
          offOrigin.push(r.url());
        }
      });

      await page.goto(server.url, { waitUntil: 'networkidle' });

      const overflow = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      report.assert(
        overflow.scrollW <= overflow.clientW + 1,
        `${vp.name}: horizontal overflow — scrollWidth ${overflow.scrollW} > clientWidth ${overflow.clientW}`,
      );

      // The headline is legible on arrival, with no script needed to make it so.
      const heroBox = await page.locator('.hero-statement').boundingBox();
      report.assert(
        heroBox !== null && heroBox.y >= 0 && heroBox.y < vp.height,
        `${vp.name}: hero statement is not in the first viewport`,
      );

      /*
       * The horizon must sit below the headline, never through it. This is the specific
       * defect the rebuild exists to fix: positioned at a percentage of the hero, the line
       * landed in the middle of the text at 1440x900. Asserting the geometry rather than
       * trusting the markup means a future layout change cannot quietly reintroduce it.
       */
      const geometry = await page.evaluate(() => {
        const hero = document.querySelector('.hero-statement');
        const line = document.querySelector('.horizon-line');
        if (!hero || !line) return null;
        const h = hero.getBoundingClientRect();
        const l = line.getBoundingClientRect();
        return { heroBottom: h.bottom, lineTop: l.top };
      });
      report.assert(geometry !== null, `${vp.name}: hero statement or horizon line missing`);
      if (geometry) {
        report.assert(
          geometry.lineTop >= geometry.heroBottom,
          `${vp.name}: horizon crosses the headline — line at y=${geometry.lineTop.toFixed(0)}, text ends at y=${geometry.heroBottom.toFixed(0)}`,
        );
      }

      assertContrast(report, vp.name, await contrast(page));

      report.assert(errors.length === 0, `${vp.name}: console/page errors: ${errors.join(' | ')}`);
      report.assert(
        offOrigin.length === 0,
        `${vp.name}: off-origin request(s): ${offOrigin.join(', ')}`,
      );

      await context.close();
    }

    // Dark theme. The tokens are shared, so contrast is the only thing that genuinely
    // differs — and it is the thing most easily got wrong.
    const darkCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: 'dark',
    });
    const darkPage = await darkCtx.newPage();
    await darkPage.goto(server.url, { waitUntil: 'networkidle' });
    assertContrast(report, 'dark', await contrast(darkPage));
    await darkCtx.close();

    // JavaScript off. With no script on the page this should be indistinguishable from the
    // normal render — asserted rather than assumed, because that is the claim being made.
    const noJsCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      javaScriptEnabled: false,
    });
    const noJsPage = await noJsCtx.newPage();
    await noJsPage.goto(server.url, { waitUntil: 'load' });
    const noJsText = await noJsPage.locator('body').innerText();
    report.assert(
      noJsText.includes('the frontier is') && noJsText.length > 900,
      `no-JS: page text is only ${noJsText.length} chars — content did not render`,
    );
    await noJsCtx.close();
  } finally {
    await browser?.close();
    await server.close();
  }

  report.finish();
}

await main();
