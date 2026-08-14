/**
 * Act II — The Closed Frontier. art-direction.md §5.
 *
 * The shot: same street, same viewpoint. The town has been built upward and inward. Two
 * towers own the sky, the road is walled, and the only colour in the world belongs to
 * whoever owns the towers.
 *
 * The saturation rule is the argument. Cyan and magenta appear only on the two monoliths,
 * the blimp ad panels, and the road's reflection of those two sources — reflected, never
 * owned. Every human-scale element is grey. One warm window in the slums would destroy it.
 *
 * Ground plane, road and reflections live in slot 7's locked layer for the same reason as
 * Act I: slot 1 paints in front of slots 2–5, and anything registered to the VP can never
 * be transformed.
 *
 * ## On the sky, which is the one substantive departure from §5's palette table
 *
 * §5 gives three sky tones — `#4A4A52` zenith, `#8A7A6A` sodium mid, `#B5A08A` horizon —
 * and calls the sky "flat, oppressive". Rendered literally that produced a frame with
 * **84% of its pixels in the darkest luminance band**, against the Act 2 reference's
 * 59/27 dark-to-bright split (docs/plans/pixel-substrate.md §2, conclusion 3). Both Act 2
 * references do their readability work with a *large bright sky*: the city is a silhouette
 * cut out of it, and with nothing bright behind it there is no silhouette, only a dark
 * frame with dark things in it.
 *
 * So the smog deck overhead keeps its dark tone and `#8A7A6A` stays in the ramp exactly as
 * specified, but the band beneath it burns: the occluded sun lights the underside of the
 * smog from the vanishing point. Enclosure is now carried by the lid overhead, by the
 * monoliths eating the sky, and by the wall — not by an evenly dark frame. §5's horizon
 * row already notes that `#B5A08A` "is never directly samplable", the slot 6 haze covering
 * it; this widens the same band rather than adding a colour of a different character.
 *
 * §5's occluded-sun row moves with the sky for the same reason. Its constraint is
 * relational — "must render *brighter* than the sky at its own height" — and `#8A7A6A` is
 * now *darker* than the sky it would sit in, so painting the literal hex would render the
 * sun as a hole. The halo is built from `sunCore` instead and satisfies the constraint the
 * row actually states.
 *
 * ## Substrate
 *
 * Every slot paints into the indexed art buffer (`draw` / `drawLocked` / `parts[].draw`).
 * The SVG markup is kept alongside it **only because `src/reduced.ts` still renders markup
 * strings** — `[piece.free, ...parts.map(p => p.markup), piece.locked]` — so deleting it
 * would empty Act II under `prefers-reduced-motion`. Act I keeps its markup for the same
 * reason. The markup is the low-fidelity twin; the `draw` callbacks are the art.
 */

import type { ActDefinition, Geometry, SlotArt } from './types.ts';
import type { Buf } from '../art/buffer.ts';
import type { Wind } from './shared.ts';
import { bayer } from '../art/buffer.ts';
import { gradientRamp } from '../art/palette.ts';
import { cloudTones, drawCloudBand } from '../art/sky.ts';
import {
  circle,
  clearsVP,
  depthScale,
  groundY,
  outlined,
  poly,
  r,
  rect,
  roadCentre,
  roadHalf,
  setPixelGrid,
  shade,
  shadeHue,
  tint,
  windingRoad,
} from './shared.ts';

const P = {
  /** Smog lid. Dark and slightly violet, so it reads as a ceiling rather than as night. */
  skyZenith: '#2E2A34',
  skyDeck: '#4C404A',
  /** Sodium smog — §5's specified mid tone, unchanged. */
  skyMid: '#8A7A6A',
  /**
   * The bright field, and its brightness is set by measurement rather than by eye.
   *
   * The Act 2 reference puts **26.7% of its whole frame in luminance band 3** (WCAG
   * relative luminance 0.375–0.5) — one large, nearly flat sodium field. Our first bright
   * sky was brighter than that and *ramped*, which spread the same area thinly across
   * bands 3, 4 and 5 and left no band with any mass in it. These three tones all sit
   * inside band 3 on purpose, so the sky accumulates rather than smears.
   *
   * They are also more saturated than a cream would be, which is how the reference reads
   * bright at a moderate luminance — but held under HSV s = 0.45, well below the 0.5 that
   * `chromaRegions` counts as saturated. The act's saturation rule is about cyan and
   * magenta belonging to two owners; a sodium sky is not a rival light source.
   */
  skyLower: '#C2A477',
  skyGlow: '#CDAC7A',
  /** The burn behind the towers, where the occluded sun is. */
  skyHorizon: '#D6B37C',
  sunCore: '#FFEFC4',
  monolith: '#1A1D24',
  cyan: '#00E5FF',
  magenta: '#FF2D95',
  slumA: '#5A5A5E',
  slumB: '#6E6E72',
  slumC: '#4A4A4E',
  /** Slum windows. Dim, never saturated — that is the whole argument. */
  slumWindow: '#8A8A80',
  blimp: '#3A3A3E',
  road: '#45454F',
  ground: '#4A4A50',
  /** The skyline standing behind the monoliths, before haze is mixed into it. */
  city: '#22232B',
  /** Smoke plume core. */
  smoke: '#38343E',
} as const;

const ROAD_NEAR_HALF = 0.2;
/**
 * The road is walled part-way to the vanishing point. Depth runs from the VP (d=0) toward
 * the viewer (d=1), so the original 0.7 put the wall almost on top of the viewer and left
 * the road occupying the bottom 8% of the frame. 0.5 gives a wall with real road in front
 * of it and keeps the VP visible above it (§2).
 *
 * Slums further away than this are drawn *with* the wall in slot 4, not in slots 2–3 —
 * those paint in front of slot 4, so a slum behind the wall would otherwise paint over the
 * thing that is supposed to be blocking the view of it.
 */
const WALL_DEPTH = 0.5;

/**
 * The road weaves — but here the weave is squeezed rather than open: a tighter, shorter
 * wavelength than Act III's, hemmed by the slums, and it runs into a wall before it can
 * straighten out.
 */
/** Depth at which slums begin migrating toward the frame edges, and how far they go. */
const SPREAD_FROM = 0.42;
const SPREAD_MAX = 0.62;

const WIND: Wind = { amplitude: 0.075, frequency: 2.4, phase: -0.5 };

/** The sky ramp's stops. Shared with the SVG twin so both paths read the same. */
/**
 * The sky ramp's stops. Shared with the SVG twin so both paths read the same.
 *
 * The dark lid is deliberately thin — the top 28% — because everything below it is the
 * only large bright surface in the act, and the enclosure is carried by the two monoliths,
 * the wall and the slums rather than by darkening the frame. Both Act 2 references do the
 * same: their dark upper region is a smoke plume over a bright sky, not a dark sky.
 */
const SKY_STOPS = [
  { at: 0, hex: P.skyZenith },
  { at: 0.14, hex: P.skyDeck },
  { at: 0.28, hex: P.skyMid },
  { at: 0.38, hex: P.skyLower },
  { at: 0.72, hex: P.skyGlow },
  { at: 1, hex: P.skyHorizon },
] as const;

/**
 * Sky ramp step count, chosen against the run metric rather than by eye.
 *
 * `artStats` treats a horizontal run as continuing while consecutive pixels stay within 14
 * Manhattan, so a ramp whose *adjacent steps* are closer than that dithers invisibly to the
 * measurement — and, more to the point, invisibly to the viewer. At 20 steps the three
 * upper segments of SKY_STOPS separate by 21, 40 and 42, so every band boundary up there is
 * a real one. The bottom segment is deliberately flat: §5 asks for a flat sky and the
 * reference has one, and holding it flat is what keeps its pixels in a single value band.
 */
const SKY_STEPS = 20;

/**
 * Deterministic 2D hash, 0..1.
 *
 * `build()` is a pure function of geo — no `Math.random`, no `Date` — so every scatter,
 * every cloud edge and every window in this act comes from integer hashing. Mirrors the
 * one in src/art/sky.ts, including the `>>> 0` on the XOR: `^` yields a *signed* 32-bit
 * int in JS, and without it half the values come back negative and the field never crosses
 * its threshold. That renders as an empty sky rather than as an error.
 */
