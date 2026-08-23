/**
 * check:content — the argument survived the build.
 *
 * A site whose whole purpose is to state a position has one failure mode that matters: the
 * position gets mangled. Layout regressions are visible; a dropped clause in the middle of
 * a paragraph is not.
 *
 * The claims are read from `docs/copy-deck.md`, not held in an array here. That is the
 * point of the deck: the page and the check derive from one source. A check that keeps its
 * own copy of the text can drift alongside the page and still agree with it, which is
 * exactly the failure it was written to prevent.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DIST, Report } from './lib.ts';

const DECK = resolve(process.cwd(), 'docs/copy-deck.md');

/**
 * Inline tags are removed leaving no space; block tags become one. That is how a browser
 * renders them, and collapsing every tag to a space instead splits words at their own
 * emphasis: `of <em>if</em>, but` reads as `of if , but`, and the check then fails on
 * punctuation the page renders correctly.
 */
const INLINE = /<\/?(?:em|strong|span|i|b|a|code|abbr|small|sup|sub)(?:\s[^>]*)?>/gi;

function textOf(html: string): string {
  return norm(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(INLINE, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"'),
  );
}

function norm(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[—–]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every `>` block in the deck is one element on a page, and must appear verbatim.
 *
 * Consecutive `>` lines are one block: markdown wraps a long paragraph across lines, and
 * treating each line as its own claim would assert fragments the page never renders as
 * separate elements.
 *
 * Blocks are grouped by the `# Page: <path>` heading above them, so each page is asserted
 * against its own copy. Without the grouping the writing page's text would be required to
 * appear on the home page and vice versa.
 */
function claimsByPage(markdown: string): Map<string, string[]> {
  const pages = new Map<string, string[]>();
  let page: string | null = null;
  let current: string[] = [];

  const flush = (): void => {
    if (current.length > 0 && page !== null) {
      const text = norm(current.join(' '));
      if (text) pages.get(page)?.push(text);
    }
    current = [];
  };

  for (const line of markdown.split('\n')) {
    const header = /^# Page:\s*(\S+)/.exec(line);
    if (header?.[1]) {
      flush();
      page = header[1];
      if (!pages.has(page)) pages.set(page, []);
      continue;
    }
    if (line.startsWith('>')) current.push(line.slice(1).trim());
    else flush();
  }
  flush();
  return pages;
}

/** dist path for a page's URL: `/` -> index.html, `/writing/` -> writing/index.html. */
function fileFor(page: string): string {
  const trimmed = page.replace(/^\/+|\/+$/g, '');
  return trimmed === '' ? 'index.html' : `${trimmed}/index.html`;
}

/** Structural assertions that must hold on every page, not just the home page. */
function checkStructure(report: Report, page: string, html: string): void {
  const h1s = html.match(/<h1[\s>]/g) ?? [];
  report.assert(h1s.length === 1, `${page}: expected exactly one <h1>, found ${h1s.length}`);

  const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
  let skipped: string | null = null;
  for (let i = 1; i < levels.length; i++) {
    const prev = levels[i - 1] ?? 0;
    const here = levels[i] ?? 0;
    if (here > prev + 1) skipped = `h${prev} -> h${here}`;
  }
  report.assert(skipped === null, `${page}: heading level skipped: ${skipped}`);

  report.assert(/<html[^>]+lang="en"/.test(html), `${page}: no lang="en" on <html>`);
  report.assert(/<title>[^<]*Inevitable Frontier<\/title>/.test(html), `${page}: title missing`);
  report.assert(
    /<meta\s+name="description"\s+content="[^"]{80,}"/.test(html),
    `${page}: meta description missing or too short`,
  );
  report.assert(/class="skip"/.test(html), `${page}: skip link missing`);

  for (const [, id] of html.matchAll(/aria-labelledby="([^"]+)"/g)) {
    report.assert(
      new RegExp(`id="${id}"`).test(html),
      `${page}: aria-labelledby="${id}" has no matching element`,
    );
  }

  // No JavaScript at all. Every bug in the previous version came from the one script on
  // the page, and this is what keeps that decision from quietly eroding.
  report.assert(
    !/<script[\s>]/i.test(html),
    `${page}: ships a <script> — this site is meant to have none`,
  );

  // No external origins: no CDN fonts, no analytics, no third party able to observe who
  // reads this.
  const external = [...html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
  report.assert(external.length === 0, `${page}: external resource(s): ${external.join(', ')}`);
}

function main(): void {
  const report = new Report('content');
  const pages = claimsByPage(readFileSync(DECK, 'utf8'));

  // A deck that parsed to nothing would make every assertion below vacuous, and the check
  // would pass while asserting nothing at all.
  report.assert(pages.size >= 2, `only ${pages.size} page group(s) in the deck — format changed`);
  const total = [...pages.values()].reduce((n, c) => n + c.length, 0);
  report.assert(total >= 16, `only ${total} claims parsed from docs/copy-deck.md`);

  for (const [page, claims] of pages) {
    const file = join(DIST, fileFor(page));
    const html = readFileSync(file, 'utf8');
    const text = textOf(html);

    report.assert(claims.length > 0, `${page}: no copy in the deck for this page`);
    for (const claim of claims) {
      const short = claim.length > 60 ? `${claim.slice(0, 60)}…` : claim;
      report.assert(text.includes(claim), `${page}: deck text missing: "${short}"`);
    }

    checkStructure(report, page, html);
  }

  report.finish();
}

main();
