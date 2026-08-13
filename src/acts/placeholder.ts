/**
 * PHASE 1 PLACEHOLDER ART — deleted act by act in Phases 2–5.
 *
 * Its only job is to exercise the engine: eight distinguishable slots, measurable
 * lateral drift, real VP-registered geometry for the invariant check, and each
 * transition verb actually firing. Nothing here is art direction.
 */

import type { ActDefinition, Geometry, SlotArt } from './types.ts';
import { SLOT_NAMES, SLOT_RATES, VP_FRAC } from '../config.ts';

/** Half-width of the corridor either side of the vanishing point that no structure
 *  may cross, as a fraction of stage width. art-direction §2: the VP stays visible in
 *  every act, including Act II where the road is walled off short of it. */
const VP_KEEP_CLEAR = 0.055;

interface Palette {
  readonly id: string;
  readonly name: string;
  /** Slot 7 sky gradient, zenith first. */
  readonly sky: readonly string[];
  readonly haze: string;
  /** Fills for slots 5..0. */
  readonly ridge: string;
  readonly far: string;
  readonly mid: string;
  readonly near: string;
  readonly ground: string;
  readonly road: string;
  readonly props: string;
}

const PALETTES: readonly Palette[] = [
  {
    id: 'i',
    name: 'Frontier',
    sky: ['#1B2A4A', '#4A5B8C', '#C97B5A', '#F2A65A', '#FFD9A0'],
    haze: '#FFD9A0',
    ridge: '#6B5B7B',
    far: '#A87C5F',
    mid: '#3E2E2E',
    near: '#2E2222',
    ground: '#C89A6B',
    road: '#B08A62',
    props: '#3E2E2E',
  },
  {
    id: 'ii',
    name: 'Closed Frontier',
    sky: ['#4A4A52', '#4A4A52', '#8A7A6A', '#8A7A6A', '#B5A08A'],
    haze: '#8A7A6A',
    ridge: '#1A1D24',
    far: '#3A3A3E',
    mid: '#5A5A5E',
    near: '#4A4A4E',
    ground: '#2A2A2E',
    road: '#33333A',
    props: '#3A3A3E',
  },
  {
    id: 'iii',
    name: 'Open Frontier',
    sky: ['#1E1B3A', '#3D2E5C', '#7A4A7E', '#E8825E', '#FFC98C'],
    haze: '#FFC98C',
    ridge: '#2A2440',
    far: '#7A4A7E',
    mid: '#2A2440',
    near: '#241E38',
    ground: '#3DA871',
    road: '#8A7A5E',
    props: '#FFE9A8',
  },
  {
    id: 'iv',
    name: 'Frontier Returns',
    sky: ['#16243F', '#405080', '#B86F52', '#F2A65A', '#FFD9A0'],
    haze: '#F2A65A',
    ridge: '#5F5170',
    far: '#96705A',
    mid: '#3E2E2E',
    near: '#2E2222',
    ground: '#B08A62',
    road: '#9C7A56',
    props: '#3E2E2E',
  },
];

/** Vertical bars in the drifting layer, so lateral rate is readable straight off a shot. */
function ticks(geo: Geometry, y: number, height: number, fill: string): string {
  const step = 160;
  const first = Math.floor((-geo.bleed) / step) * step;
  const last = geo.w + geo.bleed;
  let out = '';
  for (let x = first; x <= last; x += step) {
    out += `<rect x="${x}" y="${y}" width="3" height="${height}" fill="${fill}" opacity="0.55"/>`;
  }
  return out;
}

function label(geo: Geometry, slot: number, y: number, fill: string): string {
  const name = SLOT_NAMES[slot] ?? '?';
  const rate = SLOT_RATES[slot] ?? 1;
  return (
    `<text x="${geo.bleed + 8}" y="${y}" font-family="ui-monospace,monospace" ` +
    `font-size="13" fill="${fill}" opacity="0.85">${slot} ${name} ${rate.toFixed(2)}x</text>`
  );
}

function box(x: number, y: number, w: number, h: number, fill: string): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
}

