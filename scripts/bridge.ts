/**
 * check:bridge — the letter actually reaches the simulation.
 *
 * The handoff spans three documents and a media element, which is four things that can
 * strand a reader on a black screen. Autoplay can be refused, the clip can fail to decode,
 * the wargame can 404 after a rename. None of those show up in a build, and all of them
 * look identical from the outside: nothing happens.
 *
 * So this walks the journey rather than asserting its parts, and it walks it three ways —
 * with script, without script, and with reduced motion — because those are three different
 * code paths through the bridge and only one of them is the happy one.
 */

import { chromium, type Browser } from 'playwright';
import { Report, serveDist } from './lib.ts';

async function main(): Promise<void> {
  const report = new Report('bridge');
  const server = await serveDist();
  let browser: Browser | undefined;

  try {
    browser = await chromium.launch();

    // --- the letter offers the way in, and offers it without script -------------------
    {
      const ctx = await browser.newContext({ javaScriptEnabled: false });
      const page = await ctx.newPage();
      await page.goto(server.url, { waitUntil: 'load' });
      const href = await page.getAttribute('.enter-link', 'href');
      report.assert(href === '/enter/', `letter CTA points at ${href}, expected /enter/`);

      // With no script the bridge must still be a door, not a dead end.
      await page.goto(`${server.url}/enter/`, { waitUntil: 'load' });
      const fallback = await page.getAttribute('#fallback a', 'href');
      report.assert(
        fallback === '/wargame/',
        `no-JS bridge fallback points at ${fallback}, expected /wargame/`,
      );
      const visible = await page.isVisible('#fallback');
      report.assert(visible, 'no-JS bridge hides its only link — the reader is stranded');
      await ctx.close();
    }

    // --- the whole journey, with script ------------------------------------------------
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));

      await page.goto(server.url, { waitUntil: 'load' });
      await page.click('.enter-link');

      // The bridge must hand off on its own. Give it the clip's length plus the hard
      // ceiling in the page, and no interaction of any kind.
      await page.waitForURL(`${server.url}/wargame/`, { timeout: 12_000 });
      report.assert(true, 'letter -> bridge -> wargame completes unattended');

      /* Arriving is not enough. The bridge has a 6s hard ceiling, so a completely dead
         video element still lands the reader on the simulation — just after six seconds of
         black. Without these the gate is green while the transition does not exist. */
      const progress = Number(await page.evaluate(() => sessionStorage.getItem('bridge:progress')));
      const revealed = await page.evaluate(() => sessionStorage.getItem('bridge:revealed'));
      report.assert(
        progress > 1.0,
        `clip advanced only ${progress.toFixed(2)}s before handoff — the transition is not playing`,
      );
      report.assert(revealed === '1', 'clip never became visible — reader saw black, then a jump');

      await page.waitForSelector('.unit');
      const units = await page.locator('.unit').count();
      report.assert(units >= 30, `wargame arrived with ${units} units, expected the full laydown`);

      // The veil must actually lift, or the reader arrives at a black rectangle.
      await page.waitForFunction(() => !document.getElementById('arrival'), null, { timeout: 4000 })
        .then(() => report.assert(true, 'arrival veil lifts'))
        .catch(() => report.assert(false, 'arrival veil never lifted — theatre stays black'));

      // Back must return to the letter, not replay the clip. This is the whole reason the
      // bridge replaces itself in history instead of pushing.
      await page.goBack({ waitUntil: 'load' });
      const back = new URL(page.url()).pathname;
      report.assert(back === '/', `Back from the simulation landed on ${back}, expected /`);

      report.assert(errors.length === 0, `page errors during the journey: ${errors.join('; ')}`);
      await ctx.close();
    }

    // --- reduced motion skips the clip entirely -----------------------------------------
    {
      const ctx = await browser.newContext({ reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      const t0 = Date.now();
      await page.goto(`${server.url}/enter/`, { waitUntil: 'load' });
      await page.waitForURL(`${server.url}/wargame/`, { timeout: 6000 });
      const ms = Date.now() - t0;
      report.assert(
        ms < 3000,
        `reduced-motion readers waited ${ms}ms — the clip should be skipped, not played`,
      );
      await ctx.close();
    }

    // --- the clip is actually served, and fingerprinted ----------------------------------
    {
      /* Read the built markup rather than a live page: /enter/ navigates itself away, and
         a previous version of this block raced that navigation and died with a stack trace
         instead of failing a named assertion. */
      const html = await (await fetch(`${server.url}/enter/`)).text();
      const src = /<video[^>]*\ssrc="([^"]+)"/.exec(html)?.[1] ?? '';
      report.assert(
        /^\/assets\/intro-[A-Za-z0-9_-]+\.mp4$/.test(src),
        `clip src is "${src}" — it must be a root-absolute fingerprinted asset, or deploy caches it forever under a reusable name`,
      );
      if (src) {
        const res = await fetch(`${server.url}${src}`);
        report.assert(res.status === 200, `clip returned ${res.status}`);
        report.assert(
          (res.headers.get('content-type') ?? '').startsWith('video/'),
          `clip served as ${res.headers.get('content-type')}`,
        );
      }
    }

  } finally {
    if (browser) await browser.close();
    await server.close();
  }

  report.finish();
}

main();
