"""Terra judge for Track A streamed candidates; appends only real responses."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from gen.config import GenConfig
from gen.judge import INSTRUCTIONS, SCHEMA
from gen.llm import LLMClient

INPUT = Path(".wargame-scratch/track_a_candidates.jsonl")
OUTPUT = Path(".wargame-scratch/track_a_judged.jsonl")


async def run() -> None:
    config = GenConfig()
    config = config.__class__(**{**config.__dict__, "judge_model": "gpt-5.6-terra"})
    done: set[str] = set()
    if OUTPUT.exists():
        done = {json.loads(line)["record_id"] for line in OUTPUT.read_text().splitlines() if line}
    client = LLMClient(config, model=config.judge_model)
    try:
        with INPUT.open() as source, OUTPUT.open("a") as sink:
            calls = 0
            for line in source:
                record = json.loads(line)
                if record["record_id"] in done:
                    continue
                prompt = {
                    key: record[key]
                    for key in (
                        "seat",
                        "spec_id",
                        "filtered_state",
                        "injects_seen",
                        "messages_seen",
                        "output",
                    )
                }
                completion = await client.complete_json(
                    instructions=INSTRUCTIONS,
                    input_messages=[
                        {"role": "user", "content": json.dumps(prompt, separators=(",", ":"))}
                    ],
                    schema=SCHEMA,
                    schema_name="track_a_judgement",
                    max_output_tokens=512,
                )
                record["judge_scores"] = completion.payload["scores"]
                record["judge_rationale"] = completion.payload["rationale"]
                record["judge_model"] = completion.model
                sink.write(json.dumps(record) + "\n")
                sink.flush()
                calls += 1
                if calls % 500 == 0:
                    print(
                        json.dumps({"judge_calls": calls, "usage": client.usage.as_dict()}),
                        flush=True,
                    )
    finally:
        await client.aclose()


if __name__ == "__main__":
    asyncio.run(run())