function buildAct(pal: Palette, geo: Geometry): readonly SlotArt[] {
  const { w, h, horizon, vp, bleed } = geo;
  const left = -bleed;
  const full = w + bleed * 2;
  const gradId = `ph-sky-${pal.id}`;

  // slot 7 — sky
  const stops = pal.sky
    .map((c, i) => {
      const offset = ((i / (pal.sky.length - 1)) * 100).toFixed(2);
      return `<stop offset="${offset}%" stop-color="${c}"/>`;
    })
    .join('');
  const sky: SlotArt = {
    verb: 'crossfade',
    free:
      `<defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient></defs>` +
      box(left, -bleed, full, horizon + bleed, `url(#${gradId})`) +
      box(left, horizon, full, h - horizon + bleed, pal.sky[pal.sky.length - 1] ?? '#000') +
      ticks(geo, horizon * 0.25, 26, '#ffffff') +
      label(geo, 7, horizon * 0.25 - 8, '#ffffff'),
  };

  // slot 6 — haze band around the horizon
  const hazeH = h * 0.12;
  const haze: SlotArt = {
    verb: 'crossfade',
    free:
      `<g opacity="0.45">${box(left, horizon - hazeH / 2, full, hazeH, pal.haze)}` +
      ticks(geo, horizon - hazeH / 2 + 4, 14, '#ffffff') +
      `</g>` +
      label(geo, 6, horizon - hazeH / 2 - 6, pal.haze),
  };

  // slot 5 — ridge, sits on the horizon, rises out of it.
  // Nothing crosses VP_KEEP_CLEAR: art-direction §2 requires the vanishing point to stay
  // visible in every act, and an occluded VP means the horizon cannot be measured there.
  const ridgeH = h * 0.1;
  let ridge = '';
  for (const [cx, scale] of [
    [0.2, 1],
    [0.36, 0.62],
    [0.8, 0.86],
  ] as const) {
    const bw = w * 0.16;
    const bh = ridgeH * scale;
    ridge += box(w * cx - bw / 2, horizon - bh, bw, bh + bleed, pal.ridge);
  }
  const slotRidge: SlotArt = {
    verb: 'rise',
    clipBottom: horizon,
    free: ridge + ticks(geo, horizon - ridgeH - 22, 16, pal.ridge) + label(geo, 5, horizon - ridgeH - 28, pal.ridge),
  };

  // slot 4 — far structures on the horizon
  const farH = h * 0.06;
  let far = '';
  for (let i = 0; i < 9; i++) {
    const bw = w * 0.05;
    const x = w * (0.06 + i * 0.11);
    if (Math.abs(x / w - VP_FRAC) < VP_KEEP_CLEAR) continue;
    const bh = farH * (i % 2 === 0 ? 1 : 0.68);
    far += box(x - bw / 2, horizon - bh, bw, bh + bleed, pal.far);
  }
  const slotFar: SlotArt = {
    verb: 'rise',
    clipBottom: horizon,
    free: far + label(geo, 4, horizon - farH - 8, pal.far),
  };

  // slot 3 — mid structures flanking the road, extruded from their own base
  const midBase = horizon + h * 0.05;
  const midH = h * 0.2;
  let mid = '';
  for (const cx of [0.1, 0.24, 0.72, 0.88] as const) {
    const bw = w * 0.1;
    mid += box(w * cx - bw / 2, midBase - midH, bw, midH, pal.mid);
  }
  const slotMid: SlotArt = {
    verb: 'extrude',
    clipBottom: midBase,
    free: mid + ticks(geo, midBase - midH - 20, 14, pal.mid) + label(geo, 3, midBase - midH - 26, pal.mid),
  };

  // slot 2 — near structures, larger, closer to the frame edges
  const nearBase = horizon + h * 0.16;
  const nearH = h * 0.34;
  let near = '';
  for (const cx of [-0.02, 0.98] as const) {
    const bw = w * 0.18;
    near += box(w * cx - bw / 2, nearBase - nearH, bw, nearH, pal.near);
  }
  const slotNear: SlotArt = {
    verb: 'extrude',
    clipBottom: nearBase,
    free: near + ticks(geo, nearBase - nearH - 20, 14, pal.near) + label(geo, 2, nearBase - nearH - 26, pal.near),
  };

  // slot 1 — ground, plus the VP-locked road. The road is the invariant's witness.
  const roadHalfNear = w * 0.3;
  const roadHalfFar = w * 0.012;
  const roadPoints = [
    `${vp - roadHalfNear},${h + bleed}`,
    `${vp - roadHalfFar},${horizon}`,
    `${vp + roadHalfFar},${horizon}`,
    `${vp + roadHalfNear},${h + bleed}`,
  ].join(' ');
  const ground: SlotArt = {
    verb: 'crossfade',
    free:
      box(left, horizon, full, h - horizon + bleed, pal.ground) +
      ticks(geo, h - 40, 22, '#000000') +
      label(geo, 1, h - 48, '#000000'),
    locked:
      `<polygon points="${roadPoints}" fill="${pal.road}" data-role="road"/>` +
      `<line x1="${left}" y1="${horizon}" x2="${w + bleed}" y2="${horizon}" ` +
      `stroke="#000000" stroke-opacity="0.25" stroke-width="1" data-role="horizon-witness"/>`,
  };

  // slot 0 — props, on twos, drift on and off canvas
  let props = '';
  for (const [px, py, s] of [
    [0.14, 0.78, 26],
    [0.52, 0.86, 18],
    [0.86, 0.72, 22],
    [0.3, 0.24, 12],
    [0.68, 0.18, 12],
  ] as const) {
    props += box(w * px, h * py, s, s, pal.props);
  }
  const slotProps: SlotArt = {
    verb: 'drift',
    free: props + ticks(geo, h * 0.94, 18, pal.props) + label(geo, 0, h * 0.94 - 6, pal.props),
  };

  return [slotProps, ground, slotNear, slotMid, slotFar, slotRidge, haze, sky];
}

export const PLACEHOLDER_ACTS: readonly ActDefinition[] = PALETTES.map((pal) => ({
  id: pal.id,
  name: pal.name,
  build: (geo: Geometry) => buildAct(pal, geo),
}));
