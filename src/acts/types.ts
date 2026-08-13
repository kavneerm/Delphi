/**
 * The asset contract, in code. See docs/asset-contract.md.
 *
 * An act is a parameterisation of the eight permanent depth slots, never a separate
 * scene. A slot supplies markup for two independently-transformed layers plus an
 * untransformable one:
 *
 *   free   — receives lateral drift and, if the verb calls for it, transition travel
 *   locked — VP-registered geometry. Never transformed, by construction, so the
 *            vanishing point cannot move.
 *
 * Geometry is emitted in stage CSS pixels: SVG user units map 1:1 to the stage box, so
 * `horizon` and `vp` are exact at every viewport.
 */

export interface Geometry {
  /** Stage box in CSS pixels. */
  readonly w: number;
  readonly h: number;
  /** Absolute y of the horizon line, = h * HORIZON_FRAC. */
  readonly horizon: number;
  /** Absolute x of the vanishing point, = w * VP_FRAC. */
  readonly vp: number;
  /** Overdraw margin present on every layer. */
  readonly bleed: number;
}

/**
 * How a slot enters and leaves a transition.
 *
 *   rise      — translates up out of / down into the horizon, clipped at `clipBottom`
 *   extrude   — a clip sweep from the structure's own base line, for near slots whose
 *               base sits well below the horizon and which cannot credibly sink into it
 *   crossfade — two static layers exchanged by opacity. Atmosphere and ground only;
 *               never structures.
 *   drift     — leaves and enters laterally, off-canvas. Slot 0 props.
 */
export type TransitionVerb = 'rise' | 'extrude' | 'crossfade' | 'drift';

/**
 * A sub-layer with its own motion. Slot 0's props need this: art-direction §4 asks for
 * "two tumbleweeds crossing at different speeds", and two shapes sharing one transform
 * cannot differ. Each part is translated independently, on the same 12fps accumulator as
 * the rest of slot 0.
 */
export interface SlotPart {
  readonly markup: string;
  /** Lateral self-motion across the page, as a fraction of stage width. */
  readonly rate: number;
}

export interface SlotArt {
  readonly verb: TransitionVerb;
  /**
   * Content below this y is clipped away, in stage pixels. For `rise` this is the
   * horizon; for `extrude` it is the structure's own base line.
   */
  readonly clipBottom?: number;
  /** Travel distance in px for `rise`. Defaults to the slot's own drawn height. */
  readonly travelPx?: number;
  /** Markup for the drifting layer. */
  readonly free: string;
  /** Markup for the VP-locked layer. Omit if the slot has no VP-registered geometry. */
  readonly locked?: string;
  /** Sub-layers that move at their own rates, in addition to the slot's drift. */
  readonly parts?: readonly SlotPart[];
}

export interface ActDefinition {
  readonly id: string;
  readonly name: string;
  /** Eight entries, index 0 = nearest. Pure function of the stage box. */
  build(geo: Geometry): readonly SlotArt[];
}
