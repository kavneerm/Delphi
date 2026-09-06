"""The event loop.

Single-threaded, keyed on sim time, and the only thing in the engine that
decides what happens next. Three rules make replay exact:

1. **Sim time is an integer number of seconds**, quantised onto `tick_s`. No
   float accumulates, so no ordering ever depends on rounding.
2. **Ties break by (priority, insertion order)**, never by dict or set
   iteration. `contracts/event_log_schema.json` requires exactly this: lines in
   non-decreasing `sim_time_s`, ties in the priority queue's insertion order.
3. **Events carry data, not closures.** A scheduled event is a `kind` string
   plus a JSON-able payload, dispatched to a handler registered by name. That is
   what lets `snapshot()` capture a queue mid-episode and `fork()` rebuild it.

Wall-clock pacing (`realtime_factor`) exists for the demo and touches nothing
but `wall_time`, which replay excludes by contract.
"""

from __future__ import annotations

import heapq
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Protocol

from engine.rng import RngBook, derive_seed

__all__ = ["Event", "EventLoop", "PRIORITY", "Simulation"]

#: Ordering among events that land on the same sim second. Lower goes first.
#: The storm moves the world, then information arrives, then seats decide, then
#: what they decided lands, then the episode can end.
PRIORITY: dict[str, int] = {
    "storm_update": 10,
    "propagate": 15,
    "attack_effect": 20,
    "attack_expire": 21,
    "attribution_expire": 22,
    "inject": 30,
    "rule_actor": 31,
    "message_delivery": 40,
    "release_resolve": 45,
    "checkpoint": 50,
    "decision_point": 55,
    "action_effect": 60,
    "episode_end": 90,
}
DEFAULT_PRIORITY = 70


class Simulation(Protocol):
    """Whatever the loop is driving. Must round-trip through plain data."""

    def snapshot(self) -> dict[str, Any]: ...

    def restore(self, snap: dict[str, Any]) -> None: ...


@dataclass(frozen=True)
class Event:
    time_s: int
    priority: int
    seq: int
    kind: str
    payload: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return {
            "time_s": self.time_s,
            "priority": self.priority,
            "seq": self.seq,
            "kind": self.kind,
            "payload": self.payload,
        }

    @staticmethod
    def from_dict(data: dict[str, Any]) -> Event:
        return Event(
            time_s=int(data["time_s"]),
            priority=int(data["priority"]),
            seq=int(data["seq"]),
            kind=str(data["kind"]),
            payload=dict(data["payload"]),
        )


