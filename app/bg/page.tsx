"use client";

/* ── /bg — background preview ─────────────────────────────────────────────
   The Field with nothing on top of it. No nav, no manifesto, no
   conversations: judging a background is impossible with copy sitting over
   it, so this route strips the page back to the canvas alone.

   The background itself comes from the layout, like every other page. What
   this route adds is the ability to strip the LCD texture and the dark scrim
   off it -- the homepage never shows the raw canvas, and both layers change
   the read considerably.

   This page is a workbench, not a surface. It is deliberately not linked
   from the nav.
   ──────────────────────────────────────────────────────────────────────── */

import { useEffect, useState } from "react";

export default function BackgroundPreview() {
  const [lcd, setLcd] = useState(true);
  const [scrim, setScrim] = useState(true);
  const [showHint, setShowHint] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setShowHint(false), 4000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "l") setLcd((v) => !v);
      if (k === "s") setScrim((v) => !v);
      if (k === "h") setShowHint((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      style={{
        minHeight: "100dvh",
        position: "relative",
        overflow: "hidden",
      }}
      onMouseMove={() => setShowHint(true)}
    >
      {/* LCD screen texture — the 2px grid that gives the canvas its
          screen-door feel. Identical values to the homepage. */}
      {lcd && (
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1,
            pointerEvents: "none",
            backgroundImage: `
              repeating-linear-gradient(0deg,
                rgba(0, 0, 0, 0.07) 0px, rgba(0, 0, 0, 0.07) 1px,
                transparent 1px, transparent 2px
              ),
              repeating-linear-gradient(90deg,
                rgba(0, 0, 0, 0.05) 0px, rgba(0, 0, 0, 0.05) 1px,
                transparent 1px, transparent 2px
              )
            `,
            backgroundSize: "2px 2px",
          }}
        />
      )}

      {/* Dark scrim — the 10% black wash that sits under the content and
          keeps the Field from competing with type. */}
      {scrim && (
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2,
            pointerEvents: "none",
            background: "rgba(10, 10, 10, 0.10)",
          }}
        />
      )}

      {/* The only type on the page, and it fades itself out. */}
      <div
        style={{
          position: "fixed",
          bottom: "1.1rem",
          left: "1.1rem",
          zIndex: 10,
          display: "flex",
          gap: "0.5rem",
          fontFamily: "var(--font-space)",
          fontSize: "0.58rem",
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          color: "var(--muted)",
          opacity: showHint ? 1 : 0,
          transition: "opacity 0.6s ease",
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        <span>L · texture {lcd ? "on" : "off"}</span>
        <span>·</span>
        <span>S · scrim {scrim ? "on" : "off"}</span>
        <span>·</span>
        <span>H · hide</span>
      </div>
    </div>
  );
}
