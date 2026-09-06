"""The event loop's three determinism rules, and pause/snapshot/fork."""

from __future__ import annotations

from engine.loop import EventLoop
from engine.rng import RngBook, derive_seed


def collector(loop: EventLoop, sink: list[tuple[int, object]]) -> None:
    loop.on("x", lambda e: sink.append((e.time_s, e.payload.get("i"))))


def test_events_fire_in_sim_time_order() -> None:
    loop = EventLoop(seed=1, end_time_s=10_000, tick_s=60)
    seen: list[tuple[int, object]] = []
    collector(loop, seen)
    for at, i in ((600, "c"), (120, "a"), (3000, "d"), (300, "b")):
        loop.schedule(at, "x", {"i": i})
    loop.run()
    assert [i for _, i in seen] == ["a", "b", "c", "d"]
    assert [t for t, _ in seen] == sorted(t for t, _ in seen)


def test_ties_break_by_insertion_order() -> None:
    """Required by event_log_schema: ties replay in queue insertion order."""
    loop = EventLoop(seed=1, end_time_s=10_000, tick_s=60)
    seen: list[tuple[int, object]] = []
    collector(loop, seen)
    for i in range(6):
        loop.schedule(600, "x", {"i": i})
    loop.run()
    assert [i for _, i in seen] == list(range(6))


def test_times_quantise_onto_the_tick_grid() -> None:
    loop = EventLoop(seed=1, end_time_s=10_000, tick_s=60)
    assert loop.quantise(0) == 0
    assert loop.quantise(59) == 60
    assert loop.quantise(89) == 60
    assert loop.quantise(91) == 120
    # Never schedules into the past.
    loop.sim_time_s = 600
    assert loop.quantise(120) == 600


def test_cancel_removes_the_event() -> None:
    loop = EventLoop(seed=1, end_time_s=10_000, tick_s=60)
    seen: list[tuple[int, object]] = []
    collector(loop, seen)
    loop.schedule(600, "x", {"i": "kept"})
    doomed = loop.schedule(300, "x", {"i": "cancelled"})
    loop.cancel(doomed)
    loop.run()
    assert [i for _, i in seen] == ["kept"]


def test_pause_stops_the_clock_and_resume_continues() -> None:
    loop = EventLoop(seed=1, end_time_s=10_000, tick_s=60)
    seen: list[tuple[int, object]] = []

    def handler(event: object) -> None:
        seen.append((event.time_s, event.payload.get("i")))  # type: ignore[attr-defined]
        if event.payload.get("i") == 1:  # type: ignore[attr-defined]
            loop.pause()

    loop.on("x", handler)
    for i in range(4):
        loop.schedule(600 * (i + 1), "x", {"i": i})
    loop.run()
    assert [i for _, i in seen] == [0, 1]
    assert loop.paused
    at_pause = loop.sim_time_s
    loop.resume()
    assert [i for _, i in seen] == [0, 1, 2, 3]
    assert loop.sim_time_s > at_pause


def test_snapshot_restores_queue_clock_and_rng() -> None:
    loop = EventLoop(seed=1, end_time_s=10_000, tick_s=60)
    seen: list[tuple[int, object]] = []
    collector(loop, seen)
    for i in range(5):
        loop.schedule(600 * (i + 1), "x", {"i": i})
    loop.run(until_s=1200)
    snap = loop.snapshot()
    first_draw = loop.rng.uniform("s")

    other = EventLoop(seed=99, end_time_s=1, tick_s=60)
    other_seen: list[tuple[int, object]] = []
    collector(other, other_seen)
    other.restore(snap)
    assert other.sim_time_s == loop.sim_time_s
    assert other.rng.uniform("s") == first_draw
    other.run()
    assert [i for _, i in other_seen] == [2, 3, 4]


def test_fork_branches_share_the_world_and_differ_only_in_rng() -> None:
    def build() -> EventLoop:
        fresh = EventLoop(seed=1, end_time_s=10_000, tick_s=60)
        fresh.rebuild = build
        return fresh

    loop = build()
    loop.schedule(600, "x", {"i": 0})
    loop.run(until_s=0)
    snap = loop.snapshot()

    branches = loop.fork(snap, seed=1234, n=3)
    assert len(branches) == 3
    assert {b.sim_time_s for b in branches} == {loop.sim_time_s}
    assert [len(b.pending()) for b in branches] == [1, 1, 1]
    draws = [b.rng.uniform("d") for b in branches]
    assert len(set(draws)) == 3, "branches must not share a random stream"

    again = loop.fork(snap, seed=1234, n=3)
    assert [b.rng.uniform("d") for b in again] == draws, "fork must be reproducible"


def test_named_rng_streams_are_independent_and_stable() -> None:
    a, b = RngBook(5), RngBook(5)
    assert [a.uniform("storm") for _ in range(3)] == [b.uniform("storm") for _ in range(3)]
    # Drawing from one stream must not move another.
    a.uniform("storm")
    assert a.uniform("attribution") == b.uniform("attribution")
    assert derive_seed(5, "storm") != derive_seed(5, "attribution")
