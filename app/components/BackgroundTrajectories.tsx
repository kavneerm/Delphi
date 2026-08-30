"use client";

/* ── Trajectories (not currently used) ────────────────────────────────────
   THE SITE DOES NOT RENDER THIS. Kept deliberately -- it is the authored
   composition built to the 2026-08-26 brief, set aside in favour of the
   concentric Rings. DO NOT DELETE as dead code. See BRAND.md section 9.

   To use it on a page:

       import { BackgroundTrajectories } from "./components/BackgroundTrajectories";
       <BackgroundTrajectories />

   Multiple trajectories crossing an unsettled frontier, with a few of their
   intersections illuminated because people are shaping what happens there.

   The composition is authored, not generated. An earlier version spawned
   families of concentric rings, and concentric rings are parallel to each
   other by definition -- which is what produced the ribbed, caged look. Here
   every arc is placed individually: its own centre, radius, depth and
   opacity. Fourteen curves, not forty.

   Five things carry the difference between this and a star map:

   1. DEPTH. Three planes -- near, middle, far -- separated by opacity and
      line weight, drifting at different rates. Parallax does the rest.
   2. ARCS THAT ARRIVE AND DISSOLVE. No curve runs edge to edge at constant
      strength. Each fades up along its path and back down, so lines enter
      the frame, matter for a stretch, and leave.
   3. NODES AT REAL INTERSECTIONS. Where two arcs actually cross is solved in
      closed form, not eyeballed. Nodes can only sit where the geometry puts
      them, which is what makes them read as consequences.
   4. QUIET ZONES FROM THE REAL LAYOUT. The mask is built from live DOM
      rects -- nav, headline, buttons, faces -- so protection tracks what is
      actually on the page rather than hard-coded boxes.
   5. GRAIN, NOT A GRID. A fine monochrome noise tile, felt and not seen.

   Motion is deliberately near-imperceptible: slow drift, slow parallax, and
   a long unhurried breath on the nodes. Nothing spins, twinkles or pulses.
   `prefers-reduced-motion` renders one static frame.
   ──────────────────────────────────────────────────────────────────────── */

import { useEffect, useRef } from "react";

/* ── The composition ──────────────────────────────────────────────────────
   Centres and radii are fractions of the viewport (radius is a fraction of
   the larger dimension), so the arrangement survives any viewport instead of
   being tuned to one. Angles are NOT authored: the visible span of each
   circle is solved at runtime, then trimmed by `extent`/`offset`. Authoring
   angles by hand is what makes a composition fall apart at another width.

   `depth`  2 near / 1 middle / 0 far
   `extent` how much of the visible span to draw (1 = all of it)
   `offset` where in that span to begin
   ──────────────────────────────────────────────────────────────────────── */
interface ArcSpec {
  cx: number;
  cy: number;
  r: number;
  depth: 0 | 1 | 2;
  extent: number;
  offset: number;
  /** Per-arc opacity trim, on top of the depth's own weight. */
  gain?: number;
}

