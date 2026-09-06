// The Operations view's panels. Every one of these is a pure function of
// (snapshot, run) -> DOM, so scrubbing the timeline and playing forward take the
// same path and can never disagree.

import { h, fill } from './dom.js';
import { CHANNELS, SEAT_META, SEATS, fmtDur, fmtSim, seatColor } from './model.js';

const pct = (x) => `${Math.round(x * 100)}%`;

// ── persona cards ───────────────────────────────────────────────────────

export function renderPersonas(root, snap, run, { selected, onSelect } = {}) {
  const cards = SEATS.map((seat) => {
    const s = snap.seats[seat];
    const meta = SEAT_META[seat];
    const color = seatColor(seat);
    const spec = run.specs[seat];

    // The whole reason this card exists: how stale is this seat's picture?
    const age = s.lastDecisionAt === null ? null : snap.t - s.lastDecisionAt;
    const stale = age !== null && age > 3 * 3600;

    const b = s.beliefs;
    const per = b?.per_actor ?? {};
    const perTop = Object.entries(per)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3);

    return h(
      'article',
      {
        class: `pcard${stale ? ' stale' : ''}${selected === seat ? ' sel' : ''}`,
        style: { '--side': color },
        onclick: (e) => {
          if (e.detail === 2) e.currentTarget.classList.toggle('open');
          else onSelect?.(seat);
        },
        title: `${meta.role} — double-click for the full reasoning`,
      },
      h(
        'header',
        {},
        h('span', { class: 'name' }, meta.label),
        h('span', { class: 'spec' }, spec ?? seat),
        h(
          'span',
          { class: 'ago' },
          s.lastDecisionAt === null
            ? 'no decision yet'
            : [h('b', {}, `-${fmtDur(age)}`), ' ', fmtSim(s.lastDecisionAt).replace('T+', '')],
        ),
      ),
      b
        ? h(
            'div',
            {},
            h(
              'div',
              { class: 'belief', title: `hostile ${pct(b.hostile)} / natural ${pct(b.natural)} / unknown ${pct(b.unknown)}` },
              h('i', { class: 'h', style: { width: pct(b.hostile) } }),
              h('i', { class: 'n', style: { width: pct(b.natural) } }),
              h('i', { class: 'u', style: { width: pct(b.unknown) } }),
            ),
            h(
              'div',
              { class: 'belief-nums' },
              h('span', {}, 'hostile ', h('b', {}, b.hostile.toFixed(2))),
              h('span', {}, 'nat ', h('b', {}, b.natural.toFixed(2))),
              h('span', {}, 'unk ', h('b', {}, b.unknown.toFixed(2))),
            ),
          )
        : h(
            'div',
            { class: 'empty', style: { padding: '0' } },
            run.hasModelBeliefs
              ? 'no decision recorded yet'
              : 'beliefs not in this log — lake-record field',
          ),
      perTop.length
        ? h(
            'div',
            { class: 'per-actor' },
            perTop.map(([a, v]) => h('span', { title: 'conditional on hostile' }, `${a} ${v.toFixed(2)}`)),
          )
        : null,
      s.action
        ? h(
            'div',
            { class: 'pact' },
            h('span', { class: 'rung' }, s.action.type),
            s.blocked ? h('span', { class: 'blocked' }, '⊘ blocked') : null,
            h('span', { style: { color: 'var(--ink-faint)' } }, actionGist(s.action)),
          )
        : null,
      s.reasoning
        ? h('div', { class: 'reason' }, s.reasoning)
        : s.lastReleaseAsk
          ? h('div', { class: 'reason' }, s.lastReleaseAsk)
          : null,
    );
  });

  fill(root, cards);
}

function actionGist(action) {
  const p = action.params ?? {};
  const bits = [
    p.recipient && `→ ${p.recipient}`,
    p.attributed_actor && `names ${p.attributed_actor}`,
    p.confidence_stated !== undefined && `@${p.confidence_stated}`,
    p.target_asset_id && `vs ${p.target_asset_id}`,
    p.region && p.mode && `${p.mode} ${p.region}`,
    p.provider && p.capability && `${p.provider}/${p.capability}`,
    p.data_class,
    p.scope,
    p.standoff_km !== undefined && `${p.standoff_km}km`,
    p.delta_v_mps !== undefined && `Δv ${p.delta_v_mps}`,
  ].filter(Boolean);
  return bits.slice(0, 2).join(' ');
}

// ── escalation ladder ───────────────────────────────────────────────────

export function renderLadder(root, snap, run, ladder) {
  const byType = new Map();
  for (const hit of snap.ladderHits) {
    if (!byType.has(hit.type)) byType.set(hit.type, []);
    byType.get(hit.type).push(hit);
  }
  const maxHits = Math.max(1, ...[...byType.values()].map((v) => v.length));

  const rows = ladder.rungs.map((r) => {
    const hits = byType.get(r.type) ?? [];
    const heat = hits.length / maxHits;
    // Only the last few land as dots; the rest is carried by the heat wash so a
    // 150-action episode does not turn every rung into a solid bar.
    const recent = hits.slice(-14);
    return h(
      'div',
      {
        class: `lrow${hits.length ? ' hit' : ''}${r.irreversible ? ' irrev' : ''}`,
        style: { '--heat': hits.length ? `rgba(77,212,224,${(0.05 + heat * 0.16).toFixed(3)})` : 'transparent' },
        title: `${r.description}\n\nallowed: ${r.allowed_seats.join(', ')}${r.irreversible ? '\nIRREVERSIBLE' : ''}`,
      },
      h('span', { class: 'n' }, r.rung),
      h('span', { class: 'lbl' }, r.type.replace(/_/g, ' '), r.irreversible ? ' ⚠' : ''),
      h(
        'span',
        { class: 'hits' },
        recent.map((x) =>
          h('i', {
            class: `dot${x.blocked ? ' blocked' : ''}${snap.t - x.at < 1800 ? ' fresh' : ''}`,
            style: { '--c': seatColor(x.seat) },
            title: `${x.seat} @ ${fmtSim(x.at)}${x.blocked ? ' (blocked)' : ''}${x.human ? ' (human)' : ''}`,
          }),
        ),
        hits.length > recent.length
          ? h('span', { style: { color: 'var(--ink-faint)', fontSize: '.6rem', marginLeft: '3px' } }, `+${hits.length - recent.length}`)
          : null,
      ),
    );
  });

  fill(root, rows);
}

