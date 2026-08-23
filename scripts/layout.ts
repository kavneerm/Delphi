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

/** Both pages get the whole viewport sweep. A second page is a second chance to overflow. */
const PAGES = [
  { path: '/', label: 'home' },
  { path: '/writing/', label: 'writing' },
  { path: '/thanks/', label: 'thanks' },
];

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
      '.passage-head',
      '.passage p',
      '.eyebrow',
      '.nav a',
      '.wordmark',
      '.page-title',
      '.link',
      '.colophon-line',
      '.colophon-mark',
      '.field label',
      '.submit',
      '.optional',
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

    for (const { path, label } of PAGES) {
    for (const vp of VIEWPORTS) {
      const name = `${label} ${vp.name}`;
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

      await page.goto(server.url + path, { waitUntil: 'networkidle' });

      const overflow = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      report.assert(
        overflow.scrollW <= overflow.clientW + 1,
        `${name}: horizontal overflow — scrollWidth ${overflow.scrollW} > clientWidth ${overflow.clientW}`,
      );

      // The page's own headline is legible on arrival, with no script needed to make it so.
      const headline = path === '/' ? '.hero-statement' : '.page-title';
      const headBox = await page.locator(headline).boundingBox();
      report.assert(
        headBox !== null && headBox.y >= 0 && headBox.y < vp.height,
        `${name}: ${headline} is not in the first viewport`,
      );

      /*
       * The horizon must sit below the headline, never through it. This is the specific
       * defect the rebuild exists to fix: positioned at a percentage of the hero, the line
       * landed in the middle of the text at 1440x900. Asserting the geometry rather than
       * trusting the markup means a future layout change cannot quietly reintroduce it.
       */
      const geometry = path !== '/' ? null : await page.evaluate(() => {
        const hero = document.querySelector('.hero-statement');
        const line = document.querySelector('.horizon-line');
        if (!hero || !line) return null;
        const h = hero.getBoundingClientRect();
        const l = line.getBoundingClientRect();
        return { heroBottom: h.bottom, lineTop: l.top };
      });
      if (path === '/') {
        report.assert(geometry !== null, `${name}: hero statement or horizon line missing`);
      }
      if (geometry) {
        report.assert(
          geometry.lineTop >= geometry.heroBottom,
          `${name}: horizon crosses the headline — line at y=${geometry.lineTop.toFixed(0)}, text ends at y=${geometry.heroBottom.toFixed(0)}`,
        );
      }

      /*
       * Measure and gutter.
       *
       * This exists because a restructure deleted `.band`, `.prose` and `.lead` from the
       * stylesheet while writing/index.html still used all three. That page fell back to
       * raw block defaults — 169 characters per line at 1440, text flush against x=0 — and
       * the whole suite stayed green, because contrast, overflow, link resolution and no-JS
       * parity are all satisfied by unstyled text.
       *
       * A paragraph spanning the full viewport with no left offset is the exact signature
       * of styles not applying, and it is unreadable long before it is anything else.
       */
      const typography = await page.evaluate(() => {
        const rows: { tag: string; cpl: number; lines: number; left: number; text: string }[] = [];
        for (const el of document.querySelectorAll('main p, main h1, main h2, main li')) {
          const text = el.textContent?.trim() ?? '';
          const r = el.getBoundingClientRect();
          if (r.width === 0 || text.length === 0) continue;

          // Characters per line, from how many lines the element actually occupies. A short
          // heading in a wide container is fine — it never wraps. What hurts a reader is a
          // long paragraph whose lines run so far that the eye loses the return.
          const cs = getComputedStyle(el);
          const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
          const lines = Math.max(1, Math.round(r.height / lh));
          rows.push({ tag: el.tagName.toLowerCase(), cpl: text.length / lines, lines, left: r.left, text: text.slice(0, 40) });
        }
        return rows;
      });
      for (const row of typography) {
        // Only judge text long enough to have wrapped at all.
        if (row.lines > 1) {
          report.assert(
            row.cpl <= 95,
            `${name}: ${row.tag} runs ${row.cpl.toFixed(0)} chars/line over ${row.lines} lines (max 95) — "${row.text}…"`,
          );
        }
        report.assert(
          row.left >= 16,
          `${name}: ${row.tag} sits ${row.left.toFixed(0)}px from the edge (min 16) — "${row.text}…"`,
        );
      }

      assertContrast(report, name, await contrast(page));

      report.assert(errors.length === 0, `${name}: console/page errors: ${errors.join(' | ')}`);
      report.assert(
        offOrigin.length === 0,
        `${name}: off-origin request(s): ${offOrigin.join(', ')}`,
      );

      await context.close();
    }
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

    // Every internal link must resolve. A nav pointing at a 404 is the most embarrassing
    // failure a five-page site can have, and nothing else here would catch it.
    const linkCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const linkPage = await linkCtx.newPage();
    for (const { path, label } of PAGES) {
      await linkPage.goto(server.url + path, { waitUntil: 'networkidle' });
      const hrefs = await linkPage.evaluate(() =>
        [...document.querySelectorAll('a[href]')]
          .map((a) => a.getAttribute('href') ?? '')
          .filter((h) => h.startsWith('/')),
      );
      for (const href of hrefs) {
        const target = href.split('#')[0] || '/';
        const res = await linkPage.request.get(server.url + target);
        report.assert(res.ok(), `${label}: link ${href} -> HTTP ${res.status()}`);
      }
    }
    await linkCtx.close();

    /*
     * JavaScript off. With no script on the page this must be indistinguishable from the
     * normal render.
     *
     * Asserted as an equality between the two renders, not against a hardcoded phrase. The
     * first version of this check looked for the literal string "the frontier is", and when
     * that copy was removed from the site the check failed while nothing was actually
     * broken. A check that must be edited whenever the copy changes will eventually be
     * edited carelessly; this one derives its expectation from the page itself.
     */
    for (const { path, label } of PAGES) {
      const withJs = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const jsPage = await withJs.newPage();
      await jsPage.goto(server.url + path, { waitUntil: 'networkidle' });
      const jsText = (await jsPage.locator('body').innerText()).replace(/\s+/g, ' ').trim();
      await withJs.close();

      const noJsCtx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        javaScriptEnabled: false,
      });
      const noJsPage = await noJsCtx.newPage();
      await noJsPage.goto(server.url + path, { waitUntil: 'load' });
      const noJsText = (await noJsPage.locator('body').innerText()).replace(/\s+/g, ' ').trim();
      await noJsCtx.close();

      report.assert(
        noJsText.length > 150,
        `${label}: no-JS text is only ${noJsText.length} chars — content did not render`,
      );
      report.assert(
        noJsText === jsText,
        `${label}: no-JS render differs from the scripted one (${noJsText.length} vs ${jsText.length} chars)`,
      );
    }
  } finally {
    await browser?.close();
    await server.close();
  }

  report.finish();
}

await main();
