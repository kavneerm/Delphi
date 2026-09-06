/**
 * Check harness: a pass/fail reporter and a static server over dist/.
 *
 * Everything runs against the *built* site, never the dev server, so what is asserted is
 * what ships.
 */

import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

export const DIST = resolve(process.cwd(), 'dist');

export class Report {
  private failures: string[] = [];
  private count = 0;
  private readonly name: string;

  // A plain field, not a parameter property: Node runs these scripts by stripping types,
  // and a parameter property emits an assignment, so it is not type-only syntax.
  constructor(name: string) {
    this.name = name;
  }

  assert(ok: boolean, message: string): void {
    this.count++;
    if (!ok) this.failures.push(message);
  }

  /** Exits non-zero on any failure, so `npm run check` chains stop at the first bad gate. */
  finish(): never {
    const verdict = this.failures.length === 0 ? 'PASS' : 'FAIL';
    console.log(
      `${verdict}  ${this.name} — ${this.count} assertions, ${this.failures.length} failures`,
    );
    for (const f of this.failures) console.log(`  ✗ ${f}`);
    process.exit(this.failures.length === 0 ? 0 : 1);
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg',
};

export interface StaticServer {
  readonly url: string;
  close(): Promise<void>;
}

export async function serveDist(): Promise<StaticServer> {
  if (!existsSync(DIST)) {
    throw new Error(`no dist/ at ${DIST} — run \`npm run build\` first`);
  }

  const server: Server = createServer((req, res) => {
    // Strip the query and normalise before joining: a request for `/../package.json`
    // must not escape dist/, even from a local harness.
    const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/'));
    let file = join(DIST, path);
    if (!file.startsWith(DIST)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });

  // CHECK_PORT lets two suites run at once without fighting over a port.
  const port = Number(process.env['CHECK_PORT'] ?? 4310);
  await new Promise<void>((ok) => server.listen(port, '127.0.0.1', ok));

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}
