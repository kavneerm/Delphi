/**
 * check:shell — the two documents that make up the site hold up in a real engine.
 *
 * This replaces check:layout, which asserted against `.hero-statement`, `.passage-head`
 * and `.horizon-line` — furniture of the letter site that has been retired. Rather than
 * point those selectors at a page they were never written for, the assertions that still
 * mean something were carried over and the rest dropped:
 *
 *   kept     nothing overflows sideways at any viewport; the page asks nothing of any
 *            third party; every internal link resolves; the entrance works with no
 *            JavaScript.
 *   dropped  the copy deck (no prose left to protect), the horizon/headline geometry
 *            (no horizon), and the per-selector contrast sweep (the simulation is a dark
 *            UI with its own tokens, not the letter's shared palette).
 *
 * The no-third-party assertion is the one worth stating plainly: this site is an argument
 * about who controls access to things, and it should not be handing every reader's request
 * to a CDN to render itself.
 */

import { chromium, type Browser, type Page } from 'playwright';
import { Report, serveDist } from './lib.ts';

const PAGES = [
  { path: '/', label: 'entrance' },
  { path: '/wargame/', label: 'simulation' },
];

/** Narrow enough to catch a fixed width, wide enough to catch an unclamped one. */
const WIDTHS = [360, 414, 768, 1024, 1280, 1440, 1920, 2560];

async function main(): Promise<void> {
  const report = new Report('shell');
  const server = await serveDist();
  let browser: Browser | undefined;

  try {
    browser = await chromium.launch();

    for (const { path, label } of PAGES) {
      const context = await browser.newContext({ javaScriptEnabled: path === '/' ? false : true });
      const page: Page = await context.newPage();

      // Anything not served by us is a third party, whoever it is.
      const foreign: string[] = [];
      page.on('request', (r) => {
        const u = r.url();
        if (!u.startsWith(server.url) && !u.startsWith('data:') && !u.startsWith('blob:')) {
          foreign.push(u);
        }
      });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));

      // The entrance navigates itself onward within a second or so. Measuring its layout
      // in a live page is therefore a race it usually loses — an earlier version of this
      // check read the *simulation's* DOM and reported the entrance's title as missing.
      // Layout here is pure CSS (the clip is `position:fixed; inset:0; object-fit:cover`),
      // so it is measured with scripting off, which holds the document still and changes
      // nothing about the box model.

      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(server.url + path, { waitUntil: 'load' });
        const overflow = await page.evaluate(() => ({
          scrollW: document.documentElement.scrollWidth,
          clientW: document.documentElement.clientWidth,
        }));
        report.assert(
          overflow.scrollW <= overflow.clientW + 1,
          `${label} @${width}px: horizontal overflow — scrollWidth ${overflow.scrollW} > clientWidth ${overflow.clientW}`,
        );
      }

      report.assert(
        foreign.length === 0,
        `${label}: external resource(s) — ${[...new Set(foreign)].join(', ')}`,
      );
      report.assert(errors.length === 0, `${label}: page errors — ${errors.join('; ')}`);

      // Structural basics that survive any redesign, read from the served bytes rather
      // than a live DOM for the same reason.
      const html = await (await fetch(server.url + path)).text();
      report.assert(/<html[^>]+lang="en"/.test(html), `${label}: no lang="en" on <html>`);
      report.assert(/<title>[^<]*Inevitable Frontier/.test(html), `${label}: title missing`);
      report.assert(
        !/(?:src|href)="https?:\/\//.test(html),
        `${label}: markup references an absolute external URL`,
      );

      await context.close();
    }

    // Every internal link resolves. A dead link on a two-page site is most of the site.
    {
      const page = await browser.newPage();
      await page.route('**/*.mp4', (r) => r.abort());
      for (const { path, label } of PAGES) {
        await page.goto(server.url + path, { waitUntil: 'load' });
        const hrefs = await page.evaluate(() =>
          [...document.querySelectorAll('a[href]')]
            .map((a) => a.getAttribute('href')!)
            .filter((h) => h.startsWith('/')),
        );
        for (const href of new Set(hrefs)) {
          const res = await page.request.get(server.url + href);
          report.assert(res.status() === 200, `${label}: link ${href} -> ${res.status()}`);
        }
      }
      await page.close();
    }

    // The entrance must be a door without JavaScript, not a dead end.
    {
      const ctx = await browser.newContext({ javaScriptEnabled: false });
      const page = await ctx.newPage();
      await page.goto(server.url, { waitUntil: 'load' });
      const href = await page.getAttribute('#fallback a', 'href');
      report.assert(href === '/wargame/', `no-JS entrance link is ${href}, expected /wargame/`);
      report.assert(await page.isVisible('#fallback'), 'no-JS entrance hides its only link');
      await ctx.close();
    }
  } finally {
    if (browser) await browser.close();
    await server.close();
  }

  report.finish();
}

main();
