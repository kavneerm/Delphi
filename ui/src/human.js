// The human seat. NSC by default, per contracts/seats.md: the release and
// irreversible-action authority, and the slowest clock on the board, which is
// what makes a person cheap to seat there.
//
// Two modes, one panel:
//   playback  — release requests come off the log. Answering records what the
//               operator would have done and shows what the episode actually did.
//               Nothing is sent anywhere.
//   live      — the engine bridge is connected. Requests arrive over the socket,
//               answers go back, and the engine's clock is genuinely stopped
//               while the person thinks (env_config_schema: pause_clock).
//
// The fork panel only ever shows numbers the engine measured. If the bridge is
// down it says so and offers the command, rather than estimating.

import { EngineBridge } from './bridge.js';
import { fill, h } from './dom.js';
import { SEATS, SEAT_META, fmtDur, fmtSim, seatColor } from './model.js';

const FORK_N = 50;
const HOLD_MINUTES = 120; // "Hold 2h"

export function mountHumanSeat(opts) {
  const { root, seatSelect, statusEl, dot, ladder, getRun, getT, pause, resume, onChange } = opts;

  const st = {
    seat: 'nsc',
    run: null,
    answered: new Map(), // release_id -> {decision, at}
    forks: new Map(), // release_id -> {state, data, error}
    liveEvents: [],
    prompt: null, // a live release prompt from the engine
    pausedFor: null, // release_id the clock is currently stopped for
    picker: { type: 'hold', params: {} },
    note: '',
  };

  const bridge = new EngineBridge();

  fill(
    seatSelect,
    SEATS.map((s) => h('option', { value: s }, SEAT_META[s].label)),
  );
  seatSelect.value = st.seat;
  seatSelect.onchange = () => {
    st.seat = seatSelect.value;
    st.picker = { type: 'hold', params: {} };
    if (bridge.live) bridge.send({ op: 'hello', seat: st.seat });
    onChange();
  };

  bridge.addEventListener('status', () => {
    statusEl.textContent = bridge.status;
    dot.className = `livedot ${bridge.status === 'live' ? 'up' : bridge.status === 'connecting' ? '' : 'down'}`;
    onChange();
  });
  bridge.addEventListener('prompt', (e) => {
    if (e.detail.kind === 'release') {
      st.prompt = e.detail.context;
      st.pausedFor = e.detail.context?.release_id ?? null;
      pause();
    }
    onChange();
  });
  bridge.addEventListener('event', (e) => {
    st.liveEvents.push(e.detail.line);
    if (st.liveEvents.length > 400) st.liveEvents.shift();
    onChange();
  });

  const api = {
    setRun(run) {
      st.run = run;
      st.answered.clear();
      st.forks.clear();
      st.pausedFor = null;
    },
    render(snap) {
      draw(snap);
    },
    bridge,
  };

  // ── the release request that is in front of the operator right now ────

  function currentRequest(snap) {
    if (st.prompt) return { ...st.prompt, live: true };
    // Playback: the oldest release still unanswered at this sim time and routed
    // to the seat the operator occupies.
    const mine = snap.pendingReleases
      .filter((r) => r.releasingSeat === st.seat)
      .sort((a, b) => a.requestedAt - b.requestedAt);
    const open = mine.find((r) => !st.answered.has(r.id));
    return open ? { ...open, live: false } : null;
  }

  function beliefLine(req, snap) {
    // The card is specified to read "belief hostile=0.62". Say so only if the log
    // actually carries it; otherwise name the gap. Never invent the number.
    const b = req.beliefs ?? snap?.seats?.[req.seat]?.beliefs;
    if (b && typeof b.hostile === 'number') return `belief hostile=${b.hostile.toFixed(2)}`;
    return null;
  }

  function answer(req, decision, snap) {
    if (req.live) {
      bridge.answerRelease(req.release_id ?? req.id, decision, {
        holdMinutes: decision === 'hold' ? HOLD_MINUTES : 0,
        rationale: st.note,
      });
      st.prompt = null;
    } else {
      st.answered.set(req.id, { decision, at: snap.t });
    }
    st.pausedFor = null;
    st.note = '';
    // Answering restarts the clock. That is the whole shape of the interaction:
    // the sim stops for exactly as long as the person takes.
    resume();
    onChange();
  }

  async function runFork(req) {
    const id = req.release_id ?? req.id;
    st.forks.set(id, { state: 'running' });
    onChange();
    try {
      const res = await bridge.fork(id, ['grant', 'deny'], FORK_N, 24);
      st.forks.set(id, { state: 'done', data: res.options });
    } catch (e) {
      st.forks.set(id, { state: 'error', error: String(e.message ?? e) });
    }
    onChange();
  }

  // ── drawing ───────────────────────────────────────────────────────────

  function draw(snap) {
    const run = st.run ?? getRun();
    if (!run || !snap) return;
    const t = snap.t ?? getT();
    const req = currentRequest(snap);
    const view = run.filteredView(st.seat, t);
    const injects = view.filter((l) => l.type === 'inject').slice(-6).reverse();
    const seatState = snap.seats[st.seat];

    fill(
      root,

      // Connection. Playback needs nothing running; the live seat does.
      h(
        'div',
        { style: { display: 'flex', gap: '.35rem', alignItems: 'center', marginBottom: '.6rem' } },
        h('span', { class: 'seat-badge' }, bridge.live ? 'LIVE — engine' : 'PLAYBACK — offline'),
        h(
          'button',
          { onclick: () => (bridge.live ? bridge.disconnect() : bridge.connect(st.seat)), style: { marginLeft: 'auto' } },
          bridge.live ? 'Disconnect' : 'Connect engine',
        ),
      ),

      st.pausedFor ? h('div', { class: 'paused-banner' }, 'clock stopped — awaiting this seat') : null,

      req ? releaseCard(req, snap) : null,
      req ? forkPanel(req) : null,

      // Pending injects on this seat's feed.
      h('h3', { style: { fontSize: '.72rem', margin: '1rem 0 .3rem', color: 'var(--ink-dim)' } }, 'Pending injects'),
      injects.length
        ? injects.map((l) =>
            h(
              'div',
              { class: 'inject' },
              h(
                'div',
                { class: 'm' },
                h('span', {}, fmtSim(l.sim_time_s)),
                h('span', {}, l.payload.source ?? '—'),
                h('span', {}, `conf ${l.payload.confidence ?? '—'}`),
              ),
              h('div', { class: 'c' }, l.payload.content ?? ''),
            ),
          )
        : h('div', { class: 'empty' }, 'nothing on this feed yet'),

      actionPicker(snap),

      // The seat's own filtered view — the same one the engine hands a model.
      h(
        'h3',
        { style: { fontSize: '.72rem', margin: '1rem 0 .3rem', color: 'var(--ink-dim)' } },
        `${SEAT_META[st.seat].label} — filtered view`,
        h(
          'span',
          { style: { color: 'var(--ink-faint)', fontWeight: 400 } },
          `  ${view.length} events · last decision ${seatState.lastDecisionAt === null ? 'none' : fmtSim(seatState.lastDecisionAt)}`,
        ),
      ),
      h(
        'div',
        { class: 'feed' },
        (bridge.live ? st.liveEvents.slice(-25) : view.slice(-25))
          .reverse()
          .map((l) =>
            h(
              'div',
              { class: `ev t-${l.type}` },
              h('span', { class: 'ts' }, fmtSim(l.sim_time_s).replace('T+', '')),
              h(
                'span',
                {},
                h('span', { class: 'k' }, l.type.replace(/_/g, ' ')),
                ' ',
                summarise(l),
              ),
            ),
          ),
      ),
    );
  }

  function releaseCard(req, snap) {
    const seat = req.seat ?? req.requesting_seat;
    const action = req.action?.type ?? '?';
    const belief = beliefLine(req, snap);
    const rung = ladder.rungs.find((r) => r.type === action);
    const answered = st.answered.get(req.id);

    return h(
      'div',
      { class: 'rq' },
      h('div', { class: 'hdr' }, req.live ? 'release request — live' : 'release request — from the log'),
      h(
        'div',
        { class: 'ask' },
        h('b', { style: { color: seatColor(seat) } }, seat),
        ' requests ',
        h('b', {}, action),
        rung?.irreversible ? h('b', { style: { color: 'var(--danger)' } }, ' (IRREVERSIBLE)') : null,
        '; ',
        belief
          ? h('b', {}, belief)
          : h('span', { style: { color: 'var(--ink-faint)' } }, 'belief not in this log'),
      ),
      req.justification ? h('div', { class: 'just' }, req.justification) : null,
      h(
        'div',
        { style: { fontFamily: 'var(--mono)', fontSize: '.64rem', color: 'var(--ink-faint)' } },
        `${req.id ?? req.release_id} · requested ${fmtSim(req.requestedAt ?? snap.t)} · rung ${rung?.rung ?? '?'}`,
      ),
      answered
        ? h(
            'div',
            { style: { fontFamily: 'var(--mono)', fontSize: '.7rem' } },
            h('span', { style: { color: 'var(--accent)' } }, `you: ${answered.decision.toUpperCase()}`),
            // The comparison that makes playback worth doing at all.
            req.granted !== null && req.granted !== undefined
              ? h(
                  'span',
                  { style: { color: 'var(--ink-dim)' } },
                  `   · the episode: ${req.granted ? 'GRANTED' : 'DENIED'} by ${req.decidedBy}`,
                )
              : null,
          )
        : h(
            'div',
            { class: 'btns' },
            h('button', { class: 'approve', onclick: () => answer(req, 'grant', snap) }, 'Approve'),
            h('button', { class: 'deny', onclick: () => answer(req, 'deny', snap) }, 'Deny'),
            h(
              'button',
              { onclick: () => answer(req, 'hold', snap), title: `defer ${HOLD_MINUTES / 60} sim hours` },
              'Hold 2h',
            ),
          ),
    );
  }

  function forkPanel(req) {
    const id = req.release_id ?? req.id;
    const f = st.forks.get(id);

    const head = h(
      'h3',
      { style: { fontSize: '.72rem', margin: '.8rem 0 .3rem', color: 'var(--ink-dim)' } },
      'Fork — what each answer leads to',
      h(
        'span',
        { style: { color: 'var(--ink-faint)', fontWeight: 400 } },
        `  n=${FORK_N} continuations per option, 24h horizon`,
      ),
    );

    if (!bridge.live) {
      return h(
        'div',
        {},
        head,
        h(
          'div',
          { class: 'empty' },
          'Forking replays the episode forward from a snapshot, which needs the engine. ',
          h('code', {}, 'python ui/server/bridge.py'),
          ' then Connect engine above.',
        ),
      );
    }
    if (!f) {
      return h(
        'div',
        {},
        head,
        h('button', { onclick: () => runFork(req) }, `Fork ${FORK_N}× on grant and on deny`),
      );
    }
    if (f.state === 'running') {
      return h('div', {}, head, h('div', { class: 'empty' }, `running ${FORK_N * 2} continuations…`));
    }
    if (f.state === 'error') {
      return h(
        'div',
        {},
        head,
        h('div', { class: 'err' }, f.error),
        h('button', { onclick: () => runFork(req) }, 'Retry'),
      );
    }

    return h(
      'div',
      {},
      head,
      Object.entries(f.data).map(([option, r]) => {
        const n = r.n || 1;
        const irr = (r.irreversible ?? 0) / n;
        const esc = (r.escalated ?? 0) / n;
        const safe = Math.max(0, 1 - irr - esc);
        return h(
          'div',
          { class: 'fork-opt' },
          h(
            'div',
            { class: 'top' },
            h('span', { style: { textTransform: 'uppercase' } }, option),
            h('span', { style: { color: 'var(--ink-faint)' } }, `n=${r.n}`),
            h(
              'span',
              { class: 'pct', style: { color: irr > 0.25 ? 'var(--danger)' : 'var(--ink)' } },
              `${Math.round(irr * 100)}%`,
            ),
          ),
          h(
            'div',
            { class: 'fork-bar', title: 'share of continuations by outcome' },
            h('i', { class: 'irr', style: { width: `${irr * 100}%` } }),
            h('i', { class: 'esc', style: { width: `${esc * 100}%` } }),
            h('i', { class: 'safe', style: { width: `${safe * 100}%` } }),
          ),
          h(
            'div',
            { class: 'fork-legend' },
            h('span', {}, h('i', { style: { background: 'var(--danger)' } }), 'irreversible adversary response'),
            h('span', {}, h('i', { style: { background: 'var(--warn)' } }), 'escalated, reversible'),
            h('span', {}, h('i', { style: { background: '#2f4a3a' } }), 'neither'),
          ),
        );
      }),
      h(
        'div',
        { style: { fontFamily: 'var(--mono)', fontSize: '.6rem', color: 'var(--ink-faint)' } },
        'irreversible = counter_rpo, kinetic or terrestrial_response taken by an adversary seat',
      ),
    );
  }

  /** Action picker, constrained to what this seat may actually execute. */
  function actionPicker(snap) {
    const allowed = ladder.rungs.filter((r) => r.allowed_seats.includes(st.seat));
    const rung = allowed.find((r) => r.type === st.picker.type) ?? allowed[0];
    const required = REQUIRED_PARAMS[rung.type] ?? [];

    return h(
      'div',
      {},
      h(
        'h3',
        { style: { fontSize: '.72rem', margin: '1rem 0 .3rem', color: 'var(--ink-dim)' } },
        'Take an action',
        h(
          'span',
          { style: { color: 'var(--ink-faint)', fontWeight: 400 } },
          `  ${allowed.length} of ${ladder.rungs.length} rungs — allowed_seats includes ${st.seat}`,
        ),
      ),
      h(
        'div',
        { class: 'picker' },
        h(
          'div',
          { class: 'row' },
          h('label', {}, 'action'),
          h(
            'select',
            {
              onchange: (e) => {
                st.picker = { type: e.target.value, params: {} };
                onChange();
              },
            },
            allowed.map((r) =>
              h(
                'option',
                { value: r.type, selected: r.type === rung.type },
                `${r.rung} · ${r.type}${r.irreversible ? ' ⚠' : ''}`,
              ),
            ),
          ),
        ),
        required.map((p) =>
          h(
            'div',
            { class: 'row' },
            h('label', { title: p }, p),
            h('input', {
              value: st.picker.params[p] ?? '',
              placeholder: PARAM_HINT[p] ?? '',
              oninput: (e) => {
                st.picker.params[p] = e.target.value;
              },
            }),
          ),
        ),
        rung.irreversible
          ? h(
              'div',
              { class: 'warn-irrev' },
              '⚠ irreversible — routes through the release cycle before it lands',
            )
          : null,
        h(
          'div',
          { style: { fontSize: '.66rem', color: 'var(--ink-faint)' } },
          rung.description,
        ),
        h(
          'button',
          {
            disabled: !bridge.live,
            title: bridge.live ? '' : 'connect the engine to act; playback is read-only',
            onclick: () => {
              bridge.submitAction({ type: rung.type, params: { ...st.picker.params } }, null, st.note);
              st.picker = { type: 'hold', params: {} };
              onChange();
            },
          },
          bridge.live ? `Execute ${rung.type}` : 'Execute — needs the engine',
        ),
      ),
    );
  }

  return api;
}

