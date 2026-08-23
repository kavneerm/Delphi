/**
 * Reference matching — turns "does this look like the references" into a number.
 *
 *   npm run refstats -- envelope     re-derive docs/reference-envelope.json from
 *                                    "Object Reference/". macOS only (uses sips to
 *                                    decode JPEG/WEBP); run rarely, the JSON is committed.
 *   npm run refstats -- measure <png…>   ad-hoc measurement of any PNGs
 *   npm run check:refmatch           measure the built site against the envelope
 *
 * Why an envelope rather than a single target: the client supplied two distinct groups of
 * references. "Act 1" is a dense western street — fine detail, deep palette. "Act 2" is a
 * silhouette city — large flat masses, separated values. Holding Act II to the Act 1
 * numbers would be measuring the wrong thing. Each group's bound is taken from its
 * *least* demanding member, so passing means "at least as good as the weakest reference
 * for this kind of scene", never "as good as the best".
 *
 * The check shoots with ?nocopy=1. A shot containing the copy layer measures anti-aliased
 * typography — hundreds of colours and a great deal of sub-2px detail — and would report
 * the art as far richer than it is. This is the same trap documented for `probe contrast`
 * in docs/review-checklist.md §5, in a different disguise.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { VIEWPORTS } from '../src/config.ts';
import { ACT_HOLD_P } from '../src/timeline.ts';
import { ACTS } from '../src/acts/index.ts';
import { REPO, Report, fmtP, gotoP, launch, openPage, serveDist } from './lib.ts';
import { ART_SCALE } from '../src/config.ts';
import { artStats, decodePng, type ArtStats } from './pixels.ts';

// Repo-level, not frontend-level: the reference art and the envelope derived from it are
// what any implementation is measured against, so they sit above `v1/`.
const REFERENCE_DIR = join(REPO, 'Object Reference');
const ENVELOPE_PATH = join(REPO, 'docs', 'reference-envelope.json');

/**
 * Which reference group each act is held to. Acts I and IV are the frontier — the western
 * street references. Acts II and III are cities, which is what the Act 2 references are.
 */
const ACT_GROUP: readonly string[] = ['Act 1', 'Act 2', 'Act 2', 'Act 1'];

interface Bound {
  /** Coarsest acceptable 25th-percentile run, as a fraction of frame width. */
  readonly maxRunP25Frac: number;
  /** Reported, not gated — see the note below. */
  readonly refPal99: number;
  /** Least acceptable share of pixels in <=2 art-pixel runs. */
  readonly minFinePct: number;
  readonly from: readonly string[];
}

/**
 * Palette depth is REPORTED, not gated, and this was a mistake to begin with.
 *
 * The references are JPEG and WEBP; our frames are clean PNG from an indexed buffer with
 * no compression noise at all. Measured: one identical frame reads **pal99 77 as a PNG and
 * 203 after a JPEG round-trip**. The reference target of 188 is therefore mostly ringing
 * around the artist's real tones, not tones — and on the references' own footing our render
 * already clears it.
 *
 * It was quoted as "the real distance to the target" for several turns before being
 * checked. The honest position is that the artist's true palette count is not recoverable
 * from a lossy source, so it cannot be a gate. It stays on every report line, next to the
 * reference figure, so the trend is still visible.
 *
 * Value structure is reported for a different reason: the reference set is too varied to
 * bound (a two-band bright-sky silhouette and a night scene with 84% of its frame in one).
 * Any threshold tight enough to fail our Act II fails two references.
 */

/**
 * Value structure is REPORTED, not gated, and that is deliberate.
 *
 * Act II's collapsed values (85% of the frame in the darkest band, against the Act 2
 * reference's 59/27 dark-to-bright split) is a real finding, but this reference set
 * cannot express it as a bound: the references range from a bright-sky silhouette using
 * two well-separated bands to a night scene with 84% of its frame in one. Any threshold
 * tight enough to fail our Act II would fail two of the seven references.
 *
 * Picking a number because it happens to catch the frame we already know is wrong is the
 * tolerance-fitting failure of docs/review-checklist.md §1, run in reverse. So the bands
 * are printed on every run and Act II's value structure is an explicit art requirement
 * (docs/plans/pixel-substrate.md P5), graded by a critic rather than by a threshold.
 */

interface Envelope {
  readonly generated: string;
  readonly note: string;
  readonly groups: Record<string, Bound>;
}

function decode(path: string): ReturnType<typeof decodePng> {
  return decodePng(new Uint8Array(readFileSync(path)));
}

function line(label: string, s: ArtStats): string {
  return (
    `${label.padEnd(34)} ${String(s.width).padStart(4)}x${String(s.height).padEnd(4)}` +
    `  fine ${s.finePct.toFixed(1).padStart(5)}%` +
    `  runP25 ${String(s.runP25).padStart(3)} (${(s.runP25Frac * 100).toFixed(2).padStart(5)}% of w)` +
    `  pal99 ${String(s.pal99).padStart(4)}` +
    `  bands ${s.bandsUsed}/8`
  );
}

