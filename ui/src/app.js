// Wiring. One state object, one render pass, one clock. Everything else in
// ui/src/ is a pure function of (run, sim time) so that playing forward and
// scrubbing backwards cannot disagree.
//
// Playback is entirely offline: no model is called and the engine does not need
// to be running. The only live path in the whole console is the human-seat panel.

import {
  loadFinalReport,
  loadHeatmap,
  loadLadder,
  loadRun,
  loadRuns,
  firstAvailable,
} from './data.js';
import { $, $$, fill, h } from './dom.js';
import { GroundMap } from './map.js';
import { Run, SEATS, SEAT_META, fmtSim, seatColor } from './model.js';
import {
  drawStormStrip,
  renderChannels,
  renderInflight,
  renderLadder,
  renderPersonas,
  renderStorm,
} from './panels.js';
import { attachScrub, drawTempo, drawTimeline, timelineReadout } from './timeline.js';
import { renderCompareSide, renderSplitSide, renderValidation } from './views.js';
import { mountHumanSeat } from './human.js';

// Sim seconds per wall second. A 72-hour episode is 259 200 sim seconds, so
// 3600x plays the whole thing in 72 seconds and 900x in a shade under five
// minutes -- the two speeds a demo actually uses.
const SPEEDS = [60, 300, 900, 3600, 10800];

const state = {
  runs: [],
  entry: null,
  run: null,
  ladder: null,
  geo: null,
  assets: null,
  t: 0,
  playing: false,
  speed: 900,
  view: 'ops',
  selectedSeat: 'nsc',
  splitT: 0,
  splitA: 'usspacecom',
  splitB: 'northern_fleet',
  compare: { continuous: null, checkpoint: null },
  validation: { hm: null, report: null, loaded: false },
  human: null,
  humanOpen: false,
};

let map = null;
let lastFrame = 0;

// ── boot ────────────────────────────────────────────────────────────────

async function boot() {
  try {
    const [runs, ladder, geoRes, assetsRes] = await Promise.all([
      loadRuns(),
      loadLadder(),
      firstAvailable(['ui/data/arctic.json']),
      firstAvailable(['ui/data/assets.json']),
    ]);
    state.runs = runs;
    state.ladder = ladder;
    state.geo = JSON.parse(geoRes.text);
    state.assets = JSON.parse(assetsRes.text).assets;
  } catch (e) {
    fatal(e);
    return;
  }

  map = new GroundMap($('#map'), state.geo, state.assets);

  buildSpeedDial();
  buildRunSelect();
  buildSeatSelects();
  wireTransport();
  wireViews();
  wireClockMode();
  wireHumanSeat();

  await selectRun(state.runs[0].id);

  window.addEventListener('resize', () => {
    map.resize();
    render();
  });

  requestAnimationFrame(tick);
}

function fatal(e) {
  document.body.innerHTML = '';
  document.body.append(
    h(
      'div',
      { style: { padding: '2rem', fontFamily: 'var(--mono)' } },
      h('h1', { style: { color: 'var(--danger)' } }, 'Console failed to start'),
      h('p', {}, String(e.message ?? e)),
      h(
        'p',
        { style: { color: 'var(--ink-dim)' } },
        'Serve the repository root — the console reads contracts/, engine/samples/ and ui/data/ ',
        'by path. From the repo root: ',
        h('code', {}, 'python ui/serve.py'),
        ', then open ',
        h('code', {}, 'http://localhost:8777/ui/'),
        '.',
      ),
    ),
  );
}

// ── run loading ─────────────────────────────────────────────────────────

async function selectRun(id) {
  const entry = state.runs.find((r) => r.id === id);
  if (!entry) return;
  const { lines, source } = await loadRun(entry);
  state.entry = entry;
  state.run = new Run(lines, { source });
  state.t = 0;
  state.splitT = 0;
  state.playing = false;
  state.compare = { continuous: null, checkpoint: null };

  $('#run-select').value = id;
  $('#episode-id').textContent = state.run.episodeId;
  $('#map-tag').textContent = source.startsWith('engine/') ? 'engine sample' : source.replace('ui/data/', '');
  $('#seats-tag').textContent = state.run.hasModelBeliefs
    ? `${SEATS.length} seats`
    : `${SEATS.length} seats · beliefs not logged`;
  $('#ladder-tag').textContent = state.ladder.version;

  $$('[data-clockmode]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.clockmode === state.run.clockMode)),
  );

  state.human?.setRun(state.run);
  map.resize();
  render();
}

// ── header controls ─────────────────────────────────────────────────────

