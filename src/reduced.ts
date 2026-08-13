/**
 * prefers-reduced-motion: reduce — a first-class path, not a fallback that loses content
 * (brief §8). No pin, no scrub, no parallax. Each act is one static composition at its
 * hold parameterisation, with its copy beneath it in normal document flow.
 *
 * The copy deck is rendered here in full and in document order — §8 requires the whole
 * argument to be present and readable in this mode.
 */

import { HORIZON_FRAC, SLOT_COUNT, VP_FRAC } from './config.ts';
import type { ActDefinition } from './acts/types.ts';
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
      horizon: rect.height * HORIZON_FRAC,
      vp: rect.width * VP_FRAC,
      bleed: 0,
    };

    const art = act.build(geo);
    for (let slot = SLOT_COUNT - 1; slot >= 0; slot--) {
      const piece = art[slot];
      if (!piece) continue;
      for (const markup of [piece.free, piece.locked]) {
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
