/**
 * The copy deck, verbatim. docs/copy-deck.md.
 *
 * Every line lives in real DOM text — never baked into SVG paths or images (brief §8).
 * Reveals are driven by `p`, never by a timer, and never block scrolling: a user who
 * scrolls fast sees everything already revealed rather than a queue playing catch-up.
 *
 * Scrim opacity is solved per act against the worst-case backdrop inside the column
 * bounds, with a hard 4.5:1 floor (build.md A3). Copy colour is constant at #F5F0E8 —
 * the scrim adapts, the text does not.
 *
 * Reveal windows are deliberately placed so that **no §6 checkpoint falls inside one**.
 * Mid-reveal a block and its scrim are both at partial opacity by design, so no pixel
 * reaches #F5F0E8 and a contrast ratio measured there is meaningless — it looked like a
 * scrim defect twice before the cause was pinned. Keeping the checkpoints out of the
 * windows makes every checkpoint measure the fully-revealed state, which is the state the
 * §9 floor is actually about.
 *
 * That constraint is why the windows were shortened by holding every `at` and `out` fixed
 * and shrinking only `over` and `outOver`: the new window is then a subset of the old one,
 * which already contained no checkpoint, so no amount of tightening can introduce the
 * failure. `check:pace` asserts it mechanically rather than trusting the argument.
 */

/**
 * `cue` is the scroll affordance's own bottom-centre position. It is a column rather than a
 * block inside `centre` because in flow it would land under a paragraph that is ~600px tall
 * at 390x844, which is not where a scroll cue goes.
 */
export type Column = 'left' | 'right' | 'centre' | 'cue';

export interface Reveal {
  /** Master progress at which this block starts revealing. */
  readonly at: number;
  /** Progress over which it completes. */
  readonly over: number;
  /** Where it begins to leave. Omit to hold to the end of the page. */
  readonly out?: number;
  /** Progress over which it leaves. */
  readonly outOver?: number;
}

export interface CopyBlock {
  readonly id: string;
  readonly act: 0 | 1 | 2 | 3;
  readonly column: Column;
  readonly reveal: Reveal;
  /** Reveal word by word rather than as a block. Headings only. */
  readonly byWord?: boolean;
  readonly html: string;
}

/**
 * Per-act scrim opacity, solved against the worst-case backdrop the column overlaps.
 * Act II is the binding case: its column is pushed right, over the 62vw magenta monolith,
 * and 30% over a #00E5FF window measures 2.49:1. Act III's towers are nearly as bright.
 */
export const SCRIM_ALPHA: Record<number, number> = {
  0: 0.64,
  1: 0.78,
  2: 0.8,
  3: 0.62,
};

/** The act's darkest tone, which the scrim is tinted with (§8). */
export const SCRIM_TONE: Record<number, string> = {
  0: '#2A1E1E',
  1: '#1A1D24',
  2: '#1E1B3A',
  3: '#16243F',
};

