"""Terra judge for Track A streamed candidates; appends only real responses."""

from __future__ import annotations

import argparse
import asyncio
import glob
import json
from pathlib import Path

from gen.config import GenConfig
from gen.judge import INSTRUCTIONS, SCHEMA
from gen.llm import LLMClient

INPUT = Path(".wargame-scratch/track_a_candidates.jsonl")
OUTPUT = Path(".wargame-scratch/track_a_judged.jsonl")


async def run(shard: int = 0, shards: int = 1) -> None:
    config = GenConfig()
    config = config.__class__(**{**config.__dict__, "judge_model": "gpt-5.6-terra"})
    done: set[str] = set()
    output = OUTPUT.with_name(f"{OUTPUT.stem}.s{shards}.{shard}{OUTPUT.suffix}")
    if output.exists():
        done = {json.loads(line)["record_id"] for line in output.read_text().splitlines() if line}
    for path in glob.glob(str(OUTPUT.with_name(f"{OUTPUT.stem}.*{OUTPUT.suffix}"))):
        done.update(
            json.loads(line)["record_id"] for line in Path(path).read_text().splitlines() if line
        )
    client = LLMClient(config, model=config.judge_model)
    try:
        with INPUT.open() as source, output.open("a") as sink:
            calls = 0
            for index, line in enumerate(source):
                if index % shards != shard:
                    continue
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
                try:
                    completion = await client.complete_json(
                        instructions=INSTRUCTIONS,
                        input_messages=[
                            {"role": "user", "content": json.dumps(prompt, separators=(",", ":"))}
                        ],
                        schema=SCHEMA,
                        schema_name="track_a_judgement",
                        max_output_tokens=512,
                    )
                except Exception as exc:
                    print(
                        json.dumps({"error": str(exc), "record_id": record["record_id"]}),
                        flush=True,
                    )
                    continue
                record["judge_scores"] = completion.payload["scores"]
                record["judge_rationale"] = completion.payload["rationale"]
                record["judge_model"] = completion.model
                sink.write(json.dumps(record) + "\n")
                sink.flush()
                calls += 1
                if calls % 250 == 0:
                    print(
                        json.dumps({"judge_calls": calls, "usage": client.usage.as_dict()}),
                        flush=True,
                    )
    finally:
        await client.aclose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--shard", type=int, default=0)
    parser.add_argument("--shards", type=int, default=1)
    args = parser.parse_args()
    asyncio.run(run(args.shard, args.shards))
