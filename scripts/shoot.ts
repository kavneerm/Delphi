/**
 * The shot harness (brief §6). Builds nothing — run `npm run build` first.
 *
 *   npm run shots                 all viewports, all checkpoints, plus the reduced pass
 *   npm run shots -- --p 0.25     only these checkpoints
 *   npm run shots -- --vp 1440x900
 *   npm run shots -- --no-reduced
 *   npm run shots -- --backdrop   also emit bd-* shots with the copy layer hidden
 *
 * Writes shots/{viewport}_{p}.png, shots/rm-{viewport}_act{n}.png and, with --backdrop,
 * shots/bd-{viewport}_{p}.png. The backdrop pass is what `probe contrast` must measure
 * against: a shot containing the glyphs reports the copy colour against itself.
 */

import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CHECKPOINTS, VIEWPORTS } from '../src/config.ts';
import { fmtP, gotoP, launch, openPage, serveDist, type ConsoleIssue } from './lib.ts';

const SHOTS = resolve(process.cwd(), 'shots');

function arg(name: string): string[] {
  const out: string[] = [];
  const argv = process.argv;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === `--${name}`) {
      const value = argv[i + 1];
      if (value && !value.startsWith('--')) out.push(value);
    }
  }
  return out;
}

const flag = (name: string): boolean => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const wantedP = arg('p').map(Number);
  const wantedVp = arg('vp');
  const checkpoints = wantedP.length > 0 ? wantedP : [...CHECKPOINTS];
  const viewports =
    wantedVp.length > 0 ? VIEWPORTS.filter((v) => wantedVp.includes(v.name)) : VIEWPORTS;

  if (viewports.length === 0) throw new Error(`no viewport matched ${wantedVp.join(', ')}`);

  rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });

  const server = await serveDist();
  const browser = await launch();
  const issues: { where: string; issue: ConsoleIssue }[] = [];
  let count = 0;

  try {
    for (const vp of viewports) {
      const { page, issues: pageIssues } = await openPage(browser, server.url, vp);
      for (const p of checkpoints) {
        await gotoP(page, p);
        await page.screenshot({ path: join(SHOTS, `${vp.name}_${fmtP(p)}.png`) });
        count += 1;
      }
      for (const issue of pageIssues) issues.push({ where: vp.name, issue });
      await page.context().close();
    }

    if (flag('backdrop')) {
      for (const vp of viewports) {
        const { page, issues: pageIssues } = await openPage(browser, server.url, vp, {
          query: '?nocopy=1',
        });
        for (const p of checkpoints) {
          await gotoP(page, p);
          await page.screenshot({ path: join(SHOTS, `bd-${vp.name}_${fmtP(p)}.png`) });
          count += 1;
        }
        for (const issue of pageIssues) issues.push({ where: `backdrop ${vp.name}`, issue });
        await page.context().close();
      }
    }

    if (!flag('no-reduced')) {
      for (const vp of viewports) {
        const { page, issues: pageIssues } = await openPage(browser, server.url, vp, {
          reducedMotion: 'reduce',
        });
        const sections = page.locator('.act-static');
        const total = await sections.count();
        for (let i = 0; i < total; i++) {
          await sections
            .nth(i)
            .screenshot({ path: join(SHOTS, `rm-${vp.name}_act${i}.png`) });
          count += 1;
        }
        await page.screenshot({
          path: join(SHOTS, `rm-${vp.name}_full.png`),
          fullPage: true,
        });
        count += 1;
        for (const issue of pageIssues) issues.push({ where: `rm ${vp.name}`, issue });
        await page.context().close();
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }

  console.log(`shots: ${count} written to ${SHOTS}`);
  console.log(
    `checkpoints: ${checkpoints.map(fmtP).join(' ')}  ×  ${viewports.map((v) => v.name).join(' ')}`,
  );

  if (issues.length > 0) {
    console.log(`\nconsole issues: ${issues.length}`);
    for (const { where, issue } of issues) console.log(`  [${where}] ${issue.kind}: ${issue.text}`);
    process.exit(1);
  }
  console.log('console: clean');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
