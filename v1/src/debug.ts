import type { Frame } from './progress.ts';
import { SLOT_RATES, driftAmplitude } from './config.ts';

export function mountDebug(host: HTMLElement, geoWidth: () => number): (f: Frame) => void {
  const el = document.createElement('div');
  el.id = 'debug';
  el.setAttribute('aria-hidden', 'true');
  host.appendChild(el);

  return (f: Frame) => {
    const amplitude = driftAmplitude(geoWidth());
    const drift = SLOT_RATES.map((r) => ((f.c - 0.5) * r * amplitude).toFixed(1)).join(' ');
    const seg =
      f.segment.kind === 'hold'
        ? `hold act ${f.segment.act}`
        : `trans ${f.segment.from}→${f.segment.to}`;
    el.textContent =
      `p    ${f.p.toFixed(4)}\n` +
      `cam  ${f.c.toFixed(4)}\n` +
      `vel  ${f.velocity.toFixed(3)}\n` +
      `seg  ${seg}\n` +
      `t    ${f.t.toFixed(4)}\n` +
      `driftX 0..7\n  ${drift}`;
  };
}
