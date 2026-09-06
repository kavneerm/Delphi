/**
 * check:laydown — every unit renders on terrain it could occupy, and is actually on screen.
 *
 * A frigate placed on a glacier and a frigate placed in the Greenland Sea are one digit
 * apart in the source and look almost identical at map scale. The eye skips it; a pixel
 * does not.
 *
 * Two things this deliberately does NOT do, both of which a previous version did:
 *
 *   1. It does not read the coordinates back out of the elements. `data-ix`/`data-iy` are
 *      written from the same literals the check would then assert against, so that version
 *      verified the array and nothing about where the sprite lands. Transposing the page's
 *      `MAP_IMG` constant left it green while every unit on the page was displaced and two
 *      were off the map entirely. Here the sample position is derived from the unit's
 *      *rendered* box and the image's *own* natural size, so the page's constants are
 *      under test rather than trusted.
 *
 *   2. It does not test one viewport. The plate is scaled to the element, and a unit can be
 *      correctly placed and still be unreadable or off the page at some window size.
 *
 *   3. It does not test only where units *start*. They patrol, so a destroyer can be
 *      authored in open water and still run aground thirty seconds later. Both ends of
 *      every patrol leg are sampled, with motion held still for the base measurement.
 */

import { chromium, type Browser } from 'playwright';
import { Report, serveDist } from './lib.ts';

/** Where each class can legally sit. Coastal types are exempt: that is their whole nature. */
const DOMAIN: Record<string, 'sea' | 'land' | 'coast' | 'air'> = {
  carrier: 'sea', cruiser: 'sea', destroyer: 'sea', frigate: 'sea', corvette: 'sea',
  amphib: 'sea', icebreaker: 'sea', replenish: 'sea',
  ssn: 'sea', ssbn: 'sea', diesel: 'sea', uuv: 'sea',
  fighter: 'air', bomber: 'air', aew: 'air', tanker: 'air', mpa: 'air',
  transport: 'air', helo: 'air', uav: 'air',
  armour: 'land', mech: 'land', artillery: 'land', sam: 'land', radar: 'land',
  infantry: 'land', airbase: 'land', radarstn: 'land', missilesite: 'land',
  c2: 'land', groundstn: 'land',
  navalbase: 'coast',
};

/**
 * Terrain is judged once, at a viewport that shows the whole plate. Visibility is judged at
 * the sizes people actually use — a maximised window on a 1080p panel is the common case
 * and the one that used to drop the two units the scenario leans on.
 */
const TERRAIN_VP = { width: 1500, height: 1000 };
const VISIBILITY_VPS = [
  { width: 1920, height: 950, label: 'maximised on 1080p' },
  { width: 1440, height: 900, label: 'laptop' },
  { width: 2560, height: 1080, label: 'ultrawide' },
  { width: 1280, height: 800, label: 'small laptop' },
];

interface Sample {
  name: string; type: string; actor: string;
  lum: number; warm: number; fx: number; fy: number; onScreen: boolean; covered: string | null;
}

/**
 * Runs in the page. Derives each unit's image-space position from its rendered box and the
 * image's true natural size — never from the page's own mapping constants.
 */
