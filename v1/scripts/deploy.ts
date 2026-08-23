/**
 * Publish dist/ to the S3 bucket Terraform created, then invalidate the one file that
 * needs it.
 *
 * Two upload passes, not one, and the split is the whole point:
 *
 *   assets/*     fingerprinted by Vite, so the name changes whenever the bytes do.
 *                Cacheable forever — `immutable` tells the browser never to revalidate.
 *   index.html   the same name always, and it is what points at the new asset names.
 *                `no-cache` means revalidate every time, which is what makes a deploy
 *                take effect.
 *
 * Get this backwards and either the site is stale for a year or nothing caches at all.
 *
 * Only /index.html is invalidated. Invalidating /* would be waste — the asset names have
 * already changed, so nothing stale can be served under them.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Repo-level: the bucket and distribution outlive any one frontend.
const INFRA = resolve(process.cwd(), '..', 'infra');
const DIST = resolve(process.cwd(), 'dist');

function tf(output: string): string {
  return execFileSync('terraform', [`-chdir=${INFRA}`, 'output', '-raw', output], {
    encoding: 'utf8',
  }).trim();
}

function aws(args: string[]): void {
  console.log(`  aws ${args.join(' ')}`);
  execFileSync('aws', args, { stdio: 'inherit' });
}

if (!existsSync(DIST)) throw new Error('dist/ not found — run "npm run build" first');
if (!existsSync(resolve(INFRA, '.terraform'))) {
  throw new Error('infra/ not initialised — run "terraform -chdir=infra init" first');
}

const bucket = tf('bucket');
const distribution = tf('distribution_id');
const url = tf('url');

console.log(`deploying to s3://${bucket}`);

// Fingerprinted assets first, so index.html never points at something not yet uploaded.
aws([
  's3', 'sync', DIST, `s3://${bucket}`,
  '--delete',
  '--exclude', 'index.html',
  '--cache-control', 'public, max-age=31536000, immutable',
]);

aws([
  's3', 'sync', DIST, `s3://${bucket}`,
  '--exclude', '*',
  '--include', 'index.html',
  '--cache-control', 'no-cache',
  '--content-type', 'text/html; charset=utf-8',
]);

aws([
  'cloudfront', 'create-invalidation',
  '--distribution-id', distribution,
  '--paths', '/index.html', '/',
]);

console.log(`\ndone: ${url}`);
