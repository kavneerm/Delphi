/**
 * Pacing: how far the reader must scroll, and how fast copy arrives once they get there.
 *
 * Four claims, three of them measured off the live DOM rather than derived from the same
 * constants they are checking — a check that recomputes `over * maxScroll` from `over` and
 * `SCROLL_VH` proves only that multiplication works.
 *
 *   1. Scroll distance  — the page really is SCROLL_VH tall, so the constant reached the
 *                         document and not merely the module.
 *   2. Reveal budget    — every window is bounded in *pixels of scroll*. `p` is meaningless
 *                         to a reader: 0.03 of progress is 86px at 1440x900 now and was
 *                         162px before SCROLL_VH changed, and only the pixels are the thing
 *                         being asked about. See REVEAL_BUDGET_VH for what this does and
 *                         does not bind.
 *   3. Declared windows — each block reads ~0 opacity before `at` and ~1 after `at + over`
 *                         in the browser, *including its per-word spans*, so the numbers in
 *                         copy.ts describe what happens.
 *   4. Scroll cue       — present, opaque, on screen and reading "Keep scrolling" at p=0,
 *                         and gone once scrolling has started.
 *
 * Plus the constraint copy.ts's header describes: no §6 checkpoint may fall *inside* a
 * reveal or exit window, because mid-reveal every pixel is at partial opacity and a
 * contrast ratio measured there means nothing. That one is arithmetic, but it is exactly
 * the arithmetic this change edits, so it is the regression guard that matters most.
 */

import { CHECKPOINTS, SCROLL_VH, VIEWPORTS } from '../src/config.ts';
import { BLOCKS, type CopyBlock } from '../src/copy.ts';
import { Report, fmtP, gotoP, launch, openPage, serveDist } from './lib.ts';

/**
 * A reveal may not cost more than this fraction of a viewport height of scrolling.
 *
 * Both sides of this comparison scale with viewport height — `over x maxScroll` against
 * `BUDGET x h`, and `maxScroll` is itself `3.2h` — so it reduces to `over <= BUDGET / 3.2`
 * and is viewport-independent. It is asserted per viewport anyway because `maxScroll` is
 * read from the live document there, but the *binding* is on `over`, and the honest
 * statement of it is: no reveal window may exceed 0.0375 of master progress.
 *
 * 0.12 rather than the 0.22 this started at. At 0.22 the bound was `over <= 0.06875`, which
 * every value in the deck cleared *before* this change was made — so it guarded SCROLL_VH
 * and nothing else, while being described as a guard on the reveal windows. 0.12 puts the
 * bound at 0.0375 against a largest actual `over` of 0.03: real headroom, and a revert of
 * any window to its old 0.045 or 0.05 now fails.
 */
const REVEAL_BUDGET_VH = 0.12;

/** Probe this far outside a window, so the boundary is unambiguously outside it. */
const EDGE = 0.003;

const CUE_ID = 'act1-scroll-cue';
/** Far enough in that the cue's exit window (ends 0.06) is comfortably finished. */
const CUE_GONE_P = 0.1;

interface BlockState {
  readonly found: boolean;
  readonly opacity: number;
  /**
   * Lowest opacity across the block's per-word spans, or 1 when it has none.
   *
   * Reading the container alone is not enough and this is the whole reason the field
   * exists. For `byWord` blocks `copyLayer.ts` writes the container as
   * `min(entered * 5, 1) * (1 - left)`, which saturates at 20% of the declared window —
   * so a container-only assertion is satisfied a fifth of the way in and can never see
   * word state at all. That left the four `byWord` blocks, which are exactly what the
   * stagger change edited, with no coverage: breaking the stagger so the last word of the
   * LCP headline rests permanently at 0.86 opacity still reported PASS, and nothing else
   * in the tree would catch it either — every other check runs with `?nocopy=1`.
   */
  readonly worstWord: number;
  readonly wordCount: number;
  readonly text: string;
  readonly rect: { top: number; bottom: number; width: number; height: number } | null;
}