function buildSpeedDial() {
  fill(
    $('#speeds'),
    SPEEDS.map((s) =>
      h(
        'button',
        {
          onclick: () => {
            state.speed = s;
            buildSpeedDial();
          },
          'aria-pressed': String(s === state.speed),
          title: `${s} sim seconds per second — full episode in ${Math.round(259200 / s)}s`,
        },
        s >= 3600 ? `${s / 3600}h/s` : `${s}×`,
      ),
    ),
  );
}

function buildRunSelect() {
  const sel = $('#run-select');
  fill(
    sel,
    state.runs.map((r) => h('option', { value: r.id }, r.label)),
  );
  sel.onchange = () => selectRun(sel.value);
}

function buildSeatSelects() {
  const opts = () => SEATS.map((s) => h('option', { value: s }, SEAT_META[s].label));
  const a = $('#split-a');
  const b = $('#split-b');
  fill(a, opts());
  fill(b, opts());
  a.value = state.splitA;
  b.value = state.splitB;
  a.onchange = () => {
    state.splitA = a.value;
    render();
  };
  b.onchange = () => {
    state.splitB = b.value;
    render();
  };
  $('#split-freeze').onclick = () => {
    state.splitT = state.t;
    state.playing = false;
    syncPlayButton();
    render();
  };
}

function wireTransport() {
  $('#btn-play').onclick = () => {
    state.playing = !state.playing;
    syncPlayButton();
  };
  $('#btn-back').onclick = () => seek(state.run.eventTimeBefore(state.t));
  $('#btn-fwd').onclick = () => seek(state.run.eventTimeAfter(state.t));

  attachScrub($('#timeline'), () => state.run, seek);
  attachScrub($('#tempo'), () => state.run, seek);

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      $('#btn-play').click();
    } else if (e.code === 'ArrowLeft') {
      seek(state.t - (e.shiftKey ? 3600 : 600));
    } else if (e.code === 'ArrowRight') {
      seek(state.t + (e.shiftKey ? 3600 : 600));
    } else if (e.code === 'Home') {
      seek(0);
    } else if (e.code === 'End') {
      seek(state.run.duration);
    }
  });
}

function syncPlayButton() {
  $('#btn-play').textContent = state.playing ? '❚❚ Pause' : '▶ Play';
  $('#btn-play').setAttribute('aria-pressed', String(state.playing));
}

function seek(t) {
  state.t = Math.max(0, Math.min(state.run.duration, t));
  render();
}

