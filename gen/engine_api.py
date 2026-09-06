"""The seam between generation and the engine.

`engine/agent_api.py` is agent1-engine's deliverable (workstream item 10): the interface
a real agent implements — `observe()`, `act()`, `wake_policy`. It does not exist yet, so
this module defines the same shapes from `contracts/` and resolves the real one the
moment it lands on `main`.

**When agent1 publishes `agent_api` in its `interfaces_ready`, this file is the only one
that changes.** Everything downstream imports `SeatView`, `DecisionResult`, `WakePolicy`
and `SeatAgent` from here, not from `gen.mock_engine`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable

#: True once `engine.agent_api` is importable. `gen/run.py` prints it at startup so a
#: run is never silently a mock run.
USING_REAL_ENGINE = False

try:  # pragma: no cover - depends on another agent's merge
    from engine.agent_api import (  # type: ignore[attr-defined]  # noqa: F401
        DecisionResult,
        SeatAgent,
        SeatView,
        WakePolicy,
    )

    USING_REAL_ENGINE = True
except ImportError:

    @dataclass(frozen=True)
    class WakePolicy:
        """When this seat decides and how long its action takes to land.

        Straight off `spec_schema.json#/properties/decision_clock`. Under
        `clock_mode: checkpoint` the engine ignores `poll_minutes` and
        `wake_on_inject`; `deliberation_minutes` still applies.
        """

        poll_minutes: float
        wake_on_inject: bool
        deliberation_minutes: float

        @classmethod
        def from_spec(cls, spec: dict[str, Any]) -> WakePolicy:
            clock = spec["decision_clock"]
            return cls(
                poll_minutes=float(clock["poll_minutes"]),
                wake_on_inject=bool(clock["wake_on_inject"]),
                deliberation_minutes=float(clock["deliberation_minutes"]),
            )

    @dataclass
    class SeatView:
        """Exactly what one seat can see at one decision point.

        The three payload fields are the ones that become a lake record: they are
        copied onto it verbatim. `filtered_state` must contain nothing the seat could
        not know — `contracts/README.md` rule 4.
        """

        episode_id: str
        seat: str
        sim_time_s: float
        filtered_state: dict[str, Any]
        injects_seen: list[dict[str, Any]] = field(default_factory=list)
        messages_seen: list[dict[str, Any]] = field(default_factory=list)
        checkpoint_index: int | None = None

    @dataclass
    class DecisionResult:
        """What an agent hands back: the decision plus what it cost to produce."""

        decision: dict[str, Any]
        gen_model: str
        prompt_version: str
        schema_retries: int = 0
        #: Keys are exactly `lake_record_schema.json#/properties/tokens`:
        #: prompt, cached_prompt, completion. `prompt` is what train/filter.py's
        #: context-length check reads.
        tokens: dict[str, int] = field(default_factory=dict)
        #: Non-contract diagnostics, kept off the lake record.
        diagnostics: dict[str, Any] = field(default_factory=dict)

    @runtime_checkable
    class SeatAgent(Protocol):
        """What the engine drives at a decision point."""

        seat: str
        wake_policy: WakePolicy

        async def observe(self, view: SeatView) -> dict[str, Any]:
            """Return the filtered state this agent will actually reason from.

            The engine owns the shape; an agent may narrow it but never widen it.
            """
            ...

        async def act(self, view: SeatView) -> DecisionResult:
            """Produce one schema-valid decision for this decision point."""
            ...


__all__ = [
    "USING_REAL_ENGINE",
    "DecisionResult",
    "SeatAgent",
    "SeatView",
    "WakePolicy",
]