function hash2(x: number, y: number, seed: number): number {
  let h =
    (Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed, 1442695041)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise with smoothstep interpolation, sampled in art cells. */
function noise(x: number, y: number, scale: number, seed: number): number {
  const fx = x / scale;
  const fy = y / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const n00 = hash2(x0, y0, seed);
  const n10 = hash2(x0 + 1, y0, seed);
  const n01 = hash2(x0, y0 + 1, seed);
  const n11 = hash2(x0 + 1, y0 + 1, seed);
  return (n00 + (n10 - n00) * sx) * (1 - sy) + (n01 + (n11 - n01) * sx) * sy;
}

/** Size of one art cell in stage px, read off the buffer rather than assumed. */
function cellPx(buf: Buf): number {
  return buf.sx(1) - buf.sx(0);
}

interface Slum {
  readonly side: -1 | 1;
  readonly d: number;
  readonly width: number;
  readonly height: number;
  readonly seed: number;
  /** How far the upper floors overhang the road. The crowding is the point. */
  readonly lean: number;
}

/**
 * Accreted, irregular, leaning over the road. Where Act I had gaps, this has none.
 *
 * Eighteen rather than twelve: at twelve the street wall still showed sky between
 * neighbours at mid depths, and "the city is continuous" is the composition's whole claim.
 * The additions sit in the gaps of the original run and are otherwise on the same model.
 */
const SLUMS: readonly Slum[] = [
  { side: -1, d: 0.14, width: 0.075, height: 0.78, seed: 3, lean: 0.28 },
  { side: 1, d: 0.16, width: 0.075, height: 0.7, seed: 5, lean: 0.24 },
  { side: -1, d: 0.19, width: 0.07, height: 0.86, seed: 43, lean: 0.3 },
  { side: 1, d: 0.21, width: 0.072, height: 0.76, seed: 47, lean: 0.26 },
  { side: -1, d: 0.23, width: 0.085, height: 0.92, seed: 7, lean: 0.32 },
  { side: 1, d: 0.26, width: 0.085, height: 0.84, seed: 11, lean: 0.28 },
  { side: -1, d: 0.29, width: 0.088, height: 0.97, seed: 53, lean: 0.33 },
  { side: -1, d: 0.34, width: 0.095, height: 1.02, seed: 13, lean: 0.34 },
  { side: 1, d: 0.38, width: 0.095, height: 0.94, seed: 17, lean: 0.3 },
  { side: 1, d: 0.44, width: 0.1, height: 1.0, seed: 59, lean: 0.32 },
  { side: -1, d: 0.5, width: 0.105, height: 1.14, seed: 19, lean: 0.36 },
  { side: 1, d: 0.55, width: 0.105, height: 1.06, seed: 23, lean: 0.32 },
  { side: -1, d: 0.62, width: 0.1, height: 1.2, seed: 61, lean: 0.38 },
  { side: -1, d: 0.72, width: 0.095, height: 1.26, seed: 29, lean: 0.4 },
  { side: 1, d: 0.8, width: 0.095, height: 1.2, seed: 31, lean: 0.36 },
  { side: 1, d: 0.92, width: 0.098, height: 1.28, seed: 67, lean: 0.38 },
  { side: -1, d: 1.02, width: 0.1, height: 1.4, seed: 37, lean: 0.44 },
  { side: 1, d: 1.12, width: 0.1, height: 1.34, seed: 41, lean: 0.4 },
];

/**
 * Aerial perspective for a slum: how far its tones are washed toward the sodium sky.
 *
 * Quantised, because a continuous fade interns a fresh set of tones for every slum and at
 * eighteen slums that alone is a quarter of the 255-entry budget. Three steps is enough to
 * read as depth and costs a fixed three sets.
 */
function slumFade(d: number): number {
  return (Math.round(Math.max(0, 1 - d) * 2) / 2) * 0.34;
}

/**
 * …and how far a *near* slum is pushed down toward black.
 *
 * This is the other half of the value structure, and the half §5 does not describe. Both
 * Act 2 references put their foreground buildings within a step or two of black and let a
 * bright sky do all the separating. Painting every slum at §5's literal `#5A5A5E` /
 * `#6E6E72` instead laid a wall of mid-grey across the bottom two thirds of the frame,
 * which is most of how this act came to have 84% of its pixels in one luminance band.
 *
 * Quantised on the same argument as `slumFade`. The two together yield five distinct
 * (fade, sink) pairs across the eighteen slums rather than eighteen.
 */
function slumSink(d: number): number {
  return (Math.round(Math.min(1, Math.max(0, d - 0.3) / 0.85) * 3) / 3) * 0.62;
}

/** Act II shades toward smog-blue and lights toward sodium. Never toward Act I's gold. */
const COOL = '#2C2E3A';

/**
 * The cel outline for a group of slums, derived from the darkest body actually in it.
 *
 * art-direction §3 asks for "surface shadow tone darkened 20%, not black", and a single
 * constant satisfied that only while every slum was painted at §5's literal grey. Once
 * `slumSink` pushes the nearest buildings up to 62% toward black, a line pinned to the
 * un-sunk `#4A4A4E` ends up *lighter* than the wall it outlines — measured, on all four of
 * the nearest and largest slums — and reads as a rim light rather than as a line. Taking it
 * from the nearest slum in the group keeps the relationship the rule describes.
 *
 * Costs three palette entries instead of one, which the act has room for at 189/256.
 */
function slumLine(slums: readonly Slum[]): string {
  const nearest = slums.reduce((a, b) => (b.d > a.d ? b : a));
  const darkest = shadeHue(
    tint(P.slumC, P.skyMid, slumFade(nearest.d)),
    slumSink(nearest.d),
    COOL,
    P.skyGlow,
  );
  return shade(darkest, 0.2);
}

/** A small deterministic LCG. Same generator the SVG twin uses, so both agree. */
function lcg(seed: number): () => number {
  let hash = (seed * 2654435761) >>> 0;
  return () => {
    hash = (hash * 1664525 + 1013904223) >>> 0;
    return (hash >>> 8) / 0x1000000;
  };
}

interface Facade {
  readonly x: number;
  readonly width: number;
  readonly base: number;
  readonly height: number;
}

/**
 * How far a slum is pushed outward from the road edge, as a fraction of half the frame.
 *
 * Zero in the distance, rising toward the viewer, so the nearest blocks sit against the
 * left and right edges of the screen rather than crowding the middle.
 *
 * Client direction, and it is also better composition: the near slums were stacked around
 * the centre with the road's reflections threading between them, which put the act's
 * densest, busiest geometry exactly where the vanishing point and the two monoliths need
 * the eye to go. Pushing them to the edges frames the corridor instead of contesting it,
 * and the crowding still reads because the buildings lean over the street.
 */
function slumSpread(d: number): number {
  const t = Math.min(1, Math.max(0, (d - SPREAD_FROM) / (1 - SPREAD_FROM)));
  return t * t * SPREAD_MAX;
}

function slumFacade(geo: Geometry, s: Slum): Facade {
  const scale = depthScale(geo, s.d);
  const base = groundY(geo, s.d);
  const edge = geo.w * 0.5 * slumSpread(s.d);
  const inner =
    roadCentre(geo, s.d, WIND) + s.side * (roadHalf(geo, s.d, ROAD_NEAR_HALF, 0) + edge);
  const width = geo.w * s.width * scale;
  const height = (geo.h - geo.horizon) * s.height * scale;
  return { x: s.side === -1 ? inner - width : inner, width, base, height };
}

/** SVG twin of `drawSlum`, for the reduced-motion path only. */
function slumMarkup(geo: Geometry, s: Slum): string {
  const { x, width, base, height } = slumFacade(geo, s);
  const fade = slumFade(s.d);
  const sink = slumSink(s.d);
  const tones = [P.slumA, P.slumB, P.slumC].map((t) =>
    shadeHue(tint(t, P.skyMid, fade), sink, COOL, P.skyGlow),
  );
  let out = '';
  const next = lcg(s.seed);

  // Stacked improvised floors, each offset and each leaning further over the road. Six
  // to nine of them, no two the same width — the silhouette has to read as accretion.
  const floors = 6 + Math.floor(next() * 4);
  let y = base;
  for (let i = 0; i < floors; i++) {
    const fh = (height / floors) * (0.72 + next() * 0.6);
    const grow = i / floors;
    const overhang = width * s.lean * grow * (0.5 + next() * 0.5);
    const fx = s.side === -1 ? x - overhang * 0 : x - overhang;
    const fw = width + overhang;
    const tone = tones[Math.floor(next() * tones.length)] ?? P.slumA;
    out += rect(fx, y - fh, fw, fh, tone);
    out += rect(fx, y - fh, fw, Math.max(fh * 0.06, 1), shade(tone, 0.3));

    // Dim windows. Never saturated — that is the whole argument.
    const cols = 2 + Math.floor(next() * 2);
    for (let c = 0; c < cols; c++) {
      if (next() > 0.62) continue;
      const ww = fw * 0.15;
      const wh = fh * 0.3;
      out += rect(fx + fw * (0.12 + c * 0.3), y - fh * 0.7, ww, wh, P.slumWindow);
    }

    // Tarps and awnings jutting into the street.
    if (next() > 0.55) {
      const tw = width * (0.2 + next() * 0.24);
      const tx = s.side === -1 ? fx + fw : fx - tw;
      out += poly(
        [
          [tx, y - fh * 0.9],
          [tx + tw, y - fh * 0.74],
          [tx + tw, y - fh * 0.64],
          [tx, y - fh * 0.78],
        ],
        shade(tone, 0.42),
      );
    }
    y -= fh;
  }

  // Antennas and pipework on the roof.
  const masts = 1 + Math.floor(next() * 3);
  for (let i = 0; i < masts; i++) {
    const mx = x + width * next();
    const mh = height * (0.06 + next() * 0.14);
    out += rect(mx, y - mh, Math.max(width * 0.012, 1), mh, P.slumC);
    if (next() > 0.6) {
      out += rect(mx - width * 0.03, y - mh, width * 0.07, Math.max(mh * 0.06, 1), P.slumC);
    }
  }
  const pipeX = s.side === -1 ? x + width * 0.88 : x + width * 0.06;
  out += rect(pipeX, y, Math.max(width * 0.03, 1.5), base - y, shade(P.slumC, 0.25));

  return out;
}

/**
 * Paint one slum into the buffer, and return every tone it used.
 *
 * The caller outlines the *group's* silhouette from that set rather than stroking each
 * shape, which is the difference between a cel line and a line around every internal tone
 * change (src/art/buffer.ts `outline`).
 *
 * Structure follows the SVG twin exactly — same LCG, same draw order — so the two paths
 * describe one building. Everything the buffer adds (grime, sills, ladders, sill lights,
 * dishes) is driven off a *second* generator so the base silhouette is unchanged.
 */
function drawSlum(buf: Buf, geo: Geometry, s: Slum): number[] {
  const { x, width, base, height } = slumFacade(geo, s);
  const fade = slumFade(s.d);
  const sink = slumSink(s.d);
  const bodies = [P.slumA, P.slumB, P.slumC].map((t) =>
    shadeHue(tint(t, P.skyMid, fade), sink, COOL, P.skyGlow),
  );
  // Shading shifts hue rather than only brightness: a shadowed plane takes colour from the
  // smog above it and goes blue, a lit one takes colour from the sodium glow. Three
  // multiples of one hue read as one flat colour at three brightnesses, which is most of
  // why this act measured 25 colours over 99% of the frame.
  const iBody = bodies.map((t) => buf.tone(t, 'slum body'));
  const iRoof = bodies.map((t) => buf.tone(shadeHue(t, 0.38, COOL, P.skyGlow), 'slum roofline'));
  const iLit = buf.tone(shadeHue(bodies[1] as string, -0.34, COOL, P.skyGlow), 'slum lit');
  const iTarp = buf.tone(shadeHue(bodies[1] as string, 0.54, COOL, P.skyGlow), 'slum tarp');
  const iGrime = buf.tone(shadeHue(bodies[2] as string, 0.3, COOL, P.skyGlow), 'slum grime');
  const iWindow = buf.tone(P.slumWindow, 'slum window');
  const iWindowDim = buf.tone(shade(P.slumWindow, 0.42), 'slum window dim');
  const iPipe = buf.tone(shade(P.slumC, 0.25), 'slum pipe');
  const iMast = buf.tone(P.slumC, 'slum mast');
  const used = [...iBody, ...iRoof, iLit, iTarp, iGrime, iWindow, iWindowDim, iPipe, iMast];

  const next = lcg(s.seed);
  const detail = lcg(s.seed * 7919 + 13);
  const cell = cellPx(buf);
  const thin = Math.max(cell, width * 0.02);

  const floors = 6 + Math.floor(next() * 4);
  const ledges: { x: number; y: number; w: number; h: number }[] = [];
  let y = base;
  for (let i = 0; i < floors; i++) {
    const fh = (height / floors) * (0.72 + next() * 0.6);
    const grow = i / floors;
    const overhang = width * s.lean * grow * (0.5 + next() * 0.5);
    const fx = s.side === -1 ? x : x - overhang;
    const fw = width + overhang;
    const pick = Math.floor(next() * bodies.length);
    const top = y - fh;

    buf.rect(fx, top, fw, fh, iBody[pick] as number);
    // The road-facing edge catches the sodium glow off the sky; the rest of the face is
    // in its own shadow. Feathered with a dither rather than banded, so it reads as light
    // falling on the wall instead of as a stripe painted on it.
    const litX = s.side === -1 ? fx + fw - thin * 2 : fx;
    buf.rect(litX, top, thin * 2, fh, iLit);
    buf.rectDither(s.side === -1 ? fx + fw - thin * 5 : fx + thin * 2, top, thin * 3, fh, iLit, 0.4);
    // Roofline of each floor: the horizontal that makes a stack read as stacked.
    buf.rect(fx, top, fw, Math.max(fh * 0.06, cell), iRoof[pick] as number);
    // Grime, heaviest at the bottom of each floor where the water runs.
    buf.rectDither(fx, top + fh * 0.42, fw, fh * 0.58, iGrime, (t) => t * 0.5);

    // Dim windows. Never saturated — that is the whole argument.
    const cols = 2 + Math.floor(next() * 2);
    for (let c = 0; c < cols; c++) {
      if (next() > 0.62) continue;
      const ww = fw * 0.15;
      const wh = fh * 0.3;
      const wx = fx + fw * (0.12 + c * 0.3);
      const wy = y - fh * 0.7;
      buf.rect(wx, wy, ww, wh, detail() > 0.45 ? iWindow : iWindowDim);
      // Shutter bar and sill: two one-cell lines, and the cheapest detail in the act.
      buf.rect(wx, wy + wh * 0.45, ww, cell, iPipe);
      buf.rect(wx - cell, wy + wh, ww + cell * 2, cell, iRoof[pick] as number);
    }

    // Tarps and awnings jutting into the street. Thin, and sloping away from the wall —
    // at the original depth they read as slabs floating beside the building rather than
    // as anything attached to it.
    if (next() > 0.55) {
      const tw = width * (0.2 + next() * 0.24);
      const tx = s.side === -1 ? fx + fw : fx - tw;
      buf.poly(
        [
          [tx, y - fh * 0.9],
          [tx + tw, y - fh * 0.74],
          [tx + tw, y - fh * 0.64],
          [tx, y - fh * 0.78],
        ],
        iTarp,
      );
    }

    // An air-conditioning box or a crate on the ledge. Grey, like everything human here.
    //
    // Deferred rather than drawn here: a box sits *above* its floor's roofline, and the
    // next iteration fills exactly that span with the floor above's body rect. Drawn in
    // place, only 10-21% of these cells survived to the raster — the rest were painted and
    // immediately covered. Collected and painted after the stack, they also read correctly,
    // since a unit bolted to a ledge stands in front of the wall above it.
    if (detail() > 0.55) {
      const bw = fw * (0.16 + detail() * 0.12);
      const bx = fx + fw * (0.1 + detail() * 0.6);
      ledges.push({ x: bx, y: top - fh * 0.16, w: bw, h: fh * 0.16 });
    }
    y = top;
  }

  for (const box of ledges) {
    buf.rect(box.x, box.y, box.w, box.h, iBody[2] as number);
    buf.rect(box.x, box.y, box.w, Math.max(box.h * 0.19, cell), iLit);
  }

  // Roof furniture below is skipped for slums standing behind the wall: only the top few
  // rows of those show, so ladders and dishes land on top of each other and read as one
  // tangle of scaffolding rather than as anything.
  const hiddenByWall = s.d < WALL_DEPTH;

  // A ladder up the street-facing corner: two rails and rungs, all one cell wide.
  if (!hiddenByWall && detail() > 0.4) {
    const lx = s.side === -1 ? x + width * 0.72 : x + width * 0.18;
    const lw = Math.max(width * 0.09, cell * 2);
    buf.rect(lx, y + height * 0.12, cell, base - y - height * 0.12, iPipe);
    buf.rect(lx + lw, y + height * 0.12, cell, base - y - height * 0.12, iPipe);
    for (let ry = y + height * 0.16; ry < base; ry += Math.max(height * 0.05, cell * 3)) {
      buf.rect(lx, ry, lw, cell, iPipe);
    }
  }

  // Antennas and pipework on the roof.
  const masts = 1 + Math.floor(next() * 3);
  for (let i = 0; i < masts; i++) {
    const mx = x + width * next();
    const mh = height * (0.06 + next() * 0.14);
    buf.rect(mx, y - mh, Math.max(width * 0.012, cell), mh, iMast);
    if (next() > 0.6) {
      buf.rect(mx - width * 0.03, y - mh, width * 0.07, Math.max(mh * 0.06, cell), iMast);
    }
    // Guy wires off the taller masts, so the roofline is not a row of bare sticks.
    if (detail() > 0.55) {
      buf.line(mx, y - mh, mx + width * (detail() - 0.5) * 0.9, y, iPipe, 1);
    }
  }
  // A dish, pointed at nothing in particular.
  if (!hiddenByWall && detail() > 0.5) {
    const dr = Math.max(width * 0.09, cell);
    const dx = x + width * (0.2 + detail() * 0.6);
    buf.disc(dx, y - dr, dr, iMast);
    buf.disc(dx, y - dr, dr * 0.5, iGrime);
    buf.rect(dx - cell / 2, y - dr, cell, dr, iPipe);
  }

  const pipeX = s.side === -1 ? x + width * 0.88 : x + width * 0.06;
  buf.rect(pipeX, y, Math.max(width * 0.03, cell), base - y, iPipe);

  return used;
}

/**
 * The distant skyline standing behind the monoliths.
 *
 * Both Act 2 references are built this way: three or four tiers of towers, each tier
 * hazier and lower in contrast than the one in front, so the eye reads depth off value
 * rather than off overlap. It is also where most of this act's fine detail lives — a tier
 * of thin towers with one-cell windows breaks up an area that was previously flat sky.
 *
 * Every tower is tested against `clearsVP`: the vanishing point must stay visible (§2), and
 * `check:invariant` measures the horizon as a tonal step in exactly that corridor, so a
 * tower base standing in it would erase the step the whole build registers to.
 */
function drawSkyline(buf: Buf, geo: Geometry, tier: number): number[] {
  const { w, horizon, bleed } = geo;
  const below = geo.h - horizon;
  const full = w + bleed * 2;
  // Tier 0 is furthest: smallest, and mixed most of the way into the sky behind it.
  const hazes = [0.62, 0.44, 0.26];
  const counts = [34, 24, 16];
  const skies = [P.skyGlow, P.skyLower, P.skyMid];
  const haze = hazes[tier] as number;
  const count = counts[tier] as number;
  const body = tint(P.city, skies[tier] as string, haze);
  const iBody = buf.tone(body, 'skyline body');
  const iShade = buf.tone(shadeHue(body, 0.26, COOL, P.skyGlow), 'skyline shade');
  const iCap = buf.tone(shadeHue(body, -0.24, COOL, P.skyGlow), 'skyline cap');
  const iWindow = buf.tone(tint(P.slumWindow, body, haze * 0.5), 'skyline window');
  const cell = cellPx(buf);

  for (let i = 0; i < count; i++) {
    const jitter = hash2(i, tier * 31 + 3, 3301);
    const x = -bleed + full * ((i + 0.5) / count) + (jitter - 0.5) * (full / count) * 0.9;
    const halfW = w * (0.005 + hash2(i, tier * 17 + 5, 5501) * 0.012) * (1 + tier * 0.55);
    const height =
      below * (0.06 + hash2(i, tier * 13 + 7, 7717) ** 1.7 * 0.42) * (0.5 + tier * 0.32);
    if (!clearsVP(geo, x, halfW)) continue;
    const top = horizon - height;
    buf.rect(x - halfW, top, halfW * 2, height, iBody);
    // One shadowed face, on the side away from the glow at the vanishing point.
    const away = Math.sign(x - geo.vp) || 1;
    buf.rect(
      away === -1 ? x - halfW : x + halfW - Math.max(halfW * 0.45, cell),
      top,
      Math.max(halfW * 0.45, cell),
      height,
      iShade,
    );
    buf.rect(x - halfW, top, halfW * 2, Math.max(height * 0.02, cell), iCap);

    // A setback partway up, so the tier is not a row of plain boxes.
    if (hash2(i, tier * 11 + 19, 9173) > 0.5) {
      const sw = halfW * 0.55;
      const sh = height * (0.14 + hash2(i, tier, 233) * 0.2);
      buf.rect(x - sw, top - sh, sw * 2, sh, iBody);
      buf.rect(x - sw, top - sh, sw * 2, Math.max(sh * 0.06, cell), iCap);
    }
    // A mast. One cell wide at every viewport, which is what makes a skyline read as a city
    // rather than as a bar chart.
    if (hash2(i, tier * 7 + 23, 6151) > 0.42) {
      const mh = height * (0.1 + hash2(i, tier, 811) * 0.24);
      buf.rect(x - cell / 2, top - mh, cell, mh, iShade);
    }

    // One-cell windows. Sparse and grey: no emissive human-scale element in this act is
    // saturated, and a warm one here would read as the town that Act II has replaced.
    const cx0 = buf.ax(x - halfW) + 1;
    const cx1 = buf.ax(x + halfW) - 1;
    const cy0 = buf.ay(top) + 2;
    const cy1 = buf.ay(horizon) - 1;
    for (let cy = cy0; cy < cy1; cy += 3) {
      for (let cx = cx0; cx < cx1; cx += 2) {
        if (hash2(cx, cy, 4813 + tier) > 0.17) continue;
        buf.set(cx, cy, iWindow);
      }
    }
  }
  return [iBody, iShade, iCap, iWindow];
}

interface Monolith {
  readonly cx: number;
  readonly glass: string;
  readonly seed: number;
}

const MONOLITHS: readonly Monolith[] = [
  { cx: 0.38, glass: P.cyan, seed: 5 },
  { cx: 0.62, glass: P.magenta, seed: 23 },
];

/**
 * One monolith, flanking the vanishing point and running off the top of the frame.
 *
 * The body is a dithered vertical ramp rather than a flat fill: the tower stands in the
 * same smog everything else does, so its foot is hazed and its crown is not. That single
 * change is worth more to both the palette and the fine-detail count than every window on
 * it, because it covers ~16% of the frame width over the full height of the sky.
 */
function drawMonolith(buf: Buf, geo: Geometry, m: Monolith): void {
  const { w, horizon, vp, bleed } = geo;
  const centre = w * m.cx;
  const halfW = w * 0.082;
  const top = -bleed;
  const span = horizon - top;
  const cell = cellPx(buf);

  const body = P.monolith;
  const hazed = tint(body, P.skyGlow, 0.32);
  buf.vRamp(
    centre - halfW,
    top,
    halfW * 2,
    span,
    gradientRamp(
      buf.palette,
      [
        { at: 0, hex: body },
        { at: 0.55, hex: tint(body, P.skyDeck, 0.4) },
        { at: 1, hex: hazed },
      ],
      10,
      `ii-mono${m.cx > 0.5 ? 'b' : 'a'}`,
    ),
  );

  const iDark = buf.tone(shadeHue(body, 0.5, COOL, P.skyGlow), 'monolith dark');
  const iRib = buf.tone(shade(tint(body, P.skyDeck, 0.2), 0.4), 'monolith rib');
  const iBand = buf.tone(tint(body, P.skyMid, 0.3), 'monolith band');
  const iBandLip = buf.tone(shadeHue(tint(body, P.skyMid, 0.3), 0.4, COOL, P.skyGlow), 'monolith band lip');
  const iGantry = buf.tone(tint(body, P.skyMid, 0.46), 'monolith gantry');
  const iGlass = buf.tone(m.glass, 'monolith glass');
  const iGlassMid = buf.tone(tint(m.glass, body, 0.34), 'monolith glass mid');
  const iGlassDim = buf.tone(tint(m.glass, body, 0.62), 'monolith glass dim');

  // The face turned away from the vanishing point sits in its own shadow; the face turned
  // toward it catches the glow. One flat step each, feathered into the ramp by a dither.
  const away = Math.sign(centre - vp) || 1;
  const faceW = halfW * 0.5;
  buf.rect(away === -1 ? centre - halfW : centre + halfW - faceW, top, faceW, span, iDark);
  buf.rectDither(
    away === -1 ? centre - halfW + faceW : centre + halfW - faceW * 2,
    top,
    faceW,
    span,
    iDark,
    0.45,
  );

  // Vertical ribs. One or two cells wide, which is what puts this tower in the fine-detail
  // count at all — a 5-cell window pane is a 15-device-pixel run and counts as flat.
  const ribs = 11;
  for (let i = 1; i < ribs; i++) {
    const rx = centre - halfW + ((halfW * 2) / ribs) * i;
    buf.rect(rx, top, cell, span, iRib);
  }

  // Service bands: horizontal setbacks every few floors, with a lit lip.
  //
  // Flush with the body, never proud of it. Oversailing by 4% put the inner end of every
  // band 0.035w from the vanishing point — deeper into the `VP_KEEP_CLEAR` corridor than
  // the tower itself, which at 0.038w is already inside it. §5 fixes the towers at 38vw
  // and 62vw and the width is inherited, but nothing here is entitled to make the
  // intrusion worse. The gantries below oversail the *outer* edge instead, away from the
  // vanishing point, which costs nothing.
  const bands = 13;
  for (let i = 1; i < bands; i++) {
    const by = top + (span / bands) * i;
    buf.rect(centre - halfW, by, halfW * 2, Math.max(span * 0.008, cell), iBand);
    buf.rect(centre - halfW, by, halfW * 2, cell, iBandLip);
  }

  // Gantries and mooring arms off the outer edge. The blimps have to dock somewhere.
  for (let i = 0; i < 6; i++) {
    const gy = top + span * (0.12 + i * 0.15);
    const gw = halfW * (0.18 + hash2(i, m.seed, 991) * 0.3);
    const gx = away === -1 ? centre - halfW - gw : centre + halfW;
    buf.rect(gx, gy, gw, Math.max(span * 0.004, cell), iGantry);
    buf.rect(gx + (away === -1 ? 0 : gw - cell), gy, cell, span * 0.03, iGantry);
  }

  // A cold, regular window grid. Regularity is the point — nothing here is human.
  const cols = 9;
  const rows = 44;
  const gridW = halfW * 1.62;
  const gridX = centre - gridW / 2;
  const cw = gridW / cols;
  const ch = span / rows;
  for (let row = 2; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const h = hash2(row, col * 13 + m.seed, 8237);
      if (h > 0.86) continue;
      // Three brightnesses, so the grid reads as a lit building and not as one decal.
      const tone = h < 0.3 ? iGlass : h < 0.62 ? iGlassMid : iGlassDim;
      buf.rect(gridX + col * cw + cw * 0.24, top + row * ch + ch * 0.26, cw * 0.42, ch * 0.44, tone);
    }
  }
}

