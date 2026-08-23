/**
 * Copy-deck consistency: the deck, the site, and the no-JS fallback say the same words.
 *
 * The argument exists in three places, and they are three because each has a real job:
 *
 *   docs/copy-deck.md   the canonical text, and the thing a client signs off on
 *   src/copy.ts         what the scroll page and the reduced-motion page render
 *   index.html          <noscript> — the whole argument with no JavaScript at all
 *
 * `index.html` even carries a comment saying "Copy is duplicated from src/copy.ts — if the
 * deck changes, change it here too", which is a comment asking a human to be perfect three
 * times in a row. This asserts it instead. A copyedit that reaches the site but not the
 * fallback is invisible in every other check in the tree: nothing renders `<noscript>`, so
 * nothing screenshots it, and it would sit wrong indefinitely.
 *
 * No browser. This is a string comparison and does not need one.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { BLOCKS } from '../src/copy.ts';
import { REPO, Report } from './lib.ts';

/**
 * Blocks whose text must appear verbatim in all three places.
 *
 * Excludes:
 *   act4-cta          the same words wrapped in different link markup in each place, by
 *                     design — the deck writes "[ Get involved ]", the site builds an
 *                     <a class="button">. Asserting those match would assert the markup,
 *                     not the copy.
 *   act1-scroll-cue   deliberately absent from both the deck and <noscript>: it is an
 *                     affordance for a scroll that neither of those has. Its *absence* is
 *                     asserted below, which is the claim worth making about it.
 */
const PROSE = new Set([
  'act1-h1',
  'act1-body',
  'act2-h2',
  'act2-body',
  'act3-h2',
  'act3-body',
  'act4-statement',
]);

const CUE_ID = 'act1-scroll-cue';

/** Markup or markdown -> the words, with whitespace collapsed so wrapping cannot matter. */
function words(source: string): string {
  return source
    .replace(/<[^>]*>/g, ' ')
    // Markdown blockquote markers, at line starts only.
    .replace(/^[ \t]*>[ \t]?/gm, ' ')
    .replace(/&rarr;/g, '→')
    .replace(/&middot;/g, '·')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function main(): void {
  const report = new Report('copy deck consistency');

  const root = process.cwd();
  // dist/, not the source: this asserts what actually ships. Vite rewrites index.html, and
  // the point of the check is the artifact.
  const html = readFileSync(resolve(root, 'dist/index.html'), 'utf8');
  // The deck is repo-level: it is the argument the site makes, not an artifact of how
  // this frontend renders it.
  const deck = readFileSync(resolve(REPO, 'docs/copy-deck.md'), 'utf8');

  // No early exit if this is missing: an absent <noscript> should fail *and* let every
  // per-block assertion below report too, so one run says exactly what is wrong rather
  // than surfacing the next problem only after the first is fixed.
  const noscript = words(/<noscript>([\s\S]*?)<\/noscript>/.exec(html)?.[1] ?? '');
  report.assert(
    noscript.length > 0,
    'dist/index.html has no <noscript> content — the no-JS route to the argument is gone',
  );

  const deckWords = words(deck);

  let checked = 0;
  for (const block of BLOCKS) {
    if (!PROSE.has(block.id)) continue;
    const text = words(block.html);
    checked += 1;

    report.assert(
      text.length > 0,
      `${block.id}: renders no text at all`,
    );
    report.assert(
      noscript.includes(text),
      `${block.id}: text is not in <noscript>. The site and the no-JS fallback disagree, ` +
        `and only the site is ever rendered by a check.\n      site: "${text}"`,
    );
    report.assert(
      deckWords.includes(text),
      `${block.id}: text is not in docs/copy-deck.md. The deck is the canonical copy and ` +
        `what the client signs off on; the site has drifted from it.\n      site: "${text}"`,
    );
  }

  report.assert(
    checked === PROSE.size,
    `expected ${PROSE.size} prose blocks, matched ${checked} — a block id in PROSE no longer ` +
      `exists in BLOCKS, so it is silently unchecked`,
  );

  // The cue is scroll-specific and must not have leaked into either static route.
  const cue = BLOCKS.find((b) => b.id === CUE_ID);
  report.assert(cue !== undefined, `${CUE_ID} is missing from BLOCKS`);
  if (cue) {
    const cueText = words(cue.html);
    report.assert(
      !noscript.includes(cueText),
      `${CUE_ID}: "${cueText}" appears in <noscript>, which has no pinned stage to scroll`,
    );
  }

  console.log(`${checked} prose blocks match across copy-deck.md, src/copy.ts and <noscript>`);
  report.finish();
}

main();