const COLLECT = async (): Promise<Sample[]> => {
  const map = document.getElementById('map') as HTMLElement;
  const url = /url\("?(.+?)"?\)/.exec(getComputedStyle(map).backgroundImage)?.[1];
  if (!url) throw new Error('map background image not found');

  const img = new Image();
  img.src = url;
  await img.decode();

  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  const ctx = cv.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, cv.width, cv.height).data;

  // The browser's own `cover` arithmetic, from the element box and the real image size.
  const ew = map.clientWidth, eh = map.clientHeight;
  const sc = Math.max(ew / img.naturalWidth, eh / img.naturalHeight);
  const dw = img.naturalWidth * sc, dh = img.naturalHeight * sc;
  const ox = (ew - dw) / 2, oy = (eh - dh) / 2;

  const mapRect = map.getBoundingClientRect();

  return [...document.querySelectorAll<HTMLElement>('.unit')].map((el) => {
    const r = el.getBoundingClientRect();
    // Rendered centre, in element-local pixels.
    const cxEl = r.left + r.width / 2 - mapRect.left;
    const cyEl = r.top + r.height / 2 - mapRect.top;
    // ...converted back into image space through the true geometry.
    const fx = (cxEl - ox) / dw;
    const fy = (cyEl - oy) / dh;

    const cx = Math.min(cv.width - 1, Math.max(0, Math.round(fx * cv.width)));
    const cy = Math.min(cv.height - 1, Math.max(0, Math.round(fy * cv.height)));

    /* Two signals, because brightness alone cannot separate the coastline from the map's
       own place-names — both are pale. Svalbard is printed in cream (R-B of +18 to +33);
       the labels are neutral white or grey (-5 to -34). Requiring warmth as well as
       brightness makes "BARENTS SEA" unmistakably not a beach.

       The sample is a small cross, not a wide patch: a patch big enough to outvote a
       letterform is also bigger than Kong Karls Land, and swallows every small island. */
    const lums: number[] = [], warms: number[] = [];
    for (const [dx, dy] of [[0, 0], [-4, 0], [4, 0], [0, -4], [0, 4], [-4, -4], [4, 4]]) {
      const sx = Math.min(cv.width - 1, Math.max(0, cx + dx!));
      const sy = Math.min(cv.height - 1, Math.max(0, cy + dy!));
      const k = (sy * cv.width + sx) * 4;
      // Rec. 601 luma: the cream/ocean split is a brightness split, not a hue one.
      lums.push(0.299 * px[k]! + 0.587 * px[k + 1]! + 0.114 * px[k + 2]!);
      warms.push(px[k]! - px[k + 2]!);
    }
    lums.sort((a, b) => a - b);
    warms.sort((a, b) => a - b);
    const warm = warms[Math.floor(warms.length / 2)]!;

    // Wholly outside the map box means the reader never sees it, however right the data is.
    const onScreen =
      r.right > mapRect.left && r.left < mapRect.right &&
      r.bottom > mapRect.top && r.top < mapRect.bottom;

    // Hover-name is the only identification affordance, so a unit whose own centre belongs
    // to a neighbour cannot be identified at all.
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const owner = hit?.closest<HTMLElement>('.unit') ?? null;
    const covered = owner && owner !== el ? (owner.dataset['name'] ?? '?') : null;

    return {
      name: el.dataset['name'] ?? '?', type: el.dataset['type'] ?? '?',
      actor: el.dataset['actor'] ?? '?',
      lum: lums[Math.floor(lums.length / 2)]!, warm, fx, fy, onScreen, covered,
    };
  });
};

