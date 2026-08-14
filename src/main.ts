import './styles.css';

import gsap from 'gsap';
import ScrollTrigger from 'gsap/ScrollTrigger';
import Lenis from 'lenis';

import { SCROLL_VH } from './config.ts';
import { ACTS } from './acts/index.ts';
import { progress } from './progress.ts';
import { Stage } from './stage.ts';
import { mountDebug } from './debug.ts';
import { mountCopy } from './copyLayer.ts';
import { renderReduced } from './reduced.ts';

gsap.registerPlugin(ScrollTrigger);

import type { AnchorReport } from './hooks.ts';
import './hooks.ts';

const params = new URLSearchParams(window.location.search);
const forceMotion = params.get('motion') === 'force';
const prefersReduced =
  !forceMotion && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (prefersReduced) {
  renderReduced(ACTS);
  window.__frontier = {
    goto: () => Promise.resolve(),
    state: () => progress.frame,
    metrics: () => ({ mode: 'reduced' }),
    anchors: () => readAnchors(),
    gridOrigin: () => ({ x: 0, y: 0 }),
    frozen: false,
    ready: true,
  };
} else {
  boot();
}

function boot(): void {
  const scroll = document.getElementById('scroll');
  const host = document.getElementById('stage');
  if (!scroll || !host) throw new Error('stage markup missing');

  scroll.style.setProperty('--scroll-height', `${SCROLL_VH}vh`);

  const stage = new Stage(host, ACTS);

  // ?frozen=1 zeroes every transform, so all slots' art grids share one phase and
  // check:register has a single grid to scan. Set before the first render, or the frame
  // it measures is the one written with live transforms.
  if (params.get('frozen') === '1') stage.freeze();

  // ?nocopy=1 hides the copy layer so the prober can measure the *backdrop* behind the
  // text. Measuring a shot that still contains the glyphs just reports #F5F0E8 against
  // itself, which is 1:1 and tells you nothing.
  if (params.get('nocopy') === '1') {
    const copyLayer = document.getElementById('copy');
    if (copyLayer) copyLayer.style.display = 'none';
  }

  const measure = params.get('perf') === '1';
  if (measure) (window as unknown as { __writePass: number[] }).__writePass = [];

  const copyHost = document.getElementById('copy');
  const updateCopy = copyHost ? mountCopy(copyHost) : null;

  // Opt-in only. It used to default on in dev, which meant the telemetry panel sat over
  // the artwork for anyone looking at the dev server.
  const showDebug = params.get('debug') === '1';
  const updateDebug = showDebug ? mountDebug(document.body, () => stage.geometry.w) : null;

  const lenis = new Lenis({
    duration: 1.05,
    smoothWheel: true,
    syncTouch: false,
  });

  // One ScrollTrigger. It computes master progress and nothing else — the pin is CSS
  // sticky, so there is no pin-spacer and no layout shift.
  ScrollTrigger.create({
    trigger: scroll,
    start: 'top top',
    end: 'bottom bottom',
    onUpdate: (self) => progress.setP(self.progress),
    onRefresh: (self) => progress.setP(self.progress),
  });

  lenis.on('scroll', ScrollTrigger.update);

  // One rAF loop for the whole page: gsap's ticker drives Lenis, then the single write
  // pass. Nothing else is allowed to schedule a frame.
  let lastTime = 0;
  let painted = false;
  gsap.ticker.add((time: number) => {
    const ms = time * 1000;
    lenis.raf(ms);
    const delta = lastTime === 0 ? 16.7 : Math.min(ms - lastTime, 100);
    lastTime = ms;

    // ?perf=1 records how long our own write pass takes. Wall-clock frame deltas in
    // headless Chromium are dominated by CDP round-trips and rAF throttling and say
    // nothing useful; the cost of the work we actually do is measurable and is what the
    // §7 budget is really about.
    const t0 = measure ? performance.now() : 0;
    progress.tick(delta);
    stage.render(progress.frame, delta);
    // Only once the first frame is actually painted. Removing it at construction was
    // fine when a layer was an innerHTML assignment; with a canvas substrate the first
    // frame costs a raster, and dropping the placeholder before it lands shows the bare
    // page background for however long that takes.
    if (!painted) {
      painted = true;
      document.getElementById('stage-critical')?.remove();
    }
    updateCopy?.(progress.frame);
    if (measure) {
      const samples = (window as unknown as { __writePass: number[] }).__writePass;
      if (samples.length < 4000) samples.push(performance.now() - t0);
    }
    updateDebug?.(progress.frame);
  });
  gsap.ticker.lagSmoothing(0);

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      stage.remeasure();
      ScrollTrigger.refresh();
    }, 150);
  });

  window.__frontier = {
    async goto(p: number): Promise<void> {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      lenis.scrollTo(Math.round(max * Math.min(Math.max(p, 0), 1)), {
        immediate: true,
        force: true,
      });
      ScrollTrigger.update();
      await nextFrames(3);
    },
    state: () => progress.frame,
    metrics: () => stage.metrics(),
    anchors: () => readAnchors(),
    gridOrigin: () => stage.gridOrigin(),
    frozen: stage.isFrozen,
    ready: true,
  };
}

function readAnchors(): AnchorReport {
  const host = document.getElementById('stage');
  const horizonEl = document.getElementById('anchor-horizon');
  const vpEl = document.getElementById('anchor-vp');
  const stageRect = host?.getBoundingClientRect();
  const width = stageRect?.width ?? window.innerWidth;
  const height = stageRect?.height ?? window.innerHeight;
  const stageTop = stageRect?.top ?? 0;

  const horizonRect = horizonEl?.getBoundingClientRect();
  const vpRect = vpEl?.getBoundingClientRect();

  return {
    stage: { width, height, top: stageTop },
    horizon: horizonRect
      ? {
          top: horizonRect.top - stageTop,
          fraction: height > 0 ? (horizonRect.top - stageTop) / height : 0,
        }
      : null,
    vp: vpRect
      ? { left: vpRect.left, fraction: width > 0 ? vpRect.left / width : 0 }
      : null,
    lockedTransforms: [...document.querySelectorAll<HTMLElement>('[data-vp-locked]')].map(
      (el) => getComputedStyle(el).transform,
    ),
  };
}

function nextFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let remaining = count;
    const step = (): void => {
      remaining -= 1;
      if (remaining <= 0) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
