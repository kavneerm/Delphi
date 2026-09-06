// Everything that reads a file lives here, so there is exactly one place that
// knows the difference between "the engine has published this" and "we are still
// on the stub" (docs/COORDINATION.md #3).

export const ROOT = new URL('../../', import.meta.url);

const url = (p) => new URL(p, ROOT).href;

async function tryFetch(path) {
  try {
    const r = await fetch(url(path), { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

/** First path that exists wins. Returns { path, text } or null. */
export async function firstAvailable(paths) {
  for (const p of paths) {
    const text = await tryFetch(p);
    if (text !== null && text.trim() !== '') return { path: p, text };
  }
  return null;
}

export function parseJsonl(text) {
  const out = [];
  let n = 0;
  for (const line of text.split('\n')) {
    n += 1;
    const s = line.trim();
    if (!s) continue;
    try {
      out.push(JSON.parse(s));
    } catch (e) {
      throw new Error(`bad JSON on line ${n}: ${e.message}`);
    }
  }
  return out;
}

export async function loadRuns() {
  const res = await firstAvailable(['ui/data/runs.json']);
  if (!res) throw new Error('ui/data/runs.json missing');
  return JSON.parse(res.text).runs;
}

/**
 * Load one logged run. `path` is where the log lives; `fallback` is optional and
 * only there so a run can name an engine path that has not been published yet.
 * All three runs in ui/data/runs.json are real engine output.
 */
export async function loadRun(entry) {
  const paths = [entry.path, entry.fallback].filter(Boolean);
  const res = await firstAvailable(paths);
  if (!res) throw new Error(`no log found for ${entry.id} (tried ${paths.join(', ') || 'nothing'})`);
  return { lines: parseJsonl(res.text), source: res.path, isEngine: res.path.startsWith('engine/') };
}

/** The escalation ladder is data inside the frozen action contract, not ours. */
export async function loadLadder() {
  const res = await firstAvailable(['contracts/action_schema.json']);
  if (!res) throw new Error('contracts/action_schema.json missing');
  const schema = JSON.parse(res.text);
  const ladder = schema['x-action-ladder'];
  if (!Array.isArray(ladder)) throw new Error('contracts/action_schema.json has no x-action-ladder');
  return {
    rungs: [...ladder].sort((a, b) => a.rung - b.rung),
    version: schema['x-ladder-version'] ?? 'unknown',
    params: schema.$defs?.action_params?.properties ?? {},
  };
}

/** Minimal CSV reader: no quoted-comma support, which the eval outputs do not use. */
export function parseCsv(text) {
  const rows = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(',').map((c) => c.trim()));
  if (!rows.length) return { header: [], rows: [] };
  return { header: rows[0], rows: rows.slice(1) };
}

export async function loadHeatmap() {
  const res = await firstAvailable(['validation/heatmap.csv', 'ui/data/heatmap.csv']);
  if (!res) return null;
  return { ...parseCsv(res.text), path: res.path, real: res.path.startsWith('validation/') };
}

export async function loadFinalReport() {
  const res = await firstAvailable(['validation/final_report.md', 'ui/data/final_report.md']);
  if (!res) return null;
  return { text: res.text, path: res.path, real: res.path.startsWith('validation/') };
}
