/**
 * Paper grain, generated as a raster tile on the art grid.
 *
 * **This is an art-direction choice, not a measured defect fix.** Be clear about that: the
 * previous inline SVG `feTurbulence` grain does *not* break cell uniformity. Measured, both
 * versions report 0.00% of sky cells non-uniform. The grain's excursion after `overlay` at
 * 0.055 is roughly +/-2 per channel, well under the threshold at which a cell counts as
 * broken, so check:register cannot distinguish them and no claim is made that it does.
 *
 * What the change buys, honestly:
 *   - one grain speck is one art pixel rather than one device pixel, so the texture sits in
 *     the same register as everything else instead of a third of its size;
 *   - it is deterministic — a fixed-seed LCG, identical on every load and machine, so two
 *     builds can be diffed pixel for pixel;
 *   - it drops a `feTurbulence` dependency, which was on the untested-outside-Chromium list.
 *
 * The mechanical part that *is* forced: an SVG background is rasterised at its destination
 * size, so scaling an SVG tile up only makes the browser evaluate the turbulence at the
 * larger size and the specks stay one device pixel. `image-rendering: pixelated` can only
 * enlarge a raster source, so a tile on the art grid has to be raster to begin with.
 */

import { ART_SCALE } from '../config.ts';

/** Tile edge in art pixels. 40 * 3 = 120 CSS px, the size the CSS tiled at before. */
const TILE_CELLS = 40;
const SEED = 0x9e3779b9;

let cached: string | null = null;

export function grainTile(): string {
  if (cached) return cached;

  const canvas = document.createElement('canvas');
  canvas.width = TILE_CELLS;
  canvas.height = TILE_CELLS;
  const context = canvas.getContext('2d');
  if (!context) return '';

  const image = context.createImageData(TILE_CELLS, TILE_CELLS);
  let state = SEED >>> 0;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state >>> 24;
  };

  for (let i = 0; i < TILE_CELLS * TILE_CELLS; i++) {
    // Mid-grey with a small excursion. `overlay` at 0.055 turns this into the +/-2 per
    // channel that reads as paper rather than as noise.
    const value = 108 + (next() % 40);
    image.data[i * 4] = value;
    image.data[i * 4 + 1] = value;
    image.data[i * 4 + 2] = value;
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);

  cached = canvas.toDataURL('image/png');
  return cached;
}

export const GRAIN_TILE_PX = TILE_CELLS * ART_SCALE;
