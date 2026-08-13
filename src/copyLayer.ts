/**
 * Mounts the copy deck over the pinned stage and drives its reveals from the progress
 * store. One subscription, one write pass, opacity and transform only.
 */

import { BLOCKS, SCRIM_ALPHA, SCRIM_TONE, splitWords, type CopyBlock } from './copy.ts';
import type { Frame } from './progress.ts';

interface MountedBlock {
  readonly block: CopyBlock;
  readonly el: HTMLElement;
  readonly words: HTMLElement[];
  /** Last written reveal amount, so identical frames skip the write entirely. */
  last: number;
}

export function mountCopy(host: HTMLElement): (frame: Readonly<Frame>) => void {
  host.innerHTML = '';
  const mounted: MountedBlock[] = [];
  // One column per act, with its blocks in normal flow inside it. Absolutely positioning
  // each block independently made them collide as soon as a heading wrapped to a third
  // line — flow is what actually guarantees they stack at every viewport.
  const columns = new Map<string, HTMLElement>();

  for (const block of BLOCKS) {
    const key = `${block.act}-${block.column}`;
    let column = columns.get(key);
    if (!column) {
      column = document.createElement('div');
      column.className = `copy-col col-${block.column}`;
      column.dataset['act'] = String(block.act);
      host.appendChild(column);
      columns.set(key, column);
    }

    const el = document.createElement('div');
    el.className = 'copy-block';
    el.dataset['act'] = String(block.act);
    el.dataset['block'] = block.id;
    el.style.setProperty('--scrim-tone', SCRIM_TONE[block.act] ?? '#000');
    el.style.setProperty('--scrim-alpha', String(SCRIM_ALPHA[block.act] ?? 0.42));
    el.innerHTML = block.html;

    const words = block.byWord ? splitWords(el) : [];
    column.appendChild(el);
    mounted.push({ block, el, words, last: -1 });
  }

  return (frame: Readonly<Frame>) => {
    for (const m of mounted) {
      const { at, over, out, outOver } = m.block.reveal;
      // Driven by p, never by a timer. Scrolling fast past a block leaves it fully
      // revealed rather than queueing an animation to catch up.
      const entered = Math.min(Math.max((frame.p - at) / over, 0), 1);
      // …and every block also has to leave, or Act I's headline sits over Act II.
      const left =
        out === undefined
          ? 0
          : Math.min(Math.max((frame.p - out) / (outOver ?? 0.05), 0), 1);
      const t = entered * (1 - left);
      if (Math.abs(t - m.last) < 0.002) continue;
      m.last = t;

      if (m.words.length > 0) {
        // Per word, with a stagger across the line.
        const n = m.words.length;
        for (let i = 0; i < n; i++) {
          const word = m.words[i];
          if (!word) continue;
          const start = (i / n) * 0.55;
          const wt = Math.min(Math.max((t - start) / 0.45, 0), 1);
          word.style.opacity = wt.toFixed(3);
          word.style.transform = `translate3d(0,${((1 - wt) * 0.42).toFixed(3)}em,0)`;
        }
        // The scrim must arrive with the first word, not before it — otherwise an empty
        // box floats over the scene for the whole run-up to the reveal.
        m.el.style.opacity = (Math.min(entered * 5, 1) * (1 - left)).toFixed(3);
      } else {
        m.el.style.opacity = t.toFixed(3);
        m.el.style.transform = `translate3d(0,${((1 - t) * 14).toFixed(2)}px,0)`;
      }

      // Fully faded blocks stop taking pointer events so they cannot trap a click on
      // the CTA beneath them.
      m.el.style.pointerEvents = t > 0.9 ? 'auto' : 'none';
    }
  };
}
