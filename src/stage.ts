import {
  BLEED_PX,
  HORIZON_FRAC,
  SLOT_COUNT,
  SLOT_RATES,
  TWOS_MS,
  VP_FRAC,
  driftAmplitude,
  horizonPx,
  roundToDevicePx,
  vpPx,
} from './config.ts';
import type { ActDefinition, Geometry, SlotArt } from './acts/types.ts';
import { progress, residentActs, type Frame } from './progress.ts';
import { slotEase, slotProgress, type ActIndex } from './timeline.ts';
import { aberrates, aberrationOffset, halftoneOverlay, postDefs } from './post/index.ts';

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
  /**
   * One `build()` per act, not one per slot.
   *
   * `buildLayer` used to call `definition.build(this.geo)[slot]`, running the whole act
   * and discarding seven eighths of it, eight times over. That is invisible while an act
   * returns markup strings and unaffordable the moment each call rasterises.
   */
  private readonly builtArt = new Map<ActIndex, readonly SlotArt[]>();
  /** Cached so the write pass does not touch `window` eight times a frame. */
  private dpr: number;

  constructor(host: HTMLElement, acts: readonly ActDefinition[]) {
    this.host = host;
    this.acts = acts;
    this.dpr = window.devicePixelRatio || 1;
    this.geo = measure(host);
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

  /** Rebuild every resident layer against a new stage box. Resize only, never per frame. */
  remeasure(): void {
    this.dpr = window.devicePixelRatio || 1;
    this.geo = measure(this.host);
    this.builtArt.clear();
    this.writeAnchors();
    for (const slot of this.slots) {
      for (const act of [...slot.layers.keys()]) this.dropLayer(slot, act);
    }
    this.sync(progress.frame);
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

    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const els = this.slots[slot];
      if (!els) continue;
      const rate = SLOT_RATES[slot] ?? 1;
      // Whole device pixels. A fractional translate resamples the layer under the
      // compositor, which softens every edge on every moving slot — the failure that
      // reads as "the art is a bit mushy" and gets misfiled as an art problem.
      const driftX = roundToDevicePx((frame.c - 0.5) * rate * amplitude, this.dpr);
      // Vertical drift is zero for every slot at every scroll position (build.md A1).
      const driftTransform = `translate3d(${driftX}px,0,0)`;

      // Slot 0 runs on twos: it is skipped entirely on non-tick frames, so it updates at
      // 12fps while everything else runs at display rate. A throttled tick, not a CSS
      // animation — this is the detail that does the most to evoke the reference.
      if (slot === 0 && !twosTick) continue;

      for (const [act, layer] of els.layers) {
        layer.drift.style.transform = driftTransform;

        // Channel separation scales with scroll velocity (§3: 0px at rest to 6px at
        // peak). It is a transform, so it never re-rasterises and the response is
        // continuous rather than stepped.
        if (layer.plates) {
          // Whole pixels: a fractional translate resamples the plate and gives every edge
          // a blend column, which is the anti-aliasing §3 forbids.
          const off = Math.round(
            aberrationOffset(slot, frame.velocity, Math.max(2, Math.round(this.geo.w / 200))),
          );
          layer.plates.red.style.transform = `translate3d(${off}px,0,0)`;
          layer.plates.cyan.style.transform = `translate3d(${-off}px,0,0)`;
        }

        // Prop self-motion, scroll-driven so it is deterministic and never a timer.
        for (const part of layer.parts) {
          const x = roundToDevicePx(frame.c * part.rate * this.geo.w, this.dpr);
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
        layers: [...slot.layers.entries()].map(([act, layer]) => ({
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
   */
  private sync(frame: Readonly<Frame>): boolean {
    const resident = residentActs(frame);
    let built = false;
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      const els = this.slots[slot];
      if (!els) continue;
      for (const act of [...els.layers.keys()]) {
        if (!resident.includes(act)) this.dropLayer(els, act);
      }
      // Append in transition order so the incoming act paints over the outgoing one.
      for (const act of resident) {
        if (!els.layers.has(act)) {
          this.buildLayer(els, slot, act);
          built = true;
        }
      }
    }
    return built;
  }

  private dropLayer(els: SlotEls, act: ActIndex): void {
    const layer = els.layers.get(act);
    if (!layer) return;
    layer.drift.remove();
    layer.locked?.remove();
    els.layers.delete(act);
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
    // An aberrating slot is drawn *only* as its two channel plates — screened together
    // they reconstruct the original exactly. Keeping a full base copy underneath would
    // double the image and wash out the fringe.
    if (!aberrates(slot)) travel.appendChild(this.svg(art.free));

    let plates: { red: HTMLElement; cyan: HTMLElement } | null = null;
    if (aberrates(slot)) {
      // The two plates must screen against *each other* on transparent black, then
      // composite normally onto the scene. Without an isolation boundary they screen
      // against whatever is behind the slot and brighten the whole backdrop.
      const holder = document.createElement('div');
      holder.className = 'plates';
      const red = document.createElement('div');
      red.className = 'plate plate-red';
      red.appendChild(this.svg(art.free));
      const cyan = document.createElement('div');
      cyan.className = 'plate plate-cyan';
      cyan.appendChild(this.svg(art.free));
      holder.appendChild(cyan);
      holder.appendChild(red);
      travel.appendChild(holder);
      plates = { red, cyan };
    }

    const halftone = halftoneOverlay(slot, this.geo);
    if (halftone) travel.insertAdjacentHTML('beforeend', halftone);

    const parts: { el: HTMLElement; rate: number }[] = [];
    for (const part of art.parts ?? []) {
      const el = document.createElement('div');
      el.className = 'part';
      el.dataset['part'] = String(part.rate);
      el.appendChild(this.svg(part.markup));
      travel.appendChild(el);
      parts.push({ el, rate: part.rate });
    }

    drift.appendChild(travel);
    els.root.appendChild(drift);

    let locked: HTMLElement | null = null;
    if (art.locked) {
      locked = document.createElement('div');
      locked.className = 'layer locked';
      locked.dataset['vpLocked'] = 'true';
      locked.dataset['act'] = String(act);
      locked.appendChild(this.svg(art.locked));
      els.root.appendChild(locked);
    }

    els.layers.set(act, { art, drift, travel, locked, parts, plates });
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