const ARCS: ArcSpec[] = [
  // ── Near: three dominant sweeps, each from a different quarter ─────────
  // The long diagonal. Deliberately crosses the centre divide so the two
  // halves of the homepage read as one system rather than two panels.
  { cx: 1.28, cy: 1.42, r: 1.30, depth: 2, extent: 0.82, offset: 0.10 },
  // Comes in high from the left and falls away before the right pane.
  { cx: -0.32, cy: -0.38, r: 1.02, depth: 2, extent: 0.62, offset: 0.22, gain: 0.9 },
  // A shallow curve low on the page, opposing the first one's direction.
  { cx: 0.46, cy: 2.05, r: 1.42, depth: 2, extent: 0.70, offset: 0.16, gain: 0.85 },

  // ── Middle: five, all different centres, none parallel to a neighbour ──
  { cx: 1.55, cy: 0.16, r: 1.05, depth: 1, extent: 0.55, offset: 0.30 },
  { cx: -0.42, cy: 0.74, r: 0.78, depth: 1, extent: 0.66, offset: 0.12 },
  { cx: 0.72, cy: -0.62, r: 0.92, depth: 1, extent: 0.48, offset: 0.34 },
  { cx: 0.12, cy: 1.48, r: 0.86, depth: 1, extent: 0.58, offset: 0.20 },
  { cx: 1.14, cy: 0.92, r: 0.62, depth: 1, extent: 0.52, offset: 0.26, gain: 0.9 },

  // ── Far: six that nearly disappear. These fill without adding weight ───
  { cx: -0.10, cy: -0.20, r: 0.55, depth: 0, extent: 0.70, offset: 0.14 },
  { cx: 1.40, cy: 1.05, r: 0.88, depth: 0, extent: 0.62, offset: 0.22 },
  { cx: 0.30, cy: 0.44, r: 0.42, depth: 0, extent: 0.80, offset: 0.06 },
  { cx: 0.88, cy: 1.62, r: 1.10, depth: 0, extent: 0.50, offset: 0.28 },
  { cx: 1.72, cy: 0.58, r: 1.24, depth: 0, extent: 0.44, offset: 0.32 },
  { cx: 0.04, cy: 0.98, r: 0.34, depth: 0, extent: 0.74, offset: 0.10 },
];

/* Depth weights. The spread between near and far is what builds the sense of
   distance -- compress it and everything flattens onto one plane. */
const DEPTH = [
  { alpha: 0.14, width: 0.6, parallax: 2 },   // far
  { alpha: 0.32, width: 0.85, parallax: 5 },  // middle
  { alpha: 0.6, width: 1.15, parallax: 9 },   // near
];

interface DrawnArc {
  cx: number; cy: number; r: number;
  a0: number; a1: number;
  depth: 0 | 1 | 2;
  gain: number;
}

interface Node {
  x: number; y: number;
  /** 0 subtle, 1 medium, 2 prominent. */
  tier: 0 | 1 | 2;
  hue: number;
  phase: number;
}

interface Star {
  x: number; y: number; r: number; base: number; phase: number;
}

/** Selectors whose live rects become quiet zones, with suppression strength. */
const PROTECT: { sel: string; strength: number; pad: number }[] = [
  { sel: "nav", strength: 0.95, pad: 6 },
  { sel: ".nav-bar", strength: 0.95, pad: 6 },
  { sel: "img", strength: 0.9, pad: 10 },
  { sel: ".btn-solid", strength: 0.92, pad: 6 },
  { sel: ".btn-ghost", strength: 0.92, pad: 6 },
  { sel: ".event-cta-btn", strength: 0.92, pad: 6 },
  { sel: ".hero-cta-primary", strength: 0.92, pad: 6 },
  { sel: ".hero-cta-secondary", strength: 0.92, pad: 6 },
  { sel: ".email-input", strength: 0.92, pad: 6 },
  { sel: ".pane-left > p", strength: 0.72, pad: 18 },
  { sel: ".join-card", strength: 0.5, pad: 10 },
];

