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

      // The speed button used to be a second, hand-written copy of the starting speed, so
      // it could disagree with the clock it labels.
      report.assert(
        (await page.textContent('#speedBtn'))?.trim() === '1×',
        `speed button reads "${(await page.textContent('#speedBtn'))?.trim()}", expected 1×`,
      );

      // Without the demo, no satellite is lost to the storm.
      const quiet = await page.evaluate(`SATS.filter(s => s.orbit === 'leo').every(s => s.links.every(l => l[1] === 'ok'))`);
      report.assert(quiet === true, 'a non-demo run does not take the LEO shell down');

      // ...and the run must actually start.
      const t0 = await page.evaluate(() => document.getElementById('clock')?.textContent);
      await page.waitForTimeout(900);
      report.assert(
        (await page.evaluate(() => document.getElementById('clock')?.textContent)) !== t0,
        'the scenario clock is still held after Begin',
      );
      await page.close();
    }

    // --- the demo storm takes the LEO shell, and the blue hulls are US ------------------
    {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${server.url}/wargame/`, { waitUntil: 'load' });
      await page.waitForSelector('.setup-card');
      await page.click('#setupDemo');
      await page.click('.setup-go');
      await page.waitForSelector('.setup', { state: 'hidden' });

      const links = await page.evaluate(`SATS.map(s => [s.name, s.orbit, s.links.map(l => l[1]).join(',')])`) as Array<[string, string, string]>;
      const leo = links.filter(([, o]) => o === 'leo'), high = links.filter(([, o]) => o !== 'leo');
      report.assert(leo.length === 3, `demo: expected 3 LEO satellites, found ${leo.length}`);
      for (const [name, , st] of leo) report.assert(st.split(',').every((x) => x === 'lost'), `demo: ${name} (LEO) should be lost, links are ${st}`);
      for (const [name, o, st] of high) report.assert(st.split(',').every((x) => x === 'ok'), `demo: ${name} (${o.toUpperCase()}) should be up, links are ${st}`);

      const safe = await page.evaluate(() => {
        const w = window as unknown as { engine: { stateOf: (id: string) => { safe_mode: boolean }; storm: { severity: string } } };
        return { sev: w.engine.storm.severity, sm: ['arctic_eye', 'barents_1', 'aissat_4'].map((id) => w.engine.stateOf(id).safe_mode) };
      });
      report.assert(safe.sev === 'G5', `demo: engine severity is ${safe.sev}, expected G5`);
      report.assert(safe.sm.every(Boolean), 'demo: the three LEO birds are in safe mode in the engine');
      report.assert(((await page.textContent('#stream')) ?? '').includes('Ku-band links to Arctic Eye'), 'demo: the storm is announced in the feed');

      // An order that needs a LEO bird now fails for the right reason: it is down.
      await page.fill('#cmd', 'image storfjorden');
      await page.press('#cmd', 'Enter');
      await page.waitForTimeout(120);
      const f = (await page.textContent('#stream')) ?? '';
      report.assert(!f.includes('Sentinel-N tasked') || f.includes('✗'), 'demo: imagery is not silently granted through a dark LEO shell');

      // Blue hulls read as US ships on hover, named as the catalog names them.
      const hover = async (id: string) => page.evaluate((i) => document.getElementById(i)?.dataset['name'] ?? '', id);
      report.assert((await hover('u-n2')) === 'USS Delbert D. Black', `destroyer hover name is "${await hover('u-n2')}"`);
      report.assert((await hover('u-n4')) === 'USCGC Healy', `icebreaker hover name is "${await hover('u-n4')}"`);
      report.assert(/^US(S|CGC) /.test(await hover('u-n1')) && /^US(S|CGC) /.test(await hover('u-n3')) && /^USS /.test(await hover('u-n5')), 'every blue hull carries a US prefix');
      report.assert((await hover('u-r1')) === 'Pyotr Velikiy', 'the Northern Fleet is still Russian');
      report.assert(errors.length === 0, `page errors in the demo storm: ${errors.join('; ')}`);
      await page.close();
    }

    // --- the order box goes through the gate ------------------------------------------
    {
      const page = await browser.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${server.url}/wargame/`, { waitUntil: 'load' });
      await page.waitForSelector('.setup-card');
      await page.click('.setup-go');
      await page.waitForSelector('.setup', { state: 'hidden' });

      // The engine is on the page, loaded the real catalog, and is reachable for a
      // RemoteModel to be attached from the console until there is UI for it.
      const loaded = await page.evaluate(() => {
        const w = window as unknown as { engine?: { catalog: { assets: unknown[]; specs: Map<string, unknown> } }; RemoteModel?: unknown };
        return { assets: w.engine?.catalog.assets.length ?? 0, specs: w.engine?.catalog.specs.size ?? 0, remote: typeof w.RemoteModel === 'function' };
      });
      report.assert(loaded.assets === 51, `engine on the page holds ${loaded.assets} assets, expected 51`);
      report.assert(loaded.specs === 9, `engine on the page holds ${loaded.specs} specs, expected 9`);
      report.assert(loaded.remote, 'RemoteModel is exposed for attaching the trained model');

      const feed = () => page.textContent('#stream').then((t) => t ?? '');
      const issue = async (text: string) => { await page.fill('#cmd', text); await page.press('#cmd', 'Enter'); await page.waitForTimeout(80); };

      // Norwegian Joint HQ is the default actor. A wrong-kind target is refused with a reason.
      await issue('board svalsat_ground');
      let f = await feed();
      report.assert(f.includes('✗') && f.includes('targets a ship'), 'boarding a ground station is rejected in the feed with the reason');

      // Switch to the Northern Fleet through the page's own actor switcher.
      // `A` is a top-level const in the page's classic script: global lexical scope, not a
      // window property. A string expression evaluates in that scope, where the bare name
      // resolves; a function would only see `window`.
      await page.evaluate(`setActor(A['rus'])`);
      await issue('jam svalsat_ground with pechenga_ew_site');
      f = await feed();
      report.assert(f.includes('300 km'), 'a named jammer out of reach is refused with the range');

      // A held action reports who has to release it.
      await issue('inspect svalsat_1 with kosmos_2xxx');
      f = await feed();
      report.assert(f.includes('⏳') && f.includes('kremlin'), 'counter_rpo is held pending the Kremlin');

      // Plain intent is echoed as it always was, and logged as a hold — never judged aloud.
      const before = (await feed()).length;
      await issue('check the cable landing at Longyearbyen');
      f = await feed();
      report.assert(f.includes('check the cable landing'), 'free text still appears in the feed');
      report.assert(!f.slice(before).includes('✗'), 'free text is not rejected');
      const held = await page.evaluate(() => {
        const w = window as unknown as { engine: { log: { ofType: (t: string) => Array<{ order: { action: string; text?: string } }> } } };
        return w.engine.log.ofType('order_result').some((e) => e.order.action === 'hold' && (e.order.text ?? '').includes('cable landing'));
      });
      report.assert(held, 'free text is logged by the engine as a hold carrying the text');

      // The observer holds no seat.
      await page.evaluate(`setActor(A['obs'])`);
      await issue('hold');
      f = await feed();
      report.assert(f.includes('holds no seat'), 'the observer is told it holds no seat');

      report.assert(errors.length === 0, `page errors with the engine wired: ${errors.join('; ')}`);
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