async function main(): Promise<void> {
  const report = new Report('laydown');
  const server = await serveDist();
  let browser: Browser | undefined;

  try {
    browser = await chromium.launch();

    // --- terrain -----------------------------------------------------------------------
    {
      // reducedMotion stops the patrol, so the base sample measures the authored station.
      const page = await browser.newPage({ viewport: TERRAIN_VP, reducedMotion: 'reduce' });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(`${server.url}/wargame/`, { waitUntil: 'load' });
      await page.waitForSelector('.unit');

      const samples = await page.evaluate(COLLECT);
      report.assert(errors.length === 0, `page errors: ${errors.join('; ')}`);
      report.assert(samples.length >= 30, `expected a populated laydown, got ${samples.length}`);

      // Cream land near 230 at warmth +18 or better; open ocean near 40 at -50; the map's
      // labels are pale but neutral. Both conditions, or a place-name reads as a coast.
      const LAND = (u: { lum: number; warm: number }) => u.lum > 150 && u.warm > 8;
      for (const u of samples) {
        const domain = DOMAIN[u.type];
        report.assert(domain !== undefined, `${u.name}: unknown unit type "${u.type}"`);
        report.assert(u.name.length > 2 && u.name !== '?', `unit of type ${u.type} has no name`);
        report.assert(u.actor !== '?', `${u.name} has no owning actor`);
        report.assert(
          u.covered === null,
          `${u.name} cannot be hovered — its centre belongs to ${u.covered}`,
        );
        report.assert(
          u.fx > -0.02 && u.fx < 1.02 && u.fy > -0.02 && u.fy < 1.02,
          `${u.name} renders outside the map plate at ${u.fx.toFixed(3)},${u.fy.toFixed(3)} ` +
            `— the image-space mapping is wrong, not the datum`,
        );
        if (!domain || domain === 'air' || domain === 'coast') continue;

        const onLand = LAND(u);
        report.assert(
          onLand === (domain === 'land'),
          `${u.name} (${u.type}) is a ${domain} unit but renders on ${onLand ? 'land' : 'water'} ` +
            `at ${(u.fx * 100).toFixed(1)}%,${(u.fy * 100).toFixed(1)}% (luma ${u.lum.toFixed(0)}, warmth ${u.warm.toFixed(0)})`,
        );
        report.assert(
          u.lum < 110 || u.lum > 190,
          `${u.name}: ambiguous terrain sample (luma ${u.lum.toFixed(0)}) — move it clear of the coastline`,
        );
      }

      /* Both ends of every patrol. A unit authored in clear water is not enough: it spends
         most of its time somewhere else, and "somewhere else" is what the reader sees. */
      const legs = await page.evaluate(async () => {
        const map = document.getElementById('map') as HTMLElement;
        const url = /url\("?(.+?)"?\)/.exec(getComputedStyle(map).backgroundImage)?.[1]!;
        const img = new Image(); img.src = url; await img.decode();
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        const ctx = cv.getContext('2d')!; ctx.drawImage(img, 0, 0);
        const px = ctx.getImageData(0, 0, cv.width, cv.height).data;
        const lumAt = (fx: number, fy: number) => {
          const x = Math.min(cv.width - 1, Math.max(0, Math.round(fx * cv.width)));
          const y = Math.min(cv.height - 1, Math.max(0, Math.round(fy * cv.height)));
          const v: number[] = [], w: number[] = [];
          for (const [dx, dy] of [[0, 0], [-4, 0], [4, 0], [0, -4], [0, 4], [-4, -4], [4, 4]]) {
            const sx = Math.min(cv.width - 1, Math.max(0, x + dx!));
            const sy = Math.min(cv.height - 1, Math.max(0, y + dy!));
            const k = (sy * cv.width + sx) * 4;
            v.push(0.299 * px[k]! + 0.587 * px[k + 1]! + 0.114 * px[k + 2]!);
            w.push(px[k]! - px[k + 2]!);
          }
          v.sort((a, b) => a - b); w.sort((a, b) => a - b);
          return { lum: v[Math.floor(v.length / 2)]!, warm: w[Math.floor(w.length / 2)]! };
        };
        const aspect = img.naturalWidth / img.naturalHeight;
        return [...document.querySelectorAll<HTMLElement>('.unit')]
          .filter((el) => el.dataset['leg'])
          .flatMap((el) => {
            const bx = parseFloat(el.dataset['ix']!), by = parseFloat(el.dataset['iy']!);
            const h = parseFloat(el.dataset['h']!), leg = parseFloat(el.dataset['leg']!);
            const rad = -h * Math.PI / 180;
            return [1, -1].map((end) => ({
              name: el.dataset['name'] ?? '?', type: el.dataset['type'] ?? '?',
              kind: el.dataset['kind'] ?? '?', end,
              fx: bx + Math.cos(rad) * leg * end,
              fy: by + Math.sin(rad) * leg * end * aspect,
              ...lumAt(bx + Math.cos(rad) * leg * end, by + Math.sin(rad) * leg * end * aspect),
            }));
          });
      });

      for (const e of legs) {
        if (e.kind === 'air') continue;                       // aircraft overfly anything
        report.assert(
          !(e.lum > 150 && e.warm > 8),
          `${e.name} runs aground at the ${e.end > 0 ? 'far' : 'near'} end of its patrol ` +
            `(${(e.fx * 100).toFixed(1)}%,${(e.fy * 100).toFixed(1)}%, luma ${e.lum.toFixed(0)}, warmth ${e.warm.toFixed(0)})`,
        );
        report.assert(
          e.fx > 0.01 && e.fx < 0.99 && e.fy > 0.01 && e.fy < 0.99,
          `${e.name} patrols off the edge of the plate at ${(e.fx * 100).toFixed(1)}%,${(e.fy * 100).toFixed(1)}%`,
        );
      }
      await page.close();
    }

    // --- visibility across the sizes people actually use -------------------------------
    for (const vp of VISIBILITY_VPS) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height }, reducedMotion: 'reduce' });
      await page.goto(`${server.url}/wargame/`, { waitUntil: 'load' });
      await page.waitForSelector('.unit');
      const samples = await page.evaluate(COLLECT);
      const gone = samples.filter((u) => !u.onScreen).map((u) => u.name);
      report.assert(
        gone.length === 0,
        `${vp.width}x${vp.height} (${vp.label}): ${gone.length} unit(s) cropped off the map — ${gone.join(', ')}`,
      );
      await page.close();
    }

    // --- units hold station across a resize --------------------------------------------
    {
      const page = await browser.newPage({ viewport: { width: 1500, height: 1000 }, reducedMotion: 'reduce' });
      await page.goto(`${server.url}/wargame/`, { waitUntil: 'load' });
      await page.waitForSelector('.unit');
      const before = await page.evaluate(COLLECT);
      await page.setViewportSize({ width: 1100, height: 780 });
      await page.waitForTimeout(150);
      const after = await page.evaluate(COLLECT);
      for (let i = 0; i < before.length; i++) {
        const a = before[i]!, b = after[i]!;
        const drift = Math.hypot(a.fx - b.fx, a.fy - b.fy);
        report.assert(
          drift < 0.006,
          `${a.name} drifted ${(drift * 100).toFixed(2)}% of the plate on resize — placement is not viewport-stable`,
        );
      }
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
    await server.close();
  }

  report.finish();
}

main();
