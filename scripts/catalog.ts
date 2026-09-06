/**
 * catalog — assets.yaml and baseline_specs.yaml → engine/*.json
 *
 * The browser gets JSON, not YAML: the `yaml` package is a devDependency and never ships.
 * This runs first in `npm run build`, so the JSON the page bundles is always derived from
 * the YAML that was committed — there is no way to edit the JSON by hand and have it
 * survive a build.
 *
 * Only the parse happens here. Every structural check — unknown fields, dangling ids,
 * vocabulary — lives in engine/catalog.ts, where the browser and check:engine share it.
 * Doing validation in two places would let them disagree.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const ROOT = resolve(process.cwd());
const OUT = resolve(ROOT, 'engine');

function convert(input: string, output: string, describe: (v: unknown) => string): void {
  const text = readFileSync(resolve(ROOT, input), 'utf8');
  const value: unknown = parse(text);
  mkdirSync(OUT, { recursive: true });
  // Two-space indent so a diff of the generated file is readable in review. It is
  // committed alongside the YAML deliberately: the page must build without `yaml`
  // installed, and a reviewer should be able to see what the engine actually loads.
  writeFileSync(resolve(OUT, output), `${JSON.stringify(value, null, 2)}\n`);
  console.log(`  ${input} -> engine/${output}  (${describe(value)})`);
}

convert('assets.yaml', 'assets.json', (v) => {
  const c = v as Record<string, unknown[]>;
  const n = (k: string) => (Array.isArray(c[k]) ? c[k]!.length : 0);
  return `${n('satellites')} satellites, ${n('ground_sites')} ground sites, ${n('ships')} ships, ${n('aircraft')} aircraft`;
});

convert('baseline_specs.yaml', 'specs.json', (v) =>
  Array.isArray(v) ? `${v.length} seat specs` : 'NOT A LIST — engine/catalog.ts will refuse this',
);
