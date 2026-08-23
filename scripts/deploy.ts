/**
 * Publish dist/ to the S3 bucket Terraform created, then invalidate what needs it.
 *
 * Two upload passes, and the split is the whole point:
 *
 *   assets/*     fingerprinted by Vite, so the name changes whenever the bytes do.
 *                Cacheable forever — `immutable` tells the browser never to revalidate.
 *   *.html       the same names always, and they point at the new asset names.
 *                `no-cache` means revalidate every time, which is what makes a deploy
 *                take effect.
 *
 * Get this backwards and either the site is stale for a year or nothing caches at all.
 *
 * Only the HTML paths are invalidated. Invalidating /* would be waste — asset names have
 * already changed, so nothing stale can be served under them.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { DIST } from './lib.ts';

const INFRA = resolve(process.cwd(), 'infra');

function tf(output: string): string {
  return execFileSync('terraform', [`-chdir=${INFRA}`, 'output', '-raw', output], {
    encoding: 'utf8',
  }).trim();
}

function aws(args: string[]): void {
  console.log(`  aws ${args.join(' ')}`);
  execFileSync('aws', args, { stdio: 'inherit' });
}

/**
 * Every HTML path in the build, as the URLs CloudFront serves them under.
 *
 * Derived from dist/ rather than hardcoded: a page added to vite.config.ts would otherwise
 * be uploaded but never invalidated, and would serve stale for as long as the edge cached
 * it — a failure that looks exactly like "the deploy didn't work" with no error anywhere.
 *
 * Both forms are invalidated for a directory index. The viewer-request function rewrites
 * `/writing/` to `/writing/index.html` *before* the cache lookup, so the cached object is
 * keyed on the rewritten path — but `/writing/` is what a browser requests, and a stale
 * entry under either key would serve the old page.
 */
function htmlPaths(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...htmlPaths(full));
      continue;
    }
    if (extname(full) !== '.html') continue;
    const rel = relative(DIST, full).split('\\').join('/');
    out.push(`/${rel}`);
    if (rel === 'index.html') out.push('/');
    else if (rel.endsWith('/index.html')) out.push(`/${rel.slice(0, -'index.html'.length)}`);
  }
  return out;
}

if (!existsSync(DIST)) throw new Error('dist/ not found — run "npm run build" first');
if (!existsSync(resolve(INFRA, '.terraform'))) {
  throw new Error('infra/ not initialised — run "terraform -chdir=infra init" first');
}

const bucket = tf('bucket');
const distribution = tf('distribution_id');
const url = tf('url');

console.log(`deploying to s3://${bucket}`);

// Fingerprinted assets first, so no HTML ever points at something not yet uploaded.
aws([
  's3', 'sync', DIST, `s3://${bucket}`,
  '--delete',
  '--exclude', '*.html',
  '--cache-control', 'public, max-age=31536000, immutable',
]);

aws([
  's3', 'sync', DIST, `s3://${bucket}`,
  '--exclude', '*',
  '--include', '*.html',
  '--cache-control', 'no-cache',
  '--content-type', 'text/html; charset=utf-8',
]);

const paths = htmlPaths(DIST).sort();
console.log(`invalidating ${paths.length} path(s): ${paths.join(' ')}`);
aws(['cloudfront', 'create-invalidation', '--distribution-id', distribution, '--paths', ...paths]);

console.log(`\ndone — ${url}`);
