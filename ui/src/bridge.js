// The console's only live path. Everything else in ui/ reads a finished log off
// disk; this talks to a running engine over a local websocket so a person can sit
// at a seat and answer release requests.
//
// Wire format is ui/server/PROTOCOL.md. If agent1-engine prefers a different
// shape, this file is the whole adapter.

const DEFAULT_URL = 'ws://127.0.0.1:8778';

export class EngineBridge extends EventTarget {
  constructor(url = DEFAULT_URL) {
    super();
    this.url = url;
    this.ws = null;
    this.status = 'offline';
    this.info = null;
    this._retry = null;
    this._pendingForks = new Map();
  }

  connect(seat = 'nsc') {
    this.seat = seat;
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    this._set('connecting');
    let ws;
    try {
      ws = new WebSocket(this.url);
    } catch (e) {
      this._set('offline', String(e.message ?? e));
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this._set('live');
      this.send({ op: 'hello', seat: this.seat });
      this.send({ op: 'subscribe' });
    };
    ws.onclose = () => {
      this._set('offline');
      // The engine going away mid-demo should not take the console with it, but
      // reconnecting forever behind a firewall is just noise -- back off.
      if (!this._retry) {
        this._retry = setTimeout(() => {
          this._retry = null;
          if (this.status === 'offline' && this.wanted) this.connect(this.seat);
        }, 4000);
      }
    };
    ws.onerror = () => this._set('offline', 'websocket error');
    ws.onmessage = (m) => {
      let msg;
      try {
        msg = JSON.parse(m.data);
      } catch {
        return;
      }
      if (msg.ev === 'hello') this.info = msg;
      if (msg.ev === 'fork_result') {
        const resolve = this._pendingForks.get(msg.release_id);
        if (resolve) {
          this._pendingForks.delete(msg.release_id);
          resolve(msg);
        }
      }
      this.dispatchEvent(new CustomEvent(msg.ev, { detail: msg }));
      this.dispatchEvent(new CustomEvent('*', { detail: msg }));
    };
    this.wanted = true;
  }

  disconnect() {
    this.wanted = false;
    clearTimeout(this._retry);
    this._retry = null;
    this.ws?.close();
    this.ws = null;
    this._set('offline');
  }

  get live() {
    return this.status === 'live' && this.ws?.readyState === 1;
  }

  send(obj) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  answerRelease(releaseId, decision, { holdMinutes = 0, rationale = '' } = {}) {
    this.send({ op: 'answer_release', release_id: releaseId, decision, hold_minutes: holdMinutes, rationale });
  }

  submitAction(action, beliefs, reasoning) {
    this.send({ op: 'submit_action', action, beliefs, reasoning });
  }

  /**
   * fork(snapshot, n) per option. Resolves with the counts the engine measured;
   * rejects if the engine does not answer, because a fork panel showing numbers
   * it made up would be worse than a fork panel showing nothing.
   */
  fork(releaseId, options, n = 50, horizonHours = 24) {
    if (!this.live) return Promise.reject(new Error('engine bridge is not connected'));
    return new Promise((resolve, reject) => {
      this._pendingForks.set(releaseId, resolve);
      this.send({ op: 'fork', release_id: releaseId, options, n, horizon_hours: horizonHours });
      setTimeout(() => {
        if (this._pendingForks.has(releaseId)) {
          this._pendingForks.delete(releaseId);
          reject(new Error(`engine did not return a fork within 90s (n=${n})`));
        }
      }, 90000);
    });
  }

  _set(status, detail = '') {
    this.status = status;
    this.dispatchEvent(new CustomEvent('status', { detail: { status, detail } }));
  }
}
