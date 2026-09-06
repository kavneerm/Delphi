"""Deterministic RNG streams.

One master seed per episode, and every draw in the episode comes from a named
stream derived from it. Named streams matter: if the storm and the attribution
lags shared a generator, adding one storm draw would shift every later
attribution lag and quietly break every comparison across a sweep cell.

The derivation is `blake2b(f"{seed}:{stream}")`, which is stable across
processes, platforms and Python versions — unlike `hash()`.
"""

from __future__ import annotations

import hashlib
import math
import random
from typing import Any

__all__ = ["RngBook", "derive_seed"]


def derive_seed(master_seed: int, stream: str) -> int:
    digest = hashlib.blake2b(f"{master_seed}:{stream}".encode(), digest_size=8).digest()
    return int.from_bytes(digest, "big")


class RngBook:
    """A book of named, independently seeded generators.

    `book("storm")` always returns the same generator for the same name, so a
    caller can hold a reference or look it up per draw without changing the
    sequence. `snapshot()`/`restore()` round-trip the whole book, which is what
    `EventLoop.snapshot()` and `fork()` are built on.
    """

    def __init__(self, master_seed: int) -> None:
        self.master_seed = int(master_seed)
        self._streams: dict[str, random.Random] = {}

    def book(self, stream: str) -> random.Random:
        rng = self._streams.get(stream)
        if rng is None:
            rng = random.Random(derive_seed(self.master_seed, stream))
            self._streams[stream] = rng
        return rng

    # --- convenience draws, all routed through a named stream ----------------

    def uniform(self, stream: str, low: float = 0.0, high: float = 1.0) -> float:
        return self.book(stream).uniform(low, high)

    def chance(self, stream: str, p: float) -> bool:
        return self.book(stream).random() < p

    def choice(self, stream: str, items: list[Any]) -> Any:
        return self.book(stream).choice(items)

    def weighted_choice(self, stream: str, weights: dict[str, float]) -> str:
        """Pick a key with probability proportional to its weight.

        Keys are sorted before drawing so the result never depends on dict
        insertion order.
        """
        keys = sorted(weights)
        total = sum(max(0.0, float(weights[k])) for k in keys)
        if total <= 0:
            return keys[0]
        x = self.book(stream).random() * total
        acc = 0.0
        for k in keys:
            acc += max(0.0, float(weights[k]))
            if x < acc:
                return k
        return keys[-1]

    def lognormal(self, stream: str, mu: float, sigma: float) -> float:
        return self.book(stream).lognormvariate(mu, sigma)

    def poisson(self, stream: str, lam: float) -> int:
        """Knuth's algorithm — small lambdas only, which is all we draw."""
        if lam <= 0:
            return 0
        rng = self.book(stream)
        limit = math.exp(-lam)
        k, p = 0, 1.0
        while True:
            p *= rng.random()
            if p <= limit:
                return k
            k += 1
            if k > 1000:  # pragma: no cover — guard, not a code path
                return k

    # --- persistence ---------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        return {
            "master_seed": self.master_seed,
            "streams": {name: rng.getstate() for name, rng in sorted(self._streams.items())},
        }

    def restore(self, snap: dict[str, Any]) -> None:
        self.master_seed = int(snap["master_seed"])
        self._streams = {}
        for name, state in snap["streams"].items():
            rng = random.Random()
            rng.setstate(_as_state(state))
            self._streams[name] = rng


def _as_state(state: Any) -> tuple[Any, ...]:
    """`getstate()` round-tripped through JSON comes back as nested lists."""
    version, internal, gauss = state
    return (int(version), tuple(int(x) for x in internal), gauss)