/** SVG twin of `drawMonolith`, for the reduced-motion path only. */
function monolithMarkup(geo: Geometry, m: Monolith): string {
  const { w, horizon, vp, bleed } = geo;
  const centre = w * m.cx;
  const halfW = w * 0.082;
  const top = -bleed;
  let out = rect(centre - halfW, top, halfW * 2, horizon - top, P.monolith);
  const away = Math.sign(centre - vp) || 1;
  out += rect(
    away === -1 ? centre - halfW : centre + halfW * 0.42,
    top,
    halfW * 0.58,
    horizon - top,
    shade(P.monolith, 0.35),
  );
  const cols = 6;
  const rows = 30;
  const gridW = halfW * 1.5;
  const gridX = centre - gridW / 2;
  const cellW = gridW / cols;
  const cellH = (horizon - top) / rows;
  for (let row = 2; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const hash = ((row * 73856093) ^ (col * 19349663) ^ (m.cx * 1000)) >>> 0;
      if (hash % 100 > 82) continue;
      out += rect(
        gridX + col * cellW + cellW * 0.2,
        top + row * cellH + cellH * 0.25,
        cellW * 0.6,
        cellH * 0.5,
        m.glass,
      );
    }
  }
  return out;
}

interface Plume {
  readonly x: number;
  readonly baseY: number;
  readonly topY: number;
  readonly halfW: number;
  readonly lean: number;
  readonly seed: number;
}

