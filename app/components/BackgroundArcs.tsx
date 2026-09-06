"use client";

/* ── The Field ─────────────────────────────────────────────────────
   Concentric rings from two centres held just off canvas, with Bone motes
   riding them. The centres stay off screen so no bullseye shows; kept only
   just off, because a centre pushed far away leaves nothing on screen but
   enormous arcs, and an enormous arc reads as a near-vertical line rather
   than as part of a circle.

   Named parts, in BRAND.md terms: Starfield, Blooms, Rings, Motes, Nodes,
   Vignette. The Blooms are the original Field's, unchanged.
   ──────────────────────────────────────────────────────────────────────── */

import { useEffect, useRef } from "react";

interface Star {
  x: number; y: number; r: number;
  base: number; phase: number; speed: number;
}

interface Orb {
  x: number; y: number; radius: number;
  hue: number; vx: number; vy: number; opacity: number;
}

/* A Ripple is one family of concentric rings sharing a centre. */
interface Ripple {
  cx: number; cy: number;
  rings: number;
  gap: number;
  r0: number;
  phase: number;
  drift: number;
  alpha: number;
  /* Extra rings at the half-gap, for the first N rings only. The gap is
     constant in radius, but near the centre that same gap covers a much
     larger share of the screen -- which is why the widest bare patches are
     always the innermost bands. Infilling only the inner rings closes them
     without doubling density everywhere. */
  infillUpTo?: number;
}


/* A Mote rides one ring and never leaves it. */
interface Mote {
  ripple: number;
  ring: number;
  angle: number;
  speed: number;
  r: number;
  bright: number;
}

/* A Node is a bright point fixed on one ring, standing in for the original
   Field's intersection sparks. */
interface Node {
  ripple: number;
  ring: number;
  angle: number;
  hue: number;
  phase: number;
  rate: number;
}

