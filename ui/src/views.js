// The three views that are not the live operations console: split-screen,
// clock-compare, and validation. All read-only, all pure functions of a run and
// a sim time.

import { fill, h, renderMarkdown } from './dom.js';
import { SEATS, SEAT_META, fmtDur, fmtSim, seatColor } from './model.js';

const pct = (x) => `${Math.round(x * 100)}%`;

// ── split screen ────────────────────────────────────────────────────────

/**
 * Two seats, one instant. The point of freezing is that the two panels are
 * guaranteed to be the same sim time and still disagree — different last
 * decision, different feed, different picture.
 */
export function renderSplitSide(root, run, seat, t) {
  const snap = run.snapshotAt(t);
  const s = snap.seats[seat];
  const meta = SEAT_META[seat];
  const view = run.filteredView(seat, t);
  const own = view.filter((l) => l.type === 'action' || l.type === 'human_action');
  const heard = view.filter((l) => l.type === 'message_delivered');
  const injects = view.filter((l) => l.type === 'inject');

  const age = s.lastDecisionAt === null ? null : t - s.lastDecisionAt;

  fill(
    root,
    h('h3', { style: { color: seatColor(seat) } }, meta.label),
    h('div', { class: 'sub' }, `${meta.role} · spec ${run.specs[seat] ?? '—'}`),

    h(
      'dl',
      { class: 'kv' },
      h('dt', {}, 'last decision'),
      h(
        'dd',
        { style: { color: age !== null && age > 3 * 3600 ? 'var(--warn)' : 'inherit' } },
        s.lastDecisionAt === null ? 'none' : `${fmtSim(s.lastDecisionAt)}  (${fmtDur(age)} stale)`,
      ),
      h('dt', {}, 'last action'),
      h('dd', {}, s.action ? `${s.action.type}${s.blocked ? '  ⊘ blocked' : ''}` : '—'),
      h('dt', {}, 'decisions'),
      h('dd', {}, String(s.decisions)),
      h('dt', {}, 'injects seen'),
      h('dd', {}, String(injects.length)),
      h('dt', {}, 'messages heard'),
      h('dd', {}, String(heard.length)),
      h('dt', {}, 'beliefs'),
      h(
        'dd',
        { style: { color: s.beliefs ? 'inherit' : 'var(--ink-faint)' } },
        s.beliefs
          ? `hostile ${s.beliefs.hostile.toFixed(2)} / natural ${s.beliefs.natural.toFixed(2)} / unknown ${s.beliefs.unknown.toFixed(2)}`
          : 'not in this log',
      ),
    ),

    s.lastReleaseAsk
      ? h('div', { class: 'inject' }, h('div', { class: 'c' }, s.lastReleaseAsk))
      : null,

    h('h3', { style: { fontSize: '.8rem', marginTop: '1rem' } }, 'What this seat could see'),
    h('div', { class: 'sub' }, 'its filtered view only — nothing another seat knows privately'),
    h(
      'div',
      { class: 'feed' },
      view.length === 0
        ? h('div', { class: 'empty' }, 'nothing yet')
        : view
            .slice(-40)
            .reverse()
            .map((l) => eventRow(l, run)),
    ),
  );
}

function eventRow(l, run) {
  const p = l.payload ?? {};
  let body;
  switch (l.type) {
    case 'inject':
      body = `${p.source ?? '?'} · ${p.content ?? ''}`;
      break;
    case 'message_delivered':
    case 'message_sent':
      body = `${p.from ?? l.seat} → ${p.message?.to} (${p.message?.channel}) ${p.message?.text ?? ''}`;
      break;
    case 'action':
    case 'human_action':
      body = `${p.action?.type}${p.blocked ? ' ⊘ blocked' : ''} ${paramGist(p.action?.params)}`;
      break;
    case 'release_requested':
      body = p.justification || `${l.seat} requests ${p.action?.type}`;
      break;
    case 'release_granted':
    case 'release_denied': {
      const r = run?.releases?.get(p.release_id);
      body = `${p.release_id}${r ? ` (${r.seat} · ${r.action?.type})` : ''} — by ${p.decided_by}`;
      break;
    }
    case 'storm_update':
      body = `${p.severity} · Kp ${p.kp} · sensor ×${p.sensor_confidence_multiplier} · comms ×${p.comms_bandwidth_multiplier}`;
      break;
    default:
      body = JSON.stringify(p).slice(0, 180);
  }
  return h(
    'div',
    { class: `ev t-${l.type}` },
    h('span', { class: 'ts' }, fmtSim(l.sim_time_s).replace('T+', '')),
    h('span', {}, h('span', { class: 'k' }, l.type.replace(/_/g, ' ')), ' ', body),
  );
}

