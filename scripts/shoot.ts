/**
 * npm run shots — full-page renders of the built site into shots/.
 *
 * For eyes, not for gating. `check:layout` asserts what a screenshot cannot (contrast
 * ratios, overflow, off-origin requests); this is for judging whether the page is any
 * good, which no assertion can decide.
 *
 * With no JavaScript on the page there is nothing to drive and nothing to wait for — the
 * first paint is the finished page. The previous version had to scroll the whole document
 * and wait for reveal transitions to settle before a full-page capture was even correct.
 */

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { serveDist } from './lib.ts';

const SHOTS = resolve(process.cwd(), 'shots');

const FRAMES = [
  { name: 'desktop', width: 1440, height: 900, full: true, dark: false },
  { name: 'desktop-fold', width: 1440, height: 900, full: false, dark: false },
  { name: 'desktop-dark', width: 1440, height: 900, full: true, dark: true },
  { name: 'tablet', width: 768, height: 1024, full: true, dark: false },
  { name: 'mobile', width: 390, height: 844, full: true, dark: false },
  { name: 'mobile-fold', width: 390, height: 844, full: false, dark: false },
];

const server = await serveDist();
const browser = await chromium.launch();
mkdirSync(SHOTS, { recursive: true });

for (const frame of FRAMES) {
  const context = await browser.newContext({
    viewport: { width: frame.width, height: frame.height },
    colorScheme: frame.dark ? 'dark' : 'light',
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto(server.url, { waitUntil: 'networkidle' });
  await page.screenshot({ path: resolve(SHOTS, `${frame.name}.png`), fullPage: frame.full });
  console.log(`  ${frame.name}.png`);
  await context.close();
}

await browser.close();
await server.close();