export function BackgroundArcs() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    /* The rings draw to their own layer so the headline can be cleared of
       lines specifically -- erasing on the main canvas would take the Blooms
       and Starfield with it. */
    const ringLayer = document.createElement("canvas");
    const rctx = ringLayer.getContext("2d");
    if (!rctx) return;

    let raf: number;
    let t = 0;
    let W = 0;
    let H = 0;
    /* The larger dimension. Anything sized to cover the viewport scales off
       this rather than off W, or it shrinks on a tall narrow screen. */
    let span = 0;
    const dpr = Math.min(window.devicePixelRatio ?? 1, 2);

    let ripples: Ripple[] = [];
    let motes: Mote[] = [];
    let nodes: Node[] = [];
    let stars: Star[] = [];
    let orbs: Orb[] = [];
    let isMobile = false;

    const buildRipples = (): Ripple[] => {
      return [
        {
          cx: W * 1.03, cy: H * 0.42,
          rings: isMobile ? 6 : 10, gap: span * 0.115, r0: span * 0.05,
          phase: 0, drift: 0, alpha: 1.0, infillUpTo: 1,
        },
        {
          cx: W * -0.05, cy: H * 1.06,
          rings: isMobile ? 4 : 6, gap: span * 0.16, r0: span * 0.09,
          phase: 0, drift: 0, alpha: 0.45, infillUpTo: 1,
        },
      ];
    };

    const buildMotes = (): Mote[] => {
      const out: Mote[] = [];
      const per = isMobile ? 14 : 26;
      ripples.forEach((rp, ri) => {
        for (let i = 0; i < per; i++) {
          /* Weighting the ring choice toward the square of a random number
             leaves some rings crowded and others nearly bare. Flat random
             spreads them evenly, which reads as a printed pattern. */
          const ring = Math.floor(Math.random() ** 1.7 * rp.rings);
          /* Clustering: most motes land near one of a few seed angles. */
          const seed = (Math.floor(Math.random() * 3) / 3) * Math.PI * 2;
          const angle = Math.random() < 0.65
            ? seed + (Math.random() - 0.5) * 1.5
            : Math.random() * Math.PI * 2;
          out.push({
            ripple: ri,
            ring,
            angle,
            speed: (Math.random() * 0.5 + 0.35) * (Math.random() < 0.5 ? 1 : -1),
            r: Math.random() * 1.3 + 0.7,
            bright: Math.random() * 0.4 + 0.6,
          });
        }
      });
      return out;
    };

    let lastW = 0;
    let lastH = 0;

    const resize = () => {
      const nw = window.innerWidth;
      const nh = window.innerHeight;
      // Mobile URL-bar jitter changes innerHeight without a real resize.
      if (lastW !== 0 && nw === lastW && nw < 768 && Math.abs(nh - lastH) < 120) return;
      lastW = nw; lastH = nh;
      W = nw; H = nh; span = Math.max(W, H);
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      ringLayer.width = W * dpr;
      ringLayer.height = H * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      rctx.setTransform(1, 0, 0, 1, 0, 0);
      rctx.scale(dpr, dpr);
      ctx.fillStyle = "#0a0a0a";
      ctx.fillRect(0, 0, W, H);

      isMobile = W < 768;
      /* Blooms and the vignette are sized off the larger dimension, not the
         width. Sized off W they shrink on a tall narrow screen -- on a phone
         the biggest bloom covered 45% of the viewport height instead of
         174%, so instead of a wash you got discrete blobs of light clustered
         in one part of the page. On a landscape desktop span === W, so this
         changes nothing there. */
      ripples = buildRipples();
      motes = buildMotes();
      // Placed on rings the headline eraser does not reach, so they stay lit.
      nodes = [
        { ripple: 1, ring: 1, angle: Math.PI * -0.12,  hue: 190, phase: 0,   rate: 1.5 },
        { ripple: 1, ring: 3, angle: Math.PI * -0.306, hue: 28,  phase: 2.1, rate: 1.1 },
      ];
      stars = Array.from({ length: isMobile ? 110 : 260 }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: Math.random() * 1.3 + 0.2,
        base: Math.random() * 0.6 + 0.15,
        phase: Math.random() * Math.PI * 2,
        speed: Math.random() * 0.35 + 0.08,
      }));
      /* Blooms. Two changes from the original Field:

         The gold bloom at hue 45 is gone. It sat in the lower-left with
         nothing around it, and yellow is the one hue with no relation to the
         blue / teal / violet / ember family -- so instead of reading as
         atmosphere it read as a stain in an empty corner.

         The rest are pulled in toward the middle and carry more weight, so
         the colour concentrates where the content is and the outer thirds
         fall away into near-black. That contrast is what stops the page
         reading as an evenly-lit sheet.

         Drift is ~2.6x the original. The blooms are enormous and very soft,
         so even at this rate nothing reads as moving -- what changes is
         which part of the page is lit, which is the point. */
      orbs = [
        { x: W * 0.26, y: H * 0.34, radius: span * 0.46, hue: 210, vx: 0.21,  vy: 0.13,  opacity: 0.15 },
        { x: W * 0.74, y: H * 0.58, radius: span * 0.38, hue: 20,  vx: -0.16, vy: -0.11, opacity: 0.13 },
        { x: W * 0.5,  y: H * 0.18, radius: span * 0.34, hue: 160, vx: 0.11,  vy: 0.18,  opacity: 0.13 },
        { x: W * 0.82, y: H * 0.22, radius: span * 0.34, hue: 285, vx: -0.13, vy: 0.16,  opacity: 0.13 },
        { x: W * 0.4,  y: H * 0.7,  radius: span * 0.3,  hue: 330, vx: 0.16,  vy: -0.13, opacity: 0.11 },
        { x: W * 0.66, y: H * 0.3,  radius: span * 0.28, hue: 185, vx: -0.11, vy: 0.16,  opacity: 0.11 },
      ];
    };
    resize();
    window.addEventListener("resize", resize);

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    const draw = () => {
      // Short trail: rings are redrawn identically each frame so they hold
      // steady, while the motes smear into tails along their ring.
      ctx.fillStyle = "rgba(10, 10, 10, 0.22)";
      ctx.fillRect(0, 0, W, H);

      // Blooms
      orbs.forEach((orb) => {
        orb.x += orb.vx;
        orb.y += orb.vy;
        if (orb.x < -orb.radius * 0.5 || orb.x > W + orb.radius * 0.5) orb.vx *= -1;
        if (orb.y < -orb.radius * 0.5 || orb.y > H + orb.radius * 0.5) orb.vy *= -1;
        const g = ctx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, orb.radius);
        g.addColorStop(0, `hsla(${orb.hue}, 95%, 65%, ${orb.opacity})`);
        g.addColorStop(1, "transparent");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      });

      // Starfield
      stars.forEach((s) => {
        const tw = Math.sin(t * s.speed + s.phase) * 0.3 + 0.7;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(240, 237, 230, ${(s.base + 0.1) * tw})`;
        ctx.fill();
      });

      /* ── The rings ────────────────────────────────────────────────────
         Full circles, not arcs. The half-circle read comes from the centre
         sitting outside the viewport and the frame doing the cropping --
         a partial arc leaves its two end points visible as a hard diagonal
         edge across the page. */
      rctx.clearRect(0, 0, W, H);
      ripples.forEach((rp) => {
        rp.phase = (rp.phase + rp.drift) % (rp.rings * rp.gap);
        const cycle = rp.rings * rp.gap;
        for (let i = 0; i < rp.rings; i++) {
          const travelled = (i * rp.gap + rp.phase) % cycle;
          const radius = rp.r0 + travelled;
          const lifeT = travelled / cycle;
          const birth = Math.min(1, lifeT / 0.10);
          const death = Math.min(1, (1 - lifeT) / 0.30);
          const vis = rp.alpha * birth * death;

          rctx.beginPath();
          rctx.arc(rp.cx, rp.cy, radius, 0, Math.PI * 2);
          rctx.strokeStyle = `hsla(36, 26%, 92%, ${0.29 * vis})`;
          rctx.lineWidth = 0.75;
          rctx.stroke();

          if (rp.infillUpTo && i < rp.infillUpTo) {
            rctx.beginPath();
            rctx.arc(rp.cx, rp.cy, radius + rp.gap / 2, 0, Math.PI * 2);
            rctx.strokeStyle = `hsla(36, 26%, 92%, ${0.29 * vis})`;
            rctx.lineWidth = 0.75;
            rctx.stroke();
          }
        }
      });

      /* The headline must not be read through a lattice. Erase the lines
         over it with a soft radial falloff -- not a hard hole, which draws
         more attention than the lines did -- leaving the faintest two or
         three crossing it. Only the ring layer is erased, so the Blooms and
         Starfield underneath are untouched. */
      rctx.save();
      rctx.globalCompositeOperation = "destination-out";
      /* Where the copy actually is, which differs by layout. On desktop the
         manifesto occupies the left half; on mobile the pane is full width
         and starts near the top. A single set of numbers cannot serve both:
         the old `max(W * 0.26, 300)` floor was sized for a desktop pane and
         on a 390px phone erased 154% of the screen width, which is what made
         the area behind the manifesto go dead. */
      const qx = isMobile ? W * 0.5 : W * 0.26;
      const qy = isMobile ? H * 0.3 : H * 0.42;
      const qr = isMobile ? W * 0.62 : Math.max(W * 0.26, 300);
      const quiet = rctx.createRadialGradient(qx, qy, qr * 0.15, qx, qy, qr);
      quiet.addColorStop(0,    "rgba(0, 0, 0, 0.52)");
      quiet.addColorStop(0.55, "rgba(0, 0, 0, 0.28)");
      quiet.addColorStop(1,    "rgba(0, 0, 0, 0)");
      rctx.fillStyle = quiet;
      rctx.fillRect(qx - qr, qy - qr, qr * 2, qr * 2);
      rctx.restore();

      ctx.drawImage(ringLayer, 0, 0, W, H);

      /* ── Motes riding the rings ───────────────────────────────────────
         Bone, the same colour the Starfield uses -- these read as stars
         that happen to be travelling a path, not as a separate coloured
         system laid over the page. */
      motes.forEach((m) => {
        const rp = ripples[m.ripple];
        if (!rp) return;
        const cycle = rp.rings * rp.gap;
        const travelled = (m.ring * rp.gap + rp.phase) % cycle;
        const radius = rp.r0 + travelled;
        const lifeT = travelled / cycle;
        const birth = Math.min(1, lifeT / 0.10);
        const death = Math.min(1, (1 - lifeT) / 0.30);

        // Constant *linear* speed: divide the angular step by the radius, or
        // a mote on an outer ring crawls while an inner one races.
        m.angle += (m.speed / radius) * 1.9;
        if (m.angle > Math.PI * 2) m.angle -= Math.PI * 2;
        if (m.angle < 0) m.angle += Math.PI * 2;

        const x = rp.cx + Math.cos(m.angle) * radius;
        const y = rp.cy + Math.sin(m.angle) * radius;
        if (x < -20 || x > W + 20 || y < -20 || y > H + 20) return;

        const a = m.bright * birth * death;
        const halo = ctx.createRadialGradient(x, y, 0, x, y, m.r * 4);
        halo.addColorStop(0, `rgba(240, 237, 230, ${0.16 * a})`);
        halo.addColorStop(1, "transparent");
        ctx.fillStyle = halo;
        ctx.fillRect(x - m.r * 4, y - m.r * 4, m.r * 8, m.r * 8);

        ctx.beginPath();
        ctx.arc(x, y, m.r * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(240, 237, 230, ${0.75 * a})`;
        ctx.fill();
      });

      /* ── Nodes ───────────────────────────────────────────────────────
         Drawn over the lines so they read as sitting on the network. A
         white-hot core inside a coloured bloom, breathing slowly. */
      nodes.forEach((n) => {
        const rp = ripples[n.ripple];
        if (!rp) return;
        const radius = rp.r0 + n.ring * rp.gap;
        const x = rp.cx + Math.cos(n.angle) * radius;
        const y = rp.cy + Math.sin(n.angle) * radius;
        if (x < -60 || x > W + 60 || y < -60 || y > H + 60) return;

        const pulse = 0.55 + 0.45 * Math.sin(t * n.rate + n.phase);

        const bloom = ctx.createRadialGradient(x, y, 0, x, y, 26);
        bloom.addColorStop(0,   `hsla(${n.hue}, 95%, 72%, ${0.34 * pulse})`);
        bloom.addColorStop(0.5, `hsla(${n.hue}, 95%, 62%, ${0.13 * pulse})`);
        bloom.addColorStop(1,   "transparent");
        ctx.fillStyle = bloom;
        ctx.fillRect(x - 27, y - 27, 54, 54);

        const core = ctx.createRadialGradient(x, y, 0, x, y, 5);
        core.addColorStop(0,    `rgba(255, 255, 255, ${0.9 * pulse})`);
        core.addColorStop(0.45, `hsla(${n.hue}, 100%, 88%, ${0.5 * pulse})`);
        core.addColorStop(1,    "transparent");
        ctx.fillStyle = core;
        ctx.fillRect(x - 6, y - 6, 12, 12);

        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${0.95 * pulse})`;
        ctx.fill();
      });

      // Vignette — slightly off-centre so the left pane breathes.
      const vig = ctx.createRadialGradient(W * 0.42, H / 2, H * 0.08, W * 0.42, H / 2, span * 0.72);
      vig.addColorStop(0, "transparent");
      vig.addColorStop(0.55, "rgba(10, 10, 10, 0.22)");
      vig.addColorStop(1, "rgba(10, 10, 10, 0.78)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);

      t += 0.007;
      if (!reduceMotion) raf = requestAnimationFrame(draw);
    };

    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, W, H);
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
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
