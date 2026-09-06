/**
 * The persona model contract, and the three things that can stand behind it.
 *
 *   NullModel    holds. What every seat runs on until the model is trained.
 *   HumanModel   the person at the console. Their orders arrive through the order box;
 *                this turns each into a Decision when the engine asks.
 *   RemoteModel  the trained model, over HTTP. This is the piece that is "ready when
 *                trained": construct it with the endpoint and the seat comes alive.
 *
 * Every implementation returns a Decision the engine then gates like any other order. A
 * model cannot do anything a human at that seat could not — the gate is the same.
 */

import type { ActionId, Decision, DecisionRequest, PersonaModel } from './types.ts';

const HOLD = (rationale: string): Decision => ({ action: 'hold', params: {}, rationale });

export class NullModel implements PersonaModel {
  async decide(): Promise<Decision> {
    return HOLD('no model attached to this seat');
  }
}

/**
 * Decisions come from outside, one per submit. If the engine asks before the human has
 * answered, the promise waits; if the human answers before the engine asks, the decision
 * queues. Either way nothing is lost and nothing is invented.
 */
export class HumanModel implements PersonaModel {
  private readonly queue: Decision[] = [];
  private readonly waiting: Array<(d: Decision) => void> = [];

  submit(d: Decision): void {
    const w = this.waiting.shift();
    if (w) w(d); else this.queue.push(d);
  }

  decide(): Promise<Decision> {
    const q = this.queue.shift();
    if (q) return Promise.resolve(q);
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  /** How many orders are typed in and not yet asked for. The UI can show it. */
  get pending(): number {
    return this.queue.length;
  }
}

export interface RemoteModelOptions {
  /** Milliseconds before a request is abandoned and the seat holds. Default 20 s. */
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * POSTs the DecisionRequest as JSON and expects a Decision back. Anything that is not a
 * well-formed Decision — a network failure, a timeout, a 500, an unknown action, a missing
 * params object — becomes `hold` with the failure in `rationale` and in `lastError`. The
 * simulation never stalls on the model, and the log says when the model was not the one
 * deciding.
 */
export class RemoteModel implements PersonaModel {
  lastError: string | null = null;
  private readonly url: string;
  private readonly actions: readonly ActionId[];
  private readonly opts: RemoteModelOptions;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  // Plain fields for the same reason as Storm: strip-only mode has no parameter properties.
  constructor(url: string, actions: readonly ActionId[], opts: RemoteModelOptions = {}) {
    this.url = url;
    this.actions = actions;
    this.opts = opts;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async decide(req: DecisionRequest): Promise<Decision> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.opts.headers ?? {}) },
        body: JSON.stringify(req),
        signal: ctl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body: unknown = await res.json();
      const d = this.validate(body);
      this.lastError = null;
      return d;
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      return HOLD(`model unavailable: ${this.lastError}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private validate(body: unknown): Decision {
    if (!body || typeof body !== 'object') throw new Error('decision is not an object');
    const d = body as Record<string, unknown>;
    if (typeof d['action'] !== 'string' || !this.actions.includes(d['action'] as ActionId)) {
      throw new Error(`unknown action "${String(d['action'])}"`);
    }
    const params = d['params'];
    if (params !== undefined && (params === null || typeof params !== 'object')) {
      throw new Error('params must be an object');
    }
    const p = (params ?? {}) as Record<string, unknown>;
    for (const k of ['asset_id', 'target_id']) {
      if (p[k] !== undefined && typeof p[k] !== 'string') throw new Error(`params.${k} must be a string`);
    }
    return {
      action: d['action'] as ActionId,
      params: {
        ...(typeof p['asset_id'] === 'string' ? { asset_id: p['asset_id'] } : {}),
        ...(typeof p['target_id'] === 'string' ? { target_id: p['target_id'] } : {}),
        ...(p['area'] && typeof p['area'] === 'object' ? { area: p['area'] as Decision['params']['area'] } : {}),
      },
      ...(typeof d['rationale'] === 'string' ? { rationale: d['rationale'] } : {}),
      ...(typeof d['text'] === 'string' ? { text: d['text'] } : {}),
    };
  }
}
