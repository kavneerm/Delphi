"""The seat agent: `engine.agent_api.BaseAgent` backed by the OpenAI Responses API.

**The bridge.** `Agent.act(view)` is synchronous and `Episode.run()` is synchronous, but
generation is async at concurrency 64. So an episode runs in a worker thread and `act()`
hands its coroutine back to the one event loop on the main thread with
`run_coroutine_threadsafe(...).result()`. The thread blocks; the loop does not. Sixty-four
episodes therefore hold sixty-four blocked threads and multiplex their API calls through
one semaphore, which is what "64 in flight" is supposed to mean — 64 requests, not 64
requests per episode.

Nothing here decides anything about the episode. The engine owns time, release,
delivery and effects; this class turns one filtered view into one decision and records
what that cost.

**Failure is a `hold`, not a crash.** `engine.agent_api.coerce_decision` already turns an
invalid decision into a logged hold, and `hold_decision()` is used here for the same
reason after every schema retry is spent: one bad decision point should cost one decision
point, never the episode, and never the sweep cell. The failure is visible afterwards
because `schema_retries` is on the lake record and `train/gates.py` reads the
schema-validity rate off it.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from collections.abc import Callable, Mapping
from concurrent.futures import Future
from dataclasses import dataclass, field
from typing import Any

from engine.agent_api import BaseAgent, hold_decision
from gen.config import GenConfig
from gen.llm import LLMClient, SchemaFailure
from gen.prompt import LeakageError
from gen.prompt import build as build_prompt
from gen.version import PROMPT_VERSION

log = logging.getLogger("gen.agent")


@dataclass
class DecisionTelemetry:
    """What one decision cost. Joined onto the lake record by `gen/lake.py`."""

    decision_index: int
    seat: str
    sim_time_s: float
    tokens: dict[str, int] = field(default_factory=dict)
    schema_retries: int = 0
    transport_retries: int = 0
    latency_s: float = 0.0
    gen_model: str = ""
    prompt_version: str = PROMPT_VERSION
    prompt_chars: int = 0
    failed: bool = False
    failure: str = ""
    view_hash: str = ""
    synthetic_hold: bool = False


class GenAgent(BaseAgent):
    """One seat, played by the frontier model.

    Deliberately stateful in exactly one respect: `last_beliefs`. The engine does not
    carry a seat's previous belief across decision points, and a persona that cannot see
    what it believed an hour ago cannot update — it re-derives from priors every time and
    the belief trajectory `eval/replay_table.py` measures comes out as noise. So the
    agent keeps its own last emitted beliefs and the prompt shows them back.
    """

    def __init__(
        self,
        seat: str,
        spec: Mapping[str, Any],
        *,
        config: GenConfig,
        client: LLMClient,
        loop: asyncio.AbstractEventLoop,
        episode_id: str,
        checkpoint_index: Any = None,
        record_sink: Callable[[DecisionTelemetry, Mapping[str, Any], Mapping[str, Any]], None]
        | None = None,
    ) -> None:
        super().__init__(seat, spec)
        self.config = config
        self.client = client
        self.loop = loop
        self.episode_id = episode_id
        #: Callable or None; the engine's checkpoint counter, read at decision time.
        self._checkpoint_index = checkpoint_index
        self.last_beliefs: dict[str, Any] | None = None
        self.last_view_hash: str | None = None
        self.telemetry: list[DecisionTelemetry] = []
        self._record_sink = record_sink

    # -- the bridge ---------------------------------------------------------

    def _run(self, coro: Any) -> Any:
        """Run a coroutine on the shared loop from this worker thread."""
        future: Future[Any] = asyncio.run_coroutine_threadsafe(coro, self.loop)
        return future.result()

    # -- the interface ------------------------------------------------------

    @staticmethod
    def _view_hash(view: Mapping[str, Any]) -> str:
        """Hash material the seat can act on, excluding clock-only motion.

        Sim time, time remaining, next-poll bookkeeping and deterministic ground
        track propagation change on every tick without delivering any new
        information. Keeping them would make an "unchanged view" optimisation
        a no-op. All feeds, injects, messages, effects and degradation remain.
        """
        payload = json.loads(json.dumps(view, sort_keys=True, default=str))
        clock = payload.get("clock")
        if isinstance(clock, dict):
            for key in ("sim_time_s", "sim_hours_elapsed", "hours_remaining", "next_poll_s"):
                clock.pop(key, None)
        for asset in payload.get("own_assets", []):
            if isinstance(asset, dict):
                asset.pop("ground_track", None)
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()

    def _emit(
        self, telemetry: DecisionTelemetry, view: Mapping[str, Any], decision: Mapping[str, Any]
    ) -> None:
        self.telemetry.append(telemetry)
        if self._record_sink is not None:
            self._record_sink(telemetry, view, decision)

    def act(self, view: Mapping[str, Any]) -> dict[str, Any]:
        index = len(self.telemetry)
        clock = view.get("clock") or {}
        sim_time_s = float(clock.get("sim_time_s", 0.0))
        checkpoint = self._checkpoint_index() if callable(self._checkpoint_index) else None
        view_hash = self._view_hash(view)

        telemetry = DecisionTelemetry(
            decision_index=index,
            seat=self.seat,
            sim_time_s=sim_time_s,
            view_hash=view_hash,
        )
        if view_hash == self.last_view_hash:
            telemetry.synthetic_hold = True
            telemetry.gen_model = self.client.model
            decision = hold_decision("No material change in the filtered view; holding.")
            self._emit(telemetry, view, decision)
            return decision

        try:
            prompt = build_prompt(
                self.config,
                view,
                dict(self.spec),
                episode_id=self.episode_id,
                last_beliefs=self.last_beliefs,
                checkpoint_index=checkpoint,
            )
        except LeakageError:
            # Never paper over a leak: a poisoned filtered_state is worth failing the
            # episode for, because it is invisible once it is in the lake.
            raise

        telemetry.prompt_chars = len(prompt.text)
        telemetry.prompt_version = prompt.prompt_version

        try:
            completion = self._run(self.client.complete_decision(prompt))
        except SchemaFailure as failure:
            telemetry.failed = True
            telemetry.failure = str(failure)
            telemetry.schema_retries = failure.attempts
            telemetry.gen_model = self.client.model
            decision = hold_decision(
                "The staff work did not come back in a usable form in the time available. "
                "Holding until the next update."
            )
            self._emit(telemetry, view, decision)
            log.warning(
                "%s/%s at T+%.2fh: %s; holding",
                self.episode_id,
                self.seat,
                sim_time_s / 3600.0,
                failure,
            )
            return decision
        except Exception as error:  # noqa: BLE001 - one decision point, not the episode
            telemetry.failed = True
            telemetry.failure = f"{type(error).__name__}: {error}"
            telemetry.gen_model = self.client.model
            decision = hold_decision("No staff input available this cycle. Holding.")
            self._emit(telemetry, view, decision)
            log.warning(
                "%s/%s at T+%.2fh: %s; holding",
                self.episode_id,
                self.seat,
                sim_time_s / 3600.0,
                telemetry.failure,
            )
            return decision

        telemetry.tokens = completion.tokens()
        telemetry.schema_retries = completion.schema_retries
        telemetry.transport_retries = completion.transport_retries
        telemetry.latency_s = completion.latency_s
        telemetry.gen_model = completion.model
        self.last_view_hash = view_hash

        decision = completion.payload
        beliefs = decision.get("beliefs")
        if isinstance(beliefs, dict):
            self.last_beliefs = beliefs
        self._emit(telemetry, view, decision)
        return decision

    def decide_release(
        self, request: Mapping[str, Any], view: Mapping[str, Any]
    ) -> tuple[bool, str]:
        """Not used during generation.

        The lake runs under `release_policy: auto`, where `engine/episode.py` resolves
        every request from the episode seed rather than asking the releasing seat. The
        NSC seat is still played by a persona — it takes its own actions — it simply is
        not the adjudicator in this mode. Falling through to `BaseAgent`'s deny keeps the
        behaviour identical to a stub if a human-policy episode ever reaches here.
        """
        return super().decide_release(request, view)
