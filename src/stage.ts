import {
  BLEED_PX,
  HORIZON_FRAC,
  SLOT_COUNT,
  SLOT_RATES,
  STAGGER_ORDER,
  TWOS_MS,
  VP_FRAC,
  driftAmplitude,
  horizonPx,
  roundToDevicePx,
  vpPx,
  ART_SCALE,
} from './config.ts';
import type { ActDefinition, DrawFn, Geometry, SlotArt } from './acts/types.ts';
import { Buf, bufferSize } from './art/buffer.ts';
import { canvasFor, rasterOf, type Raster } from './art/compose.ts';
import { GRAIN_TILE_PX, grainTile } from './art/grain.ts';
import { Palette } from './art/palette.ts';
import { bufferOriginFor, horizonPx as horizonPxOf, vpPx as vpPxOf } from './config.ts';
import { progress, prewarmActs, residentActs, type Frame } from './progress.ts';
import { slotEase, slotProgress, type ActIndex } from './timeline.ts';
import { aberrates, aberrationOffset, halftoneOverlay, postDefs } from './post/index.ts';

/**
 * How long one frame may spend rastering newly-resident layers, in ms.
 *
 * 3, not something closer to a full 16ms frame: the write pass is not the only thing in a
 * frame, and the point is to leave the compositor room. It is a floor as well as a ceiling —
 * `sync` always builds at least one unit per frame, so a unit costing more than the budget
 * on its own still makes progress rather than deadlocking.
 *
 * Tuned down from 6. At 6 the measured work-median was 7.1ms, i.e. above the budget, which
 * meant a frame could admit a second unit before noticing it was over — and 1440x900 peaked
 * at 16.7ms against a 16ms frame. A budget below the cost of a single unit makes "one unit
 * per frame" the normal case instead of the lucky one.
 */
const BUILD_BUDGET_MS = 3;

/**
 * The budget while the reader is moving fast, in ms.
 *
 * Completeness beats frame time during a flick, and the trade is not close. A 10ms frame
 * inside a fast scroll is invisible — the view is already moving further per frame than any
 * one frame's detail survives. A *missing building* is not invisible: it fades up after the
 * ground it stands on, and that is the seam a reader actually notices.
 *
 * Applied when an act that is **visible right now** still has unbuilt layers — that is, when
 * prewarming lost the race and the reader is looking at a hole. Prewarm work, which nobody
 * can see yet, keeps the small budget.
 *
 * That distinction is the whole design. Deciding it from scroll velocity does not work: a
 * flick peaks at 0.263 smoothed velocity while a sustained scroll approaches 1, so velocity
 * widens the budget for the reader who needs it least. "Is something missing from the frame
 * on screen" is the question actually being asked, so it is the one that is asked.
 *
 * Stays under the 16ms frame gate with room.
 */
const URGENT_BUDGET_MS = 10;



interface ActLayer {
  readonly art: SlotArt;
  /** Outer element. Receives lateral drift only — never a Y translate. */
  readonly drift: HTMLElement;
  /** Inner element. Receives transition travel. */
  readonly travel: HTMLElement;
  /** VP-registered geometry. Never transformed. */
  readonly locked: HTMLElement | null;
  /** Independently-moving sub-layers, paired with their rates. */
  readonly parts: readonly { el: HTMLElement; rate: number }[];
  /** Red / cyan channel plates for chromatic aberration. Null where the slot has none. */
  readonly plates: { red: HTMLElement; cyan: HTMLElement } | null;
}