/**
 * A smoke plume, rising and widening.
 *
 * Both Act 2 references put a large diagonal smoke column across the sky, and it does two
 * jobs at once: it is the thing that makes a bright sky read as *smog* rather than as
 * dawn, and it breaks the largest flat area in the frame into shapes.
 *
 * Kept clear of the vanishing-point corridor by placement — the plumes rise from the
 * flanks — because a dark column standing over the corridor would flatten the very step
 * `check:invariant` measures the horizon by.
 */
function drawPlume(buf: Buf, p: Plume, tones: readonly number[]): void {
  const cell = cellPx(buf);
  const y1 = buf.ay(p.baseY);
  const y0 = buf.ay(p.topY);
  const span = y1 - y0;
  if (span <= 1) return;
  const acx = buf.ax(p.x);
  const halfBase = p.halfW / cell;
  const lean = p.lean / cell;

  for (let cy = Math.max(0, y0); cy < Math.min(buf.h, y1); cy++) {
    const t = (y1 - cy) / span;
    const half = halfBase * (0.22 + t * 1.25);
    const centre = acx + lean * t * t + (noise(0, cy, 11, p.seed) - 0.5) * half * 0.55;
    // Thin at the stack and thinning again as it disperses into the deck overhead.
    const strength = Math.min(1, t * 7) * (1 - t * 0.62);
    const from = Math.max(0, Math.round(centre - half));
    const to = Math.min(buf.w, Math.round(centre + half));
    for (let cx = from; cx < to; cx++) {
      const u = (cx - centre) / Math.max(half, 1);
      const n = noise(cx, cy, 8, p.seed) * 0.6 + noise(cx, cy, 3, p.seed + 17) * 0.4;
      const cover = (1 - u * u) * strength * (0.34 + n * 1.05);
      if (cover <= bayer(cx, cy)) continue;
      const step = Math.min(tones.length - 1, Math.floor(cover * tones.length));
      buf.set(cx, cy, tones[step] as number);
    }
  }
}

