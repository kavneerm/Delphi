/**
 * Buffer -> DOM.
 *
 * The one rule here that is easy to get wrong: the canvas gets an **explicit integer CSS
 * size**, never `width: 100%`.
 *
 * `image-rendering: pixelated` hard-edges whatever scale it is given, so a non-integer
 * scale does not blur — it does something worse and less obvious. Art pixels come out
 * alternately 3 and 4 device pixels wide, and the frame reads as a subtly wobbling grid
 * that no existing check catches and that is very hard to attribute by eye. Sizing the
 * element at exactly `artW * ART_SCALE` keeps every cell identical.
 */

import { ART_SCALE, BLEED_PX } from '../config.ts';
import type { Buf } from './buffer.ts';

/**
 * A canvas holding this buffer, positioned so its art grid lines up with the stage.
 *
 * The buffer origin may exceed BLEED_PX by a pixel or two — that is how the anchors are
 * kept on exact cell boundaries (see `bufferOriginFor`) — so the canvas is offset within
 * its `.layer` box rather than assumed to fill it.
 */
/**
 * A rastered layer, held separately from any canvas that shows it.
 *
 * The aberration plates are two DOM copies of one image, not two images. Rastering per
 * plate doubled the cost of every aberrating slot — five of the eight — which showed up as
 * a 17.5ms worst frame with only one act ported.
 */
export interface Raster {
  readonly image: ImageData;
  readonly w: number;
  readonly h: number;
  readonly ox: number;
  readonly oy: number;
}

export function rasterOf(buf: Buf, rgba: Uint32Array): Raster {
  const image = new ImageData(buf.w, buf.h);
  buf.toImageData(rgba, image.data);
  return { image, w: buf.w, h: buf.h, ox: buf.ox, oy: buf.oy };
}

/**
 * A canvas showing a raster, positioned so its art grid lines up with the stage.
 *
 * The canvas gets an **explicit integer CSS size**, never `width: 100%`.
 * `image-rendering: pixelated` hard-edges whatever scale it is given, so a non-integer
 * scale does not blur — it does something worse and less obvious: art pixels come out
 * alternately 3 and 4 device pixels wide, and the frame reads as a subtly wobbling grid
 * that no check catches and that is very hard to attribute by eye.
 *
 * The buffer origin may exceed BLEED_PX by a pixel or two — that is how the anchors are
 * kept on exact cell boundaries (see `bufferOriginFor`) — so the canvas is offset within
 * its `.layer` box rather than assumed to fill it.
 */
export function canvasFor(raster: Raster): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = raster.w;
  canvas.height = raster.h;
  canvas.setAttribute('aria-hidden', 'true');

  canvas.getContext('2d')?.putImageData(raster.image, 0, 0);

  const style = canvas.style;
  style.position = 'absolute';
  style.left = `${BLEED_PX - raster.ox}px`;
  style.top = `${BLEED_PX - raster.oy}px`;
  style.width = `${raster.w * ART_SCALE}px`;
  style.height = `${raster.h * ART_SCALE}px`;
  style.imageRendering = 'pixelated';
  return canvas;
}
