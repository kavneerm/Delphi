// The scrubbable timeline and the decisions-per-sim-hour tempo strip above it.
// One canvas each, both drawn from the same run so their x axes always agree.

import { SEATS, fmtSim, seatColor } from './model.js';

function setup(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.max(2, Math.round(r.width * dpr));
  canvas.height = Math.max(2, Math.round(r.height * dpr));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  return { ctx, w: r.width, hgt: r.height };
}

/**
 * Decision tempo. Stacked by seat so a burst reads as "who woke up", not just
 * "something happened" — which is the difference between the two clock modes.
 */
export function drawTempo(canvas, run, t) {
  const { ctx, w, hgt } = setup(canvas);
  const tempo = run.tempo(3600);
  const n = tempo.total.length;
  const bw = w / n;

  for (let i = 0; i < n; i++) {
    let y = hgt - 1;
    for (const seat of SEATS) {
      const c = tempo.bySeat[seat][i];
      if (!c) continue;
      const hh = (c / tempo.peak) * (hgt - 3);
      ctx.fillStyle = seatColor(seat);
      ctx.globalAlpha = i * 3600 <= t ? 0.9 : 0.28;
      ctx.fillRect(i * bw, y - hh, Math.max(1, bw - 0.6), hh);
      y -= hh;
    }
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = '#232b38';
  ctx.beginPath();
  ctx.moveTo(0, hgt - 0.5);
  ctx.lineTo(w, hgt - 0.5);
  ctx.stroke();

  ctx.fillStyle = '#56637a';
  ctx.font = '9px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(`peak ${tempo.peak} decisions/h`, 3, 9);

  const x = (t / run.duration) * w;
  ctx.strokeStyle = '#ffffff88';
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, hgt);
  ctx.stroke();
}

const MARK = {
  inject: { y: 0.18, c: '#e8a33d', r: 2.6 },
  release_requested: { y: 0.5, c: '#ff5f52', r: 3.2 },
  release_granted: { y: 0.5, c: '#5cc98a', r: 2.4 },
  release_denied: { y: 0.5, c: '#ff5f52', r: 2.4 },
  human_action: { y: 0.5, c: '#4dd4e0', r: 3 },
  checkpoint: { y: 0.82, c: '#56637a', r: 1.8 },
  attribution_revealed: { y: 0.5, c: '#d9b45c', r: 3.4 },
};

/** Scrubbable episode timeline: injects, releases, checkpoints, hour ticks. */
export function drawTimeline(canvas, run, t) {
  const { ctx, w, hgt } = setup(canvas);

  ctx.fillStyle = '#0d1015';
  ctx.fillRect(0, 0, w, hgt);

  // Hour grid, labelled every six hours.
  ctx.strokeStyle = '#1a2129';
  ctx.fillStyle = '#3c4757';
  ctx.font = '9px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  const hours = run.duration / 3600;
  for (let hh = 0; hh <= hours; hh += 1) {
    const x = ((hh * 3600) / run.duration) * w;
    const major = hh % 6 === 0;
    ctx.beginPath();
    ctx.moveTo(x, hgt - (major ? 8 : 4));
    ctx.lineTo(x, hgt);
    ctx.strokeStyle = major ? '#2a3442' : '#1a2129';
    ctx.stroke();
    if (major && hh < hours) ctx.fillText(`${hh}h`, x, hgt - 10);
  }

  // Played portion.
  const px = (t / run.duration) * w;
  ctx.fillStyle = '#4dd4e00e';
  ctx.fillRect(0, 0, px, hgt);

  for (const l of run.lines) {
    const m = MARK[l.type];
    if (!m) continue;
    const x = (l.sim_time_s / run.duration) * w;
    ctx.globalAlpha = l.sim_time_s <= t ? 1 : 0.32;
    ctx.fillStyle = m.c;
    ctx.beginPath();
    ctx.arc(x, hgt * m.y, m.r, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px, 0);
  ctx.lineTo(px, hgt);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(px, 0);
  ctx.lineTo(px - 4, -0);
  ctx.lineTo(px, 5);
  ctx.lineTo(px + 4, 0);
  ctx.closePath();
  ctx.fill();
}

/** Click/drag anywhere on either canvas maps x back to sim time. */
export function attachScrub(canvas, run, onSeek) {
  let dragging = false;
  const toT = (ev) => {
    const r = canvas.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    return frac * run().duration;
  };
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    onSeek(toT(e));
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) onSeek(toT(e));
  });
  canvas.addEventListener('pointerup', () => {
    dragging = false;
  });
  canvas.addEventListener('pointercancel', () => {
    dragging = false;
  });
}

export function timelineReadout(run, t) {
  const tempo = run.tempo(3600);
  const b = Math.min(tempo.total.length - 1, Math.floor(t / 3600));
  return `${fmtSim(t)} · hour ${b} · ${tempo.total[b]} decisions this sim hour · ${run.indexAt(t)}/${run.lines.length} events`;
}
