"""Import `engine.agent_api` if agent1-engine has published it; otherwise mock it.

`docs/COORDINATION.md` §3: an agent idle on a dependency is the one failure mode
the protocol exists to prevent. The interface is fixed by the workstream brief —
`observe() -> filtered_state`, `act(decision_json)`, `wake_policy` — so a local
Protocol with that shape is enough to build and test the served client against.

When `engine/agent_api.py` lands on `main`, `Agent` below resolves to the real
class and this shim becomes a no-op import. Nothing else in `train/` imports
`engine` directly, so the swap is one file.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

USING_REAL_ENGINE = False


@runtime_checkable
class AgentProtocol(Protocol):
    """What a seat-playing agent must implement for the engine to drive it."""

    def observe(self) -> dict[str, Any]:
        """The seat's filtered state at this decision point."""
        ...

    def act(self, decision_json: dict[str, Any]) -> None:
        """Submit one schema-valid decision to the engine."""
        ...

    @property
    def wake_policy(self) -> dict[str, Any]:
        """When this seat next wants control: poll interval and inject wake rules."""
        ...


try:  # pragma: no cover - depends on which agents have merged
    from engine.agent_api import Agent  # type: ignore[attr-defined]

    USING_REAL_ENGINE = True
except (ImportError, AttributeError):  # pragma: no cover

    class Agent:  # type: ignore[no-redef]
        """Mock stand-in for `engine.agent_api.Agent` until agent1-engine merges.

        Holds the seat's state and records decisions; the engine will replace
        both halves. `train/serve.py` subclasses this, so the subclass keeps
        working when the real base class arrives.
        """

        def __init__(self, seat: str, spec: dict[str, Any] | None = None) -> None:
            self.seat = seat
            self.spec = spec or {}
            self._state: dict[str, Any] = {}
            self.decisions: list[dict[str, Any]] = []

        def observe(self) -> dict[str, Any]:
            return self._state

        def act(self, decision_json: dict[str, Any]) -> None:
            self.decisions.append(decision_json)

        @property
        def wake_policy(self) -> dict[str, Any]:
            return {"poll_interval_s": 3600, "wake_on_inject": True}


__all__ = ["Agent", "AgentProtocol", "USING_REAL_ENGINE"]
