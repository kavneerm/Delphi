/**
 * prefers-reduced-motion: reduce — a first-class path, not a fallback that loses content
 * (brief §8). No pin, no scrub, no parallax. Each act is one static composition at its
 * hold parameterisation, with its copy beneath it in normal document flow.
 *
 * The copy deck is rendered here in full and in document order — §8 requires the whole
 * argument to be present and readable in this mode.
 */

import { BLEED_PX, SLOT_COUNT, bufferOriginFor, horizonPx, vpPx } from './config.ts';
import type { ActDefinition, DrawFn, Geometry } from './acts/types.ts';
import { Buf, bufferSize } from './art/buffer.ts';
import { canvasFor, rasterOf } from './art/compose.ts';
import { Palette } from './art/palette.ts';
import { BLOCKS } from './copy.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function renderReduced(acts: readonly ActDefinition[]): void {
  const scroll = document.getElementById('scroll');
  const critical = document.getElementById('stage-critical');
  if (!scroll) return;
  critical?.remove();

  const root = document.createElement('main');
  root.id = 'static-root';
  scroll.replaceWith(root);
  document.documentElement.style.setProperty('--scroll-height', 'auto');

  acts.forEach((act, index) => {
    const section = document.createElement('section');
    section.className = 'act-static';
    section.dataset['act'] = String(index);

    const scene = document.createElement('div');
    scene.className = 'scene';
    scene.setAttribute('aria-hidden', 'true');
    section.appendChild(scene);

    // The complete argument, verbatim, in document order. brief §8: the full argument
    // must be readable and complete in this mode — it is a first-class path, not a
    // fallback that loses content. Nothing here is hidden behind a reveal.
    const copy = document.createElement('div');
    copy.className = 'copy-static';
    for (const block of BLOCKS) {
      if (block.act !== index) continue;
      const holder = document.createElement('div');
      holder.innerHTML = block.html;
      // The scroll cue means nothing without scroll-driven reveals.
      holder.querySelector('.scroll-cue')?.remove();
      while (holder.firstChild) copy.appendChild(holder.firstChild);
    }
    section.appendChild(copy);

    root.appendChild(section);

    // Measure only after the section is in flow, so the scene box is real.
    const rect = scene.getBoundingClientRect();
    const geo = {
      w: rect.width,
      h: rect.height,
      // Same whole-pixel anchors as the scroll path, so both render one geometry.
      horizon: horizonPx(rect.height),
      vp: vpPx(rect.width),
      bleed: 0,
    };

    const art = act.build(geo);
    for (let slot = SLOT_COUNT - 1; slot >= 0; slot--) {
      const piece = art[slot];
      if (!piece) continue;
      // free, then parts, then locked — the same paint order as the scroll path, where
      // `parts` live inside `.travel` (above `free`) and `.locked` is a later sibling.
      //
      // `parts` were previously omitted entirely, so Act I's tumbleweeds and every other
      // independently-moving prop simply did not exist in reduced motion. brief §8 makes
      // this a first-class path, not a fallback that loses content.
      //
      // Draw callbacks are rendered here too, and that matters more than it looks.
      // docs/plans/pixel-substrate.md claimed this path already rendered them — "one code
      // path, not two" — and that was simply false: it rendered markup only. The cost of
      // the gap was that every ported act had to keep a whole second SVG composition
      // alive purely for this path, and the two drifted, exactly as duplicated
      // descriptions of one thing always do.
      const painters: (DrawFn | undefined)[] = [
        piece.draw,
        ...(piece.parts ?? []).map((p) => p.draw),
        piece.drawLocked,
      ];
      const markups = [piece.free, ...(piece.parts ?? []).map((p) => p.markup), piece.locked];

      for (const [i, draw] of painters.entries()) {
        if (!draw) continue;
        const holder = document.createElement('div');
        holder.className = 'layer locked';
        // Same inset as the scroll path's `.layer`: canvasFor positions the canvas at
        // `BLEED_PX - ox` relative to its holder, so a holder at inset 0 would place the
        // art a full bleed out.
        holder.style.inset = `${-BLEED_PX}px`;
        holder.appendChild(rasterFor(draw, geo));
        scene.appendChild(holder);
        markups[i] = undefined; // painted; do not also emit its SVG
      }

      for (const markup of markups) {
        if (!markup) continue;
        const holder = document.createElement('div');
        holder.className = 'layer locked';
        holder.style.inset = '0';
        holder.appendChild(svgFor(markup, geo));
        scene.appendChild(holder);
      }
    }

    const horizon = document.createElement('div');
    horizon.id = index === 0 ? 'anchor-horizon' : `anchor-horizon-${index}`;
    horizon.dataset['anchor'] = 'horizon';
    scene.appendChild(horizon);
  });
}

/** Raster one draw callback into a canvas sized to this static scene. */
function rasterFor(draw: DrawFn, geo: Geometry): HTMLCanvasElement {
  const ox = bufferOriginFor(vpPx(geo.w));
  const oy = bufferOriginFor(horizonPx(geo.h));
  const size = bufferSize(geo.w, geo.h, ox, oy);
  const palette = new Palette();
  const buf = new Buf(palette, size.w, size.h, ox, oy);
  buf.protectRow(geo.horizon);
  draw(buf, geo);
  return canvasFor(rasterOf(buf, palette.toRgba()));
}

function svgFor(
  markup: string,
  geo: { w: number; h: number },
): SVGSVGElement {
  const el = document.createElementNS(SVG_NS, 'svg');
  el.setAttribute('viewBox', `0 0 ${geo.w} ${geo.h}`);
  el.setAttribute('preserveAspectRatio', 'none');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = markup;
  return el;
}