function paramGist(params) {
  if (!params) return '';
  return Object.entries(params)
    .filter(([k]) => k !== 'purpose')
    .slice(0, 3)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
}

// ── clock compare ───────────────────────────────────────────────────────

/**
 * Same seed, same specs, two clocks. What the demo is trying to show is that
 * continuous scatters decisions and checkpoint bunches them, and that the seats'
 * pictures are equal at a checkpoint and unequal everywhere else.
 */
export function renderCompareSide(root, run, t, label) {
  const snap = run.snapshotAt(t);
  const decided = SEATS.map((s) => snap.seats[s].lastDecisionAt).filter((x) => x !== null);
  const spread = decided.length > 1 ? Math.max(...decided) - Math.min(...decided) : 0;
  const tempo = run.tempo(3600);
  const hour = Math.min(tempo.total.length - 1, Math.floor(t / 3600));

  fill(
    root,
    h('h3', {}, label),
    h(
      'div',
      { class: 'sub' },
      `${run.episodeId} · seed ${run.seed} · ${run.scenarioId ?? '—'} · release ${run.releasePolicy}`,
    ),

    h(
      'dl',
      { class: 'kv' },
      h('dt', {}, 'decisions so far'),
      h('dd', {}, String(SEATS.reduce((n, s) => n + snap.seats[s].decisions, 0))),
      h('dt', {}, 'this sim hour'),
      h('dd', {}, `${tempo.total[hour]} decisions`),
      h('dt', {}, 'checkpoints'),
      h('dd', {}, run.checkpoints.length ? String(run.checkpoints.filter((c) => c.sim_time_s <= t).length) : 'n/a — continuous'),
      // The headline number: how far apart the nine seats' pictures are right now.
      h('dt', { title: 'newest minus oldest last-decision time across the nine seats' }, 'seat spread'),
      h(
        'dd',
        { style: { color: spread > 3 * 3600 ? 'var(--warn)' : 'var(--ok)', fontWeight: 600 } },
        spread === 0 ? 'all aligned' : fmtDur(spread),
      ),
      h('dt', {}, 'releases pending'),
      h('dd', {}, String(snap.pendingReleases.length)),
      h('dt', {}, 'in deliberation'),
      h('dd', {}, String(snap.inflight.filter((f) => f.kind === 'action').length)),
    ),

    h('h3', { style: { fontSize: '.8rem', marginTop: '1rem' } }, 'Last decision, per seat'),
    h(
      'div',
      { class: 'feed' },
      SEATS.map((seat) => {
        const s = snap.seats[seat];
        const age = s.lastDecisionAt === null ? null : t - s.lastDecisionAt;
        return h(
          'div',
          { class: 'ev' },
          h('span', { class: 'ts', style: { color: seatColor(seat) } }, seat.slice(0, 10)),
          h(
            'span',
            {},
            s.lastDecisionAt === null
              ? h('span', { class: 'empty' }, 'no decision yet')
              : [
                  h('span', { class: 'k' }, fmtSim(s.lastDecisionAt).replace('T+', '')),
                  ' ',
                  h('span', { style: { color: age > 3 * 3600 ? 'var(--warn)' : 'var(--ink-dim)' } }, `−${fmtDur(age)}`),
                  ' · ',
                  s.action?.type ?? '—',
                ],
          ),
        );
      }),
    ),
  );
}