class EventLoop:
    """Priority queue over sim time, with pause, snapshot and fork."""

    def __init__(
        self,
        *,
        seed: int,
        end_time_s: int,
        tick_s: int = 60,
        rng: RngBook | None = None,
    ) -> None:
        self.seed = int(seed)
        self.end_time_s = int(end_time_s)
        self.tick_s = max(1, int(tick_s))
        self.rng = rng if rng is not None else RngBook(self.seed)
        self.sim_time_s: int = 0
        self.paused: bool = False
        self.stopped: bool = False
        #: Real seconds per sim second while running. 0 disables pacing, which
        #: is the headless case and the only one that finishes 72 hours fast.
        self.realtime_factor: float = 0.0

        self._queue: list[tuple[int, int, int]] = []
        self._events: dict[int, Event] = {}
        self._cancelled: set[int] = set()
        self._seq: int = 0
        self._handlers: dict[str, Callable[[Event], None]] = {}

        #: The simulation this loop drives; set by `Episode`.
        self.state: Simulation | None = None
        #: Builds a fresh, fully wired loop for `fork()` to restore into.
        self.rebuild: Callable[[], EventLoop] | None = None

    # --- scheduling ----------------------------------------------------------

    def quantise(self, time_s: float) -> int:
        """Snap a time onto the tick grid, never earlier than now."""
        ticks = int(round(float(time_s) / self.tick_s))
        return max(int(self.sim_time_s), ticks * self.tick_s)

    def schedule(
        self,
        time_s: float,
        kind: str,
        payload: dict[str, Any] | None = None,
        *,
        priority: int | None = None,
        quantise: bool = True,
    ) -> int:
        at = self.quantise(time_s) if quantise else max(int(self.sim_time_s), int(time_s))
        prio = PRIORITY.get(kind, DEFAULT_PRIORITY) if priority is None else int(priority)
        self._seq += 1
        event = Event(time_s=at, priority=prio, seq=self._seq, kind=kind, payload=payload or {})
        self._events[event.seq] = event
        heapq.heappush(self._queue, (at, prio, event.seq))
        return event.seq

    def after(self, delay_s: float, kind: str, payload: dict[str, Any] | None = None) -> int:
        return self.schedule(self.sim_time_s + max(0.0, float(delay_s)), kind, payload)

    def cancel(self, event_id: int) -> None:
        if event_id in self._events:
            self._cancelled.add(event_id)

    def on(self, kind: str, handler: Callable[[Event], None]) -> None:
        self._handlers[kind] = handler

    def pending(self, kind: str | None = None) -> list[Event]:
        events = [
            self._events[seq]
            for (_, _, seq) in self._queue
            if seq not in self._cancelled and seq in self._events
        ]
        if kind is not None:
            events = [e for e in events if e.kind == kind]
            return sorted(events, key=lambda e: (e.time_s, e.priority, e.seq))
        return sorted(events, key=lambda e: (e.time_s, e.priority, e.seq))

    def next_time(self) -> int | None:
        while self._queue and self._queue[0][2] in self._cancelled:
            _, _, seq = heapq.heappop(self._queue)
            self._cancelled.discard(seq)
            self._events.pop(seq, None)
        return self._queue[0][0] if self._queue else None

    # --- running -------------------------------------------------------------

    def step(self) -> Event | None:
        """Pop and dispatch exactly one event. Returns it, or None if drained."""
        while True:
            if not self._queue:
                return None
            at, prio, seq = heapq.heappop(self._queue)
            if seq in self._cancelled:
                self._cancelled.discard(seq)
                self._events.pop(seq, None)
                continue
            event = self._events.pop(seq)
            break

        if at > self.end_time_s and event.kind != "episode_end":
            # Past the horizon: drop it rather than let it move the clock.
            return event
        self._pace(at)
        self.sim_time_s = at
        handler = self._handlers.get(event.kind)
        if handler is not None:
            handler(event)
        return event

    def run(self, until_s: int | None = None) -> None:
        """Drain the queue up to `until_s`, or to the episode horizon."""
        horizon = self.end_time_s if until_s is None else int(until_s)
        while not self.stopped:
            if self.paused:
                break
            nxt = self.next_time()
            if nxt is None or nxt > horizon:
                break
            if self.step() is None:
                break

    def stop(self) -> None:
        self.stopped = True

    # --- pause / resume ------------------------------------------------------

    def pause(self) -> None:
        """Stop advancing sim time. Nothing is lost: the queue is untouched."""
        self.paused = True

    def resume(self, until_s: int | None = None) -> None:
        self.paused = False
        self.run(until_s)

    def _pace(self, to_time_s: int) -> None:
        if self.realtime_factor > 0 and to_time_s > self.sim_time_s:
            time.sleep((to_time_s - self.sim_time_s) * self.realtime_factor)

    # --- snapshot / restore / fork ------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        """A complete, JSON-able picture of the run at this instant."""
        return {
            "seed": self.seed,
            "sim_time_s": self.sim_time_s,
            "end_time_s": self.end_time_s,
            "tick_s": self.tick_s,
            "paused": self.paused,
            "seq": self._seq,
            "queue": [e.as_dict() for e in self.pending()],
            "rng": self.rng.snapshot(),
            "state": self.state.snapshot() if self.state is not None else None,
        }

    def restore(self, snap: dict[str, Any]) -> None:
        self.seed = int(snap["seed"])
        self.sim_time_s = int(snap["sim_time_s"])
        self.end_time_s = int(snap["end_time_s"])
        self.tick_s = int(snap["tick_s"])
        self.paused = bool(snap["paused"])
        self._seq = int(snap["seq"])
        self._queue = []
        self._events = {}
        self._cancelled = set()
        for data in snap["queue"]:
            event = Event.from_dict(data)
            self._events[event.seq] = event
            heapq.heappush(self._queue, (event.time_s, event.priority, event.seq))
        self.rng.restore(snap["rng"])
        if self.state is not None and snap.get("state") is not None:
            self.state.restore(snap["state"])

    def fork(self, snapshot: dict[str, Any], seed: int, n: int) -> list[EventLoop]:
        """Branch `n` futures from one snapshot, each on its own seed.

        The world, the queue and the clock are identical in every branch; only
        the RNG differs, so a fork isolates "what else could have happened from
        here" from "what else could have been set up". Branch `i` is seeded
        `blake2b(seed:fork:i)`, so the same (snapshot, seed, n) always yields the
        same `n` futures.
        """
        if self.rebuild is None:
            raise RuntimeError("EventLoop.fork needs a rebuild factory; Episode sets one")
        branches: list[EventLoop] = []
        for i in range(int(n)):
            loop = self.rebuild()
            loop.restore(snapshot)
            branch_seed = derive_seed(int(seed), f"fork:{i}")
            loop.seed = branch_seed
            loop.rng = RngBook(branch_seed)
            loop.paused = False
            branches.append(loop)
        return branches