export function BackgroundTrajectories() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio ?? 1, 2);
    const reduceMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    let W = 0, H = 0, span = 0, raf = 0, t = 0;

    /* One canvas per depth plane, plus a compositor and a mask. The planes
       hold the expensive part -- every arc drawn as ~96 separately faded
       segments -- and are re-rendered only on resize. Per frame we just blit
       three images at slightly different offsets, which is what makes the
       parallax essentially free. */
    const planes = [0, 1, 2].map(() => document.createElement("canvas"));
    const planeCtx = planes.map((c) => c.getContext("2d")!);
    const geom = document.createElement("canvas");
    const gctx = geom.getContext("2d")!;
    const mask = document.createElement("canvas");
    const mctx = mask.getContext("2d")!;
    let grain: HTMLCanvasElement | null = null;

    let drawn: DrawnArc[] = [];
    let nodes: Node[] = [];
    let stars: Star[] = [];

    /* ── Visible span of a circle ───────────────────────────────────────
       Sample the circle and keep the longest unbroken run that is on
       screen. Solving this at runtime rather than authoring start/end
       angles is what lets one composition hold at any viewport. */
    const visibleSpan = (cx: number, cy: number, r: number): [number, number] | null => {
      const N = 360, m = span * 0.06;
      const on: boolean[] = [];
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        on.push(x > -m && x < W + m && y > -m && y < H + m);
      }
      if (on.every((v) => !v)) return null;
      if (on.every((v) => v)) return [0, Math.PI * 2];
      let bestStart = 0, bestLen = 0, curStart = -1, curLen = 0;
      for (let i = 0; i < N * 2; i++) {
        if (on[i % N]) {
          if (curStart < 0) curStart = i;
          curLen++;
          if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
        } else { curStart = -1; curLen = 0; }
      }
      if (bestLen === 0) return null;
      const step = (Math.PI * 2) / N;
      return [bestStart * step, (bestStart + bestLen) * step];
    };

    const build = () => {
      drawn = [];
      for (const s of ARCS) {
        const cx = s.cx * W, cy = s.cy * H, r = s.r * span;
        const vis = visibleSpan(cx, cy, r);
        if (!vis) continue;
        const [v0, v1] = vis;
        const len = v1 - v0;
        const a0 = v0 + len * s.offset;
        const a1 = Math.min(v1, a0 + len * s.extent);
        if (a1 - a0 < 0.05) continue;
        drawn.push({ cx, cy, r, a0, a1, depth: s.depth, gain: s.gain ?? 1 });
      }

      /* ── Cull near-parallel neighbours ───────────────────────────────
         Two curves that run close together at nearly the same heading read
         as a rib, not as two trajectories -- it is the single thing that
         made the old concentric version look caged. Rather than hand-check
         the composition at every viewport, detect it: sample both arcs, and
         where they sit within `near` of each other AND their tangents agree
         to better than ~14 degrees, count it. Past a fifth of the shorter
         arc, drop the fainter of the two. */
      const samplePts = (arc: DrawnArc, n: number) =>
        Array.from({ length: n }, (_, k) => {
          const a = arc.a0 + ((arc.a1 - arc.a0) * k) / (n - 1);
          return { x: arc.cx + Math.cos(a) * arc.r, y: arc.cy + Math.sin(a) * arc.r, a };
        });
      const near = span * 0.055;
      const dropped = new Set<number>();
      for (let i = 0; i < drawn.length; i++) {
        if (dropped.has(i)) continue;
        for (let j = i + 1; j < drawn.length; j++) {
          if (dropped.has(j)) continue;
          const P = samplePts(drawn[i], 40), Q = samplePts(drawn[j], 40);
          let hitCount = 0;
          for (const p of P) {
            for (const q of Q) {
              if (Math.hypot(p.x - q.x, p.y - q.y) > near) continue;
              // Tangent at a point on a circle is perpendicular to its radius.
              const tp = p.a + Math.PI / 2, tq = q.a + Math.PI / 2;
              if (Math.abs(Math.cos(tp - tq)) > 0.97) { hitCount++; break; }
            }
          }
          if (hitCount > 8) {
            dropped.add(drawn[i].depth <= drawn[j].depth ? i : j);
          }
        }
      }
      if (dropped.size) drawn = drawn.filter((_, i) => !dropped.has(i));

      /* ── Intersections, solved not guessed ───────────────────────────
         Two circles with centres d apart intersect where
         a = (r0^2 - r1^2 + d^2) / 2d along the centre line, offset by
         h = sqrt(r0^2 - a^2) perpendicular to it. A point counts only if it
         falls inside BOTH arcs' drawn spans and is on screen -- so a node
         can never sit anywhere the geometry does not actually cross. */
      const within = (arc: DrawnArc, x: number, y: number) => {
        let a = Math.atan2(y - arc.cy, x - arc.cx);
        while (a < arc.a0) a += Math.PI * 2;
        return a <= arc.a1;
      };
      const hits: { x: number; y: number; weight: number }[] = [];
      for (let i = 0; i < drawn.length; i++) {
        for (let j = i + 1; j < drawn.length; j++) {
          const A = drawn[i], B = drawn[j];
          const dx = B.cx - A.cx, dy = B.cy - A.cy;
          const d = Math.hypot(dx, dy);
          if (d === 0 || d > A.r + B.r || d < Math.abs(A.r - B.r)) continue;
          const a = (A.r * A.r - B.r * B.r + d * d) / (2 * d);
          const h2 = A.r * A.r - a * a;
          if (h2 < 0) continue;
          const h = Math.sqrt(h2);
          const mx = A.cx + (dx * a) / d, my = A.cy + (dy * a) / d;
          for (const sgn of [1, -1]) {
            const x = mx + (sgn * h * dy) / d;
            const y = my - (sgn * h * dx) / d;
            if (x < 0 || x > W || y < 0 || y > H) continue;
            if (!within(A, x, y) || !within(B, x, y)) continue;
            hits.push({ x, y, weight: A.depth + B.depth });
          }
        }
      }

      /* Rank by nearness to the seam between the mission and the events --
         the transition the strongest node should mark -- then thin out any
         crossings that land on top of each other. */
      const target = { x: W * 0.5, y: H * 0.46 };
      hits.sort((p, q) => {
        const dp = Math.hypot(p.x - target.x, p.y - target.y) - p.weight * 40;
        const dq = Math.hypot(q.x - target.x, q.y - target.y) - q.weight * 40;
        return dp - dq;
      });
      const kept: typeof hits = [];
      for (const p of hits) {
        if (kept.some((k) => Math.hypot(k.x - p.x, k.y - p.y) < span * 0.11)) continue;
        kept.push(p);
        if (kept.length >= 9) break;
      }
      nodes = kept.map((p, i) => ({
        x: p.x, y: p.y,
        tier: (i === 0 ? 2 : i <= 3 ? 1 : 0) as 0 | 1 | 2,
        hue: i === 0 ? 24 : i % 2 ? 196 : 30,
        phase: i * 1.9,
      }));

      /* ── Stars ────────────────────────────────────────────────────────
         A third fewer than before, sizes held in a narrow band, and two
         thirds of them pulled loosely toward the arcs and their crossings.
         Even scatter is what reads as outer space; clustering along the
         geometry ties the layers together and leaves real empty regions. */
      const count = W < 768 ? 74 : 168;
      stars = [];
      let guard = 0;
      for (let i = 0; i < count; i++) {
        let x: number, y: number;
        if (drawn.length && i % 3 !== 0) {
          if (nodes.length && i % 7 === 0) {
            const n = nodes[Math.floor(Math.random() * nodes.length)];
            x = n.x + (Math.random() - 0.5) * span * 0.09;
            y = n.y + (Math.random() - 0.5) * span * 0.09;
          } else {
            const arc = drawn[Math.floor(Math.random() * drawn.length)];
            const a = arc.a0 + Math.random() * (arc.a1 - arc.a0);
            const off = (Math.random() - 0.5) * span * 0.055;
            x = arc.cx + Math.cos(a) * (arc.r + off);
            y = arc.cy + Math.sin(a) * (arc.r + off);
          }
        } else {
          x = Math.random() * W;
          y = Math.random() * H;
        }
        if ((x < 0 || x > W || y < 0 || y > H) && guard++ < count * 4) { i--; continue; }
        stars.push({
          x, y,
          r: 0.55 + Math.random() * 0.6,
          base: 0.24 + Math.random() * 0.34,
          phase: Math.random() * Math.PI * 2,
        });
      }

      // ── Render the three planes once ───────────────────────────────────
      planes.forEach((p, di) => {
        p.width = W * dpr; p.height = H * dpr;
        const c = planeCtx[di];
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.scale(dpr, dpr);
        c.clearRect(0, 0, W, H);
        const { alpha, width } = DEPTH[di];
        c.lineWidth = width;
        c.lineCap = "round";
        for (const arc of drawn) {
          if (arc.depth !== di) continue;
          /* Segment the arc so opacity can vary along it. A single arc()
             call can only be one alpha end to end, which is exactly the
             uniformity that reads as generated. */
          const SEG = 96;
          const total = arc.a1 - arc.a0;
          for (let k = 0; k < SEG; k++) {
            const u0 = k / SEG, u1 = (k + 1) / SEG;
            const u = (u0 + u1) / 2;
            const env = Math.min(1, u / 0.28) * Math.min(1, (1 - u) / 0.38);
            const a = alpha * arc.gain * env;
            if (a < 0.004) continue;
            c.beginPath();
            c.arc(arc.cx, arc.cy, arc.r, arc.a0 + total * u0, arc.a0 + total * u1);
            c.strokeStyle = `hsla(38, 20%, 92%, ${a})`;
            c.stroke();
          }
        }
      });
    };

    /* ── Quiet zones from the live layout ───────────────────────────────
       Built from real element rects so protection follows the page instead
       of hard-coded boxes that drift the moment content changes. Blurred so
       each zone is a falloff rather than a cut-out. */
    const buildMask = () => {
      mask.width = W * dpr; mask.height = H * dpr;
      mctx.setTransform(1, 0, 0, 1, 0, 0);
      mctx.scale(dpr, dpr);
      mctx.clearRect(0, 0, W, H);
      mctx.filter = "blur(26px)";
      for (const { sel, strength, pad } of PROTECT) {
        document.querySelectorAll(sel).forEach((el) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.width < 4 || r.height < 4) return;
          if (r.bottom < -60 || r.top > H + 60) return;
          mctx.fillStyle = `rgba(0, 0, 0, ${strength})`;
          mctx.fillRect(r.left - pad, r.top - pad, r.width + pad * 2, r.height + pad * 2);
        });
      }
      mctx.filter = "none";
    };

    /* Monochrome grain, generated once and tiled. Replaces the 2px LCD grid,
       which at this scale read as compression artefacts. */
    const buildGrain = () => {
      const S = 128;
      const g = document.createElement("canvas");
      g.width = S; g.height = S;
      const gc = g.getContext("2d")!;
      const img = gc.createImageData(S, S);
      for (let i = 0; i < S * S; i++) {
        const v = 128 + (Math.random() - 0.5) * 255;
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
        img.data[i * 4 + 3] = 10;
      }
      gc.putImageData(img, 0, 0);
      grain = g;
    };

    let lastW = 0, lastH = 0;
    const resize = () => {
      const nw = window.innerWidth, nh = window.innerHeight;
      if (lastW !== 0 && nw === lastW && nw < 768 && Math.abs(nh - lastH) < 120) return;
      lastW = nw; lastH = nh;
      W = nw; H = nh; span = Math.max(W, H);
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + "px"; canvas.style.height = H + "px";
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      geom.width = W * dpr; geom.height = H * dpr;
      gctx.setTransform(1, 0, 0, 1, 0, 0);
      gctx.scale(dpr, dpr);
      build();
      buildMask();
    };
    resize();
    buildGrain();
    window.addEventListener("resize", resize);

    // The mask tracks scrolling content (the conversations pane moves faces
    // and buttons under the geometry), throttled to one rebuild per frame.
    let maskQueued = false;
    const queueMask = () => {
      if (maskQueued) return;
      maskQueued = true;
      requestAnimationFrame(() => { maskQueued = false; buildMask(); });
    };
    window.addEventListener("scroll", queueMask, true);

    const draw = () => {
      /* ── Atmosphere ──────────────────────────────────────────────────
         One graded wash, not separate coloured blobs: deep blue behind the
         mission, muted green through the middle, violet easing into a
         restrained ember behind the conversations. The old gold bloom is
         gone -- it was what tipped the page toward a rainbow. */
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, W, H);

      const drift = reduceMotion ? 0 : Math.sin(t * 0.06) * 0.03;
      const wash = ctx.createLinearGradient(0, H * 0.1, W, H * 0.9);
      wash.addColorStop(0, "hsla(212, 72%, 44%, 0.23)");
      wash.addColorStop(Math.max(0.01, 0.34 + drift), "hsla(168, 58%, 40%, 0.16)");
      wash.addColorStop(Math.min(0.99, 0.68 + drift), "hsla(286, 62%, 48%, 0.18)");
      wash.addColorStop(1, "hsla(20, 80%, 48%, 0.16)");
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, W, H);

      const lift = ctx.createRadialGradient(
        W * 0.5, H * (0.34 + drift * 2), 0, W * 0.5, H * 0.5, span * 0.75
      );
      lift.addColorStop(0, "hsla(190, 62%, 62%, 0.07)");
      lift.addColorStop(1, "transparent");
      ctx.fillStyle = lift;
      ctx.fillRect(0, 0, W, H);

      // ── Geometry: planes at parallax offsets, then the quiet zones ─────
      gctx.clearRect(0, 0, W, H);
      planes.forEach((p, di) => {
        const amp = reduceMotion ? 0 : DEPTH[di].parallax;
        const ox = Math.sin(t * 0.05 + di) * amp;
        const oy = Math.cos(t * 0.037 + di * 1.7) * amp * 0.6;
        gctx.drawImage(p, ox, oy, W, H);
      });

      stars.forEach((s) => {
        const tw = reduceMotion ? 1 : 0.86 + 0.14 * Math.sin(t * 0.22 + s.phase);
        gctx.beginPath();
        gctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        gctx.fillStyle = `rgba(240, 237, 230, ${s.base * tw})`;
        gctx.fill();
      });

      gctx.save();
      gctx.globalCompositeOperation = "destination-out";
      gctx.drawImage(mask, 0, 0, W, H);
      gctx.restore();

      ctx.drawImage(geom, 0, 0, W, H);

      /* ── Nodes ───────────────────────────────────────────────────────
         Three strengths, never a scatter of equals. Each breathes on a long
         period with its own phase, so illumination is occasional rather
         than a page of things pulsing together. */
      nodes.forEach((n) => {
        const base = n.tier === 2 ? 1 : n.tier === 1 ? 0.42 : 0.16;
        const breath = reduceMotion ? 0.85 : 0.72 + 0.28 * Math.sin(t * 0.16 + n.phase);
        const a = base * breath;
        const R = n.tier === 2 ? 34 : n.tier === 1 ? 20 : 11;

        const bloom = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, R);
        bloom.addColorStop(0, `hsla(${n.hue}, 90%, 70%, ${0.3 * a})`);
        bloom.addColorStop(0.5, `hsla(${n.hue}, 90%, 60%, ${0.11 * a})`);
        bloom.addColorStop(1, "transparent");
        ctx.fillStyle = bloom;
        ctx.fillRect(n.x - R, n.y - R, R * 2, R * 2);

        const core = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, R * 0.22);
        core.addColorStop(0, `rgba(255, 255, 255, ${0.85 * a})`);
        core.addColorStop(1, "transparent");
        ctx.fillStyle = core;
        ctx.fillRect(n.x - R * 0.3, n.y - R * 0.3, R * 0.6, R * 0.6);

        ctx.beginPath();
        ctx.arc(n.x, n.y, n.tier === 2 ? 1.7 : 1.1, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 254, 250, ${0.9 * a})`;
        ctx.fill();
      });

      if (grain) {
        const pat = ctx.createPattern(grain, "repeat");
        if (pat) { ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H); }
      }

      // ── Corners to near-black ──────────────────────────────────────────
      const vig = ctx.createRadialGradient(
        W * 0.45, H * 0.46, H * 0.12, W * 0.45, H * 0.5, span * 0.78
      );
      vig.addColorStop(0, "transparent");
      vig.addColorStop(0.65, "rgba(10, 10, 10, 0.16)");
      vig.addColorStop(1, "rgba(10, 10, 10, 0.62)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);

      t += 0.016;
      if (!reduceMotion) raf = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", queueMask, true);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        display: "block",
      }}
    />
  );
}
