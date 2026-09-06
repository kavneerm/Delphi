// Ground-track map, north-polar. The storm severity is painted onto the map as
// an auroral-oval overlay rather than sitting in a separate widget, because what
// the storm actually does in this scenario is degrade the picture over exactly
// that band of latitudes.

import { groundTrack, makeProjection, subpoint } from './orbits.js';
import { seatColor, STORM_ORDER } from './model.js';

const STORM_TINT = {
  quiet: null,
  G1: 'rgba(90,190,120,0.10)',
  G2: 'rgba(200,190,80,0.13)',
  G3: 'rgba(220,150,60,0.16)',
  G4: 'rgba(225,80,60,0.20)',
  G5: 'rgba(235,50,70,0.24)',
  carrington: 'rgba(255,30,110,0.30)',
};

// Equatorward edge of the auroral oval, roughly, per severity. The overlay grows
// south as the storm strengthens, which is the visual the demo needs.
const OVAL_LAT = { quiet: 72, G1: 68, G2: 65, G3: 61, G4: 57, G5: 53, carrington: 48 };

export class GroundMap {
  constructor(canvas, geo) {
    this.canvas = canvas;
    this.geo = geo;
    this.ctx = canvas.getContext('2d');
    this.latMin = 45;
    this.trail = new Map();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(2, Math.round(r.width * dpr));
    this.canvas.height = Math.max(2, Math.round(r.height * dpr));
    this.w = r.width;
    this.h = r.height;
    this.dpr = dpr;
  }

  draw(t, snap) {
    if (!this.w) this.resize();
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    const p = makeProjection({ w: this.w, h: this.h, latMin: this.latMin, lon0: 20, pad: 10 });
    this.proj = p;

    ctx.save();
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, p.R, 0, 2 * Math.PI);
    ctx.clip();

    ctx.fillStyle = '#0b1016';
    ctx.fillRect(0, 0, this.w, this.h);

    this._graticule(ctx, p);
    this._storm(ctx, p, snap?.storm);
    this._coast(ctx, p);
    this._stations(ctx, p, snap);
    this._tracks(ctx, p, t, snap);

    ctx.restore();

    // Frame
    ctx.strokeStyle = '#232b38';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, p.R, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.fillStyle = '#56637a';
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${this.latMin}°N`, p.cx, p.cy - p.R - 2);
  }

  _graticule(ctx, p) {
    ctx.strokeStyle = '#18202b';
    ctx.lineWidth = 1;
    for (const lat of [50, 60, 70, 80]) {
      const r = (p.R * (90 - lat)) / (90 - p.latMin);
      ctx.beginPath();
      ctx.arc(p.cx, p.cy, r, 0, 2 * Math.PI);
      ctx.stroke();
    }
    for (let lon = -180; lon < 180; lon += 30) {
      const [x0, y0] = p.project(90, lon);
      const [x1, y1] = p.project(p.latMin, lon);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    ctx.fillStyle = '#2c3644';
    ctx.font = '9px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    for (const lat of [60, 70, 80]) {
      const [x, y] = p.project(lat, 20);
      ctx.fillText(`${lat}`, x, y - 2);
    }
  }

  _storm(ctx, p, storm) {
    if (!storm) return;
    const sev = storm.severity ?? 'quiet';
    const tint = STORM_TINT[sev];
    if (!tint) return;
    const edge = OVAL_LAT[sev] ?? 70;
    const rOuter = (p.R * (90 - edge)) / (90 - p.latMin);
    const rInner = (p.R * (90 - Math.min(88, edge + 16))) / (90 - p.latMin);
    const g = ctx.createRadialGradient(p.cx, p.cy, rInner, p.cx, p.cy, rOuter);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.45, tint);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.cx, p.cy, rOuter, 0, 2 * Math.PI);
    ctx.fill();

    if (storm.screening_suspended) {
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = 'rgba(255,95,82,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.cx, p.cy, rOuter, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  _coast(ctx, p) {
    ctx.strokeStyle = '#33404f';
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';
    for (const [name, line] of Object.entries(this.geo.coast)) {
      const key = name;
      ctx.beginPath();
      let pen = false;
      for (const [lon, lat] of line) {
        if (lat < p.latMin - 4) {
          pen = false;
          continue;
        }
        const [x, y] = p.project(lat, lon);
        if (!pen) {
          ctx.moveTo(x, y);
          pen = true;
        } else ctx.lineTo(x, y);
      }
      // The islands that carry the scenario read brighter than the context.
      ctx.strokeStyle = /spitsbergen|nordaustlandet|edgeoya|novaya|franz|bear/.test(key)
        ? '#4a5c72'
        : '#2b3644';
      ctx.stroke();
    }
  }

  _stations(ctx, p, snap) {
    ctx.font = '9px ui-monospace, Menlo, monospace';
    for (const s of this.geo.stations) {
      if (s.lat < p.latMin) continue;
      const [x, y] = p.project(s.lat, s.lon);
      const c = seatColor(s.owner);
      // A downlink outage recorded in the log turns its station red.
      const degraded = (snap?.stateChanges ?? []).some(
        (l) =>
          l.payload.what?.includes(s.id) ||
          (s.id === 'svalsat' && l.payload.what?.includes('svalsat') && l.payload.value === 'outage'),
      );
      ctx.fillStyle = degraded ? '#ff5f52' : c;
      ctx.beginPath();
      ctx.rect(x - 2.5, y - 2.5, 5, 5);
      ctx.fill();
      ctx.fillStyle = '#7b8aa0';
      ctx.textAlign = 'left';
      ctx.fillText(s.label, x + 5, y + 3);
    }
  }

  _tracks(ctx, p, t, snap) {
    this.offmap = [];
    for (const a of this.geo.assets) {
      const c = seatColor(a.owner);
      const { segs, now } = groundTrack(a.el, t, { latMin: p.latMin });

      if (!segs.length) {
        this.offmap.push({ ...a, now });
        continue;
      }

      for (const seg of segs) {
        // Past arc solid, future arc dashed: where it has been vs where it goes.
        for (const part of ['past', 'future']) {
          const pts = seg.filter((q) => (part === 'past' ? q.dt <= 0 : q.dt >= 0));
          if (pts.length < 2) continue;
          ctx.beginPath();
          pts.forEach((q, i) => {
            const [x, y] = p.project(q.lat, q.lon);
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          });
          ctx.strokeStyle = c;
          ctx.globalAlpha = part === 'past' ? 0.75 : 0.3;
          ctx.lineWidth = part === 'past' ? 1.6 : 1;
          ctx.setLineDash(part === 'past' ? [] : [2, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      ctx.globalAlpha = 1;

      if (now.lat >= p.latMin) {
        const [x, y] = p.project(now.lat, now.lon);
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(x, y, 3.4, 0, 2 * Math.PI);
        ctx.fill();
        ctx.strokeStyle = '#0a0c10';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#c3ceda';
        ctx.font = '9px ui-monospace, Menlo, monospace';
        ctx.textAlign = 'left';
        ctx.fillText(a.label.replace(/^STARLINK-/, 'SL-'), x + 6, y - 4);
      } else {
        this.offmap.push({ ...a, now });
      }
    }
  }

  /** Assets whose subpoint is south of the map edge, listed rather than drawn. */
  offmapList() {
    return this.offmap ?? [];
  }
}

export function stormAt(snap) {
  const s = snap?.storm;
  if (!s) return { severity: 'quiet', kp: 0, idx: 0 };
  return { ...s, idx: Math.max(0, STORM_ORDER.indexOf(s.severity)) };
}

export { subpoint };
