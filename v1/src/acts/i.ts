/**
 * Act I — The Frontier, dawn. art-direction.md §4.
 *
 * The shot: standing at the near end of the street, looking down it. Road running past the
 * last building into open land, sun rising exactly where the road disappears. Nothing
 * blocks the way out.
 *
 * The town is three buildings, at Act IV's placements — client direction. What separates
 * this act from Act IV is the light, not the density: a risen sun against a horizon glow,
 * a warm palette against a cooled one, more windows lit, a narrower road.
 *
 * On where the ground lives. The brief's slot table puts "near ground, road surface,
 * shadows" in slot 1, which paints *in front of* slots 2–5. A ground plane spans every
 * depth at once, so putting its fill in a near slot occludes everything behind it — and
 * anything converging on the VP has to be VP-registered anyway. Base plane, road, ruts and
 * cast shadows therefore live in slot 7's locked group; slot 1 keeps only what is genuinely
 * nearer than the buildings.
 */

import type { ActDefinition, Geometry, SlotArt } from './types.ts';
import { bayer, type Buf } from '../art/buffer.ts';
import { gradientRamp, multiply, over, parseHex, toHex } from '../art/palette.ts';
import { cloudTones, drawBandedSun, drawCloudBand } from '../art/sky.ts';
import {
  circle,
  clearsVP,
  depthScale,
  groundY,
  line,
  poly,
  rect,
  roadHalf,
  setPixelGrid,
  shade,
  shadeHue,
  tint,
} from './shared.ts';

const P = {
  skyZenith: '#1B2A4A',
  skyUpper: '#4A5B8C',
  skyMid: '#C97B5A',
  skyLower: '#F2A65A',
  skyHorizon: '#FFD9A0',
  sunCore: '#FFE8B0',
  sunRim: '#FF9E4F',
  mesa: '#6B5B7B',
  midGround: '#A87C5F',
  desert: '#C89A6B',
  desertHigh: '#D8AC7C',
  desertShadow: '#7A5C4A',
  road: '#BC8F63',
  rut: '#A87C5F',
  town: '#3E2E2E',
  window: '#FFE8B0',
  accent: '#FF5E3A',
  castShadow: '#4A5B8C',
  /** Cloud bodies. Salmon over the blue upper sky, warming toward the horizon. */
  cloud: '#C98A86',
  cloudWarm: '#E0A07A',
} as const;

const TOWN_LINE = shade(P.town, 0.2);
const RIM = '#8A5A3E';
const RIM_FAR = '#6E4636';
const ROAD_NEAR_HALF = 0.24;

interface Building {
  readonly side: -1 | 1;
  readonly d: number;
  readonly width: number;
  readonly height: number;
  readonly falseFront: boolean;
  readonly cols: number;
  readonly rows: number;
  readonly seed: number;
}

/**
 * Eight buildings, forming a street rather than three towers in open desert.
 *
 * Two changes from the original three, both at the client's direction and both about
 * matching the reference: **shorter** — heights drop from 0.82-1.10 of the ground plane to
 * 0.40-0.62, so these read as two-storey frontier buildings rather than blocks — and
 * **denser**, alternating sides down the road so the eye is led to the vanishing point by a
 * continuous receding wall. Wider relative to their height, too, which is what a false-front
 * street actually looks like.
 *
 * Act I and Act IV share these marks exactly, so the loop reads as one place seen twice.
 * Change one and you must change the other.
 */
/**
 * No town. Client direction: Act I and Act IV are open frontier, nothing built on it.
 *
 * Kept as an empty typed array rather than deleting the machinery, because Act IV shares
 * these marks and the two acts must stay able to hold buildings together or not at all.
 * Everything downstream — the facades, the cast shadows, the cel outline, the porch lamp —
 * is written to degrade to nothing on an empty list.
 */
const TOWN: readonly Building[] = [];

function facade(
  geo: Geometry,
  b: Building,
): { x: number; width: number; base: number; height: number } {
  const scale = depthScale(geo, b.d);
  const base = groundY(geo, b.d);
  const inner = geo.vp + b.side * roadHalf(geo, b.d, ROAD_NEAR_HALF, 0);
  const width = geo.w * b.width * scale;
  const height = (geo.h - geo.horizon) * b.height * scale;
  return { x: b.side === -1 ? inner - width : inner, width, base, height };
}


/** The shadow a building throws toward the viewer, the sun being at the vanishing point. */
function castShadowPoints(geo: Geometry, b: Building): (readonly [number, number])[] {
  const { x, width, base } = facade(geo, b);
  const scale = depthScale(geo, b.d);
  // Long, and mostly toward the viewer: the sun is low and directly at the VP, so the
  // lateral component is small. A wide splay reads as a grey slab beside the building.
  const length = (geo.h - geo.horizon) * 1.15 * scale;
  const spread = ((x + width / 2 - geo.vp) / geo.w) * length * 0.75;
  return [
    [x, base],
    [x + width, base],
    [x + width + spread, base + length],
    [x + spread, base + length],
  ];
}


