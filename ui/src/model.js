// Turns a JSONL event log into the things the panels need to draw, and nothing
// else. The only rule this file relies on that the schema states in prose is
// the ordering rule: lines are non-decreasing in sim_time_s.

export const SEATS = [
  'northcom',
  'usspacecom',
  'nsc',
  'norway',
  'northern_fleet',
  'kremlin',
  'china',
  'starlink',
  'iridium',
];

export const SEAT_META = {
  northcom: { label: 'NORTHCOM', side: 'blue', role: 'operational picture' },
  usspacecom: { label: 'USSPACECOM', side: 'blue', role: 'attribution' },
  nsc: { label: 'NSC / Deputies', side: 'blue', role: 'release + escalation authority' },
  norway: { label: 'Norway', side: 'ally', role: 'ground segment, treaty-bound' },
  northern_fleet: { label: 'Northern Fleet', side: 'red', role: 'hidden private_type' },
  kremlin: { label: 'Kremlin / MFA', side: 'red', role: 'denial, narrative, Red release' },
  china: { label: 'China', side: 'green', role: 'bystander with its own SSA' },
  starlink: { label: 'Starlink', side: 'commercial', role: 'the constellation that was hit' },
  iridium: { label: 'Iridium', side: 'commercial', role: 'the survivor, and the scarcity' },
};

export const SIDE_COLOR = {
  blue: '#4dd4e0',
  ally: '#7fd47f',
  red: '#e0645c',
  green: '#d9b45c',
  commercial: '#9d8ce0',
};

export const seatColor = (seat) => SIDE_COLOR[SEAT_META[seat]?.side] ?? '#8695ab';

export const CHANNELS = [
  'hotline',
  'internal',
  'press',
  'back_channel',
  'commercial',
  'mil_to_mil',
  'liaison',
  'diplomatic',
];

export const STORM_ORDER = ['quiet', 'G1', 'G2', 'G3', 'G4', 'G5', 'carrington'];