/**
 * The occluded sun: a stepped halo at the vanishing point.
 *
 * §5 requires it to render *brighter* than the sky at its own height, which with a bright
 * sky means brighter still. Drawn as coverage rather than as concentric discs: a disc
 * stack puts a hard horizontal edge at the top of every ring, and the ring nearest the
 * horizon would then compete with the horizon itself for `strongestNear`.
 *
 * The inner 55% of the radius is laid down solid, deliberately. That region is wider than
 * the vanishing-point corridor at all three viewports, so the rows immediately above the
 * horizon are one flat tone across the whole corridor and the horizon step stays clean.
 */
function drawHalo(buf: Buf, cx: number, cy: number, radius: number, tones: readonly number[]): void {
  const acx = buf.ax(cx);
  const acy = buf.ay(cy);
  const ar = Math.max(1, radius / cellPx(buf));
  const top = Math.max(0, Math.floor(acy - ar));
  const bottom = Math.min(buf.h, Math.ceil(acy + ar) + 1);
  const from = Math.max(0, Math.floor(acx - ar));
  const to = Math.min(buf.w, Math.ceil(acx + ar) + 1);

  for (let y = top; y < bottom; y++) {
    for (let x = from; x < to; x++) {
      const dx = (x - acx) / ar;
      const dy = (y - acy) / ar;
      const glow = 1 - Math.sqrt(dx * dx + dy * dy);
      if (glow <= 0) continue;
      if (glow < 0.45 && glow * 1.5 <= bayer(x, y)) continue;
      const step = Math.min(tones.length - 1, Math.floor(glow * tones.length));
      buf.set(x, y, tones[step] as number);
    }
  }
}