// ── validation ──────────────────────────────────────────────────────────

/**
 * Heatmap of the false-positive escalation rate: x storm severity, y Red type.
 * The CSV is agent6-eval's; this only insists on a first column of row labels and
 * numeric cells, so a column rename upstream does not break the view.
 */
export function drawHeatmap(canvas, hm, tip) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  const cols = hm.header.slice(1);
  const rows = hm.rows;
  const cw = 92;
  const ch = 34;
  const left = 150;
  const top = 46;
  const w = left + cols.length * cw + 16;
  const hgt = top + rows.length * ch + 26;

  canvas.style.width = `${w}px`;
  canvas.style.height = `${hgt}px`;
  canvas.width = w * dpr;
  canvas.height = hgt * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, hgt);

  const vals = rows.flatMap((r) => r.slice(1).map(Number)).filter((v) => Number.isFinite(v));
  const max = Math.max(0.0001, ...vals);

  ctx.font = '10px ui-monospace, Menlo, monospace';
  ctx.fillStyle = '#8695ab';
  ctx.textAlign = 'center';
  cols.forEach((c, i) => ctx.fillText(c, left + i * cw + cw / 2, top - 10));
  ctx.textAlign = 'left';
  ctx.fillText(hm.header[0], 4, top - 10);

  const cells = [];
  rows.forEach((r, ri) => {
    ctx.fillStyle = '#8695ab';
    ctx.textAlign = 'right';
    ctx.fillText(r[0], left - 10, top + ri * ch + ch / 2 + 3);
    r.slice(1).forEach((raw, ci) => {
      const v = Number(raw);
      const x = left + ci * cw;
      const y = top + ri * ch;
      const k = Number.isFinite(v) ? v / max : 0;
      // One hue, luminance carrying the value: a diverging scale would imply a
      // meaningful midpoint, and a false-positive rate has none.
      ctx.fillStyle = Number.isFinite(v)
        ? `rgba(255,95,82,${(0.08 + k * 0.82).toFixed(3)})`
        : '#11151c';
      ctx.fillRect(x + 1, y + 1, cw - 2, ch - 2);
      ctx.strokeStyle = '#0a0c10';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 1, y + 1, cw - 2, ch - 2);
      ctx.fillStyle = k > 0.55 ? '#fff' : '#c3ceda';
      ctx.textAlign = 'center';
      ctx.fillText(Number.isFinite(v) ? v.toFixed(3) : '—', x + cw / 2, y + ch / 2 + 3);
      cells.push({ x, y, w: cw, h: ch, row: r[0], col: cols[ci], v: raw });
    });
  });

  canvas.onmousemove = (e) => {
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const c = cells.find((q) => mx >= q.x && mx < q.x + q.w && my >= q.y && my < q.y + q.h);
    tip.textContent = c
      ? `${hm.header[0]}=${c.row} · ${c.col} → false-positive escalation ${c.v}`
      : 'storm severity × Red type';
  };
  canvas.onmouseleave = () => {
    tip.textContent = 'storm severity × Red type';
  };
}

export function renderValidation(els, hm, report) {
  if (hm) {
    drawHeatmap(els.canvas, hm, els.tip);
    els.note.textContent = hm.real
      ? `validation/heatmap.csv — ${hm.rows.length} rows × ${hm.header.length - 1} columns`
      : 'PLACEHOLDER — agent6-eval has not written validation/heatmap.csv yet. Shape is real, numbers are not.';
    els.note.style.color = hm.real ? 'var(--ok)' : 'var(--warn)';
  } else {
    els.note.textContent = 'no heatmap.csv found in validation/ or ui/data/';
  }

  if (report) {
    els.md.innerHTML = renderMarkdown(report.text);
    els.src.textContent = report.real
      ? `reading validation/final_report.md`
      : `PLACEHOLDER — validation/final_report.md does not exist yet`;
    els.src.style.color = report.real ? 'var(--ok)' : 'var(--warn)';
  } else {
    els.md.innerHTML = '';
    els.src.textContent = 'no final_report.md found';
  }
}