interface SlotEls {
  readonly root: HTMLElement;
  readonly layers: Map<ActIndex, ActLayer>;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export class Stage {
  private readonly slots: SlotEls[] = [];
  private readonly host: HTMLElement;
  private readonly acts: readonly ActDefinition[];
  private geo: Geometry;
  private twosAccumulator = 0;
  private buildsPending = false;
  /**
   * Locked-layer canvases whose upload has been deferred to a later frame.
   *
   * Only the *upload* is deferred, never the element: `.locked` is appended to its slot in
   * document order at build time, because within a slot the child order is the paint order
   * and moving a locked layer after another act's drift would change what paints over what
   * mid-transition. The empty div costs nothing and is invisible until its act's opacity
   * comes up, which `render` drives from the transition anyway.
   *
   * This exists because slot 7 is the only slot carrying both a `draw` and a `drawLocked`,
   * and it is the entire act-entry cost — one indivisible `buildLayer` call doing two
   * full-frame rasters, which no per-frame budget could split.
   */
  private readonly pendingLocked: {
    host: HTMLElement;
    act: ActIndex;
    draw: DrawFn;
    /** Blit from this canvas instead of re-uploading. See `canvasFor`. */
    copyFrom?: HTMLCanvasElement;
    alpha?: number;
  }[] = [];
  /**
   * One `build()` per act, not one per slot.
   *
   * `buildLayer` used to call `definition.build(this.geo)[slot]`, running the whole act
   * and discarding seven eighths of it, eight times over. That is invisible while an act
   * returns markup strings and unaffordable the moment each call rasterises.
   */
  private readonly builtArt = new Map<ActIndex, readonly SlotArt[]>();
  /** One indexed palette per act — see `raster`. */
  private readonly palettes = new Map<ActIndex, Palette>();
  /** Cached so the write pass does not touch `window` eight times a frame. */
  private dpr: number;
  /**
   * ?frozen=1 — every transform written as identity.
   *
   * Only check:register uses this. Each slot drifts by a different amount, so in normal
   * operation the slots' art grids sit at different phases and a whole-frame scan for
   * uniform cells has no single grid to scan against. Freezing puts them all on the same
   * phase; it is a measurement fixture, not a rendering mode.
   */
  private frozen = false;
  /**
   * Whether to build chromatic-aberration plates.
   *
   * Off on small high-density screens. A plate is a second full-viewport canvas, and five of
   * the eight slots aberrate, so the plates are roughly a third of the composited memory —
   * which is the resource a phone actually runs out of. Measured at 390x844 dpr 3, a
   * transition composites ~33 canvases for ~580MB, and that is what kills a tab.
   *
   * The effect costs almost nothing visually here: the separation peaks at a few CSS pixels
   * (`aberrationOffset`), and at dpr 3 over art whose pixels are already 3 CSS px wide, a
   * 1-2px channel split is at the edge of visible. Trading it for the page not dying is not
   * a close call.
   */
  private plates = true;

  constructor(host: HTMLElement, acts: readonly ActDefinition[]) {
    this.host = host;
    this.acts = acts;
    this.dpr = window.devicePixelRatio || 1;
    this.geo = measure(host);
    this.plates = usePlates(this.geo.w, this.dpr);
    host.style.setProperty('--horizon-frac', String(HORIZON_FRAC));
    host.style.setProperty('--vp-frac', String(VP_FRAC));
    host.style.setProperty('--bleed', `${BLEED_PX}px`);
    this.writeAnchors();

    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const root = document.createElement('div');
      root.className = 'slot';
      root.dataset['slot'] = String(slot);
      // Slot 0 is nearest the viewer, so it paints last.
      root.style.zIndex = String((SLOT_COUNT - slot) * 10);
      host.appendChild(root);
      this.slots.push({ root, layers: new Map() });
    }

    // One <defs> for the whole page. Every pattern in it is static — §3 forbids
    // animating a filter primitive, and re-rasterising a screen-sized layer per frame
    // is what would break the frame budget.
    host.insertAdjacentHTML('beforeend', postDefs(Math.max(2, Math.round(this.geo.w / 200))));
  }

  get geometry(): Geometry {
    return this.geo;
  }

  get isFrozen(): boolean {
    return this.frozen;
  }

  freeze(): void {
    this.frozen = true;
  }

  /**
   * Phase of the art grid in viewport pixels: cell boundaries sit at `phase + k*ART_SCALE`.
   *
   * The grid is anchored to the vanishing point and the horizon, never to the frame
   * origin. A scan rooted at 0,0 would be half a cell out wherever an anchor is not itself
   * a multiple of ART_SCALE, and would report every cell broken while the art was
   * perfectly registered — the same class of mistake as measuring the horizon by looking
   * for the strongest edge in the image.
   */
  gridOrigin(): { x: number; y: number } {
    const mod = (value: number): number => ((value % ART_SCALE) + ART_SCALE) % ART_SCALE;
    return {
      x: mod(-bufferOriginFor(vpPxOf(this.geo.w))),
      y: mod(-bufferOriginFor(horizonPxOf(this.geo.h))),
    };
  }

