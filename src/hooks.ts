/**
 * The test surface. One declaration, imported by both the runtime and the verification
 * scripts, so the harness and the page can never drift apart.
 */

export interface AnchorReport {
  stage: { width: number; height: number; top: number };
  horizon: { top: number; fraction: number } | null;
  vp: { left: number; fraction: number } | null;
  lockedTransforms: string[];
}

export interface FrontierTestHooks {
  /** Park the page at an exact master progress, bypassing smooth scrolling. */
  goto(p: number): Promise<void>;
  state(): unknown;
  /** Per-slot layer transforms, as computed styles. */
  metrics(): unknown;
  anchors(): AnchorReport;
  /** Phase of the art grid in viewport px, for check:register. */
  gridOrigin(): { x: number; y: number };
  /** True when ?frozen=1 zeroed every transform. */
  frozen: boolean;
  ready: true;
}

declare global {
  interface Window {
    __frontier?: FrontierTestHooks;
  }
}
