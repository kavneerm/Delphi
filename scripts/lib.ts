/**
 * Shared harness plumbing: a static server over dist/, a Chromium page wired to the
 * page's test hooks, and deterministic scroll positioning.
 *
 * Everything here runs against the *built* site, never the dev server, so what the
 * critic reviews is what ships.
 */

import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import '../src/hooks.ts';

export const DIST = resolve(process.cwd(), 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

export interface StaticServer {
  readonly url: string;
  close(): Promise<void>;
}

export async function serveDist(port = 4319): Promise<StaticServer> {
  if (!existsSync(DIST)) {
    throw new Error(`dist/ not found at ${DIST} — run "npm run build" first`);
  }

  const server: Server = createServer((req, res) => {
    const raw = (req.url ?? '/').split('?')[0] ?? '/';
    const rel = normalize(decodeURIComponent(raw)).replace(/^(\.\.[/\\])+/, '');
    let file = join(DIST, rel);
    if (!file.startsWith(DIST)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) file = join(DIST, 'index.html');

    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(res);
  });

  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', done);
  });

  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((done) => {
        server.close(() => done());
      }),
  };
}

export interface ConsoleIssue {
  readonly kind: 'error' | 'pageerror';
  readonly text: string;
}

export interface OpenPageResult {
  readonly page: Page;
  readonly issues: ConsoleIssue[];
}

export async function openPage(
  browser: Browser,
  url: string,
  viewport: { width: number; height: number },
  options: { reducedMotion?: 'reduce' | 'no-preference'; query?: string } = {},
): Promise<OpenPageResult> {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    reducedMotion: options.reducedMotion ?? 'no-preference',
  });
  const page = await context.newPage();
  const issues: ConsoleIssue[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') issues.push({ kind: 'error', text: msg.text() });
  });
  page.on('pageerror', (err) => issues.push({ kind: 'pageerror', text: String(err) }));

  await page.goto(`${url}/${options.query ?? ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__frontier?.ready === true, null, {
    timeout: 15_000,
  });
  return { page, issues };
}

/**
 * Park the page at an exact master progress.
 *
 * Slot 0 updates at 12fps from its own accumulator (one period ≈ 83ms) and is skipped
 * entirely on non-tick frames, so a measurement taken too early reads its previous
 * transform — or, at the first checkpoint after load, its initial identity. Wait two full
 * periods plus margin so the reading is of a settled frame rather than of a race.
 */
export async function gotoP(page: Page, p: number): Promise<void> {
  await page.evaluate((value) => window.__frontier?.goto(value), p);
  await page.waitForTimeout(220);
}

export async function launch(): Promise<Browser> {
  return chromium.launch({ args: ['--force-color-profile=srgb', '--font-render-hinting=none'] });
}

export function fmtP(p: number): string {
  return p.toFixed(2);
}

export interface Matrix {
  readonly x: number;
  readonly y: number;
}

/** Parse a computed `transform` into its translation. Handles matrix() and matrix3d(). */
export function translation(transform: string): Matrix {
  if (!transform || transform === 'none') return { x: 0, y: 0 };
  const values = transform
    .slice(transform.indexOf('(') + 1, transform.lastIndexOf(')'))
    .split(',')
    .map((v) => Number(v.trim()));
  if (transform.startsWith('matrix3d')) {
    return { x: values[12] ?? 0, y: values[13] ?? 0 };
  }
  return { x: values[4] ?? 0, y: values[5] ?? 0 };
}

export class Report {
  private readonly failures: string[] = [];
  private readonly title: string;
  private checks = 0;

  constructor(title: string) {
    this.title = title;
  }

  assert(condition: boolean, message: string): void {
    this.checks += 1;
    if (!condition) this.failures.push(message);
  }

  get failed(): boolean {
    return this.failures.length > 0;
  }

  finish(): never {
    const line = '─'.repeat(64);
    console.log(line);
    if (this.failures.length === 0) {
      console.log(`PASS  ${this.title} — ${this.checks} assertions, 0 failures`);
      console.log(line);
      process.exit(0);
    }
    console.log(`FAIL  ${this.title} — ${this.checks} assertions, ${this.failures.length} failures`);
    for (const f of this.failures.slice(0, 40)) console.log(`  ✗ ${f}`);
    if (this.failures.length > 40) {
      console.log(`  … and ${this.failures.length - 40} more`);
    }
    console.log(line);
    process.exit(1);
  }
}