/**
 * Buffer version of `buildingMarkup`. Same composition, painted as pixels.
 *
 * Returns the tones it used, so the caller can outline the group's *silhouette* rather
 * than every internal tone boundary.
 */
function drawBuilding(buf: Buf, geo: Geometry, b: Building): number[] {
  const { x, width, base, height } = facade(geo, b);
  const roofY = base - height;
  const body = tint(P.town, P.skyHorizon, Math.max(0, (1 - b.d) * 0.3));
  // Hue-shifted planes: shadowed faces take colour from the sky and go violet, lit ones
  // take colour from the sun and go gold. Multiples of one hue read as one flat colour at
  // three brightnesses, which is most of why the palette measured shallow.
  const iBody = buf.tone(body, 'town body');
  const iBodyLit = buf.tone(shadeHue(body, -0.28), 'town body lit');
  const iRoof = buf.tone(shadeHue(body, 0.34), 'roof');
  const iAwning = buf.tone(shadeHue(body, 0.46), 'awning');
  const iPost = buf.tone(shadeHue(body, 0.6), 'post');
  const iWindow = buf.tone(P.window, 'window');
  const iWindowWarm = buf.tone(tint(P.window, P.accent, 0.28), 'window warm');
  const iRim = buf.tone(tint(b.d < 0.6 ? RIM_FAR : RIM, P.sunRim, 0.55), 'rim');

  buf.rect(x, roofY, width, height, iBody);
  // The upper part of the facade catches more sky light than the lower, feathered into it
  // rather than banded: a hard horizontal edge across a flat wall reads as a stripe painted
  // on the building instead of as light falling on it.
  buf.rect(x, roofY, width, height * 0.2, iBodyLit);
  buf.rectDither(x, roofY + height * 0.2, width, height * 0.22, iBodyLit, (t) => 1 - t);

  if (b.falseFront) {
    const parapet = height * 0.15;
    buf.rect(x - width * 0.03, roofY - parapet, width * 1.06, parapet, iBody);
    buf.rect(x - width * 0.03, roofY - parapet, width * 1.06, parapet * 0.24, iRoof);
  } else {
    const pitch = height * 0.13;
    buf.poly(
      [
        [x - width * 0.05, roofY],
        [x + width / 2, roofY - pitch],
        [x + width * 1.05, roofY],
      ],
      iRoof,
    );
  }

  const awning = width * 0.24;
  const awningX = b.side === -1 ? x + width - awning : x;
  const awningY = base - height * 0.3;
  buf.rect(awningX, awningY, awning, height * 0.045, iAwning);
  buf.rect(
    b.side === -1 ? awningX : awningX + awning - width * 0.02,
    awningY,
    width * 0.02,
    height * 0.3,
    iPost,
  );

  // Window grid, same hash and density as the SVG version.
  const gx = x + width * 0.12;
  const gy = roofY + height * 0.2;
  const gw = width * 0.76;
  const gh = height * 0.44;
  const density = 0.52 + ((b.seed * 37) % 30) / 100;
  const cellW = gw / b.cols;
  const cellH = gh / b.rows;
  const paneW = cellW * 0.46;
  const paneH = cellH * 0.42;
  for (let row = 0; row < b.rows; row++) {
    for (let col = 0; col < b.cols; col++) {
      const hash = ((row * 73856093) ^ (col * 19349663) ^ (b.seed * 83492791)) >>> 0;
      if ((hash % 1000) / 1000 > density) continue;
      buf.rect(
        gx + col * cellW + (cellW - paneW) / 2,
        gy + row * cellH + (cellH - paneH) / 2,
        paneW,
        paneH,
        (hash >>> 7) % 3 === 0 ? iWindowWarm : iWindow,
      );
    }
  }

  const roofSeed = b.seed * 2654435761;
  if (roofSeed % 3 !== 0) {
    const cw = width * 0.09;
    const cx = x + width * (0.2 + ((roofSeed >>> 7) % 50) / 100);
    buf.rect(cx, roofY - height * 0.13, cw, height * 0.13, iBody);
    buf.rect(cx - cw * 0.2, roofY - height * 0.15, cw * 1.4, height * 0.025, iRoof);
  }

  // Rim light on the road-facing edge: the sun is at the VP.
  buf.rect(
    b.side === -1 ? x + width - Math.max(width * 0.018, 2.5) : x,
    roofY,
    Math.max(width * 0.018, 2.5),
    height,
    iRim,
  );

  return [iBody, iBodyLit, iRoof, iAwning, iPost, iWindow, iWindowWarm, iRim];
}