// Mirrors the conditional blocks on action_schema.json#/$defs/action, so the
// picker asks for exactly what the engine will refuse the action without.
const REQUIRED_PARAMS = {
  hold: [],
  maneuver: ['asset_id', 'delta_v_mps'],
  private_demarche: ['recipient'],
  public_attribution: ['attributed_actor', 'confidence_stated'],
  request_commercial_priority: ['provider', 'capability'],
  share_telemetry: ['recipient', 'data_class'],
  geofence_or_throttle: ['region', 'mode'],
  disclose_incident: ['scope'],
  jam: ['target_asset_id', 'duration_minutes'],
  dazzle: ['target_asset_id', 'duration_minutes'],
  ground_cyber: ['target_system', 'effect'],
  counter_rpo: ['asset_id', 'target_asset_id', 'standoff_km'],
  kinetic: ['target_asset_id', 'weapon_class'],
  terrestrial_response: ['target_id', 'response_class'],
};

const PARAM_HINT = {
  recipient: 'seat id, or public / all',
  attributed_actor: 'seat id, or unknown / none',
  confidence_stated: '0.0 – 1.0',
  provider: 'starlink | iridium',
  capability: 'arctic_bandwidth | downlink_slots | priority_routing',
  data_class: 'ssa_tracks | interference_signature | ground_logs | assessment',
  region: 'svalbard | barents | north_of_74n',
  mode: 'geofence | throttle | suspend | restore',
  scope: 'customers | regulator | allies | public',
  effect: 'degrade | disrupt | deny | manipulate | persist',
  weapon_class: 'direct_ascent | co_orbital | unspecified',
  response_class: 'strike | destructive_cyber | law_enforcement | sanctions | expulsion',
  duration_minutes: 'minutes, ≤ 4320',
  standoff_km: 'km, ≤ 5000',
  delta_v_mps: 'm/s, ≤ 500',
};

function summarise(l) {
  const p = l.payload ?? {};
  switch (l.type) {
    case 'inject':
      return `${p.source ?? ''} — ${(p.content ?? '').slice(0, 120)}`;
    case 'message_delivered':
    case 'message_sent':
      return `${p.from ?? l.seat} → ${p.message?.to} · ${(p.message?.text ?? '').slice(0, 100)}`;
    case 'action':
    case 'human_action':
      return `${p.action?.type}${p.blocked ? ' ⊘' : ''}`;
    case 'release_requested':
      return p.justification || `${l.seat} → ${p.releasing_seat} for ${p.action?.type}`;
    case 'release_granted':
    case 'release_denied':
      return `${p.release_id} by ${p.decided_by}`;
    case 'storm_update':
      return `${p.severity} Kp ${p.kp}`;
    default:
      return '';
  }
}

export { fmtDur };