// ── in-progress actions and pending releases ────────────────────────────

export function renderInflight(root, snap) {
  if (!snap.inflight.length) {
    fill(root, h('div', { class: 'empty' }, 'nothing in deliberation'));
    return;
  }
  const rows = snap.inflight
    .sort((a, b) => a.to - b.to)
    .map((f) =>
      h(
        'div',
        { class: `ip${f.kind === 'release' ? ' release' : ''}` },
        h('span', { class: 'who' }, `${f.seat} · ${f.type}`),
        h('span', { class: 'eta' }, f.kind === 'release' ? `release +${fmtDur(f.to - snap.t)}` : `lands +${fmtDur(f.to - snap.t)}`),
        h(
          'span',
          { class: 'bar' },
          h('span', { style: { width: pct(Math.max(0, Math.min(1, f.progress))), '--c': seatColor(f.seat) } }),
        ),
      ),
    );
  fill(root, rows);
}

// ── channels with messages in transit ───────────────────────────────────

export function renderChannels(root, snap, run) {
  // Latency is the episode's own engine_params.channel_delay_minutes, read off
  // the config line, so the number beside the wire is the one that produced the
  // pips crawling along it.
  const latency = run?.channelDelayMinutes ?? {};
  const byChannel = new Map(CHANNELS.map((c) => [c, []]));
  for (const m of snap.inTransit) {
    if (!byChannel.has(m.channel)) byChannel.set(m.channel, []);
    byChannel.get(m.channel).push(m);
  }

  const rows = [...byChannel.entries()].map(([chan, msgs]) =>
    h(
      'div',
      { class: 'chan' },
      h('span', { class: 'cn' }, chan.replace(/_/g, ' ')),
      h(
        'span',
        { class: 'wire' },
        msgs.map((m) =>
          h('i', {
            class: `pip${m.lost ? ' drop' : ''}`,
            style: { left: pct(Math.max(0.02, Math.min(0.98, m.progress))), '--c': seatColor(m.from) },
            title: `${m.from} → ${m.to}${m.lost ? ` — DROPPED (${m.dropped})` : ''}\n${m.text.slice(0, 220)}`,
          }),
        ),
      ),
      h('span', { class: 'lat' }, latency[chan] === undefined ? '—' : `${latency[chan]}m`),
    ),
  );
  fill(root, rows);
}

// ── storm ───────────────────────────────────────────────────────────────

const SEV_BG = {
  quiet: 'var(--storm-quiet)',
  G1: 'var(--storm-g1)',
  G2: 'var(--storm-g2)',
  G3: 'var(--storm-g3)',
  G4: 'var(--storm-g4)',
  G5: 'var(--storm-g5)',
  carrington: 'var(--storm-carrington)',
};

export function renderStorm(els, snap) {
  const s = snap.storm;
  els.sev.textContent = s?.severity ?? '—';
  els.sev.style.background = SEV_BG[s?.severity ?? 'quiet'];
  els.sev.style.color = s && s.severity !== 'quiet' ? '#fff' : 'var(--ink-dim)';
  els.kp.textContent = s ? `Kp ${s.kp.toFixed(1)}` : 'Kp —';
  els.dst.textContent = s?.dst_nt !== undefined ? `Dst ${Math.round(s.dst_nt)} nT` : 'Dst —';
  els.profile.textContent = s?.profile ?? '';

  const setMeter = (meter, val, label) => {
    meter.firstElementChild.style.width = pct(val ?? 1);
    meter.classList.toggle('warn', val < 0.75 && val >= 0.5);
    meter.classList.toggle('bad', val < 0.5);
    label.textContent = val === undefined ? '—' : val.toFixed(2);
  };
  setMeter(els.mSensor, s?.sensor_confidence_multiplier, els.vSensor);
  setMeter(els.mComms, s?.comms_bandwidth_multiplier, els.vComms);

  els.fTrack.classList.toggle('on', !!s?.tracking_degraded);
  els.fScreen.classList.toggle('on', !!s?.screening_suspended);
}

const SEV_HEX = {
  quiet: '#2a3340',
  G1: '#3d5a3a',
  G2: '#6a6a32',
  G3: '#8a5a28',
  G4: '#a83e2c',
  G5: '#c22f3a',
  carrington: '#e01e5a',
};

/** The storm as a band under the panel, so severity has a shape over the episode. */
export function drawStormStrip(canvas, run, t) {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.max(2, r.width * dpr);
  canvas.height = Math.max(2, r.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);

  const steps = run.stormSteps();
  for (let i = 0; i < steps.length; i++) {
    const x0 = (steps[i].at / run.duration) * r.width;
    const x1 = ((steps[i + 1]?.at ?? run.duration) / run.duration) * r.width;
    ctx.fillStyle = SEV_HEX[steps[i].severity] ?? '#2a3340';
    ctx.fillRect(x0, 0, Math.max(1, x1 - x0), r.height);
  }
  const x = (t / run.duration) * r.width;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, r.height);
  ctx.stroke();
}
