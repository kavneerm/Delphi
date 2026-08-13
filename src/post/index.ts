/**
 * Print-process finish. art-direction.md §3.
 *
 * Three effects, none of which animates a filter primitive:
 *
 *   halftone     a static SVG dot pattern, multiplied into shadow regions only. Dot
 *                radius grows with depth, 1.5px at slot 1 to 4px at slot 5.
 *   aberration   three stacked tinted copies of a slot, separated by translate3d and
 *                composited with mix-blend-mode: screen. The offset is a transform, so
 *                it is compositor-only and responds continuously to scroll velocity.
 *   grain        one static tiling noise layer over the whole stage, at low opacity.
 *
 * The look is *printed*, not *rendered*: no bloom, no soft shadows, no lens flare.
 */

import { SLOT_COUNT } from '../config.ts';

/**
 * Dot pitch per slot, in whole chunks.
 *
 * §3's stated radii (1.5px at slot 1 rising to 4px at slot 5) predate the pixel register
 * and are all sub-chunk at PIXEL≈7 — quantising them to whole chunks made every dot ~5x
 * its intended size and the screen swallowed the art. The register resolves it: the dot is
 * exactly one chunk, and *depth is carried by the pitch instead*, so distant slots read
 * coarser while every dot still lands on the grid. This is how a dither works in pixel art.
 */
export function halftonePitchChunks(slot: number): number {
  const t = Math.min(Math.max((slot - 1) / 4, 0), 1);
  return Math.round(2 + t * 2);
}

/** Slots that receive chromatic aberration (§3: slots 4+, and slot 0 on fast scroll). */
export function aberrates(slot: number): boolean {
  return slot >= 4 || slot === 0;
}

/**
 * Peak channel separation in px at full scroll velocity. Slot 0 only separates while
 * moving fast; the far slots carry a resting offset, which is what makes the distance
 * read as mis-registered plate rather than as motion blur.
 */
export function aberrationOffset(slot: number, velocity: number, chunk = 1): number {
  const raw =
    slot === 0
      ? velocity * velocity * 6
      : (() => {
          const rest = 2 * ((slot - 3) / 4);
          return rest + velocity * (6 - rest);
        })();
  // floor, not round: §3 says 0px at rest. Rounding turned a sub-chunk resting offset into
  // a whole chunk wherever the chunk was small — at 390 (chunk 2) that put a 4px saturated
  // bar down every far edge while the page was standing still.
  return Math.floor(raw / chunk) * chunk;
}

/**
 * One <defs> block for the whole page: a halftone dot tile per slot, plus a grain tile.
 * Injected once at init and never touched again — every pattern here is static.
 */
export function postDefs(chunk = 7): string {
  let patterns = '';
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const pitch = halftonePitchChunks(slot) * chunk;
    // One chunk square. A circle would fight the hard-edge register.
    const d = chunk;
    patterns +=
      `<pattern id="halftone-${slot}" width="${pitch.toFixed(2)}" height="${pitch.toFixed(2)}" ` +
      `patternUnits="userSpaceOnUse">` +
      `<rect x="0" y="0" width="${d}" height="${d}" fill="#000"/></pattern>`;
  }

  // Value noise, generated once from a fixed sequence so the tile is deterministic.
  let grain = '';
  let seed = 0x2f6e2b1;
  for (let i = 0; i < 900; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const x = seed % 60;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const y = seed % 60;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const light = (seed >>> 16) % 2 === 0;
    grain += `<rect x="${x}" y="${y}" width="1" height="1" fill="${light ? '#fff' : '#000'}"/>`;
  }

  // Channel isolation. Static — set once, never tweened (§3).
  const channels =
    `<filter id="chan-red" x="-10%" y="-10%" width="120%" height="120%">` +
    `<feColorMatrix type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"/></filter>` +
    `<filter id="chan-cyan" x="-10%" y="-10%" width="120%" height="120%">` +
    `<feColorMatrix type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0"/></filter>`;

  return (
    `<svg class="post-defs" aria-hidden="true" focusable="false"><defs>${patterns}${channels}` +
    `<pattern id="grain" width="60" height="60" patternUnits="userSpaceOnUse">${grain}</pattern>` +
    `</defs></svg>`
  );
}

/**
 * The halftone overlay for one slot: the dot screen, masked to the region below the
 * horizon where the act's shadows fall. §3 — dots in shadow only, never in light.
 */
export function halftoneOverlay(
  slot: number,
  geo: { w: number; h: number; horizon: number; bleed: number },
): string {
  // §3 gives dot radii for slots 1 through 5, so all five carry a screen.
  if (slot < 1 || slot > 5) return '';
  const top = geo.horizon;
  const height = geo.h - geo.horizon;
  // Same bled viewBox as every other layer svg — the overlay sits inside the same
  // inset(-bleed) box, so a 0 0 w h viewBox would put the horizon at the wrong y.
  const b = geo.bleed;
  return (
    `<svg class="halftone" aria-hidden="true" focusable="false" ` +
    `viewBox="${-b} ${-b} ${geo.w + b * 2} ${geo.h + b * 2}" preserveAspectRatio="none">` +
    `<defs><linearGradient id="ht-fade-${slot}" x1="0" y1="${top}" x2="0" y2="${geo.h}" ` +
    `gradientUnits="userSpaceOnUse">` +
    `<stop offset="0%" stop-color="#fff" stop-opacity="0"/>` +
    `<stop offset="100%" stop-color="#fff" stop-opacity="1"/></linearGradient>` +
    `<mask id="ht-mask-${slot}"><rect x="0" y="${top}" width="${geo.w}" height="${height}" ` +
    `fill="url(#ht-fade-${slot})"/></mask></defs>` +
    `<rect x="0" y="${top.toFixed(1)}" width="${geo.w}" height="${height.toFixed(1)}" ` +
    `fill="url(#halftone-${slot})" mask="url(#ht-mask-${slot})"/></svg>`
  );
}