/** Decode the client's JPEG/WEBP references to PNG so our own decoder can read them. */
function referencePngs(): { group: string; name: string; path: string }[] {
  const out: { group: string; name: string; path: string }[] = [];
  const tmp = mkdtempSync(join(tmpdir(), 'refstats-'));
  for (const group of readdirSync(REFERENCE_DIR)) {
    let files: string[];
    try {
      files = readdirSync(join(REFERENCE_DIR, group));
    } catch {
      continue; // not a directory (.DS_Store)
    }
    for (const file of files) {
      if (!/\.(png|jpe?g|webp)$/i.test(file)) continue;
      const src = join(REFERENCE_DIR, group, file);
      const dst = join(tmp, `${group}__${file}`.replace(/[^\w.]+/g, '_') + '.png');
      execFileSync('sips', ['-s', 'format', 'png', src, '--out', dst], { stdio: 'ignore' });
      out.push({ group, name: basename(file).replace(/\.[^.]+$/, ''), path: dst });
    }
  }
  return out;
}

function buildEnvelope(): void {
  const refs = referencePngs();
  if (refs.length === 0) throw new Error(`no reference images under ${REFERENCE_DIR}`);

  const byGroup = new Map<string, { name: string; stats: ArtStats }[]>();
  for (const ref of refs) {
    const stats = artStats(decode(ref.path));
    console.log(line(`${ref.group}/${ref.name}`, stats));
    const list = byGroup.get(ref.group) ?? [];
    list.push({ name: ref.name, stats });
    byGroup.set(ref.group, list);
  }

  const groups: Record<string, Bound> = {};
  for (const [group, entries] of byGroup) {
    groups[group] = {
      maxRunP25Frac: Math.max(...entries.map((e) => e.stats.runP25Frac)),
      refPal99: Math.min(...entries.map((e) => e.stats.pal99)),
      minFinePct: Math.min(...entries.map((e) => e.stats.finePct)),
      from: entries.map((e) => e.name).sort(),
    };
  }

  const envelope: Envelope = {
    generated: 'npm run refstats -- envelope',
    note:
      'Bounds are the least demanding member of each group. Reference sources are ' +
      'JPEG/WEBP, so compression inflates pal99 and finePct somewhat — see the caveat on ' +
      'artStats() in scripts/pixels.ts.',
    groups,
  };
  writeFileSync(ENVELOPE_PATH, `${JSON.stringify(envelope, null, 2)}\n`);
  console.log(`\nwrote ${ENVELOPE_PATH}`);
  for (const [group, bound] of Object.entries(groups)) {
    console.log(
      `  ${group.padEnd(6)} runP25 <= ${(bound.maxRunP25Frac * 100).toFixed(2)}% of width, ` +
        `fine >= ${bound.minFinePct.toFixed(1)}%  (ref pal99 ${bound.refPal99}, reported only)`,
    );
  }
}

function loadEnvelope(): Envelope {
  try {
    return JSON.parse(readFileSync(ENVELOPE_PATH, 'utf8')) as Envelope;
  } catch {
    throw new Error(
      `${ENVELOPE_PATH} missing — run "npm run refstats -- envelope" (macOS) to generate it`,
    );
  }
}

async function check(): Promise<void> {
  const envelope = loadEnvelope();
  const report = new Report('reference match');
  const server = await serveDist();
  const browser = await launch();

  try {
    for (const vp of VIEWPORTS) {
      // ?nocopy=1: measure the art, not the typography. See the header note.
      const { page } = await openPage(browser, server.url, vp, { query: '?nocopy=1' });

      for (const [act, p] of ACT_HOLD_P.entries()) {
        const group = ACT_GROUP[act] ?? 'Act 1';
        const bound = envelope.groups[group];
        const name = ACTS[act]?.name ?? `act ${act}`;
        const where = `${vp.name} ${name} (p=${fmtP(p)}, vs ${group})`;

        report.assert(bound !== undefined, `${where}: no envelope for group "${group}"`);
        if (!bound) continue;

        await gotoP(page, p);
        // Our frames are ART_SCALE device pixels per art pixel; the references are 1:1.
        const stats = artStats(decodePng(await page.screenshot()), ART_SCALE);
        console.log(line(`${vp.name} ${name}`, stats));

        report.assert(
          stats.runP25Frac <= bound.maxRunP25Frac,
          `${where}: detail too coarse — runP25 is ${(stats.runP25Frac * 100).toFixed(2)}% of width, ` +
            `want <= ${(bound.maxRunP25Frac * 100).toFixed(2)}%`,
        );
        report.assert(
          stats.finePct >= bound.minFinePct,
          `${where}: too little fine detail — ${stats.finePct.toFixed(1)}% of pixels in <=2px runs, ` +
            `want >= ${bound.minFinePct.toFixed(1)}%`,
        );
        // Reported, never asserted — see the note on Bound.
        console.log(
          `${''.padEnd(34)}   palette ${stats.pal99} (ref ${bound.refPal99}, JPEG-inflated)  ` +
            `values ${stats.bandsUsed}/8 bands  ` +
            `[${stats.bands.map((b) => b.toFixed(0).padStart(2)).join(' ')}]  ` +
            `largest ${Math.max(...stats.bands).toFixed(0)}%`,
        );
      }

      await page.context().close();
    }
  } finally {
    await browser.close();
    await server.close();
  }

  report.finish();
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  switch (command) {
    case 'envelope':
      buildEnvelope();
      break;

    case 'measure': {
      if (rest.length === 0) throw new Error('usage: refstats measure <png…>');
      for (const path of rest) console.log(line(basename(path), artStats(decode(path))));
      break;
    }

    case 'check':
      await check();
      break;

    default:
      console.log(
        [
          'usage: npm run refstats -- <command>',
          '',
          '  envelope          re-derive docs/reference-envelope.json (macOS: uses sips)',
          '  measure <png…>    measure arbitrary PNGs',
          '  check             measure the built site against the envelope',
        ].join('\n'),
      );
      process.exit(command ? 1 : 0);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