function build(geo: Geometry): readonly SlotArt[] {
  setPixelGrid(geo);
  const { w, h, horizon, vp, bleed } = geo;
  const left = -bleed;
  const full = w + bleed * 2;
  const below = h - horizon;
  const sunR = h * 0.055;
  const bottomY = h * 1.06;

  const wallBase = groundY(geo, WALL_DEPTH);
  const wallTop = horizon + below * 0.085;
  const wallH = wallBase - wallTop;

  // The road is paved and wet, and it stops at the wall — this is the one act whose road
  // never reaches the vanishing point (§2).
  const roadPoints = windingRoad(geo, ROAD_NEAR_HALF, WIND, { farD: WALL_DEPTH });

  // ---- slot 7 — sky, ground, road, reflections -----------------------------

  /** Reflected saturation, for the SVG twin. */
  let reflections = '';
  for (const [cx, colour] of [
    [0.38, P.cyan],
    [0.62, P.magenta],
  ] as const) {
    const refl = tint(colour, P.road, 0.5);
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const nearX = roadCentre(geo, 1, WIND) + (w * cx - vp) * (1.9 + t * 0.5);
      const farX = roadCentre(geo, WALL_DEPTH, WIND) + (w * cx - vp) * 0.55;
      const wdt = w * (0.006 + t * 0.012);
      reflections += poly(
        [
          [farX - wdt * 0.3, wallBase],
          [farX + wdt * 0.3, wallBase],
          [nearX + wdt, h + bleed],
          [nearX - wdt, h + bleed],
        ],
        refl,
        ` fill-opacity="${(0.72 - t * 0.09).toFixed(2)}"`,
      );
    }
  }

  const sky: SlotArt = {
    verb: 'crossfade',
    /**
     * A banded, dithered ramp — never a smooth gradient.
     *
     * An indexed buffer cannot hold a true gradient: one palette entry per art row would
     * cost two thirds of the act's budget for one layer. Banding is also what the
     * references are actually made of, and it is where most of this act's fine detail now
     * comes from — a smooth ramp reads as one flat run from edge to edge.
     */
    draw: (buf) => {
      buf.vRamp(
        left,
        -bleed,
        full,
        horizon + bleed,
        gradientRamp(buf.palette, [...SKY_STOPS], SKY_STEPS, 'ii-sky'),
      );

      // Three decks of smog, lit from the vanishing point where the occluded sun is. Read
      // downward: a lid overhead, a torn middle, and a low band compressed into the glow.
      // This is Act I's cloud machinery given a different character — the same structure
      // carries the enclosure rather than the dawn.
      //
      // Coverage and base tone are both tuned against the value measurement rather than by
      // eye. A dark deck at 0.80 coverage looks like weather and measures as a lid: it put
      // the *sky* back into the darkest luminance band, which is the exact failure this
      // act was rebuilt to fix (79% of the frame in band 0, against a 59/27 target). Both
      // Act 2 references keep their cloud *lit* — dark shapes in their skies are smoke,
      // not cloud — so the decks here thin out and the plumes carry the darkness.
      const sun = { x: vp, y: horizon };
      for (const spec of [
        {
          top: -bleed,
          bottom: horizon * 0.34,
          scale: 30,
          squash: 3,
          coverage: 0.52,
          seed: 1601,
          base: '#3C3442',
          sky: P.skyDeck,
          lit: P.skyMid,
        },
        {
          top: horizon * 0.28,
          bottom: horizon * 0.74,
          scale: 18,
          squash: 4.2,
          coverage: 0.42,
          seed: 733,
          // Inside the same luminance band as the field behind it, for the reason given on
          // `skyLower`: a deck a band darker than its sky reads as cloud and measures as a
          // hole punched in the one part of the frame that is doing the separating.
          base: '#B08D63',
          sky: P.skyMid,
          lit: P.skyGlow,
        },
        {
          top: horizon * 0.68,
          bottom: horizon * 0.99,
          scale: 12,
          squash: 6,
          coverage: 0.3,
          seed: 419,
          // Darker than the glow it sits on, so the low deck silhouettes rather than
          // washing out — the same reason Act I's lowest band is darker than its horizon.
          base: '#BC9464',
          sky: P.skyLower,
          lit: P.skyHorizon,
        },
      ]) {
        drawCloudBand(
          buf,
          {
            top: spec.top,
            bottom: spec.bottom,
            scale: spec.scale,
            squash: spec.squash,
            coverage: spec.coverage,
            seed: spec.seed,
            ...cloudTones(buf.palette, spec.base, spec.sky, spec.lit),
          },
          sun,
        );
      }

      const plumeTones = [
        buf.tone(tint(P.smoke, P.skyGlow, 0.6), 'plume thin'),
        buf.tone(tint(P.smoke, P.skyGlow, 0.38), 'plume edge'),
        buf.tone(tint(P.smoke, P.skyMid, 0.26), 'plume body'),
        buf.tone(P.smoke, 'plume core'),
        buf.tone(shade(P.smoke, 0.34), 'plume dense'),
      ];
      for (const plume of [
        { x: w * 0.17, baseY: horizon, topY: -bleed, halfW: w * 0.072, lean: -w * 0.1, seed: 811 },
        {
          x: w * 0.86,
          baseY: horizon,
          topY: horizon * 0.06,
          halfW: w * 0.05,
          lean: w * 0.07,
          seed: 1279,
        },
        {
          x: w * 0.3,
          baseY: horizon * 0.97,
          topY: horizon * 0.2,
          halfW: w * 0.034,
          lean: -w * 0.05,
          seed: 401,
        },
      ]) {
        drawPlume(buf, plume, plumeTones);
      }
    },
    /**
     * Everything registered to an anchor, in paint order: the halo sits behind the ground
     * plane, so the plane follows it.
     *
     * Translucent fills are resolved to the tone they produce rather than composited —
     * `tint(background, ink, alpha)` — because the buffer has no alpha. Same result, and
     * the palette stays countable.
     */
    drawLocked: (buf) => {
      drawHalo(buf, vp, horizon, sunR * 2.4, [
        buf.tone(tint(P.skyGlow, P.sunCore, 0.2), 'halo rim'),
        buf.tone(tint(P.skyGlow, P.sunCore, 0.45), 'halo outer'),
        buf.tone(tint(P.skyHorizon, P.sunCore, 0.55), 'halo inner'),
        buf.tone(tint(P.skyHorizon, P.sunCore, 0.8), 'halo bright'),
        buf.tone(P.sunCore, 'halo core'),
      ]);

      // The ground as a dithered aerial-perspective ramp, not one flat fill. It is ~40% of
      // the frame, so a single tone here contributes one colour and zero detail to a very
      // large area — which is exactly what the measurement found.
      //
      // Lighter than a street "should" be, deliberately. This plane is ~40% of the frame
      // and every pixel of it was in the darkest luminance band; wet tarmac under a
      // sodium sky reflects that sky, which is both true and what moves the value
      // structure. The near end still sinks toward cool dark so the plane reads as
      // receding rather than as a flat sheet.
      buf.vRamp(
        left,
        horizon,
        full,
        below + bleed,
        gradientRamp(
          buf.palette,
          [
            { at: 0, hex: tint(P.ground, P.skyGlow, 0.58) },
            { at: 0.2, hex: tint(P.ground, P.skyGlow, 0.38) },
            { at: 0.55, hex: tint(P.ground, P.skyGlow, 0.14) },
            { at: 1, hex: tint(P.ground, COOL, 0.46) },
          ],
          14,
          'ii-ground',
        ),
      );

      const iRoad = buf.tone(P.road, 'road');
      const iSheen = buf.tone(tint(P.road, P.skyGlow, 0.42), 'road sheen');
      const iKerb = buf.tone(tint(P.road, P.skyMid, 0.34), 'kerb');
      buf.poly(roadPoints, iRoad);
      // The road carries its own ramp rather than one flat fill: it is the largest single
      // surface below the horizon, and a flat fill contributes one colour and no detail to
      // it. Painted row by row in the pass below, because `vRamp` fills rectangles and this
      // surface is a winding polygon.
      const roadRamp = gradientRamp(
        buf.palette,
        [
          { at: 0, hex: tint(P.road, P.skyGlow, 0.44) },
          { at: 0.45, hex: tint(P.road, P.skyGlow, 0.18) },
          { at: 1, hex: tint(P.road, COOL, 0.26) },
        ],
        10,
        'ii-road',
      );

      // Reflected saturation: visibly darker and lower in chroma than its source (§5).
      // The brightest step is still 55% of the way to the road tone, so the streak reads
      // as wet tarmac carrying a light rather than as a second light source — the thing
      // the rule exists to prevent.
      const reflectTones = [
        [
          buf.tone(tint(P.cyan, P.road, 0.8), 'reflect cyan dim'),
          buf.tone(tint(P.cyan, P.road, 0.67), 'reflect cyan'),
          buf.tone(tint(P.cyan, P.road, 0.55), 'reflect cyan bright'),
        ],
        [
          buf.tone(tint(P.magenta, P.road, 0.8), 'reflect magenta dim'),
          buf.tone(tint(P.magenta, P.road, 0.67), 'reflect magenta'),
          buf.tone(tint(P.magenta, P.road, 0.55), 'reflect magenta bright'),
        ],
      ];
      const sources = [0.38, 0.62];

      // One pass down the visible road: wet sheen, then the two reflections, then the
      // kerbs on top. All of it is clamped to the road's own edges at that depth, so the
      // reflection is on the wet surface rather than floating over the pavement.
      const yFrom = Math.max(0, buf.ay(wallBase));
      const yTo = Math.min(buf.h, buf.ay(h + bleed) + 1);
      for (let cy = yFrom; cy < yTo; cy++) {
        const sy = buf.sy(cy);
        // Clamped at both ends. `windingRoad` samples its near edge at exactly d = 1 and
        // then extends that width down to `h + bleed`; without the upper clamp the last
        // few rows here compute d > 1, and `roadHalf` — which does not clamp — hands back
        // a road several pixels wider than the polygon underneath it.
        const d = Math.min(1, Math.max(WALL_DEPTH, (sy - horizon) / (bottomY - horizon)));
        const t = (d - WALL_DEPTH) / (1 - WALL_DEPTH);
        const rc = roadCentre(geo, d, WIND);
        const rh = roadHalf(geo, d, ROAD_NEAR_HALF, 0);
        const x0 = Math.max(0, buf.ax(rc - rh));
        const x1 = Math.min(buf.w, buf.ax(rc + rh));
        if (x1 <= x0) continue;

        // The road's own depth ramp, dithered between adjacent steps exactly as `vRamp`
        // would, then wet scatter over it. Tarmac catches the sky in horizontal ripples,
        // never as a smooth sheet.
        const exact = t * (roadRamp.length - 1);
        const low = Math.min(roadRamp.length - 1, Math.floor(exact));
        const high = Math.min(roadRamp.length - 1, low + 1);
        const frac = exact - low;
        const ripple = noise(0, cy, 4, 4409);
        for (let cx = x0; cx < x1; cx++) {
          const bias = bayer(cx, cy);
          buf.set(cx, cy, (frac > bias ? roadRamp[high] : roadRamp[low]) as number);
          const sheen = ripple * noise(cx, cy, 9, 2287) * (0.5 + t * 0.7);
          if (sheen > bias) buf.set(cx, cy, iSheen);
        }

        for (let s = 0; s < sources.length; s++) {
          const cx0 = sources[s] as number;
          const tones = reflectTones[s] as number[];
          // The streak starts under its own monolith and is drawn onto the road as it
          // comes toward the viewer.
          //
          // Anchoring it to a fixed screen x instead put the magenta streak off the right
          // edge of the road for most of its length — the road winds, and at mid depth the
          // weave carries it left while the near end swings right — so one source
          // reflected and the other did not. §5 wants both reflections traceable to a
          // source above them; it does not want one of them deleted by the meander.
          const side = cx0 < 0.5 ? -1 : 1;
          const anchor = w * cx0;
          const onRoad = rc + side * rh * 0.5;
          const centre = buf.ax(anchor + (onRoad - anchor) * (0.35 + t * 0.65));
          const half = Math.max(1, (w * (0.014 + t * 0.06)) / cellPx(buf));
          const from = Math.max(x0, Math.round(centre - half));
          const to = Math.min(x1, Math.round(centre + half));
          const streak = 0.5 + ripple * 0.95;
          for (let cx = from; cx < to; cx++) {
            const u = (cx - centre) / half;
            const cover = (1 - Math.abs(u) ** 1.4) * streak * (0.62 + t * 0.7);
            if (cover <= bayer(cx, cy)) continue;
            const step = Math.min(tones.length - 1, Math.floor(cover * tones.length));
            buf.set(cx, cy, tones[step] as number);
          }
        }

        buf.set(x0, cy, iKerb);
        buf.set(x1 - 1, cy, iKerb);
      }
    },
    // The only smooth gradient in the SVG twin (§3), and it exists for reduced motion only.
    free:
      `<defs><linearGradient id="ii-sky" x1="0" y1="0" x2="0" y2="${r(horizon)}" gradientUnits="userSpaceOnUse">` +
      SKY_STOPS.map((s) => `<stop offset="${(s.at * 100).toFixed(0)}%" stop-color="${s.hex}"/>`).join('') +
      `</linearGradient></defs>` +
      rect(left, -bleed, full, horizon + bleed, 'url(#ii-sky)'),
    locked:
      circle(vp, horizon, sunR * 1.25, tint(P.skyHorizon, '#FFFFFF', 0.08), ' fill-opacity="0.5"') +
      circle(vp, horizon, sunR, P.sunCore) +
      rect(left, horizon, full, below + bleed, P.ground) +
      poly(roadPoints, P.road) +
      reflections,
  };

  // ---- slot 6 — particulate haze, denser than Act I -------------------------
  const hazeBand = h * 0.09;
  const haze: SlotArt = {
    verb: 'crossfade',
    /**
     * A uniform wash, not a dither, and this is the one place in the act where alpha is
     * load-bearing.
     *
     * `check:invariant` reads the horizon as a tonal step across the vanishing-point
     * corridor. A wash tints both sides equally and leaves the step intact; a dither lands
     * the haze tone on one side and not the other in alternating rows, which turns every
     * art row boundary near the horizon into a stronger boundary than the horizon itself.
     * That was measured on Act I at 100% coverage two art cells high.
     *
     * The tone is §5's `#8A7A6A` carried most of the way to the horizon burn: a 45% wash
     * of the raw sodium over a bright sky pulls the whole horizon band back down into the
     * dark end, which is the thing this act was rebuilt to stop doing. Carried this far it
     * is close to the sky's own value at that height, so it barely touches the sky and
     * does its work on the ground below the horizon — which is where particulate haze is
     * actually visible from a street.
     */
    alpha: 0.38,
    draw: (buf) => {
      buf.rect(
        left,
        horizon - hazeBand,
        full,
        hazeBand * 2,
        buf.tone(tint(P.skyMid, P.skyHorizon, 0.7), 'haze'),
      );
    },
    free: rect(left, horizon - hazeBand, full, hazeBand * 2, P.skyMid, ' fill-opacity="0.45"'),
  };

  // ---- slot 5 — the far skyline and the two monoliths -----------------------
  // The monoliths flank the VP at 38vw and 62vw, rising past the top of the frame — no
  // visible tops. They are the only saturated structures on screen and they own all the
  // colour. The skyline stands behind them, three tiers deep and hazing back.
  const ridge: SlotArt = {
    verb: 'rise',
    clipBottom: horizon,
    travelPx: h * 0.3,
    draw: (buf) => {
      for (let tier = 0; tier < 3; tier++) drawSkyline(buf, geo, tier);
      for (const m of MONOLITHS) drawMonolith(buf, geo, m);
    },
    free: MONOLITHS.map((m) => monolithMarkup(geo, m)).join(''),
  };

  // ---- slot 4 — the wall closing the road ----------------------------------
  // Continuous, no gate. The VP stays visible above it.
  let wall = rect(left, wallTop, full, wallH + 4, shade(P.slumC, 0.12));
  for (let i = 0; i <= 22; i++) {
    const bx = left + (full / 22) * i;
    wall += rect(bx - w * 0.0015, wallTop, w * 0.003, wallH, shade(P.slumC, 0.32));
  }
  wall += rect(left, wallTop, full, wallH * 0.09, shade(P.slumC, 0.34));
  wall += rect(left, wallTop, full, Math.max(wallH * 0.018, 2), tint(P.slumB, P.skyHorizon, 0.3));
  wall += rect(left, wallBase - wallH * 0.12, full, wallH * 0.12 + 4, shade(P.slumC, 0.42));
  for (let i = 0; i < 26; i++) {
    const sx = left + (((i * 137.5) % 100) / 100) * full;
    const sw = w * (0.004 + (((i * 7) % 5) / 5) * 0.01);
    wall += rect(sx, wallTop, sw, wallH * (0.3 + (((i * 11) % 7) / 7) * 0.5), shade(P.slumC, 0.26));
  }

  const behindWall = SLUMS.filter((sl) => sl.d < WALL_DEPTH);

  /**
   * The wall.
   *
   * Cast in sections and streaked: a vertical ramp catching the sky at its capping course
   * and going to grime at the plinth, panel joints every section, and run-off stains
   * dithered down from the top. It is a large flat object in the middle of the frame, so
   * every one of those is load-bearing on both the palette and the detail count.
   *
   * Its top edge sits at `horizon + 0.085 * below` — twelve art rows below the horizon at
   * 1440 and ten at 390, well clear of the ±2-row window `check:invariant` searches for
   * the strongest boundary.
   */
  const drawWall = (buf: Buf): void => {
    const cell = cellPx(buf);
    buf.vRamp(
      left,
      wallTop,
      full,
      wallH,
      gradientRamp(
        buf.palette,
        [
          // Cast concrete under a sodium sky, and lit by it. Kept a whole luminance band
          // above the slums in front of it: the wall has to read as the thing closing the
          // road, and a wall the same value as the buildings beside it reads as more
          // building.
          { at: 0, hex: tint(P.slumC, P.skyGlow, 0.58) },
          { at: 0.3, hex: tint(P.slumC, P.skyGlow, 0.34) },
          { at: 1, hex: shadeHue(P.slumC, 0.3, COOL, P.skyGlow) },
        ],
        9,
        'ii-wall',
      ),
    );

    const iJoint = buf.tone(shadeHue(P.slumC, 0.3, COOL, P.skyGlow), 'wall joint');
    const iCap = buf.tone(shadeHue(P.slumC, 0.4, COOL, P.skyGlow), 'wall cap');
    const iCapLit = buf.tone(tint(P.slumB, P.skyHorizon, 0.42), 'wall cap lit');
    const iStain = buf.tone(shadeHue(P.slumC, 0.5, COOL, P.skyGlow), 'wall stain');
    const iPlinth = buf.tone(shade(P.slumC, 0.66), 'wall plinth');

    // Panel joints. One cell, low contrast, and few: at twenty-two sections with a lit
    // pilaster beside each dark one the wall read as railings rather than as cast
    // concrete, which is the opposite of "continuous, no gate".
    const sections = 13;
    for (let i = 0; i <= sections; i++) {
      const bx = left + (full / sections) * i;
      buf.rect(bx, wallTop, cell, wallH, iJoint);
    }
    // One form-work line: the seam between the two pours. More than one, crossed with the
    // panel joints, and the wall reads as chain-link rather than as concrete.
    buf.rect(left, wallTop + wallH * 0.42, full, cell, iJoint);

    // Capping course, and the smog catching its upper edge.
    buf.rect(left, wallTop, full, wallH * 0.07, iCap);
    buf.rect(left, wallTop, full, Math.max(wallH * 0.018, cell), iCapLit);
    // A comb of spikes along the top. Cheap, one cell wide, and it says "no gate" faster
    // than any amount of wall does.
    for (let i = 0; i < 132; i++) {
      const sx = left + (full / 132) * i;
      buf.rect(sx, wallTop - cell * 2, cell, cell * 2, iCap);
    }

    // Run-off stains from the capping: a solid core with a dithered halo either side, so
    // each one reads as a streak. Dithering the whole width instead turned the wall into
    // an even screen of dots — over a large flat surface that is the screen-door artifact
    // art-direction §3 warns about, arrived at from the other direction.
    for (let i = 0; i < 24; i++) {
      const sx = left + (((i * 137.5) % 100) / 100) * full;
      const sw = w * (0.003 + (((i * 7) % 5) / 5) * 0.009);
      const sh = wallH * (0.26 + (((i * 11) % 7) / 7) * 0.5);
      buf.rectDither(sx - sw, wallTop, sw * 3, sh, iStain, (t) => 0.34 * (1 - t));
      buf.rect(sx, wallTop, Math.max(sw * 0.35, cell), sh * 0.72, iStain);
    }

    // A darker plinth where it meets the ground, so it sits rather than floats.
    buf.rect(left, wallBase - wallH * 0.13, full, wallH * 0.13, iPlinth);
    buf.rectDither(left, wallBase - wallH * 0.34, full, wallH * 0.22, iPlinth, (t) => t * 0.8);
  };

  const far: SlotArt = {
    verb: 'rise',
    clipBottom: wallBase,
    // Slums first, wall second: the wall must occlude what stands behind it.
    draw: (buf) => {
      const tones = new Set<number>();
      for (const sl of behindWall) {
        for (const t of drawSlum(buf, geo, sl)) tones.add(t);
      }
      buf.outline(tones, buf.tone(slumLine(behindWall), 'slum line'));
      drawWall(buf);
    },
    free:
      outlined(behindWall.map((sl) => slumMarkup(geo, sl)).join(''), slumLine(behindWall), 1.5) +
      wall,
  };

  // ---- slots 3 and 2 — the slums -------------------------------------------
  /**
   * Cables strung across the street.
   *
   * The single most city-evocative mark available at this depth, and it is two lines: the
   * slums on both sides are wired to each other, over the road, at head height for a
   * building. Drawn once per slot rather than per slum, because a cable belongs to the gap
   * between two buildings and not to either of them.
   */
  const drawCables = (buf: Buf, fromD: number, toD: number, index: number): void => {
    for (let i = 0; i < 9; i++) {
      const d = fromD + ((toD - fromD) * (i + 0.5)) / 9;
      const sc = depthScale(geo, d);
      const gy = groundY(geo, d);
      const rc = roadCentre(geo, d, WIND);
      const rh = roadHalf(geo, d, ROAD_NEAR_HALF, 0);
      const hang = (geo.h - horizon) * (0.42 + hash2(i, 3, 517) * 0.3) * sc;
      const sag = hang * (0.1 + hash2(i, 7, 619) * 0.12);
      const yl = gy - hang;
      const yr = gy - hang * (0.88 + hash2(i, 11, 727) * 0.2);
      buf.line(rc - rh, yl, rc, Math.max(yl, yr) + sag, index, 1);
      buf.line(rc, Math.max(yl, yr) + sag, rc + rh, yr, index, 1);
    }
  };

  const midSlums = SLUMS.filter((sl) => sl.d >= WALL_DEPTH && sl.d < 0.8);
  const nearSlums = SLUMS.filter((sl) => sl.d >= 0.8);

  const mid: SlotArt = {
    verb: 'extrude',
    clipBottom: groundY(geo, 0.8),
    draw: (buf) => {
      const tones = new Set<number>();
      for (const sl of midSlums) {
        for (const t of drawSlum(buf, geo, sl)) tones.add(t);
      }
      const iLine = buf.tone(slumLine(midSlums), 'slum line');
      buf.outline(tones, iLine);
      drawCables(buf, WALL_DEPTH, 0.8, iLine);
    },
    free: outlined(midSlums.map((sl) => slumMarkup(geo, sl)).join(''), slumLine(midSlums), 1.5),
  };

  const near: SlotArt = {
    verb: 'extrude',
    clipBottom: h + bleed,
    draw: (buf) => {
      const tones = new Set<number>();
      for (const sl of nearSlums) {
        for (const t of drawSlum(buf, geo, sl)) tones.add(t);
      }
      const iLine = buf.tone(slumLine(nearSlums), 'slum line');
      buf.outline(tones, iLine);
      drawCables(buf, 0.82, 1.15, iLine);
    },
    free: outlined(nearSlums.map((sl) => slumMarkup(geo, sl)).join(''), slumLine(nearSlums), 2.5),
  };

  // ---- slot 1 — near ground. Nothing full-width (build.md B11). -------------
  // A band across this slot paints in front of slots 2–5 and occludes the whole scene.
  // That bug has landed three times; the rule is the fix.
  let foreground = '';
  for (let i = 0; i < 16; i++) {
    const t = ((i * 41) % 100) / 100;
    const x = w * (0.02 + t * 0.96);
    const y = h - below * (0.004 + (((i * 17) % 7) / 7) * 0.05);
    const s = w * (0.003 + (((i * 13) % 5) / 5) * 0.005);
    foreground += rect(x - s, y - s * 0.5, s * 2, s * 0.5, shade(P.road, 0.3));
  }

  const ground: SlotArt = {
    verb: 'crossfade',
    draw: (buf) => {
      const cell = cellPx(buf);
      const iKerbStone = buf.tone(shadeHue(P.road, 0.34, COOL, P.skyGlow), 'kerb stone');
      const iKerbLit = buf.tone(tint(P.road, P.skyMid, 0.4), 'kerb stone lit');
      const iPuddle = buf.tone(tint(P.road, P.skyGlow, 0.44), 'puddle');
      const iPuddleDeep = buf.tone(tint(P.road, P.skyLower, 0.26), 'puddle deep');

      // Broken kerb stones and rubble at the very front of the frame.
      for (let i = 0; i < 22; i++) {
        const t = ((i * 41) % 100) / 100;
        const x = w * (0.02 + t * 0.96);
        const y = h - below * (0.004 + (((i * 17) % 7) / 7) * 0.05);
        const s = w * (0.003 + (((i * 13) % 5) / 5) * 0.005);
        buf.rect(x - s, y - s * 0.5, s * 2, s * 0.5, iKerbStone);
        buf.rect(x - s, y - s * 0.5, s * 2, cell, iKerbLit);
      }

      // Standing water, reflecting the sodium sky rather than either monolith: this is
      // ground level and the only saturation permitted here is traceable to a source
      // directly above it, which a puddle at the frame edge is not.
      for (let i = 0; i < 7; i++) {
        const px = w * (0.05 + (((i * 29) % 100) / 100) * 0.9);
        const py = h - below * (0.01 + (((i * 23) % 5) / 5) * 0.06);
        const pw = w * (0.02 + (((i * 13) % 4) / 4) * 0.035);
        const ph = pw * 0.22;
        const x0 = Math.max(0, buf.ax(px - pw));
        const x1 = Math.min(buf.w, buf.ax(px + pw));
        const y0 = Math.max(0, buf.ay(py - ph));
        const y1 = Math.min(buf.h, buf.ay(py + ph));
        for (let cy = y0; cy < y1; cy++) {
          for (let cx = x0; cx < x1; cx++) {
            const u = (cx - (x0 + x1) / 2) / Math.max(1, (x1 - x0) / 2);
            const v = (cy - (y0 + y1) / 2) / Math.max(1, (y1 - y0) / 2);
            const cover = 1 - (u * u + v * v);
            if (cover <= 0) continue;
            if (cover < 0.45 && cover * 1.6 <= bayer(cx, cy)) continue;
            buf.set(cx, cy, cover > 0.62 ? iPuddle : iPuddleDeep);
          }
        }
      }
    },
    free: foreground,
  };

  // ---- slot 0 — blimps and ash ---------------------------------------------
  // Invented glyph forms on the ad panels: original geometric constructions that read as
  // writing without being any real script (§5). Never real text in any language.
  const glyph = (gx: number, gy: number, size: number, seed: number, fill: string): string => {
    const next = lcg(seed);
    let out = '';
    const strokes = 3 + Math.floor(next() * 3);
    for (let i = 0; i < strokes; i++) {
      const vertical = next() > 0.45;
      const ox = gx + size * next() * 0.6;
      const oy = gy + size * next() * 0.6;
      if (vertical) {
        out += rect(ox, oy, Math.max(size * 0.1, 1), size * (0.3 + next() * 0.5), fill);
      } else {
        out += rect(ox, oy, size * (0.3 + next() * 0.6), Math.max(size * 0.1, 1), fill);
      }
    }
    return out;
  };

  const drawGlyph = (
    buf: Buf,
    gx: number,
    gy: number,
    size: number,
    seed: number,
    index: number,
  ): void => {
    const next = lcg(seed);
    const cell = cellPx(buf);
    const strokes = 3 + Math.floor(next() * 3);
    for (let i = 0; i < strokes; i++) {
      const vertical = next() > 0.45;
      const ox = gx + size * next() * 0.6;
      const oy = gy + size * next() * 0.6;
      if (vertical) buf.rect(ox, oy, cell, size * (0.3 + next() * 0.5), index);
      else buf.rect(ox, oy, size * (0.3 + next() * 0.6), cell, index);
    }
  };

  const blimp = (cx: number, cy: number, len: number, panel: string, seed: number): string => {
    const bh = len * 0.34;
    let out = '';
    const bands = 5;
    for (let i = 0; i < bands; i++) {
      const t = (i + 0.5) / bands;
      const bw = len * Math.sin(Math.PI * t);
      out += rect(cx - bw / 2, cy - bh / 2 + (bh / bands) * i, bw, bh / bands, P.blimp);
    }
    out += rect(cx - len * 0.36, cy + bh * 0.1, len * 0.72, bh * 0.22, shade(P.blimp, 0.3));
    out += rect(cx - len * 0.12, cy + bh * 0.42, len * 0.24, bh * 0.2, shade(P.blimp, 0.4));
    const pw = len * 0.46;
    const ph = bh * 0.44;
    out += rect(cx - pw / 2, cy - ph / 2, pw, ph, panel);
    for (let g = 0; g < 4; g++) {
      out += glyph(
        cx - pw / 2 + pw * 0.08 + g * pw * 0.23,
        cy - ph * 0.3,
        ph * 0.6,
        seed + g * 17,
        shade(panel, 0.62),
      );
    }
    return out;
  };

  /**
   * A blimp: stepped hull bands, a gondola, and the ad panel.
   *
   * The panel is one of exactly three places saturation is permitted in this act, and it
   * is the only one that moves. Everything structural on the hull is grey.
   */
  const drawBlimp =
    (cx: number, cy: number, len: number, panel: string, seed: number) =>
    (buf: Buf): void => {
      const bh = len * 0.34;
      const cell = cellPx(buf);
      const iHull = buf.tone(P.blimp, 'blimp hull');
      const iHullLit = buf.tone(shadeHue(P.blimp, -0.34, COOL, P.skyGlow), 'blimp hull lit');
      const iHullDark = buf.tone(shadeHue(P.blimp, 0.38, COOL, P.skyGlow), 'blimp hull dark');
      const iFin = buf.tone(shade(P.blimp, 0.45), 'blimp fin');
      const iPanel = buf.tone(panel, 'blimp panel');
      const iPanelDim = buf.tone(tint(panel, P.blimp, 0.45), 'blimp panel dim');
      const iGlyph = buf.tone(shade(panel, 0.66), 'blimp glyph');

      const bands = 9;
      for (let i = 0; i < bands; i++) {
        const t = (i + 0.5) / bands;
        const bw = len * Math.sin(Math.PI * t);
        const y = cy - bh / 2 + (bh / bands) * i;
        buf.rect(
          cx - bw / 2,
          y,
          bw,
          bh / bands,
          i < 2 ? iHullLit : i > bands - 4 ? iHullDark : iHull,
        );
      }
      // Longitudinal seams: the ribs of the envelope, one cell each.
      for (const k of [-0.62, -0.28, 0.28, 0.62] as const) {
        buf.rect(cx - len * 0.44, cy + bh * k * 0.5, len * 0.88, cell, iHullDark);
      }
      buf.rect(cx - len * 0.36, cy + bh * 0.1, len * 0.72, bh * 0.2, iHullDark);
      // Tail fins.
      buf.poly(
        [
          [cx - len * 0.5, cy],
          [cx - len * 0.36, cy - bh * 0.5],
          [cx - len * 0.3, cy - bh * 0.16],
        ],
        iFin,
      );
      buf.poly(
        [
          [cx - len * 0.5, cy],
          [cx - len * 0.36, cy + bh * 0.5],
          [cx - len * 0.3, cy + bh * 0.16],
        ],
        iFin,
      );
      // Gondola.
      buf.rect(cx - len * 0.12, cy + bh * 0.42, len * 0.24, bh * 0.2, iFin);
      buf.rect(cx - len * 0.09, cy + bh * 0.46, len * 0.18, cell, iHullLit);

      const pw = len * 0.46;
      const ph = bh * 0.44;
      buf.rect(cx - pw / 2, cy - ph / 2, pw, ph, iPanel);
      // The panel is a screen, so its lower half is dimmer — the refresh, frozen.
      buf.rectDither(cx - pw / 2, cy - ph / 2, pw, ph, iPanelDim, (t) => t * 0.55);
      for (let g = 0; g < 4; g++) {
        drawGlyph(
          buf,
          cx - pw / 2 + pw * 0.08 + g * pw * 0.23,
          cy - ph * 0.3,
          ph * 0.6,
          seed + g * 17,
          iGlyph,
        );
      }
    };

  // Ash falling. Grey, never warm.
  let ash = '';
  for (let i = 0; i < 40; i++) {
    const x = w * (((i * 37) % 100) / 100);
    const y = h * (((i * 61) % 100) / 100);
    ash += rect(x, y, Math.max(w * 0.0014, 1), Math.max(h * 0.005, 2), '#6E6E72', ' fill-opacity="0.4"');
  }

  return [
    {
      verb: 'drift',
      draw: (buf) => {
        const cell = cellPx(buf);
        // Two tones: ash reads dark against the sky and light against the road, and one
        // tone can only do one of those. Resolved to opaque tones rather than dithered —
        // a fleck one or two cells across, dithered at 40%, is erased outright. That is
        // the mistake that rendered Act III's music motes as zero pixels.
        const iAsh = buf.tone(tint(P.road, P.skyMid, 0.45), 'ash');
        const iAshDim = buf.tone(tint(P.road, P.skyMid, 0.18), 'ash dim');
        for (let i = 0; i < 110; i++) {
          const x = w * (((i * 37) % 101) / 101) + w * 0.004 * (((i * 7) % 5) - 2);
          const y = h * (((i * 61) % 103) / 103);
          const tall = (i % 3 === 0 ? 3 : 2) * cell;
          buf.rect(x, y, cell, tall, i % 4 === 0 ? iAshDim : iAsh);
        }
      },
      free: ash,
      // Three blimps at different depths and speeds, drifting horizontally.
      parts: [
        {
          draw: drawBlimp(w * 0.24, h * 0.17, w * 0.2, P.magenta, 5),
          markup: blimp(w * 0.24, h * 0.17, w * 0.2, P.magenta, 5),
          rate: 0.42,
        },
        {
          draw: drawBlimp(w * 0.7, h * 0.09, w * 0.13, P.cyan, 23),
          markup: blimp(w * 0.7, h * 0.09, w * 0.13, P.cyan, 23),
          rate: 0.26,
        },
        {
          draw: drawBlimp(w * 0.52, h * 0.29, w * 0.09, P.magenta, 41),
          markup: blimp(w * 0.52, h * 0.29, w * 0.09, P.magenta, 41),
          rate: 0.15,
        },
      ],
    },
    ground,
    near,
    mid,
    far,
    ridge,
    haze,
    sky,
  ];
}

export const ACT_II: ActDefinition = {
  id: 'ii',
  name: 'Closed Frontier',
  build,
};
