/**
 * A publish gate, not a build gate.
 *
 * The contact section ships a literal `[ADD EMAIL]` marker because no address exists yet.
 * That is fine to develop against and not fine to publish, so this runs in `npm run
 * deploy` and never in `npm run check`.
 *
 * The distinction matters: a check that is permanently red teaches everyone to ignore it,
 * and then it is worth nothing on the day it catches something real. `npm run check` stays
 * green and keeps its authority; deploying is what gets blocked.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { DIST } from './lib.ts';

const MARKERS = ['[ADD EMAIL]', 'ADD EMAIL', 'TODO', 'FIXME', 'lorem ipsum'];

function htmlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
    else if (extname(full) === '.html') out.push(full);
  }
  return out;
}

const found: string[] = [];
for (const file of htmlFiles(DIST)) {
  const text = readFileSync(file, 'utf8').toLowerCase();
  const hits: string[] = [];
  for (const marker of MARKERS) {
    if (!text.includes(marker.toLowerCase())) continue;
    // `ADD EMAIL` is inside `[ADD EMAIL]`, and reporting both makes one placeholder look
    // like two problems. Keep the most specific marker that matched.
    if (hits.some((h) => h.toLowerCase().includes(marker.toLowerCase()))) continue;
    hits.push(marker);
  }
  for (const hit of hits) found.push(`${file.replace(DIST, 'dist')}: ${hit}`);
}

if (found.length > 0) {
  console.log(`BLOCKED  ${found.length} placeholder(s) still in the build:`);
  for (const f of found) console.log(`  ✗ ${f}`);
  console.log('\nReplace the marker with real content, then deploy again.');
  process.exit(1);
}

console.log('PASS  no placeholders in dist/ — safe to publish');