  /** Rebuild every resident layer against a new stage box. Resize only, never per frame. */
  remeasure(): void {
    this.dpr = window.devicePixelRatio || 1;
    this.geo = measure(this.host);
    this.plates = usePlates(this.geo.w, this.dpr);
    this.builtArt.clear();
    // Palettes are rebuilt with the art. A ramp's step count depends on the stage box, so
    // carrying entries across a resize would leak dead colours into the next budget.
    this.palettes.clear();
    this.writeAnchors();
    for (const slot of this.slots) {
      for (const act of [...slot.layers.keys()]) this.dropLayer(slot, act);
    }
    // `immediate`: every layer was just dropped, so amortising here would show a stage
    // with one slot in it for several frames. A resize is rare and already costs a full
    // relayout; one long frame is the right trade, and the alternative is a visible flash.
    this.sync(progress.frame, true);
    // sync() only builds; it does not position. Without a write pass here every rebuilt
    // layer sits at identity until the next frame, which is a visible jump on resize.
    this.render(progress.frame, 0);
  }

  /**
   * The anchors, in whole pixels rather than `calc(58% )`.
   *
   * A percentage resolves to 489.52px at 390x844, and no pixel boundary exists there — so
   * the art can only ever be registered to the anchor approximately. Publishing the
   * rounded value and drawing the art at the same number makes the two agree exactly.
   */
  private writeAnchors(): void {
    this.host.style.setProperty('--horizon-px', `${horizonPx(this.geo.h)}px`);
    this.host.style.setProperty('--vp-px', `${vpPx(this.geo.w)}px`);
    // The grain tile has to sit on the same grid as the art, or its specks straddle cell
    // boundaries and the whole frame stops being cell-uniform.
    const phase = this.gridOrigin();
    this.host.style.setProperty('--grain-phase-x', `${phase.x}px`);
    this.host.style.setProperty('--grain-phase-y', `${phase.y}px`);
    this.host.style.setProperty('--grain-tile', `${GRAIN_TILE_PX}px`);
    this.host.style.setProperty('--grain-image', `url(${grainTile()})`);
  }