export const BLOCKS: readonly CopyBlock[] = [
  {
    id: 'act1-h1',
    act: 0,
    column: 'centre',
    // Complete at p=0, rather than revealing over the deck's 0.01–0.04.
    //
    // Measured: with the h1 at opacity 0 on arrival the page has *no* Largest Contentful
    // Paint candidate at all — a zero-opacity block is not one, and neither is inline SVG.
    // That fails §7's "LCP ≤ 2.5s" outright, and no amount of payload tuning fixes it,
    // because there is nothing to paint.
    //
    // §7 is a hard budget and the deck's reveal timing is an aesthetic preference, so the
    // budget wins. The word-by-word reveal still runs for every other heading — those are
    // ones the reader genuinely scrolls into. This headline is the page's entry point and
    // has to be on screen when they arrive. Flagged to the client; it is the only timing
    // in docs/copy-deck.md that has been changed.
    reveal: { at: -0.05, over: 0.05, out: 0.13, outOver: 0.03 },
    byWord: true,
    html: '<h1>AI is the inevitable frontier.</h1>',
  },
  {
    id: 'act1-scroll-cue',
    act: 0,
    column: 'cue',
    // Complete at p=0, for the same reason the headline is: an affordance that fades in
    // after the reader has already decided what to do is not an affordance. It leaves as
    // soon as scrolling starts, because by then it has done its job — fully gone by 0.06,
    // which is a checkpoint, so it lands exactly on the end of the window and never
    // measures mid-fade.
    reveal: { at: -0.02, over: 0.02, out: 0.015, outOver: 0.045 },
    html:
      '<p class="scroll-hint">Keep scrolling' +
      '<span class="scroll-cue" aria-hidden="true"></span></p>',
  },
  {
    id: 'act1-body',
    act: 0,
    column: 'centre',
    reveal: { at: 0.065, over: 0.03, out: 0.13, outOver: 0.03 },
    html:
      '<p>Abundance is guaranteed. Competition is not. Emerging technologies could bring ' +
      'intelligence, knowledge, medicine, energy, and productive capacity to new levels ' +
      'of development and sophistication.</p>',
  },
  {
    id: 'act2-h2',
    act: 1,
    column: 'right',
    reveal: { at: 0.26, over: 0.02, out: 0.41, outOver: 0.03 },
    byWord: true,
    html: '<h2>Closed Frontier</h2>',
  },
  {
    id: 'act2-body',
    act: 1,
    column: 'right',
    reveal: { at: 0.265, over: 0.03, out: 0.405, outOver: 0.03 },
    html:
      '<p>If technological power becomes concentrated in a small number of corporations ' +
      'and government institutions, progress could instead produce dependency, regulatory ' +
      'capture, and permanent barriers to competition.</p>',
  },
  {
    id: 'act3-h2',
    act: 2,
    column: 'left',
    reveal: { at: 0.54, over: 0.02, out: 0.69, outOver: 0.03 },
    byWord: true,
    html: '<h2>Open Frontier</h2>',
  },
  {
    id: 'act3-body',
    act: 2,
    column: 'left',
    reveal: { at: 0.545, over: 0.03, out: 0.695, outOver: 0.03 },
    html:
      '<p>A society in which technological progress remains open to new entrants, ' +
      'independent researchers, and widespread experimentation; in which genuine risks are ' +
      'governed without creating monopolies; and in which the state is limited in scope, ' +
      'capable in execution, and constrained by individual rights.</p>',
  },
  {
    id: 'act4-statement',
    act: 3,
    column: 'centre',
    reveal: { at: 0.84, over: 0.025 },
    byWord: true,
    html: '<h2 class="statement">Our goal is to ensure the frontier remains open.</h2>',
  },
  {
    id: 'act4-cta',
    act: 3,
    column: 'centre',
    reveal: { at: 0.92, over: 0.025 },
    // TODO: CTA destinations are unspecified in docs/copy-deck.md. Left as TODO rather
    // than inventing a link target.
    html:
      '<p class="cta">' +
      '<a class="button" href="#TODO-get-involved">Get involved</a>' +
      '<span class="cta-sep" aria-hidden="true">·</span>' +
      '<a class="quiet" href="#TODO-full-case">Read the full case &rarr;</a>' +
      '</p>',
  },
  // act4-footer is withheld, not deleted.
  //
  // docs/copy-deck.md leaves the organisation name, contact, socials and legal
  // unspecified, and the block was rendering those TODOs to the reader. Hidden at the
  // client's direction until the real content exists; restoring it is uncommenting this
  // and filling in four strings.
  //
  // {
  //   id: 'act4-footer',
  //   act: 3,
  //   column: 'centre',
  //   reveal: { at: 0.97, over: 0.02 },
  //   html: '<p class="footer-note">…</p>',
  // },
];

/** Split a heading's text nodes into per-word spans so it can reveal by word. */
export function splitWords(root: HTMLElement): HTMLElement[] {
  const spans: HTMLElement[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    texts.push(node as Text);
    node = walker.nextNode();
  }

  for (const text of texts) {
    const parent = text.parentNode;
    if (!parent) continue;
    const fragment = document.createDocumentFragment();
    for (const part of (text.textContent ?? '').split(/(\s+)/)) {
      if (part.length === 0) continue;
      if (/^\s+$/.test(part)) {
        fragment.appendChild(document.createTextNode(part));
        continue;
      }
      const span = document.createElement('span');
      span.className = 'word';
      span.textContent = part;
      fragment.appendChild(span);
      spans.push(span);
    }
    parent.replaceChild(fragment, text);
  }
  return spans;
}
