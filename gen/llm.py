"""The OpenAI Responses client: structured outputs, schema retry, backoff, concurrency.

Three things this module is responsible for and nothing else is:

1. **Structured outputs against a strict schema.** `gen.contracts.strict_decision_schema`
   is the wire format; the *contract* is `action_schema.json#/$defs/decision`. Strict
   mode guarantees the shape, not the semantics, so every completion is denormalised and
   validated against the contract, and a failure is retried with the errors quoted back.
2. **Backoff.** Rate limits and 5xx are retried with exponential backoff and jitter;
   4xx that are not rate limits are not, because retrying a malformed request just
   spends money slower.
3. **Concurrency.** One semaphore for the whole process, so 64 in flight means 64 in
   flight across every episode running concurrently, not 64 per episode.

Token accounting is returned on every call because `gen/cost_check.py` needs it and
`train/filter.py` needs `tokens.prompt` for its context-length check against the 32k
floor of the smaller sweep base.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from dataclasses import dataclass, field
from typing import Any

from openai import (
    APIConnectionError,
    APITimeoutError,
    AsyncOpenAI,
    BadRequestError,
    InternalServerError,
    NotFoundError,
    RateLimitError,
)

from gen.config import GenConfig
from gen.contracts import decision_errors, from_strict, strict_decision_schema
from gen.prompt import Prompt, retry_note

log = logging.getLogger("gen.llm")

RETRYABLE = (RateLimitError, APITimeoutError, APIConnectionError, InternalServerError)


class SchemaFailure(RuntimeError):
    """Every structured-output attempt failed the contract schema."""

    def __init__(self, errors: list[str], attempts: int) -> None:
        super().__init__(
            f"decision failed the contract schema after {attempts} attempts: {errors[:3]}"
        )
        self.errors = errors
        self.attempts = attempts


@dataclass
class Completion:
    """One successful call."""

    payload: dict[str, Any]
    model: str
    prompt_tokens: int = 0
    cached_prompt_tokens: int = 0
    completion_tokens: int = 0
    schema_retries: int = 0
    transport_retries: int = 0
    latency_s: float = 0.0
    raw_text: str = ""

    def tokens(self) -> dict[str, int]:
        """Exactly `lake_record_schema.json#/properties/tokens`."""
        return {
            "prompt": self.prompt_tokens,
            "cached_prompt": self.cached_prompt_tokens,
            "completion": self.completion_tokens,
        }


@dataclass
class Usage:
    """Process-wide totals, for cost_check and for the run summary."""

    calls: int = 0
    prompt_tokens: int = 0
    cached_prompt_tokens: int = 0
    completion_tokens: int = 0
    schema_retries: int = 0
    transport_retries: int = 0
    failures: int = 0
    latency_s: float = 0.0
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock, repr=False)

    async def add(self, completion: Completion) -> None:
        async with self._lock:
            self.calls += 1
            self.prompt_tokens += completion.prompt_tokens
            self.cached_prompt_tokens += completion.cached_prompt_tokens
            self.completion_tokens += completion.completion_tokens
            self.schema_retries += completion.schema_retries
            self.transport_retries += completion.transport_retries
            self.latency_s += completion.latency_s

    def as_dict(self) -> dict[str, Any]:
        return {
            "calls": self.calls,
            "prompt_tokens": self.prompt_tokens,
            "cached_prompt_tokens": self.cached_prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "schema_retries": self.schema_retries,
            "transport_retries": self.transport_retries,
            "failures": self.failures,
            "mean_latency_s": round(self.latency_s / self.calls, 2) if self.calls else 0.0,
            "cache_hit_rate": (
                round(self.cached_prompt_tokens / self.prompt_tokens, 4)
                if self.prompt_tokens
                else 0.0
            ),
        }


class LLMClient:
    """Async Responses-API client with one process-wide concurrency limit."""

    def __init__(self, config: GenConfig, *, model: str | None = None) -> None:
        self.config = config
        self.model = model or config.model
        self._fallback_used = False
        self._client = AsyncOpenAI(timeout=config.request_timeout_s, max_retries=0)
        self._semaphore = asyncio.Semaphore(config.concurrency)
        self.usage = Usage()

    async def aclose(self) -> None:
        await self._client.close()

    # -- transport ----------------------------------------------------------

    async def _create(self, **kwargs: Any) -> tuple[Any, int]:
        """One API call, retried on rate limits and 5xx with exponential backoff."""
        transport_retries = 0
        for attempt in range(self.config.max_transport_retries + 1):
            try:
                async with self._semaphore:
                    return await self._client.responses.create(**kwargs), transport_retries
            except NotFoundError:
                # The model id is wrong or not enabled for this org. Fall back once, and
                # say so loudly: a silent downgrade would put two models in one lake.
                if kwargs["model"] == self.config.model and not self._fallback_used:
                    self._fallback_used = True
                    log.warning(
                        "model %s not available; falling back to %s for the rest of this run",
                        self.config.model,
                        self.config.fallback_model,
                    )
                    self.model = self.config.fallback_model
                    kwargs["model"] = self.config.fallback_model
                    continue
                raise
            except RETRYABLE as error:
                if attempt >= self.config.max_transport_retries:
                    raise
                transport_retries += 1
                delay = min(self.config.backoff_base_s * (2**attempt), self.config.backoff_max_s)
                delay *= 0.5 + random.random()  # full jitter, so 64 clients do not sync up
                log.debug("retrying after %s in %.1fs", type(error).__name__, delay)
                await asyncio.sleep(delay)
        raise RuntimeError("unreachable")

    @staticmethod
    def _usage_of(response: Any) -> tuple[int, int, int]:
        usage = getattr(response, "usage", None)
        if usage is None:
            return 0, 0, 0
        details = getattr(usage, "input_tokens_details", None)
        cached = getattr(details, "cached_tokens", 0) if details else 0
        return (
            int(getattr(usage, "input_tokens", 0) or 0),
            int(cached or 0),
            int(getattr(usage, "output_tokens", 0) or 0),
        )

    # -- structured output --------------------------------------------------

    async def complete_json(
        self,
        *,
        instructions: str,
        input_messages: list[dict[str, Any]],
        schema: dict[str, Any],
        schema_name: str,
        cache_key: str | None = None,
        max_output_tokens: int | None = None,
    ) -> Completion:
        started = time.monotonic()
        kwargs: dict[str, Any] = {
            "model": self.model,
            "instructions": instructions,
            "input": input_messages,
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": schema_name,
                    "schema": schema,
                    "strict": True,
                }
            },
            "max_output_tokens": max_output_tokens or self.config.max_output_tokens,
            "store": False,
        }
        if cache_key:
            kwargs["prompt_cache_key"] = cache_key
        response, transport_retries = await self._create(**kwargs)
        text = (response.output_text or "").strip()
        prompt_tokens, cached, completion_tokens = self._usage_of(response)
        return Completion(
            payload=json.loads(text) if text else {},
            model=getattr(response, "model", self.model),
            prompt_tokens=prompt_tokens,
            cached_prompt_tokens=cached,
            completion_tokens=completion_tokens,
            transport_retries=transport_retries,
            latency_s=time.monotonic() - started,
            raw_text=text,
        )

    async def complete_decision(self, prompt: Prompt) -> Completion:
        """One contract-valid decision, retrying on schema failure.

        Strict mode fixes the shape. What it cannot express — that the three belief
        probabilities sum to 1, that `public_attribution` carries an
        `attributed_actor` — is checked against the contract here, and a failure goes
        back to the model with the errors quoted.
        """
        messages = list(prompt.input)
        errors: list[str] = []
        schema_retries = 0
        transport_retries = 0
        cached = prompt_tokens = completion_tokens = 0
        started = time.monotonic()

        for attempt in range(self.config.max_schema_retries + 1):
            completion = await self.complete_json(
                instructions=prompt.instructions,
                input_messages=messages,
                schema=strict_decision_schema(),
                schema_name="decision",
                cache_key=prompt.cache_key,
            )
            prompt_tokens += completion.prompt_tokens
            cached += completion.cached_prompt_tokens
            completion_tokens += completion.completion_tokens
            transport_retries += completion.transport_retries

            decision = from_strict(completion.payload)
            errors = decision_errors(decision)
            if not errors:
                completion.payload = decision
                completion.prompt_tokens = prompt_tokens
                completion.cached_prompt_tokens = cached
                completion.completion_tokens = completion_tokens
                completion.schema_retries = schema_retries
                completion.transport_retries = transport_retries
                completion.latency_s = time.monotonic() - started
                await self.usage.add(completion)
                return completion

            schema_retries += 1
            if attempt < self.config.max_schema_retries:
                messages = [
                    *messages,
                    {
                        "role": "assistant",
                        "content": [{"type": "output_text", "text": completion.raw_text}],
                    },
                    retry_note(errors),
                ]

        async with self.usage._lock:
            self.usage.failures += 1
        raise SchemaFailure(errors, schema_retries)


async def probe(config: GenConfig) -> dict[str, Any]:
    """One tiny call, to confirm the model id and the structured-output path work.

    Called by `gen/run.py --probe` and by `gen/cost_check.py` before it spends anything.
    """
    client = LLMClient(config)
    try:
        completion = await client.complete_json(
            instructions="Answer with the requested JSON object and nothing else.",
            input_messages=[
                {"role": "user", "content": [{"type": "input_text", "text": "Say ready."}]}
            ],
            schema={
                "type": "object",
                "additionalProperties": False,
                "required": ["ok", "note"],
                "properties": {
                    "ok": {"type": "boolean"},
                    "note": {"type": "string", "description": "One short word."},
                },
            },
            schema_name="probe",
            max_output_tokens=256,
        )
        return {
            "requested_model": config.model,
            "served_model": completion.model,
            "fell_back": client.model != config.model,
            "payload": completion.payload,
            "tokens": completion.tokens(),
            "latency_s": round(completion.latency_s, 2),
        }
    finally:
        await client.aclose()


def is_bad_request(error: BaseException) -> bool:
    return isinstance(error, BadRequestError)