function wireViews() {
  $$('#view-tabs button').forEach((b) => {
    b.onclick = () => {
      state.view = b.dataset.view;
      $$('#view-tabs button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${state.view}`));
      if (state.view === 'compare') loadCompare();
      if (state.view === 'validation') loadValidation();
      render();
    };
  });
  $$('#view-tabs button')[0].setAttribute('aria-pressed', 'true');
  $('#validation-reload').onclick = () => {
    state.validation.loaded = false;
    loadValidation();
  };
}

/** The clock-mode toggle swaps to the sibling run in the same compare_group. */
function wireClockMode() {
  $$('[data-clockmode]').forEach((b) => {
    b.onclick = () => {
      const want = b.dataset.clockmode;
      const sibling = state.runs.find(
        (r) => r.compare_group === state.entry.compare_group && r.clock_mode === want,
      );
      if (!sibling) {
        b.animate([{ opacity: 1 }, { opacity: 0.3 }, { opacity: 1 }], { duration: 260 });
        return;
      }
      selectRun(sibling.id);
    };
  });
}

function wireHumanSeat() {
  const btn = $('#btn-human');
  btn.onclick = () => {
    state.humanOpen = !state.humanOpen;
    btn.setAttribute('aria-pressed', String(state.humanOpen));
    $('#human').hidden = !state.humanOpen;
    $('#view-ops').classList.toggle('with-human', state.humanOpen);
    if (state.humanOpen && !state.human) {
      state.human = mountHumanSeat({
        root: $('#human-body'),
        seatSelect: $('#human-seat'),
        statusEl: $('#human-status'),
        dot: $('#livedot'),
        ladder: state.ladder,
        getRun: () => state.run,
        getT: () => state.t,
        // A release request routed to the operator stops the clock; answering it
        // starts it again. That is the contract's pause_clock, made visible.
        pause: () => {
          state.playing = false;
          syncPlayButton();
        },
        resume: () => {
          state.playing = true;
          syncPlayButton();
        },
        onChange: render,
      });
      state.human.setRun(state.run);
    }
    map.resize();
    render();
  };
}

// ── lazy view data ──────────────────────────────────────────────────────

async function loadCompare() {
  if (!state.entry) return;
  const group = state.entry.compare_group;
  const wanted = state.runs.filter((r) => r.compare_group === group);
  for (const entry of wanted) {
    if (state.compare[entry.clock_mode]) continue;
    const { lines, source } = await loadRun(entry);
    state.compare[entry.clock_mode] = new Run(lines, { source });
  }
  render();
}

async function loadValidation() {
  if (state.validation.loaded) return;
  state.validation.hm = await loadHeatmap();
  state.validation.report = await loadFinalReport();
  state.validation.loaded = true;
  render();
}

// ── clock ───────────────────────────────────────────────────────────────

function tick(ts) {
  const dt = lastFrame ? (ts - lastFrame) / 1000 : 0;
  lastFrame = ts;
  if (state.playing && state.run) {
    state.t += dt * state.speed;
    if (state.t >= state.run.duration) {
      state.t = state.run.duration;
      state.playing = false;
      syncPlayButton();
    }
    render();
  }
  requestAnimationFrame(tick);
}

// ── render ──────────────────────────────────────────────────────────────

function render() {
  const run = state.run;
  if (!run) return;
  const t = state.t;

  $('#clk').innerHTML = `${fmtSim(t)}<small> sim</small>`;
  $('#clk-abs').textContent = `${(t / 3600).toFixed(2)}h of ${(run.duration / 3600).toFixed(0)}h`;
  $('#clk-mode').textContent = `${run.clockMode} · release ${run.releasePolicy} · ${run.envVersion}`;

  if (state.view === 'ops') renderOps(run, t);
  else if (state.view === 'split') renderSplit(run);
  else if (state.view === 'compare') renderCompare(t);
  else if (state.view === 'validation') {
    renderValidation(
      {
        canvas: $('#heatmap'),
        tip: $('#hm-tip'),
        note: $('#heatmap-note'),
        md: $('#validation-md'),
        src: $('#validation-src'),
      },
      state.validation.hm,
      state.validation.report,
    );
  }

  drawTimeline($('#timeline'), run, t);
  drawTempo($('#tempo'), run, t);
  $('#tl-readout').textContent = timelineReadout(run, t);
}

function renderOps(run, t) {
  const snap = run.snapshotAt(t);

  map.draw(t, snap);
  // Assets south of the map edge get a short list rather than a wall of text
  // across the graticule; the count is the part that matters.
  const off = map.offmapList();
  fill(
    $('#offmap'),
    off.length
      ? [
          h('div', { style: { color: 'var(--ink-dim)' } }, `${off.length} of ${state.assets.length} below ${45}°N`),
          ...off
            .slice(0, 4)
            .map((a) => h('div', {}, `${a.id}  ${a.now.lat.toFixed(0)}°`)),
          off.length > 4 ? h('div', {}, `+${off.length - 4} more`) : null,
        ]
      : [],
  );
  fill(
    $('#map-legend'),
    [...new Set(state.assets.map((a) => a.owner))].map((o) =>
      h('span', {}, h('i', { style: { backgroundColor: seatColor(o) } }), o),
    ),
  );

  renderStorm(
    {
      sev: $('#storm-sev'),
      kp: $('#storm-kp'),
      dst: $('#storm-dst'),
      profile: $('#storm-profile'),
      mSensor: $('#m-sensor'),
      vSensor: $('#v-sensor'),
      mComms: $('#m-comms'),
      vComms: $('#v-comms'),
      fTrack: $('#f-track'),
      fScreen: $('#f-screen'),
    },
    snap,
  );
  drawStormStrip($('#storm-strip'), run, t);

  renderPersonas($('#personas'), snap, run, {
    selected: state.selectedSeat,
    onSelect: (seat) => {
      state.selectedSeat = seat;
      render();
    },
  });
  renderLadder($('#ladder'), snap, run, state.ladder);
  renderInflight($('#inflight'), snap);
  renderChannels($('#channels'), snap, run);

  state.human?.render(snap);
}

function renderSplit(run) {
  $('#split-frozen').textContent = `frozen at ${fmtSim(state.splitT)}`;
  renderSplitSide($('#split-side-a'), run, state.splitA, state.splitT);
  renderSplitSide($('#split-side-b'), run, state.splitB, state.splitT);
}

function renderCompare(t) {
  $('#compare-t').textContent = fmtSim(t);
  const c = state.compare.continuous;
  const k = state.compare.checkpoint;
  if (c) renderCompareSide($('#cmp-cont'), c, t, 'Continuous clock');
  else fill($('#cmp-cont'), h('div', { class: 'empty' }, 'loading…'));
  if (k) renderCompareSide($('#cmp-chk'), k, t, 'Checkpoint clock');
  else fill($('#cmp-chk'), h('div', { class: 'empty' }, 'loading…'));
}

boot();