async function blockState(
  page: Awaited<ReturnType<typeof openPage>>['page'],
  id: string,
): Promise<BlockState> {
  return page.evaluate((blockId) => {
    const el = document.querySelector<HTMLElement>(`[data-block="${blockId}"]`);
    if (!el) {
      return { found: false, opacity: 0, worstWord: 0, wordCount: 0, text: '', rect: null };
    }
    const r = el.getBoundingClientRect();
    const words = [...el.querySelectorAll<HTMLElement>('.word')];
    let worstWord = 1;
    for (const word of words) {
      const o = Number(getComputedStyle(word).opacity);
      if (o < worstWord) worstWord = o;
    }
    return {
      found: true,
      opacity: Number(getComputedStyle(el).opacity),
      worstWord,
      wordCount: words.length,
      text: el.textContent ?? '',
      rect: { top: r.top, bottom: r.bottom, width: r.width, height: r.height },
    };
  }, id);
}

/** Windows as half-open intervals of master progress. */
function windowsOf(block: CopyBlock): { kind: string; a: number; b: number }[] {
  const { at, over, out, outOver } = block.reveal;
  const list = [{ kind: 'reveal', a: at, b: at + over }];
  if (out !== undefined) list.push({ kind: 'exit', a: out, b: out + (outOver ?? 0.05) });
  return list;
}