export function fmtSim(s) {
  const neg = s < 0;
  s = Math.max(0, Math.abs(Math.round(s)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${neg ? '-' : ''}T+${pad(h)}:${pad(m)}:${pad(sec)}`;
}

export function fmtDur(s) {
  s = Math.round(s);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

export class Run {
  constructor(lines, meta = {}) {
    if (!lines.length) throw new Error('empty log');
    this.lines = lines;
    this.meta = meta;
    this.times = lines.map((l) => l.sim_time_s);

    const end = lines.findLast?.((l) => l.type === 'episode_end') ?? [...lines].reverse().find((l) => l.type === 'episode_end');
    const first = lines[0];

    this.episodeId = first.episode_id;
    this.seed = first.seed;
    this.envVersion = first.env_version;
    this.scenarioId = first.scenario_id ?? end?.scenario_id ?? null;
    this.clockMode = end?.clock_mode ?? first.clock_mode ?? 'continuous';
    this.releasePolicy = end?.release_policy ?? first.release_policy ?? 'auto';
    this.specVersion = end?.spec_version ?? null;
    this.specs = end?.payload?.seats ?? {};
    this.utilities = end?.payload?.utilities ?? {};
    this.duration = this.times[this.times.length - 1];

    this.byType = {};
    for (const l of lines) (this.byType[l.type] ??= []).push(l);

    // Pair message_sent with message_delivered so a channel can show what is in
    // flight right now. A sent line with no delivered line was dropped.
    this.messages = new Map();
    for (const l of this.byType.message_sent ?? []) {
      this.messages.set(l.payload.message_id, {
        id: l.payload.message_id,
        from: l.payload.from ?? l.seat,
        to: l.payload.message.to,
        channel: l.payload.message.channel,
        text: l.payload.message.text,
        sent: l.sim_time_s,
        delivered: null,
        dropped: l.payload.dropped_reason ?? null,
      });
    }
    for (const l of this.byType.message_delivered ?? []) {
      const m = this.messages.get(l.payload.message_id);
      if (m) m.delivered = l.sim_time_s;
    }

    // Release cycle, keyed by release_id.
    this.releases = new Map();
    for (const l of this.byType.release_requested ?? []) {
      this.releases.set(l.payload.release_id, {
        id: l.payload.release_id,
        seat: l.seat,
        releasingSeat: l.payload.releasing_seat,
        action: l.payload.action,
        justification: l.payload.justification ?? '',
        decisionId: l.payload.decision_id ?? null,
        requestedAt: l.sim_time_s,
        answeredAt: null,
        granted: null,
        decidedBy: null,
        rationale: '',
      });
    }
    for (const l of [...(this.byType.release_granted ?? []), ...(this.byType.release_denied ?? [])]) {
      const r = this.releases.get(l.payload.release_id);
      if (!r) continue;
      r.answeredAt = l.sim_time_s;
      r.granted = l.type === 'release_granted';
      r.decidedBy = l.payload.decided_by;
      r.rationale = l.payload.rationale ?? '';
    }

    this.actions = [...(this.byType.action ?? []), ...(this.byType.human_action ?? [])].sort(
      (a, b) => a.sim_time_s - b.sim_time_s,
    );
    this.storm = this.byType.storm_update ?? [];
    this.injects = this.byType.inject ?? [];
    this.checkpoints = this.byType.checkpoint ?? [];
    this.reveal = (this.byType.attribution_revealed ?? [])[0] ?? null;

    this._snapshots = new Map();
  }

  get seatsPlayed() {
    const s = new Set(this.actions.map((a) => a.seat).filter(Boolean));
    return SEATS.filter((x) => s.has(x) || x in this.specs);
  }

  /** Number of events at or before t. Binary search on the ordering rule. */
  indexAt(t) {
    let lo = 0;
    let hi = this.times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.times[mid] <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  eventTimeBefore(t) {
    const i = this.indexAt(t);
    for (let j = i - 1; j >= 0; j--) if (this.times[j] < t) return this.times[j];
    return 0;
  }

  eventTimeAfter(t) {
    const i = this.indexAt(t);
    return i < this.times.length ? this.times[i] : this.duration;
  }

  /**
   * World as of sim time t. Memoised on the event index rather than on t, so
   * scrubbing between two events costs nothing.
   */
  snapshotAt(t) {
    const idx = this.indexAt(t);
    if (this._snapshots.has(idx)) return { ...this._snapshots.get(idx), t };

    const seats = {};
    for (const s of SEATS) {
      seats[s] = {
        seat: s,
        lastDecisionAt: null,
        lastLandedAt: null,
        beliefs: null,
        reasoning: null,
        action: null,
        blocked: false,
        decisions: 0,
      };
    }

    let storm = null;
    const ladderHits = [];
    const stateChanges = [];
    const seenInjects = [];

    for (let i = 0; i < idx; i++) {
      const l = this.lines[i];
      switch (l.type) {
        case 'storm_update':
          storm = { ...l.payload, at: l.sim_time_s };
          break;
        case 'inject':
          seenInjects.push(l);
          break;
        case 'state_change':
          stateChanges.push(l);
          break;
        case 'action':
        case 'human_action': {
          const s = seats[l.seat];
          if (!s) break;
          const p = l.payload;
          s.decisions += 1;
          s.lastLandedAt = l.sim_time_s;
          s.lastDecisionAt = p.decided_at_sim_time_s ?? l.sim_time_s;
          if (p.beliefs) s.beliefs = p.beliefs;
          if (p.reasoning) s.reasoning = p.reasoning;
          s.action = p.action;
          s.blocked = !!p.blocked;
          ladderHits.push({
            at: l.sim_time_s,
            seat: l.seat,
            type: p.action?.type ?? 'hold',
            blocked: !!p.blocked,
            human: l.type === 'human_action',
          });
          break;
        }
        default:
          break;
      }
    }

    // Decided but not yet landed: the deliberation delay, drawn as a progress bar.
    const inflight = [];
    for (const l of this.actions) {
      const decidedAt = l.payload.decided_at_sim_time_s ?? l.sim_time_s;
      if (decidedAt <= t && l.sim_time_s > t) {
        inflight.push({
          seat: l.seat,
          type: l.payload.action?.type ?? 'hold',
          from: decidedAt,
          to: l.sim_time_s,
          progress: (t - decidedAt) / Math.max(1, l.sim_time_s - decidedAt),
          kind: 'action',
        });
      }
    }
    for (const r of this.releases.values()) {
      if (r.requestedAt <= t && (r.answeredAt === null || r.answeredAt > t)) {
        const to = r.answeredAt ?? this.duration;
        inflight.push({
          seat: r.seat,
          type: r.action?.type ?? '?',
          from: r.requestedAt,
          to,
          progress: (t - r.requestedAt) / Math.max(1, to - r.requestedAt),
          kind: 'release',
          releaseId: r.id,
        });
      }
    }

    const inTransit = [];
    for (const m of this.messages.values()) {
      if (m.sent > t) continue;
      if (m.dropped) {
        if (t - m.sent < 900) inTransit.push({ ...m, progress: 1, lost: true });
        continue;
      }
      if (m.delivered === null || m.delivered > t) {
        const to = m.delivered ?? this.duration;
        inTransit.push({ ...m, progress: Math.min(1, (t - m.sent) / Math.max(1, to - m.sent)) });
      }
    }

    const pendingReleases = [...this.releases.values()].filter(
      (r) => r.requestedAt <= t && (r.answeredAt === null || r.answeredAt > t),
    );

    const snap = {
      idx,
      storm,
      seats,
      ladderHits,
      stateChanges,
      injects: seenInjects,
      inflight,
      inTransit,
      pendingReleases,
    };
    this._snapshots.set(idx, snap);
    return { ...snap, t };
  }

  /** What one seat could actually see at time t. Used by the human seat panel. */
  filteredView(seat, t) {
    const out = [];
    const idx = this.indexAt(t);
    for (let i = 0; i < idx; i++) {
      const l = this.lines[i];
      switch (l.type) {
        case 'inject':
          if ((l.payload.recipients ?? []).includes(seat)) out.push(l);
          break;
        case 'message_delivered': {
          const to = l.payload.message?.to;
          if (to === seat || to === 'all' || to === 'public') out.push(l);
          break;
        }
        case 'message_sent':
          if ((l.payload.from ?? l.seat) === seat) out.push(l);
          break;
        case 'storm_update':
          // The seat-visible storm is swpc's forecast, which may lag the truth;
          // until the engine emits that separately, show the update itself.
          out.push(l);
          break;
        case 'action':
        case 'human_action':
          if (l.seat === seat) out.push(l);
          break;
        case 'release_requested':
          if (l.payload.releasing_seat === seat || l.seat === seat) out.push(l);
          break;
        case 'release_granted':
        case 'release_denied': {
          const r = this.releases.get(l.payload.release_id);
          if (r && (r.seat === seat || r.releasingSeat === seat)) out.push(l);
          break;
        }
        case 'attribution_revealed':
          if ((l.payload.revealed_to ?? []).includes(seat)) out.push(l);
          break;
        default:
          break;
      }
    }
    return out;
  }

  /** Decisions per sim hour, for the tempo strip under the timeline. */
  tempo(bucketS = 3600) {
    const n = Math.max(1, Math.ceil(this.duration / bucketS));
    const total = new Array(n).fill(0);
    const bySeat = {};
    for (const s of SEATS) bySeat[s] = new Array(n).fill(0);
    for (const a of this.actions) {
      const decidedAt = a.payload.decided_at_sim_time_s ?? a.sim_time_s;
      const b = Math.min(n - 1, Math.floor(decidedAt / bucketS));
      total[b] += 1;
      if (bySeat[a.seat]) bySeat[a.seat][b] += 1;
    }
    return { bucketS, total, bySeat, peak: Math.max(1, ...total) };
  }

  /** Storm severity as a step function, for the overlay strip. */
  stormSteps() {
    return this.storm.map((l) => ({
      at: l.sim_time_s,
      severity: l.payload.severity,
      kp: l.payload.kp,
    }));
  }
}
