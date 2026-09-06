"""The human seat.

An `agent_api` agent whose `act()` blocks on something outside the simulation —
a person at a UI — and whose `observe()` returns that seat's filtered view. It
occupies `nsc` by default, which `contracts/seats.md` makes the human-playable
seat: escalation authority, release authority, the only Blue seat that can take
an irreversible action, and the slowest clock on the board, so a person
deliberating does not stall anything.

Blocking is safe because the engine is single-threaded and the clock is sim
time, not wall time. While `act()` waits, no event is dispatched and `sim_time_s`
does not move, so a person taking four minutes and a person taking four seconds
produce the same episode. That is what makes a human-played run replayable, and
it is why `release_policy: human` sets `pause_clock: true` by default.

Wiring a UI to it:

    channel = ExternalDecisionChannel()
    agent = HumanAgent("nsc", spec, channel, operator_label="operator-1")
    # ... in the UI thread, when the person submits:
    channel.submit_decision(decision_dict)
    channel.submit_release(release_id, granted=True, rationale="...")

`ScriptedChannel` is the same interface with the answers known in advance, which
is what the tests and a scripted demo use.
"""

from __future__ import annotations

import queue
import threading
from collections.abc import Callable, Mapping
from typing import Any

from engine.agent_api import BaseAgent, hold_decision

__all__ = ["ExternalDecisionChannel", "HumanAgent", "ScriptedChannel"]


class ExternalDecisionChannel:
    """A blocking hand-off between the engine and whatever the person is using.

    The engine calls `request_decision()` and waits; the UI calls
    `submit_decision()` and the wait ends. `timeout_s` is real seconds and is the
    only place wall time enters the engine at all — it exists so a demo cannot
    hang forever, and what happens on timeout is `on_timeout` in
    `contracts/env_config_schema.json`.
    """

    def __init__(self) -> None:
        self._decisions: queue.Queue[Mapping[str, Any]] = queue.Queue()
        self._releases: queue.Queue[tuple[str, bool, str]] = queue.Queue()
        self._prompt_hook: Callable[[str, Mapping[str, Any]], None] | None = None
        self._pending_prompt: dict[str, Any] | None = None
        self._lock = threading.Lock()

    # --- the UI side ---------------------------------------------------------

    def on_prompt(self, hook: Callable[[str, Mapping[str, Any]], None]) -> None:
        """Called when the engine starts waiting. Draw the screen here."""
        self._prompt_hook = hook

    def submit_decision(self, decision: Mapping[str, Any]) -> None:
        self._decisions.put(dict(decision))

    def submit_release(self, release_id: str, *, granted: bool, rationale: str = "") -> None:
        self._releases.put((str(release_id), bool(granted), str(rationale)))

    def pending_prompt(self) -> dict[str, Any] | None:
        """What the engine is currently waiting for, for the UI to render."""
        with self._lock:
            return dict(self._pending_prompt) if self._pending_prompt else None

    # --- the engine side -----------------------------------------------------

    def _announce(self, kind: str, context: Mapping[str, Any]) -> None:
        with self._lock:
            self._pending_prompt = {"kind": kind, "context": dict(context)}
        if self._prompt_hook is not None:
            self._prompt_hook(kind, context)

    def _clear(self) -> None:
        with self._lock:
            self._pending_prompt = None

    def request_decision(
        self, view: Mapping[str, Any], timeout_s: float | None = None
    ) -> Mapping[str, Any] | None:
        self._announce("decision", view)
        try:
            return self._decisions.get(timeout=timeout_s)
        except queue.Empty:
            return None
        finally:
            self._clear()

    def request_release(
        self, request: Mapping[str, Any], view: Mapping[str, Any], timeout_s: float | None = None
    ) -> tuple[bool, str] | None:
        self._announce("release", {"request": dict(request), "view": dict(view)})
        try:
            while True:
                try:
                    release_id, granted, rationale = self._releases.get(timeout=timeout_s)
                except queue.Empty:
                    return None
                if release_id == str(request.get("release_id")):
                    return granted, rationale
                # An answer to a stale request: drop it and keep waiting.
        finally:
            self._clear()