function drawBird(buf: Buf, x: number, y: number, size: number, index: number): void {
  const t = Math.max(size * 0.22, 2);
  buf.line(x - size, y, x - size * 0.34, y - size * 0.5, index, t);
  buf.line(x - size * 0.34, y - size * 0.5, x, y, index, t);
  buf.line(x, y, x + size * 0.34, y - size * 0.5, index, t);
  buf.line(x + size * 0.34, y - size * 0.5, x + size, y, index, t);
}

/** A bird: chunk staircases, never a curve. §3 forbids curves and sub-chunk detail alike. */
function bird(x: number, y: number, size: number, tone: string): string {
  const t = Math.max(size * 0.22, 2);
  return (
    line(x - size, y, x - size * 0.34, y - size * 0.5, tone, t) +
    line(x - size * 0.34, y - size * 0.5, x, y, tone, t) +
    line(x, y, x + size * 0.34, y - size * 0.5, tone, t) +
    line(x + size * 0.34, y - size * 0.5, x + size, y, tone, t)
  );
}


/**
 * Convert a fraction of one tone's cells into a lighter and a darker relative.
 *
 * Bounded to a stage-y band: scanning the whole grid for a region occupying a third of it
 * is the same waste `Buf.outline` was measured for and bounded away from.
 *
 * Writes `buf.idx` directly, so `toY` is exclusive and callers must stop short of the
 * horizon — a speckled horizon row would break the tonal step `check:invariant` reads
 * there, which is the failure the haze dither already caused once.
 */
function speckle(
  buf: Buf,
  from: number,
  lit: number,
  litDensity: number,
  dark: number,
  darkDensity: number,
  fromY: number,
  toY: number,
): void {
  const y0 = Math.max(0, buf.ay(fromY) + 1);
  const y1 = Math.min(buf.h, buf.ay(toY));
  for (let y = y0; y < y1; y++) {
    const row = y * buf.w;
    for (let x = 0; x < buf.w; x++) {
      if (buf.idx[row + x] !== from) continue;
      const t = bayer(x, y);
      if (t < litDensity) buf.idx[row + x] = lit;
      else if (t > 1 - darkDensity) buf.idx[row + x] = dark;
    }
  }
}

