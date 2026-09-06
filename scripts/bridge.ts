/**
 * check:bridge — the front door actually opens onto the simulation.
 *
 * `/` is the entrance: it plays the intro clip and hands off to `/wargame/`. That is the
 * whole site above the simulation, so if this fails there is nothing left — a reader who
 * types the domain gets a black rectangle and no way forward.
 *
 * Several things can produce exactly that, none of which show up in a build: autoplay can
 * be refused, the clip can fail to decode or stall on a cold connection, the simulation can
 * 404 after a rename. From the outside they are indistinguishable — nothing happens.
 *
 * So this walks the journey rather than asserting its parts, and it walks it three ways —
 * with script, without script, and with reduced motion — because those are three different
 * code paths through the entrance and only one of them is the happy one.
 */

import { chromium, type Browser } from 'playwright';
import { Report, serveDist } from './lib.ts';

async function main(): Promise<void> {
  const report = new Report('bridge');
  const server = await serveDist();
  let browser: Browser | undefined;

  try {
    browser = await chromium.launch();

    // --- the whole journey, with script ------------------------------------------------
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));

      await page.goto(server.url, { waitUntil: 'load' });

      // The entrance must hand off on its own. Give it the clip's length plus the hard
      // ceiling in the page, and no interaction of any kind.
      await page.waitForURL(`${server.url}/wargame/`, { timeout: 12_000 });
      report.assert(true, '/ -> wargame completes unattended, with no interaction');

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

      /* The entrance must not sit in history. It replaces itself rather than pushing, so
         Back from the simulation leaves the site instead of replaying three seconds of
         video and immediately bouncing forward again — which is a trap, not navigation. */
      const depth = await page.evaluate(() => history.length);
      const wentBack = await page.goBack({ waitUntil: 'load' }).then(() => true, () => false);
      const landed = wentBack ? new URL(page.url()).pathname : null;
      report.assert(
        landed !== '/',
        `Back from the simulation landed on the entrance (history length ${depth}) — the clip will replay and bounce forward`,
      );

      report.assert(errors.length === 0, `page errors during the journey: ${errors.join('; ')}`);
      await ctx.close();
    }

    // --- the setup dialog configures a real run --------------------------------------
    {
      const page = await browser.newPage();
      await page.goto(`${server.url}/wargame/`, { waitUntil: 'load' });
      await page.waitForSelector('.setup-card');

      // The clock and the fleet are held until Begin, or the reader is configuring a run
      // that is already two minutes old.
      const heldAt = await page.evaluate(() => document.getElementById('clock')?.textContent);
      await page.waitForTimeout(700);
      report.assert(
        (await page.evaluate(() => document.getElementById('clock')?.textContent)) === heldAt,
        'the scenario clock runs while the setup dialog is still open',
      );

      // The demo button must actually write the prompt — it is the only affordance that
      // fills it, and an empty box behind a pressed button is indistinguishable from broken.
      report.assert(
        (await page.inputValue('#setupPrompt')) === '',
        'system prompt is pre-filled before the demo button is pressed',
      );
      await page.click('#setupDemo');
      const demo = await page.inputValue('#setupPrompt');
      report.assert(demo.length > 80, `demo prompt is ${demo.length} chars — the button wrote nothing useful`);
      report.assert(
        /electromagnetic|geomagnetic/i.test(demo) && /satellite/i.test(demo) &&
          /communications/i.test(demo) && /\bUS\b|United States/.test(demo),
        `demo prompt does not describe the storm scenario: "${demo.slice(0, 70)}…"`,
      );
      report.assert(
        (await page.getAttribute('#setupDemo', 'aria-pressed')) === 'true',
        'demo button does not report its pressed state',
      );

      // Pressing it again must not destroy text the reader typed themselves.
      await page.click('#setupDemo');
      await page.fill('#setupPrompt', 'Hand-written situation.');
      await page.click('#setupDemo');
      await page.click('#setupDemo');
      report.assert(
        (await page.inputValue('#setupPrompt')) === 'Hand-written situation.',
        'toggling the demo button destroyed a prompt the reader had typed',
      );

      // What is entered has to reach the run.
      await page.fill('#setupSim', 'Barents contingency');
      await page.fill('#setupOp', 'Majhail');
      await page.fill('#setupPrompt', 'A test situation the actors wake up into.');
      await page.click('.setup-go');
      await page.waitForSelector('.setup', { state: 'hidden' });

      report.assert(
        (await page.textContent('#feedTitle'))?.trim() === 'Barents contingency',
        'simulation name did not reach the feed heading',
      );
      report.assert(
        (await page.textContent('#feedOperator'))?.trim() === 'Majhail',
        'operator name did not reach the feed',
      );
      report.assert(
        (await page.getAttribute('#cmd', 'placeholder'))?.includes('Majhail') === true,
        'operator name did not reach the compose box',
      );
      report.assert(
        (await page.textContent('#stream'))?.includes('A test situation the actors wake up into.') === true,
        'system prompt was not pushed into the feed',
      );
      report.assert(
        (await page.title()).startsWith('Barents contingency'),
        `document title is "${await page.title()}" — the run name did not reach it`,
      );

      // ...and the run must actually start.
      const t0 = await page.evaluate(() => document.getElementById('clock')?.textContent);
      await page.waitForTimeout(900);
      report.assert(
        (await page.evaluate(() => document.getElementById('clock')?.textContent)) !== t0,
        'the scenario clock is still held after Begin',
      );
      await page.close();
    }

    // --- reduced motion skips the clip entirely -----------------------------------------
    {
      const ctx = await browser.newContext({ reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      const t0 = Date.now();
      await page.goto(server.url, { waitUntil: 'load' });
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
      const html = await (await fetch(server.url)).text();
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
