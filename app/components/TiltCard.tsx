"use client";

import { useRef, useState } from "react";

/* Maximum tilt at the far corners. Small on purpose: past ~10deg the frame
   reads as a novelty rather than a surface catching the light. */
const DEFAULT_MAX_TILT = 7;

/* Touch screens fire a single synthetic mousemove on tap, which would leave
   a card frozen mid-tilt with no pointer to move away. Readers who asked for
   reduced motion get the same opt-out. Both are checked at call time rather
   than cached, so a system-preference change takes effect immediately. */
function tiltDisabled(): boolean {
  return (
    window.matchMedia("(hover: none)").matches ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** True while the pointer is over a control the reader is actively using. */
function isEditing(root: HTMLElement | null): boolean {
  const active = document.activeElement;
  if (!root || !active || !root.contains(active)) return false;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
}

interface TiltCardProps {
  children: React.ReactNode;
  /** Classes for the card surface itself (border, fill, padding). */
  className?: string;
  /** Classes for the outer wrapper that carries the drift animation. */
  outerClassName?: string;
  /** Renders the wrapper as a link when set. */
  href?: string;
  maxTilt?: number;
  perspective?: number;
  /** How far the card lifts toward the reader on hover, in px. */
  lift?: number;
  /** Position in a list, used to stagger the idle drift. */
  driftIndex?: number;
  /** Idle float. Off for large content cards, where it induces motion sickness. */
  drift?: boolean;
  /**
   * Hold the card still while a field inside it has focus. A card that tilts
   * under the cursor while someone is typing into it is disorienting.
   */
  freezeWhileTyping?: boolean;
}

/**
 * A card that lies flat at rest and tilts toward the cursor on hover, with a
 * highlight that tracks the pointer across its surface.
 *
 * Two nested elements, because the drift and the tilt both want the transform
 * property and cannot share it: the outer element runs the idle drift as a CSS
 * animation, the inner one takes the cursor tilt from JS.
 */
export function TiltCard({
  children,
  className = "",
  outerClassName = "",
  href,
  maxTilt = DEFAULT_MAX_TILT,
  perspective = 900,
  lift = 14,
  driftIndex = 0,
  drift = true,
  freezeWhileTyping = false,
}: TiltCardProps) {
  const inner = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);

  const tilt = (e: React.MouseEvent) => {
    const el = inner.current;
    if (!el || tiltDisabled()) return;
    if (freezeWhileTyping && isEditing(el)) return;

    const r = el.getBoundingClientRect();
    // Cursor position as -0.5…0.5 from the centre of the card.
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    // Y follows horizontal travel, X inverts vertical travel: pointing at
    // the top edge should tip that edge away, not toward.
    el.style.transform =
      `perspective(${perspective}px) rotateY(${px * maxTilt * 2}deg) ` +
      `rotateX(${-py * maxTilt * 2}deg) translateZ(${lift}px)`;
    // The highlight is drawn in CSS; JS only reports where the cursor is.
    el.style.setProperty("--mx", `${(px + 0.5) * 100}%`);
    el.style.setProperty("--my", `${(py + 0.5) * 100}%`);
    // mouseenter fires only on crossing the edge. A pointer already resting
    // on the card when the page loads would otherwise tilt but never light up.
    if (!hover) setHover(true);
  };

  const reset = () => {
    setHover(false);
    const el = inner.current;
    if (el) el.style.transform = "";
  };

  const outerProps = {
    className: `${drift ? "tilt-drift" : ""} ${outerClassName}`.trim(),
    // Staggered so cards in a grid never bob in unison. Prime-ish offsets
    // keep the cycles from re-syncing on any short loop.
    style: drift
      ? {
          animationDelay: `${(driftIndex % 7) * -1.3}s`,
          // Faster than it looks like it should be. See the note on
          // `@keyframes tilt-float` in globals.css: below roughly 4px/s a 1px
          // border snaps between pixel rows instead of gliding, and the drift
          // reads as stepping however smooth the curve is.
          animationDuration: `${5.5 + (driftIndex % 4) * 1.1}s`,
        }
      : undefined,
    onMouseMove: tilt,
    onMouseEnter: () => setHover(true),
    onMouseLeave: reset,
  };

  const surface = (
    <div
      ref={inner}
      className={`tilt-card ${className}`.trim()}
      data-hover={hover || undefined}
    >
      {children}
    </div>
  );

  if (href) {
    return (
      <a {...outerProps} href={href} target="_blank" rel="noopener noreferrer">
        {surface}
      </a>
    );
  }

  return <div {...outerProps}>{surface}</div>;
}
