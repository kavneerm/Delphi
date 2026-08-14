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
export function canvasFor(buf: Buf, rgba: Uint32Array): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = buf.w;
  canvas.height = buf.h;
  canvas.setAttribute('aria-hidden', 'true');

  const context = canvas.getContext('2d');
  if (context) {
    const image = context.createImageData(buf.w, buf.h);
    buf.toImageData(rgba, image.data);
    context.putImageData(image, 0, 0);
  }

  const style = canvas.style;
  style.position = 'absolute';
  style.left = `${BLEED_PX - buf.ox}px`;
  style.top = `${BLEED_PX - buf.oy}px`;
  style.width = `${buf.w * ART_SCALE}px`;
  style.height = `${buf.h * ART_SCALE}px`;
  style.imageRendering = 'pixelated';
  return canvas;
}
