/**
 * Rise/extrude travel: a slot must move far enough to actually clear its clip line.
 *
 * `rise` and `extrude` hide a slot by translating it down behind a static clip
 * (`src/stage.ts`), and they hold `opacity: 1` for the whole transition. So if the travel
 * distance is shorter than the art's extent above the clip line, the shortfall does not
 * fade out — it stands there at full opacity, with a hard flat edge where the clip cuts it,
 * and then hard-cuts when the layer is dropped. docs/review-checklist.md §7 names it: "travel
 * shorter than the art's extent above its clip line leaks the incoming act above the horizon."
 *
 * That bug has now been found twice, in Act III and Act II, both times as a copy of the same
 * `h * 0.3` constant, and both times only by looking at it. The distance it needs to clear is
 * a property of the art, which the art knows and a hand-written constant does not — so this
 * measures it: raster each slot, read the drawn extent off the buffer, and compare.
 *
 * Runs in node with no browser. The acts are pure functions of a geometry box and touch no
 * DOM, which is what makes rastering them here possible at all.
 */

import { BLEED_PX, VIEWPORTS, bufferOriginFor, horizonPx, vpPx } from '../src/config.ts';
import { ACTS } from '../src/acts/index.ts';
import type { DrawFn, Geometry, SlotArt } from '../src/acts/types.ts';
import { Buf, bufferSize } from '../src/art/buffer.ts';
import { Palette } from '../src/art/palette.ts';
import { Report } from './lib.ts';

/** Verbs that move. `crossfade` and `drift` clear the frame by other means. */
const TRAVELLING = new Set(['rise', 'extrude']);

function geoFor(w: number, h: number): Geometry {
  // Identical to Stage.measure, including whole-pixel anchors — a geometry that differs
  // from the runtime's would measure art nobody ever sees.
  return { w, h, horizon: horizonPx(h), vp: vpPx(w), bleed: BLEED_PX };
}

/** Raster one draw callback and return the bounding box of what it painted, in stage px. */
function extentOf(draw: DrawFn, geo: Geometry): { y0: number; y1: number } | null {
  const ox = bufferOriginFor(geo.vp);
  const oy = bufferOriginFor(geo.horizon);
  const size = bufferSize(geo.w, geo.h, ox, oy);
  const buf = new Buf(new Palette(), size.w, size.h, ox, oy);
  buf.protectRow(geo.horizon);
  draw(buf, geo);
  const box = buf.drawnBox();
  return box ? { y0: box.y0, y1: box.y1 } : null;
}

/** The distance stage.ts will actually translate this slot. Mirrors Stage.defaultTravel. */
function travelOf(art: SlotArt, geo: Geometry): number {
  return art.travelPx ?? (art.clipBottom ?? geo.horizon) + geo.bleed;
}

function main(): void {
  const report = new Report('rise / extrude travel');
  let unmeasurable = 0;
  let empty = 0;

  for (const vp of VIEWPORTS) {
    const geo = geoFor(vp.width, vp.height);
    const rows: string[] = [];

    for (const act of ACTS) {
      const slots = act.build(geo);

      for (const [slot, art] of slots.entries()) {
        if (!art || !TRAVELLING.has(art.verb)) continue;

        const where = `${vp.name} ${act.id} slot ${slot} (${art.verb})`;
        const clipBottom = art.clipBottom ?? geo.horizon;
        const travel = travelOf(art, geo);

        if (!art.draw) {
          // An unported slot is markup, not pixels, and its extent cannot be read here.
          // Counted and reported rather than skipped silently: a check whose coverage
          // quietly shrinks as acts change is worse than one that says what it missed.
          unmeasurable += 1;
          rows.push(`  ${where}: no draw callback — extent not measurable, NOT CHECKED`);
          continue;
        }

        const extent = extentOf(art.draw, geo);
        if (!extent) {
          // A slot that paints nothing has no art above the clip line, so there is nothing
          // for the travel to clear and the requirement is vacuous — not violated. Act I
          // slots 2-3 and Act IV slot 3 are here legitimately: the houses were removed at
          // the client's direction, and the slots stayed as empty parameterisations rather
          // than being deleted.
          //
          // Whether a slot *ought* to be painting is a real question, but it is not this
          // check's question, and answering it here would fail the build for a deliberate
          // art decision. Printed rather than skipped silently.
          empty += 1;
          rows.push(`  ${where}: paints nothing — no art to clear, requirement vacuous`);
          continue;
        }

        // How far the topmost painted pixel has to fall to sit below the clip line.
        const required = clipBottom - extent.y0;
        const margin = travel - required;

        report.assert(
          margin >= 0,
          `${where}: travels ${travel.toFixed(0)}px but its art stands ${required.toFixed(0)}px ` +
            `above the clip line at y=${clipBottom.toFixed(0)} (top pixel at y=${extent.y0.toFixed(0)}) ` +
            `— short by ${(-margin).toFixed(0)}px. rise/extrude hold opacity 1, so that ` +
            `shortfall stands at full opacity instead of fading (review-checklist §7). ` +
            `Drop travelPx and let defaultTravel give ${(clipBottom + geo.bleed).toFixed(0)}px.`,
        );

        rows.push(
          `  ${where}: travel ${travel.toFixed(0)}px, needs ${required.toFixed(0)}px, ` +
            `margin ${margin >= 0 ? '+' : ''}${margin.toFixed(0)}px` +
            (art.travelPx === undefined ? ' [default]' : ' [override]'),
        );
      }
    }

    console.log(`${vp.name}:`);
    for (const row of rows) console.log(row);
  }

  if (unmeasurable > 0) {
    console.log(`\n${unmeasurable} slot(s) could not be measured — see NOT CHECKED above.`);
  }
  if (empty > 0) {
    console.log(`${empty} slot(s) paint nothing — vacuously satisfied, not asserted.`);
  }

  report.finish();
}

main();
