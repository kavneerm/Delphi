"""One-request health probe for the GPT-5.6 Terra Responses endpoint.

This is intentionally independent of generation: it never reads or writes the
lake. It makes exactly one low-reasoning, flex-tier structured-output request
and prints latency, token use, and the small returned payload.

    python -m gen.probe_terra
"""

from __future__ import annotations

import asyncio
import json
import time

from openai import AsyncOpenAI

MODEL = "gpt-5.6-terra"
SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["status", "sum"],
    "properties": {
        "status": {"type": "string", "enum": ["ok"]},
        "sum": {"type": "integer", "minimum": 4, "maximum": 4},
    },
}


async def probe() -> dict[str, object]:
    """Return one independently verifiable Terra response and its token use."""
    client = AsyncOpenAI(timeout=30, max_retries=0)
    started = time.monotonic()
    try:
        response = await client.responses.create(
            model=MODEL,
            input="Return JSON showing that 2 + 2 equals 4.",
            text={
                "format": {
                    "type": "json_schema",
                    "name": "terra_health",
                    "schema": SCHEMA,
                    "strict": True,
                }
            },
            max_output_tokens=64,
            reasoning={"effort": "low"},
            service_tier="flex",
            store=False,
        )
        payload = json.loads(response.output_text)
        usage = response.usage
        return {
            "ok": payload == {"status": "ok", "sum": 4},
            "model": response.model,
            "seconds": round(time.monotonic() - started, 2),
            "payload": payload,
            "tokens": {
                "input": int(usage.input_tokens or 0),
                "output": int(usage.output_tokens or 0),
            },
        }
    finally:
        await client.close()


def main() -> int:
    print(json.dumps(asyncio.run(probe()), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