function build(geo: Geometry): readonly SlotArt[] {
  setPixelGrid(geo);
  const { w, h, horizon, vp, bleed } = geo;
  const left = -bleed;
  const full = w + bleed * 2;
  const below = h - horizon;
  const sunR = h * 0.09;

  // ---- slot 7 — sky, sun, ground plane, road, ruts, shadows ----------------
  const roadPoints: (readonly [number, number])[] = [
    [vp - roadHalf(geo, 1.0, ROAD_NEAR_HALF, 0), h + bleed],
    [vp, horizon],
    [vp, horizon],
    [vp + roadHalf(geo, 1.0, ROAD_NEAR_HALF, 0), h + bleed],
  ];

  let ruts = '';
  for (const k of [-0.62, -0.2, 0.2, 0.62] as const) {
    ruts += line(
      vp + roadHalf(geo, 1.0, ROAD_NEAR_HALF, 0) * k,
      h + bleed,
      vp,
      horizon,
      P.rut,
      2,
      ' fill-opacity="0.45"',
    );
  }

  const sky: SlotArt = {
    verb: 'crossfade',
    /**
     * The sky, as a banded ramp rather than a smooth gradient.
     *
     * §3 permits one smooth vertical gradient here and nowhere else, and on the SVG
     * substrate that is what this was. An indexed buffer cannot hold it: a true gradient
     * over 174 art rows costs ~174 palette entries, two thirds of the whole budget, for
     * one layer of one act. 32 dithered steps cost 32 and are what the reference skies
     * are actually made of — see docs/plans/pixel-substrate.md.
     */
    draw: (buf) => {
      const steps = gradientRamp(
        buf.palette,
        [
          { at: 0, hex: P.skyZenith },
          { at: 0.32, hex: P.skyUpper },
          { at: 0.64, hex: P.skyMid },
          { at: 0.84, hex: P.skyLower },
          { at: 1, hex: P.skyHorizon },
        ],
        32,
        'i-sky',
      );
      buf.vRamp(left, -bleed, full, horizon + bleed, steps);

      // Three cloud bands at different altitudes, scales and densities. Reading upward:
      // high thin streaks, a heavy mid deck catching the sun, and a low band compressed
      // into the haze near the horizon. All three are lit from the vanishing point, which
      // is where the sun is, so the frame reads as lit from one place.
      const sun = { x: vp, y: horizon };
      for (const spec of [
        {
          top: -bleed,
          bottom: horizon * 0.42,
          scale: 26,
          squash: 3.4,
          coverage: 0.34,
          seed: 1201,
          // Mauve against the blue zenith. Against `skyUpper` — the tone actually behind
          // it — a cloud drawn in `skyUpper` is invisible however correctly it is drawn.
          base: '#7E6E9C',
          sky: P.skyUpper,
          lit: P.skyLower,
          coverageOverride: 0.58,
        },
        {
          top: horizon * 0.3,
          bottom: horizon * 0.78,
          scale: 17,
          squash: 4.2,
          coverage: 0.46,
          seed: 907,
          base: P.cloud,
          sky: P.skyMid,
          lit: P.sunCore,
          coverageOverride: 0.72,
        },
        {
          top: horizon * 0.72,
          bottom: horizon * 0.99,
          scale: 11,
          squash: 6.5,
          coverage: 0.4,
          seed: 613,
          // Darker than the horizon glow it sits on, so the low deck silhouettes rather
          // than washing out — which is what the reference does with its lowest band.
          base: '#A8706A',
          sky: P.skyLower,
          lit: P.sunCore,
          coverageOverride: 0.62,
        },
      ]) {
        drawCloudBand(
          buf,
          {
            top: spec.top,
            bottom: spec.bottom,
            scale: spec.scale,
            squash: spec.squash,
            coverage: spec.coverageOverride,
            seed: spec.seed,
            ...cloudTones(buf.palette, spec.base, spec.sky, spec.lit),
          },
          sun,
        );
      }
    },
    /**
     * Everything registered to an anchor, in paint order: the sun rises *behind* the
     * ground plane, so the plane follows it.
     *
     * Translucent fills are resolved to the tone they produce rather than composited —
     * `tint(background, ink, alpha)` — because the buffer has no alpha. Same result, and
     * the palette stays countable.
     */
    drawLocked: (buf) => {
      drawBandedSun(
        buf,
        vp,
        horizon,
        sunR,
        buf.tone(P.sunCore, 'sun core'),
        buf.tone(tint(P.sunCore, P.sunRim, 0.55), 'sun band'),
        buf.tone(P.sunRim, 'sun rim'),
      );
      // The ground as a dithered aerial-perspective ramp, not one flat fill.
      //
      // Distance is carried by the ground itself: sand near the horizon is washed toward
      // the sky tone by the air between, and warms and deepens as it comes toward the
      // viewer. This is ~40% of the frame, so it is also where most of the palette depth
      // and most of the fine detail have to come from — a single flat fill contributes one
      // colour and zero detail to a very large area.
      const groundRamp = gradientRamp(
        buf.palette,
        [
          { at: 0, hex: tint(P.desert, P.skyHorizon, 0.5) },
          { at: 0.22, hex: tint(P.desert, P.skyHorizon, 0.22) },
          { at: 0.6, hex: P.desert },
          { at: 1, hex: shade(tint(P.desert, P.desertShadow, 0.3), 0.08) },
        ],
        22,
        'i-ground',
      );
      buf.vRamp(left, horizon, full, below + bleed, groundRamp);

      // Grain, the way Act IV's sand is grained — but brighter, and on this act's own hue
      // rather than IV's cold one. A smooth ramp reads as paper; the references' ground is
      // stippled, and it is also where a large flat area earns its fine detail.
      //
      // Each ramp step is speckled with a lighter and a darker relative of itself, so the
      // grain follows the aerial perspective instead of sitting on top of it as one tone.
      for (const step of groundRamp) {
        const base = buf.palette.at(step);
        const lit = buf.tone(tint(toHex(base), P.skyHorizon, 0.34), 'sand lit');
        const dark = buf.tone(shadeHue(toHex(base), 0.16), 'sand grain');
        speckle(buf, step, lit, 0.2, dark, 0.13, horizon, h + bleed);
      }

      // Base, highlight, shadow — the three steps §3 permits.
      buf.poly(
        [
          [left, horizon],
          [w + bleed, horizon],
          [w + bleed, horizon + below * 0.1],
          [left, horizon + below * 0.16],
        ],
        buf.tone(P.desertHigh, 'desert high'),
      );
      const duneShadow = buf.tone(tint(P.desert, P.desertShadow, 0.34), 'dune shadow');
      buf.poly(
        [
          [left, horizon + below * 0.52],
          [w * 0.36, horizon + below * 0.42],
          [w * 0.48, horizon + below * 0.74],
          [left, horizon + below * 0.92],
        ],
        duneShadow,
      );
      buf.poly(
        [
          [w * 0.68, horizon + below * 0.46],
          [w + bleed, horizon + below * 0.36],
          [w + bleed, horizon + below * 0.8],
          [w * 0.6, horizon + below * 0.66],
        ],
        duneShadow,
      );

      buf.poly(roadPoints, buf.tone(P.road, 'road'));
      const rutTone = buf.tone(tint(P.road, P.rut, 0.45), 'rut');
      for (const k of [-0.62, -0.2, 0.2, 0.62] as const) {
        buf.line(
          vp + roadHalf(geo, 1.0, ROAD_NEAR_HALF, 0) * k,
          h + bleed,
          vp,
          horizon,
          rutTone,
          2,
        );
      }

      // Cast shadows multiply into whatever they cross — desert, dune highlight, road —
      // rather than being one flat tone laid over all three.
      const cast = parseHex(P.castShadow);
      for (const b of TOWN) {
        buf.polyBlend(castShadowPoints(geo, b), (dst) => over(multiply(cast, dst), dst, 0.4));
      }
    },
    // The only smooth gradient in the build (§3).
    // Everything registered to an anchor, in paint order: the sun rises *behind* the
    // ground plane, so the plane follows it. All of it is horizon- or VP-registered and
    // therefore never transformed.
  };

  // ---- slot 6 — haze -------------------------------------------------------
  const hazeBand = h * 0.06;
  const haze: SlotArt = {
    verb: 'crossfade',
    // Dithered at 30% coverage rather than filled at 30% opacity. The layer has its own
    // canvas and no alpha, so it cannot composite against the sky below it; scattering the
    // haze tone on a Bayer threshold reads the same and is what the references do.
    // Solid band at a constant 30% layer opacity — not a dither.
    //
    // This is the one place in the act where alpha is load-bearing rather than decorative.
    // The horizon has to remain *measurable through* the haze: check:invariant reads it as
    // a tonal step across the vanishing-point corridor. A uniform wash tints both sides
    // equally and leaves the step intact; a dither lands the haze tone on one side and not
    // the other in alternating rows, which turns every art row boundary near the horizon
    // into a stronger "boundary" than the horizon itself. Measured, at 100% coverage two
    // art cells high.
    alpha: 0.3,
    draw: (buf) => {
      buf.rect(left, horizon - hazeBand, full, hazeBand * 2, buf.tone(P.skyHorizon, 'haze'));
    },
    // Flat band, hard edges. §3 permits a smooth gradient in the slot 7 sky and nowhere
    // else; a ramped haze is the exact thing the pixel register forbids.
  };

  // ---- slot 5 — three mesas, tallest at 20vw and 80vw, none across the VP ---
  const mesaSpec = [
    { cx: 0.2, top: 0.245, halfW: 0.155, lean: 0.016 },
    { cx: 0.8, top: 0.225, halfW: 0.142, lean: -0.014 },
    { cx: 0.375, top: 0.115, halfW: 0.058, lean: 0.006 },
  ] as const;

  let mesas = '';
  for (const m of mesaSpec) {
    const cx = w * m.cx;
    const topY = horizon - h * m.top;
    const halfTop = w * m.halfW * 0.66;
    const halfBottom = w * m.halfW;
    const skew = w * m.lean;
    const stepX = halfTop * 0.28;
    const stepY = h * m.top * 0.13;
    // Flat top with one step down, battered sides. Two tones, no stroke (§3 slots 4–5).
    mesas += poly(
      [
        [cx - halfBottom, horizon + bleed],
        [cx - halfTop + skew, topY + stepY],
        [cx - stepX + skew, topY + stepY],
        [cx - stepX + skew, topY],
        [cx + halfTop + skew, topY],
        [cx + halfBottom, horizon + bleed],
      ],
      P.mesa,
    );
    const away = Math.sign(cx - vp) || 1;
    mesas += poly(
      [
        [cx + away * halfBottom, horizon + bleed],
        [cx + away * halfTop + skew, topY],
        [cx + away * halfTop * 0.42 + skew, topY],
        [cx + away * halfBottom * 0.46, horizon + bleed],
      ],
      shade(P.mesa, 0.24),
    );
  }

  const ridge: SlotArt = {
    verb: 'rise',
    clipBottom: horizon,
    travelPx: h * 0.28,
    draw: (buf) => {
      const iMesa = buf.tone(P.mesa, 'mesa');
      const iMesaShade = buf.tone(shadeHue(P.mesa, 0.3), 'mesa shade');
      const iMesaLit = buf.tone(shadeHue(tint(P.mesa, P.sunRim, 0.22), -0.22), 'mesa lit');
      const iMesaGrit = buf.tone(shadeHue(P.mesa, 0.15), 'mesa grit');

      for (const m of mesaSpec) {
        const cx = w * m.cx;
        const topY = horizon - h * m.top;
        const halfTop = w * m.halfW * 0.66;
        const halfBottom = w * m.halfW;
        const skew = w * m.lean;
        const stepX = halfTop * 0.28;
        const stepY = h * m.top * 0.13;

        buf.poly(
          [
            [cx - halfBottom, horizon + bleed],
            [cx - halfTop + skew, topY + stepY],
            [cx - stepX + skew, topY + stepY],
            [cx - stepX + skew, topY],
            [cx + halfTop + skew, topY],
            [cx + halfBottom, horizon + bleed],
          ],
          iMesa,
        );
        // Sunlit cap: the sun is at the VP and above the horizon in this act, so the top
        // face takes a full warm lift where Act IV's takes a fifth of one.
        buf.rect(
          cx - halfTop * 0.92 + skew,
          topY,
          halfTop * 1.84,
          Math.max(h * m.top * 0.05, 2),
          iMesaLit,
        );

        // Strata. A mesa face is bedded rock, and two bands of it stop the wedge reading
        // as one flat purple mass. Polygons that follow the batter of the sides, not
        // dithered rectangles — a rectangle is not clipped to the silhouette and scatters
        // loose dots into the open sky either side of the mesa.
        for (const [at, thick] of [
          [0.34, 0.09],
          [0.63, 0.06],
        ] as const) {
          const halfA = halfTop + (halfBottom - halfTop) * at;
          const halfB = halfTop + (halfBottom - halfTop) * (at + thick);
          const yA = topY + (horizon - topY) * at;
          const yB = topY + (horizon - topY) * (at + thick);
          buf.poly(
            [
              [cx - halfA + skew * (1 - at), yA],
              [cx + halfA + skew * (1 - at), yA],
              [cx + halfB + skew * (1 - at - thick), yB],
              [cx - halfB + skew * (1 - at - thick), yB],
            ],
            iMesaShade,
          );
          // Weathered lower edge: the band below a stratum is rubble, not a ruled line.
          // Safe as a rect because the mesa only ever widens going down, so a band of its
          // own width cannot escape the silhouette.
          buf.rectDither(
            cx - halfB * 0.94 + skew * (1 - at - thick),
            yB,
            halfB * 1.88,
            (horizon - topY) * 0.09,
            iMesaShade,
            (k) => 0.62 - 0.62 * k,
          );
        }

        const away = Math.sign(cx - vp) || 1;
        buf.poly(
          [
            [cx + away * halfBottom, horizon + bleed],
            [cx + away * halfTop + skew, topY],
            [cx + away * halfTop * 0.42 + skew, topY],
            [cx + away * halfBottom * 0.46, horizon + bleed],
          ],
          iMesaShade,
        );
      }

      // Rock grain, once the masses are down: three mesas in two flat tones read as cut
      // paper against the sky. Bounded above the horizon — `speckle` writes `buf.idx`
      // directly and does not honour `protectRow`, and `toY` is exclusive.
      speckle(buf, iMesa, iMesaGrit, 0.2, iMesaShade, 0.14, horizon - h * 0.26, horizon);
    },
  };

  // ---- slot 4 — scrub, and the fence line running to the VP -----------------
  let scrub = '';
  for (let i = 0; i < 30; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const d = 0.05 + ((i * 11) % 29) / 52;
    const y = groundY(geo, d);
    const sc = depthScale(geo, d);
    const spread = ((i * 37) % 100) / 100;
    const x = vp + side * (roadHalf(geo, d, ROAD_NEAR_HALF, 0) + w * (0.05 + spread * 1.9) * sc);
    if (x < left || x > w + bleed || !clearsVP(geo, x, w * 0.03 * sc)) continue;
    const bw = w * 0.03 * sc;
    const bh = below * 0.06 * sc;
    scrub += poly(
      [
        [x - bw, y],
        [x - bw * 0.28, y - bh],
        [x + bw * 0.34, y - bh * 0.72],
        [x + bw, y],
      ],
      P.midGround,
    );
    scrub += poly(
      [
        [x + bw * 0.1, y],
        [x + bw * 0.34, y - bh * 0.72],
        [x + bw, y],
      ],
      shade(P.midGround, 0.28),
    );
  }




  const far: SlotArt = {
    verb: 'rise',
    clipBottom: groundY(geo, 0.72),
    travelPx: below * 0.85,
    draw: (buf) => {
      const iScrub = buf.tone(P.midGround, 'scrub');
      const iScrubShade = buf.tone(shade(P.midGround, 0.28), 'scrub shade');
      for (let i = 0; i < 30; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const d = 0.05 + ((i * 11) % 29) / 52;
        const y = groundY(geo, d);
        const sc = depthScale(geo, d);
        const spread = ((i * 37) % 100) / 100;
        const x = vp + side * (roadHalf(geo, d, ROAD_NEAR_HALF, 0) + w * (0.05 + spread * 1.9) * sc);
        if (x < left || x > w + bleed || !clearsVP(geo, x, w * 0.03 * sc)) continue;
        const bw = w * 0.03 * sc;
        const bh = below * 0.06 * sc;
        buf.poly(
          [
            [x - bw, y],
            [x - bw * 0.28, y - bh],
            [x + bw * 0.34, y - bh * 0.72],
            [x + bw, y],
          ],
          iScrub,
        );
        buf.poly(
          [
            [x + bw * 0.1, y],
            [x + bw * 0.34, y - bh * 0.72],
            [x + bw, y],
          ],
          iScrubShade,
        );
      }
    },
    // No fence. The posts and their two converging rails were the last VP-registered
    // geometry on the ground plane; with the town and the poles gone the rails read as bare
    // diagonals ruled across open sand rather than as a fence line.
  };

  // ---- street furniture, so the middle distance is not an empty wedge -------
  let streetProps = '';
  for (const [d, side, kind] of [
    [0.36, -1, 'rail'],
    [0.6, 1, 'barrel'],
    [0.66, 1, 'trough'],
    [1.02, -1, 'barrel'],
  ] as const) {
    const sc = depthScale(geo, d);
    const gy = groundY(geo, d);
    const px = vp + side * (roadHalf(geo, d, ROAD_NEAR_HALF, 0) * 0.82);
    const tone = shade(tint(P.town, P.skyHorizon, Math.max(0, (1 - d) * 0.3)), 0.15);
    if (kind === 'rail') {
      const railW = w * 0.055 * sc;
      const railH = below * 0.075 * sc;
      streetProps += rect(px - railW / 2, gy - railH, w * 0.0035 * sc, railH, tone);
      streetProps += rect(px + railW / 2, gy - railH, w * 0.0035 * sc, railH, tone);
      streetProps += rect(px - railW / 2, gy - railH, railW, below * 0.008 * sc, tone);
    } else if (kind === 'barrel') {
      const bw = w * 0.016 * sc;
      const bh = below * 0.055 * sc;
      streetProps += rect(px - bw / 2, gy - bh, bw, bh, tone);
      streetProps += rect(px - bw * 0.56, gy - bh * 0.72, bw * 1.12, bh * 0.1, shade(tone, 0.3));
    } else {
      const tw = w * 0.05 * sc;
      streetProps += rect(px - tw / 2, gy - below * 0.03 * sc, tw, below * 0.03 * sc, tone);
    }
  }

  // ---- slots 3 and 2 — the town --------------------------------------------
  // Street furniture — a hitching rail, barrels, a water trough — removed with the town.
  // It existed to stop the middle distance reading as an empty wedge, but furniture for a
  // street that no longer exists reads as debris: a bracket floating on open sand.

  const mid: SlotArt = {
    verb: 'extrude',
    clipBottom: groundY(geo, 0.62),
    draw: (buf) => {
      const tones = new Set<number>();
      for (const b of TOWN.filter((x) => x.d < 0.6)) {
        for (const t of drawBuilding(buf, geo, b)) tones.add(t);
      }
      // Outline the group's silhouette, not every internal tone boundary.
      buf.outline(tones, buf.tone(TOWN_LINE, 'town line'));
    },
  };

  // One accent, the last thing the eye finds: a lamp still lit over the nearest porch.
  // `reduce` with no seed throws on an empty list, so the lamp is conditional on a host
  // existing at all rather than on TOWN happening to be non-empty today.
  const lampHost = TOWN.filter((b) => b.d >= 0.6).sort((a, b) => b.d - a.d)[0];
  const lampFacade = lampHost ? facade(geo, lampHost) : null;
  const lampX = lampFacade ? lampFacade.x + lampFacade.width * 0.86 : 0;
  const lampY = lampFacade ? lampFacade.base - lampFacade.height * 0.34 : 0;
  const lampR = Math.max(w * 0.0055, 3.2);
    circle(lampX, lampY, lampR, P.accent) +
    circle(lampX, lampY, lampR * 0.5, P.window);

  const near: SlotArt = {
    verb: 'extrude',
    clipBottom: h + bleed,
    draw: (buf) => {
      const tones = new Set<number>();
      for (const b of TOWN.filter((x) => x.d >= 0.6)) {
        for (const t of drawBuilding(buf, geo, b)) tones.add(t);
      }
      buf.outline(tones, buf.tone(TOWN_LINE, 'town line'));
      if (!lampFacade) return;
      // One accent, the last thing the eye finds: a lamp still lit over the nearest porch.
      buf.line(
        lampX,
        lampY - lampR * 2.6,
        lampX,
        lampY - lampR,
        buf.tone(P.town, 'lamp arm'),
        Math.max(lampR * 0.5, 1.5),
      );
      buf.disc(lampX, lampY, lampR, buf.tone(P.accent, 'lamp glow'));
      buf.disc(lampX, lampY, lampR * 0.5, buf.tone(P.window, 'lamp core'));
    },
  };

  // ---- slot 1 — only things genuinely nearer than the buildings -------------
  // Nothing full-width here: a band across this slot occludes every structure behind it.
  let foreground = '';
  for (let i = 0; i < 14; i++) {
    const t = ((i * 41) % 100) / 100;
    const x = w * (0.02 + t * 0.96);
    const y = h - below * (0.005 + (((i * 17) % 7) / 7) * 0.06);
    const sz = w * (0.004 + (((i * 13) % 5) / 5) * 0.006);
    foreground += poly(
      [
        [x - sz, y],
        [x - sz * 0.4, y - sz * 0.75],
        [x + sz * 0.5, y - sz * 0.6],
        [x + sz, y],
      ],
      shade(P.desert, 0.34),
    );
  }
  for (let i = 0; i < 9; i++) {
    const x = w * (0.06 + (((i * 29) % 100) / 100) * 0.88);
    const y = h - below * (0.002 + (((i * 23) % 5) / 5) * 0.03);
    foreground += circle(x, y, w * 0.0035, P.desertShadow, ' fill-opacity="0.7"');
  }

  const ground: SlotArt = {
    verb: 'crossfade',
    /**
     * Empty, deliberately.
     *
     * This slot held a scatter of foreground stones and pebbles along the bottom edge.
     * Removed at the client's direction: against a grained ground plane they read as
     * bumps stuck to the frame rather than as rocks lying on it, and slot 1 sits in front
     * of every structure, so anything here is the first thing the eye meets.
     *
     * The slot stays in the eight rather than being deleted — an act is a parameterisation
     * of all eight, and a missing one is a different shape of thing from an empty one.
     */
    draw: () => {},
  };


  let props = '';
  // Dust motes. Dim — anything brighter reads as a flare over a facade, and the look is
  // printed, not rendered.
  for (let i = 0; i < 20; i++) {
    const x = w * (((i * 37) % 100) / 100);
    const y = horizon + below * (((i * 61) % 100) / 100) * 0.95;
    props += circle(x, y, h * 0.0015, P.skyHorizon, ' fill-opacity="0.09"');
  }
  for (const [cx, cy, sc] of [
    [0.38, 0.22, 1],
    [0.46, 0.175, 0.78],
    [0.55, 0.245, 0.88],
  ] as const) {
    props += bird(w * cx, h * cy, h * 0.018 * sc, P.town);
  }

  const drawTumbleweed = (cx: number, cy: number, rad: number, spin: number) => (buf: Buf) => {
    const x = w * cx;
    const y = h * cy;
    const rr = h * rad;
    const index = buf.tone(P.desertShadow, 'tumbleweed');
    buf.disc(x, y, rr * 0.55, index);
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + spin;
      buf.line(
        x + Math.cos(a) * rr * 0.2,
        y + Math.sin(a) * rr * 0.2,
        x + Math.cos(a * 1.7 + spin) * rr,
        y + Math.sin(a * 1.7 + spin) * rr,
        index,
        Math.max(rr * 0.14, 2),
      );
    }
  };

  return [
    {
      verb: 'drift',
      draw: (buf) => {
        // Dust motes. Were fill-opacity 0.09; at one or two cells across, dithering at 9%
        // erases them outright — the same class of mistake that rendered Act III's music
        // motes as zero pixels. Resolved to a dim tone against the ground instead.
        const iMote = buf.tone(tint(P.desert, P.skyHorizon, 0.35), 'dust mote');
        for (let i = 0; i < 20; i++) {
          const x = w * (((i * 37) % 100) / 100);
          const y = horizon + below * (((i * 61) % 100) / 100) * 0.95;
          buf.disc(x, y, h * 0.0015, iMote);
        }
        const iBird = buf.tone(P.town, 'bird');
        for (const [cx, cy, sc] of [
          [0.38, 0.22, 1],
          [0.46, 0.175, 0.78],
          [0.55, 0.245, 0.88],
        ] as const) {
          drawBird(buf, w * cx, h * cy, h * 0.018 * sc, iBird);
        }
      },
      // Two tumbleweeds crossing at different speeds (§4 slot 0). Two shapes in one markup
      // string share one transform and cannot differ.
      parts: [
        { draw: drawTumbleweed(0.36, 0.93, 0.042, 0), rate: 0.5 },
        { draw: drawTumbleweed(0.6, 0.82, 0.024, 1.1), rate: 0.28 },
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

export const ACT_I: ActDefinition = {
  id: 'i',
  name: 'The Frontier',
  build,
};