async function main(): Promise<void> {
  const report = new Report('pacing');

  // ---------------------------------------------------------------------------
  // The checkpoint constraint. Pure arithmetic, no browser needed, and it is the
  // one that silently poisons a *different* check when it breaks.
  // ---------------------------------------------------------------------------
  for (const block of BLOCKS) {
    for (const w of windowsOf(block)) {
      for (const c of CHECKPOINTS) {
        report.assert(
          !(c > w.a && c < w.b),
          `${block.id}: §6 checkpoint ${fmtP(c)} falls inside the ${w.kind} window ` +
            `[${w.a.toFixed(3)}, ${w.b.toFixed(3)}] — mid-reveal every pixel is at partial ` +
            `opacity, so contrast measured at this checkpoint is meaningless`,
        );
      }
    }
  }

  const server = await serveDist();
  const browser = await launch();

  try {
    for (const vp of VIEWPORTS) {
      const { page, issues } = await openPage(browser, server.url, vp);
      const budgetPx = REVEAL_BUDGET_VH * vp.height;

      // 1. scroll distance
      const maxScroll = await page.evaluate(
        () => document.documentElement.scrollHeight - window.innerHeight,
      );
      const wantScroll = (SCROLL_VH / 100 - 1) * vp.height;
      report.assert(
        Math.abs(maxScroll - wantScroll) <= 2,
        `${vp.name}: scrollable distance is ${maxScroll}px, want ${wantScroll.toFixed(0)}px ` +
          `(${SCROLL_VH}vh) — SCROLL_VH did not reach the document`,
      );

      console.log(
        `${vp.name}: ${maxScroll}px of scroll (${SCROLL_VH}vh), ` +
          `reveal budget ${budgetPx.toFixed(0)}px`,
      );

      // 2 + 3. every block's window, in pixels and in the DOM
      for (const block of BLOCKS) {
        const { at, over } = block.reveal;

        // Only the part of the window that is actually on the page costs the reader
        // anything. `act1-h1` and the cue both start at a negative `at` so that they are
        // complete at first paint — their windows close at or before p=0, and the reader
        // scrolls through none of them. Charging them the full `over` measures a reveal
        // that never happens, and at a tight budget that is a false failure rather than a
        // conservative one.
        const onPage = Math.max(0, at + over) - Math.max(0, at);
        const revealPx = onPage * maxScroll;

        report.assert(
          revealPx <= budgetPx,
          `${vp.name} ${block.id}: takes ${revealPx.toFixed(0)}px of scroll to arrive, ` +
            `budget ${budgetPx.toFixed(0)}px (${REVEAL_BUDGET_VH} x viewport height)`,
        );

        // Hidden before the window opens. Blocks that start at a negative `at` are
        // complete at first paint by design and have no "before".
        if (at - EDGE >= 0) {
          await gotoP(page, at - EDGE);
          const before = await blockState(page, block.id);
          report.assert(before.found, `${vp.name} ${block.id}: not mounted`);
          report.assert(
            before.opacity <= 0.05,
            `${vp.name} ${block.id}: opacity ${before.opacity.toFixed(3)} at p=${fmtP(at - EDGE)}, ` +
              `just before its declared start of ${fmtP(at)} — want hidden`,
          );
        }

        // Fully arrived once it closes.
        const afterP = Math.min(at + over + EDGE, 1);
        await gotoP(page, afterP);
        const after = await blockState(page, block.id);
        report.assert(after.found, `${vp.name} ${block.id}: not mounted`);
        report.assert(
          after.opacity >= 0.98,
          `${vp.name} ${block.id}: opacity ${after.opacity.toFixed(3)} at p=${fmtP(afterP)}, ` +
            `just past its declared end of ${fmtP(at + over)} — want fully revealed`,
        );

        // …and the words with it. A `byWord` heading whose container reads 1 can still have
        // its tail sitting at partial opacity for the whole hold, which is a contrast
        // failure that lasts rather than a transient one.
        if (block.byWord) {
          report.assert(
            after.wordCount > 0,
            `${vp.name} ${block.id}: declared byWord but has no .word spans — splitWords ` +
              `did not run, so the per-word reveal is silently not happening`,
          );
          report.assert(
            after.worstWord >= 0.98,
            `${vp.name} ${block.id}: worst word opacity ${after.worstWord.toFixed(3)} at ` +
              `p=${fmtP(afterP)} across ${after.wordCount} words — the line never finishes ` +
              `arriving, and stays that way through the hold`,
          );
        }
      }

      // 4. the scroll cue
      await gotoP(page, 0);
      const cue = await blockState(page, CUE_ID);
      report.assert(cue.found, `${vp.name}: no [data-block="${CUE_ID}"] — the cue is missing`);
      if (cue.found && cue.rect) {
        report.assert(
          cue.opacity >= 0.95,
          `${vp.name}: cue opacity ${cue.opacity.toFixed(3)} at p=0 — it must be complete on ` +
            `arrival, not revealed after the reader has already decided what to do`,
        );
        report.assert(
          /keep scrolling/i.test(cue.text),
          `${vp.name}: cue reads "${cue.text.trim()}", want "Keep scrolling"`,
        );
        report.assert(
          cue.rect.top >= 0 && cue.rect.bottom <= vp.height && cue.rect.width > 0,
          `${vp.name}: cue box is top=${cue.rect.top.toFixed(0)} bottom=${cue.rect.bottom.toFixed(0)} ` +
            `in a ${vp.height}px viewport — a scroll affordance below the fold is no affordance`,
        );

        // It must also overlap nothing. Act I's copy column is the only other thing on
        // screen at p=0, and at 390x844 it is ~600px tall.
        const clash = await page.evaluate(
          ({ id, height }) => {
            const cueEl = document.querySelector<HTMLElement>(`[data-block="${id}"]`);
            if (!cueEl) return null;
            const c = cueEl.getBoundingClientRect();
            for (const el of document.querySelectorAll<HTMLElement>('.copy-block')) {
              if (el === cueEl) continue;
              if (Number(getComputedStyle(el).opacity) < 0.05) continue;
              const r = el.getBoundingClientRect();
              if (r.bottom > c.top && r.top < c.bottom && r.right > c.left && r.left < c.right) {
                return { block: el.dataset['block'] ?? '?', bottom: r.bottom, cueTop: c.top, height };
              }
            }
            return null;
          },
          { id: CUE_ID, height: vp.height },
        );
        report.assert(
          clash === null,
          `${vp.name}: cue overlaps ${clash?.block} (its bottom ${clash?.bottom.toFixed(0)}px ` +
            `vs cue top ${clash?.cueTop.toFixed(0)}px)`,
        );
      }

      await gotoP(page, CUE_GONE_P);
      const gone = await blockState(page, CUE_ID);
      report.assert(
        gone.opacity <= 0.02,
        `${vp.name}: cue opacity ${gone.opacity.toFixed(3)} at p=${fmtP(CUE_GONE_P)} — it should ` +
          `leave once scrolling has started, having done its job`,
      );

      for (const issue of issues) {
        report.assert(false, `${vp.name}: ${issue.kind} — ${issue.text}`);
      }

      await page.context().close();
    }
  } finally {
    await browser.close();
    await server.close();
  }

  report.finish();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