  /**
   * The single write pass. Called once per frame from one rAF, after the store ticks.
   */
  render(frame: Readonly<Frame>, deltaMs: number): void {
    const built = this.sync(frame);

    this.twosAccumulator += deltaMs;
    // A layer built this frame must be positioned this frame. Slot 0 is otherwise skipped
    // on non-tick frames, so a newly-resident act's props would hold an identity transform
    // for up to a twos period (~83ms) and visibly pop into place once it expired.
    const twosTick = built || this.twosAccumulator >= TWOS_MS;
    if (twosTick) this.twosAccumulator %= TWOS_MS;

    const amplitude = driftAmplitude(this.geo.w);
    const segment = frame.segment;
    // Which acts may be *seen* this frame. `sync` builds a longer list than this — the next
    // act is rastered ahead during a hold so a fast scroll never outruns the raster — and a
    // prewarmed act must stay invisible until its segment actually arrives.
    const visible = residentActs(frame);

    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const els = this.slots[slot];
      if (!els) continue;
      const rate = SLOT_RATES[slot] ?? 1;
      // Whole device pixels. A fractional translate resamples the layer under the
      // compositor, which softens every edge on every moving slot — the failure that
      // reads as "the art is a bit mushy" and gets misfiled as an art problem.
      const driftX = this.frozen
        ? 0
        : roundToDevicePx((frame.c - 0.5) * rate * amplitude, this.dpr);
      // Vertical drift is zero for every slot at every scroll position (build.md A1).
      const driftTransform = `translate3d(${driftX}px,0,0)`;

      // Slot 0 runs on twos: it is skipped entirely on non-tick frames, so it updates at
      // 12fps while everything else runs at display rate. A throttled tick, not a CSS
      // animation — this is the detail that does the most to evoke the reference.
      if (slot === 0 && !twosTick) continue;

      for (const [act, layer] of els.layers) {
        // Prewarmed but not yet on stage: positioned exactly as if it were, then taken out
        // of the composite entirely.
        //
        // Positioned, not skipped. Leaving a prewarmed layer at identity and only writing
        // its transform once it becomes visible means it *jumps* into place on that first
        // visible frame — a seam of exactly the kind prewarming exists to remove, and one
        // that check:parallax catches as `driftX=0, want -24px`.
        //
        // `display: none`, not `opacity: 0`. This is the difference between a prewarmed act
        // costing nothing and costing the same as a visible one. A canvas is 174x326 in its
        // backing store at 390x844, but it is *displayed* at full viewport width, so the
        // compositor texture is device-resolution: ~11.8MB per layer at dpr 3. Measured on a
        // mobile profile, holding three acts at opacity 0 came to **49 canvases and ~861MB**
        // of worst-case compositor memory, which is how a phone tab gets killed. An
        // `opacity: 0` layer is still composited; a `display: none` subtree is not rastered
        // at all. The transform is still written, so nothing jumps when it is shown.
        const shown = visible.includes(act);
        const wantDisplay = shown ? '' : 'none';
        if (layer.drift.style.display !== wantDisplay) {
          layer.drift.style.display = wantDisplay;
          if (layer.locked) layer.locked.style.display = wantDisplay;
        }
        // Written before the early-out, always. A prewarmed layer that is not positioned
        // jumps into place on the frame it is shown, which check:parallax reports as
        // `driftX=0, want -24px`. `display: none` does not stop a transform being recorded.
        layer.drift.style.transform = driftTransform;
        if (!shown) continue;

        // Channel separation scales with scroll velocity (§3: 0px at rest to 6px at
        // peak). It is a transform, so it never re-rasterises and the response is
        // continuous rather than stepped.
        if (layer.plates) {
          // Whole pixels: a fractional translate resamples the plate and gives every edge
          // a blend column, which is the anti-aliasing §3 forbids.
          const off = this.frozen
            ? 0
            : Math.round(aberrationOffset(slot, frame.velocity, ART_SCALE));
          layer.plates.red.style.transform = `translate3d(${off}px,0,0)`;
          layer.plates.cyan.style.transform = `translate3d(${-off}px,0,0)`;
        }

        // Prop self-motion, scroll-driven so it is deterministic and never a timer.
        for (const part of layer.parts) {
          const x = this.frozen
            ? 0
            : roundToDevicePx(frame.c * part.rate * this.geo.w, this.dpr);
          part.el.style.transform = `translate3d(${x}px,0,0)`;
        }

        if (segment.kind === 'hold') {
          layer.travel.style.transform = 'translate3d(0,0,0)';
          layer.drift.style.opacity = '1';
          if (layer.locked) layer.locked.style.opacity = '1';
          continue;
        }

        const incoming = act === segment.to;
        const eased = slotEase(slot, slotProgress(slot, frame.t));
        const local = incoming ? 1 - eased : eased;

        // VP-registered geometry can never be transformed — check:invariant asserts an
        // identity matrix on it — so opacity is the only verb available to it, whatever
        // the slot's verb is for its free layer. Without this the road, the sun and the
        // ground plane hard-cut at every segment boundary while the structures above them
        // rise and sink correctly.
        if (layer.locked) {
          layer.locked.style.opacity = (incoming ? eased : 1 - eased).toFixed(4);
        }

        switch (layer.art.verb) {
          case 'crossfade': {
            layer.drift.style.opacity = (incoming ? eased : 1 - eased).toFixed(4);
            layer.travel.style.transform = 'translate3d(0,0,0)';
            break;
          }
          case 'drift': {
            // Must clear the frame from any authored x, so it is the full stage width
            // plus the bleed — not a fraction of it. A fractional offset only parks art
            // off-canvas if it started on the far side to begin with.
            const off = roundToDevicePx(
              (this.geo.w + this.geo.bleed) * local * (incoming ? 1 : -1),
              this.dpr,
            );
            layer.drift.style.opacity = '1';
            layer.travel.style.transform = `translate3d(${off}px,0,0)`;
            break;
          }
          // `rise` and `extrude` are the same transform. They differ only in where the
          // static clip line sits: the horizon, or the structure's own base.
          case 'rise':
          case 'extrude': {
            const distance = layer.art.travelPx ?? this.defaultTravel(slot, layer.art);
            const y = roundToDevicePx(distance * local, this.dpr);
            layer.drift.style.opacity = '1';
            layer.travel.style.transform = `translate3d(0,${y}px,0)`;
            break;
          }
        }

      }
    }
  }

  /** Per-slot DOM + transform state, for the verification scripts. */
  metrics(): unknown {
    const amplitude = driftAmplitude(this.geo.w);
    const c = progress.frame.c;
    return {
      geometry: this.geo,
      dpr: this.dpr,
      slots: this.slots.map((slot, index) => ({
        slot: index,
        rate: SLOT_RATES[index] ?? null,
        // The displacement *before* rounding. check:parallax needs this: once every
        // transform is snapped to a device pixel, the ratios between slots no longer hold
        // on the written values — slot 7's whole sweep is 3px, so rounding dominates it.
        // The rate contract is a statement about intent, and this is the intent.
        driftIntent: (c - 0.5) * (SLOT_RATES[index] ?? 1) * amplitude,
        // Prewarmed acts are `display: none` and are not part of the rendered composition.
        // They are excluded here rather than reported with a zero transform, because
        // getComputedStyle does not resolve transforms on an element outside the render
        // tree — reporting them would have check:parallax assert against a value the
        // browser declines to compute, not against anything the build did wrong.
        layers: [...slot.layers.entries()]
          .filter(([, layer]) => getComputedStyle(layer.drift).display !== 'none')
          .map(([act, layer]) => ({
          act,
          verb: layer.art.verb,
          drift: getComputedStyle(layer.drift).transform,
          travel: getComputedStyle(layer.travel).transform,
          opacity: getComputedStyle(layer.drift).opacity,
          locked: layer.locked ? getComputedStyle(layer.locked).transform : null,
        })),
      })),
    };
  }

  /**
   * Build layers for resident acts, drop the rest (build.md B5). Returns true if anything
   * was built, so the caller can guarantee the new layer is positioned on this same frame.
   *
   * **Amortised.** Building all eight slots of an incoming act in one frame is what every
   * over-budget frame in this build was: measured under real wheel scrolling at 1440x900,
   * 5 frames of 204 exceeded 16ms, peaking at 33ms, and every one of them was a transition
   * boundary. Steady state is 0.10ms, so the cost is entirely here.
   *
   * The saving grace is that at the instant an act becomes resident, **none of its layers
   * are visible yet**: `crossfade` enters at `opacity: eased(0) = 0`, `rise`/`extrude` enter
   * translated fully below their clip line, and `drift` enters off-canvas. A slot only needs
   * to exist by the time its own staggered window opens, which for the last slot is 42% of
   * the way through the transition. So the work can be spread over frames rather than
   * crammed into the one where the segment changed.
   *
   * Slots are built in `STAGGER_ORDER` — the order they become visible — so the first thing
   * built is the first thing needed. `BUILD_BUDGET_MS` bounds a frame's work, and at least
   * one slot is always built so progress is guaranteed even if a single slot exceeds the
   * budget on its own. Nothing here is a timer: a fast scroll simply builds more per frame
   * because the budget refills every frame.
   */
  private sync(frame: Readonly<Frame>, immediate = false): boolean {
    // Build the prewarm set, keep the prewarm set — but `render` only *shows* the resident
    // set. An act built ahead of time is present in the DOM at opacity 0 until its segment
    // arrives.
    const resident = prewarmActs(frame);

    // Dropping is cheap — DOM removal, no raster — so it stays eager and complete.
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const els = this.slots[slot];
      if (!els) continue;
      for (const act of [...els.layers.keys()]) {
        if (!resident.includes(act)) this.dropLayer(els, act);
      }
    }

    // `build()` gets a frame to itself. It is the second-largest item after the slot 7
    // raster — 6.49ms for Act III at 1440x900 — and pairing the two in one frame is what
    // keeps a transition frame over budget even with the raster amortised. Returning here
    // costs one extra frame per act, during which nothing of that act is visible yet.
    //
    // Most of that cost is waste: all four acts emit nine slots carrying *both* a `draw`
    // callback and SVG markup, and `draw` wins everywhere it is present, so 59-289KB of
    // markup is built per act and dropped. Deleting it is the real fix and is a change to
    // the acts, not to the engine.
    // `immediate` skips the yield: remeasure() has just dropped every layer, so returning
    // here would leave the stage empty for a frame rather than merely unbuilt-but-hidden.
    for (const act of resident) {
      if (!this.builtArt.has(act)) {
        this.artFor(act);
        if (!immediate) {
          this.buildsPending = true;
          return false;
        }
      }
    }

    let built = false;
    let pending = false;
    const start = performance.now();
    // Urgent if anything the reader can see right now is still missing.
    const visibleNow = residentActs(frame);
    let urgent = false;
    for (const act of visibleNow) {
      for (let slot = 0; slot < SLOT_COUNT && !urgent; slot++) {
        if (!this.slots[slot]?.layers.has(act)) urgent = true;
      }
      if (urgent) break;
    }
    if (!urgent && this.pendingLocked.some((j) => visibleNow.includes(j.act))) urgent = true;
    const budget = urgent ? URGENT_BUDGET_MS : BUILD_BUDGET_MS;

    // Act order first, so the incoming act paints over the outgoing one; slot order within
    // it is visibility order, not index order. Slots are separate containers, so ordering
    // between slots is structural and unaffected — only the order of acts *within* one slot
    // decides what paints over what, and that stays `resident` order across frames.
    outer: for (const act of resident) {
      for (const slot of STAGGER_ORDER) {
        const els = this.slots[slot];
        if (!els || els.layers.has(act)) continue;

        // Checked before building, and only once something has been built, so the
        // "at least one per frame" floor holds however expensive that one slot is.
        if (!immediate && built && performance.now() - start >= budget) {
          pending = true;
          break outer;
        }

        this.buildLayer(els, slot, act);
        built = true;
      }
    }

    // Deferred locked uploads share the frame budget with layer builds, and are drained
    // after them: a slot's free layer is what becomes visible first, so it is what should
    // exist first.
    while (this.pendingLocked.length > 0) {
      if (!immediate && built && performance.now() - start >= budget) {
        pending = true;
        break;
      }
      const job = this.pendingLocked.shift();
      if (!job) break;
      job.host.appendChild(
        job.copyFrom
          ? this.canvas(this.rasterOnce(job.act, job.draw), job.alpha, job.copyFrom)
          : this.canvas(this.rasterOnce(job.act, job.draw)),
      );
      built = true;
    }

    this.buildsPending = pending || this.pendingLocked.length > 0;
    return built;
  }

  /**
   * True once every resident act's layers exist.
   *
   * `main.ts` holds the first-paint placeholder until this goes true. Removing it on the
   * first painted frame was correct when that frame built the whole act; with the raster
   * amortised, the first frame holds one slot out of eight, and dropping the placeholder
   * there would expose a half-built scene — trading a hitch for a flash.
   */
  get settled(): boolean {
    return !this.buildsPending;
  }

  private dropLayer(els: SlotEls, act: ActIndex): void {
    const layer = els.layers.get(act);
    if (!layer) return;
    layer.drift.remove();
    layer.locked?.remove();
    els.layers.delete(act);
    // Drop any deferred upload aimed at the element just removed, or the queue would raster
    // a full frame's worth of art into a detached div — invisible, and paid for.
    for (let i = this.pendingLocked.length - 1; i >= 0; i--) {
      if (this.pendingLocked[i]?.host === layer.locked) this.pendingLocked.splice(i, 1);
    }
  }

  /** One `build()` per act per geometry — see `builtArt`. */
  private artFor(act: ActIndex): readonly SlotArt[] | null {
    const cached = this.builtArt.get(act);
    if (cached) return cached;
    const definition = this.acts[act];
    if (!definition) return null;
    const art = definition.build(this.geo);
    this.builtArt.set(act, art);
    return art;
  }

  private buildLayer(els: SlotEls, slot: number, act: ActIndex): void {
    const art = this.artFor(act)?.[slot];
    if (!art) return;

    const drift = document.createElement('div');
    drift.className = 'layer drift';
    drift.dataset['drift'] = 'free';
    drift.dataset['act'] = String(act);
    if (art.clipBottom !== undefined) {
      // Whole device pixels, for the same reason as the transforms: a clip edge landing
      // mid-pixel is antialiased by the compositor, which puts a soft seam along the one
      // line the composition is registered to.
      const fromBottom = roundToDevicePx(
        this.geo.h + this.geo.bleed - art.clipBottom,
        this.dpr,
      );
      drift.style.clipPath = `inset(0px 0px ${fromBottom}px 0px)`;
    }

    const travel = document.createElement('div');
    travel.className = 'travel';
    travel.dataset['travel'] = art.verb;
    // One paint of the free layer, however many copies of it the DOM needs. The aberration
    // plates are two *copies of the same raster*, not two rasters — that distinction is
    // what keeps the effect compositor-only, and it is why the channel split stays in the
    // DOM rather than moving into the buffer: the offset is velocity-driven, so an
    // in-buffer split would re-raster the slot on every frame.
    // Raster the free layer at most once, however many DOM copies of it are needed.
    const freeRaster = art.draw ? this.rasterOnce(act, art.draw) : null;
    // The first canvas pays the upload; any further copy blits from it (see `canvasFor`).
    let firstCanvas: HTMLCanvasElement | null = null;
    const paintFree = (): Node => {
      if (!freeRaster) return this.svg(art.free ?? '');
      const canvas = this.canvas(freeRaster, art.alpha, firstCanvas ?? undefined);
      firstCanvas ??= canvas;
      return canvas;
    };

    /**
     * Append a copy of the free raster into `host`, deferring it if one already exists.
     *
     * The two aberration plates are the last indivisible pair in a slot 7 build, and slot 7
     * is the entire act-entry cost. The first plate is uploaded now because something has
     * to be on screen; the second is queued, and until it lands the slot shows one channel
     * instead of two. That is invisible in practice: an incoming act's layers are at
     * opacity 0 for the whole of their first frames, and at load the placeholder is held
     * until `settled`.
     */
    const appendFreeCopy = (host: HTMLElement): void => {
      if (!freeRaster || !art.draw) {
        host.appendChild(paintFree());
        return;
      }
      if (!firstCanvas) {
        host.appendChild(paintFree());
        return;
      }
      this.pendingLocked.push({
        host,
        act,
        draw: art.draw,
        copyFrom: firstCanvas,
        ...(art.alpha === undefined ? {} : { alpha: art.alpha }),
      });
    };

    // An aberrating slot is drawn *only* as its two channel plates — screened together
    // they reconstruct the original exactly. Keeping a full base copy underneath would
    // double the image and wash out the fringe.
    const aberrating = aberrates(slot) && this.plates;
    if (!aberrating) travel.appendChild(paintFree());

    let plates: { red: HTMLElement; cyan: HTMLElement } | null = null;
    if (aberrating) {
      // The two plates must screen against *each other* on transparent black, then
      // composite normally onto the scene. Without an isolation boundary they screen
      // against whatever is behind the slot and brighten the whole backdrop.
      const holder = document.createElement('div');
      holder.className = 'plates';
      const red = document.createElement('div');
      red.className = 'plate plate-red';
      appendFreeCopy(red);
      const cyan = document.createElement('div');
      cyan.className = 'plate plate-cyan';
      appendFreeCopy(cyan);
      holder.appendChild(cyan);
      holder.appendChild(red);
      travel.appendChild(holder);
      plates = { red, cyan };
    }

    // The halftone overlay is for SVG-backed slots only.
    //
    // It is a dot pattern masked by a smooth `<linearGradient>`, so its opacity varies per
    // device pixel and it can never be cell-uniform — over pixel art it is exactly the
    // screen-door artifact art-direction §3 warns against, and check:register sees it as a
    // fine seam through every shadowed cell. On the buffer the same job is done properly by
    // dithering between ramp steps in the art itself, where the dot is an art pixel by
    // construction. Slots port to `draw`, and their halftone goes with them.
    if (!art.draw) {
      const halftone = halftoneOverlay(slot, this.geo);
      if (halftone) travel.insertAdjacentHTML('beforeend', halftone);
    }

    const parts: { el: HTMLElement; rate: number }[] = [];
    for (const part of art.parts ?? []) {
      const el = document.createElement('div');
      el.className = 'part';
      el.dataset['part'] = String(part.rate);
      el.appendChild(
        part.draw
          ? this.canvas(this.rasterOnce(act, part.draw))
          : this.svg(part.markup ?? ''),
      );
      travel.appendChild(el);
      parts.push({ el, rate: part.rate });
    }

    drift.appendChild(travel);
    els.root.appendChild(drift);

    // `.locked` stays a separate element from `.drift`, never composited into one buffer.
    // check:invariant asserts an identity transform on every [data-vp-locked] layer and
    // fails outright if none exists — "the invariant has no witness". Merging them would
    // delete the structural guarantee and the check that proves it in one move.
    let locked: HTMLElement | null = null;
    if (art.drawLocked || art.locked) {
      locked = document.createElement('div');
      locked.className = 'layer locked';
      locked.dataset['vpLocked'] = 'true';
      locked.dataset['act'] = String(act);
      // SVG is cheap and goes in now; a raster is queued for a later frame.
      if (art.drawLocked) {
        this.pendingLocked.push({ host: locked, act, draw: art.drawLocked });
      } else {
        locked.appendChild(this.svg(art.locked ?? ''));
      }
      els.root.appendChild(locked);
    }

    els.layers.set(act, { art, drift, travel, locked, parts, plates });
  }

  /**
   * Raster one draw callback into a fresh canvas.
   *
   * Each act keeps its own palette, built on demand as the act draws. The 255-entry
   * ceiling is per act, which is the right unit: it is what stops one act's ramps from
   * quietly consuming another's budget, and it is what a per-act palette check can assert.
   */
  private rasterOnce(act: ActIndex, draw: DrawFn): Raster {
    const { w, h } = this.geo;
    const ox = bufferOriginFor(vpPxOf(w));
    const oy = bufferOriginFor(horizonPxOf(h));
    const size = bufferSize(w, h, ox, oy);

    let palette = this.palettes.get(act);
    if (!palette) {
      palette = new Palette();
      this.palettes.set(act, palette);
    }

    const buf = new Buf(palette, size.w, size.h, ox, oy);
    // The horizon row must stay a clean tonal step for check:invariant to read it.
    buf.protectRow(this.geo.horizon);
    draw(buf, this.geo);
    return rasterOf(buf, palette.toRgba());
  }

  /** One canvas showing a raster, with the layer's constant opacity if it declares one. */
  private canvas(raster: Raster, alpha?: number, copyFrom?: HTMLCanvasElement): HTMLCanvasElement {
    const canvas = canvasFor(raster, copyFrom);
    // Set on the canvas, not the layer, so the transition crossfade written to `.drift`
    // multiplies with it rather than overwriting it.
    if (alpha !== undefined && alpha < 1) canvas.style.opacity = String(alpha);
    return canvas;
  }

  private svg(markup: string): SVGSVGElement {
    const { w, h, bleed } = this.geo;
    const el = document.createElementNS(SVG_NS, 'svg');
    el.setAttribute('viewBox', `${-bleed} ${-bleed} ${w + bleed * 2} ${h + bleed * 2}`);
    el.setAttribute('preserveAspectRatio', 'none');
    // Hard edges. Everything is already snapped to the chunk grid; this stops the
    // rasteriser softening the ones that land on a fractional device pixel.
    el.setAttribute('shape-rendering', 'crispEdges');
    el.setAttribute('focusable', 'false');
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = markup;
    return el;
  }

  /**
   * Travel far enough that every pixel of the layer ends below its clip line. A short
   * travel leaves the top of a sinking structure poking above the horizon, which reads
   * as the incoming act bleeding through before it has arrived. Acts override this with
   * `travelPx` when they want a specific motion distance — but the override must still
   * clear the clip, and if it does not, this is the floor.
   */
  private defaultTravel(_slot: number, art: SlotArt): number {
    return (art.clipBottom ?? this.geo.horizon) + this.geo.bleed;
  }
}

/**
 * Aberration plates double the canvas count on five of eight slots. Skipped where the
 * device cannot afford the compositor memory — a narrow viewport at 2x or more.
 */
function usePlates(width: number, dpr: number): boolean {
  return !(width <= 820 && dpr >= 2);
}

function measure(host: HTMLElement): Geometry {
  const rect = host.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  return {
    w,
    h,
    // Whole pixels, and the same numbers the anchors are published at — so the art is
    // registered to the anchor exactly rather than to within a rounding error.
    horizon: horizonPx(h),
    vp: vpPx(w),
    bleed: BLEED_PX,
  };
}