class ScriptedChannel(ExternalDecisionChannel):
    """The same interface with the answers already known.

    Used by the tests and by a scripted demo. It never blocks, so a scripted
    human-played episode runs at full speed and still exercises every human code
    path — including the `human_action` log lines and the clock pause.
    """

    def __init__(
        self,
        decisions: list[Mapping[str, Any]] | None = None,
        releases: list[bool] | None = None,
        *,
        default_release: bool = False,
    ) -> None:
        super().__init__()
        self.scripted_decisions = list(decisions or [])
        self.scripted_releases = list(releases or [])
        self.default_release = default_release
        self.decision_index = 0
        self.release_index = 0

    def request_decision(
        self, view: Mapping[str, Any], timeout_s: float | None = None
    ) -> Mapping[str, Any] | None:
        if self.decision_index < len(self.scripted_decisions):
            decision = self.scripted_decisions[self.decision_index]
            self.decision_index += 1
            return decision
        return hold_decision("Scripted operator: no further instructions, holding.")

    def request_release(
        self, request: Mapping[str, Any], view: Mapping[str, Any], timeout_s: float | None = None
    ) -> tuple[bool, str] | None:
        if self.release_index < len(self.scripted_releases):
            granted = self.scripted_releases[self.release_index]
            self.release_index += 1
        else:
            granted = self.default_release
        action_type = str((request.get("action") or {}).get("type", "the action"))
        return granted, (
            f"Scripted operator {'releases' if granted else 'withholds release for'} {action_type}."
        )


class HumanAgent(BaseAgent):
    """A person at a seat. Default seat `nsc`."""

    #: The engine reads this to decide whether to log `human_action` and whether
    #: a release was `decided_by` a human or a model.
    is_human = True

    def __init__(
        self,
        seat: str,
        spec: Mapping[str, Any],
        channel: ExternalDecisionChannel | None = None,
        *,
        operator_label: str = "operator",
        timeout_s: float | None = None,
        on_timeout: str = "deny",
        fallback: Any = None,
    ) -> None:
        super().__init__(seat, spec)
        self.channel = channel if channel is not None else ExternalDecisionChannel()
        #: Opaque. Never a real name, an email address or anything identifying.
        self.operator_label = operator_label
        self.timeout_s = timeout_s
        self.on_timeout = on_timeout
        #: The model persona that takes over under `on_timeout: model`.
        self.fallback = fallback
        self.last_view: Mapping[str, Any] | None = None

    def observe(self) -> Mapping[str, Any]:
        """This seat's filtered view, pulled live. The UI calls this to redraw."""
        view = super().observe()
        self.last_view = view
        return view

    def act(self, view: Mapping[str, Any]) -> Mapping[str, Any]:
        """Block until the person decides.

        Sim time does not advance while this waits — the engine is
        single-threaded and the clock is the event queue, not the wall.
        """
        self.last_view = view
        decision = self.channel.request_decision(view, self.timeout_s)
        if decision is not None:
            return decision
        return self._timeout_decision(view)

    def _timeout_decision(self, view: Mapping[str, Any]) -> Mapping[str, Any]:
        if self.on_timeout == "model" and self.fallback is not None:
            return self.fallback.act(view)
        return hold_decision(
            f"No operator input within {self.timeout_s}s; holding. "
            "Silence is not an instruction to act."
        )

    def decide_release(
        self, request: Mapping[str, Any], view: Mapping[str, Any]
    ) -> tuple[bool, str]:
        """Answer a release request. The clock is already paused by the engine."""
        answer = self.channel.request_release(request, view, self.timeout_s)
        if answer is not None:
            return answer
        if self.on_timeout == "grant":
            return True, "Timed out; configuration grants on timeout."
        if self.on_timeout == "model" and self.fallback is not None:
            return self.fallback.decide_release(request, view)
        return False, "Timed out with no operator answer. Silence is not consent."
