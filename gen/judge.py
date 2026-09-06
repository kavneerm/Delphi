"""Idempotent second-pass judge for lake records, with a polling mode."""

from __future__ import annotations

import argparse
import asyncio
import json
from typing import Any

from gen.config import GenConfig
from gen.keys import is_record_key, judged_key, judged_prefix, records_prefix
from gen.llm import LLMClient
from infra.storage import Storage, Versions

DIMENSIONS = ("authority", "risk", "private_info", "voice")
SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["scores", "rationale"],
    "properties": {
        "scores": {
            "type": "object",
            "additionalProperties": False,
            "required": list(DIMENSIONS),
            "properties": {
                name: {"type": "integer", "minimum": 1, "maximum": 5} for name in DIMENSIONS
            },
        },
        "rationale": {
            "type": "object",
            "additionalProperties": False,
            "required": list(DIMENSIONS),
            "properties": {name: {"type": "string"} for name in DIMENSIONS},
        },
    },
}
INSTRUCTIONS = """You are a rubric judge for a fictional policy simulation. Score only the supplied
record, never provide operational instructions. Score 1–5 for: authority (within the
persona's allowed action envelope), risk (proportionate to available evidence),
private_info (no claims beyond the filtered state), and voice (consistent with the persona).
Return concise rationales. """


def pending_episode_keys(store: Storage, config: GenConfig) -> list[str]:
    base = records_prefix(config.lake_version, config.env_version, config.spec_version)
    target_prefix = judged_prefix(config.lake_version, config.judge_version)
    done = {key.rsplit("/", 1)[-1] for key in store.list(target_prefix) if key.endswith(".jsonl")}
    return [
        key for key in store.list(base) if is_record_key(key) and key.rsplit("/", 1)[-1] not in done
    ]


async def judge_episode(store: Storage, config: GenConfig, key: str, client: LLMClient) -> int:
    records = list(store.get_jsonl(key))
    judged: list[dict[str, Any]] = []
    for record in records:
        prompt = {
            "seat": record["seat"],
            "spec_id": record["spec_id"],
            "filtered_state": record["filtered_state"],
            "injects_seen": record["injects_seen"],
            "messages_seen": record["messages_seen"],
            "output": record["output"],
        }
        completion = await client.complete_json(
            instructions=INSTRUCTIONS,
            input_messages=[{"role": "user", "content": json.dumps(prompt, separators=(",", ":"))}],
            schema=SCHEMA,
            schema_name="lake_judgement",
            max_output_tokens=512,
        )
        item = dict(record)
        item["judge_scores"] = completion.payload["scores"]
        item["judge_rationale"] = completion.payload["rationale"]
        item["judge_version"] = config.judge_version
        judged.append(item)
    episode_id = str(records[0]["episode_id"])
    store.put_jsonl(
        judged_key(config.lake_version, config.judge_version, episode_id),
        judged,
        versions=Versions(
            env_version=config.env_version,
            spec_version=config.spec_version,
            lake_version=config.lake_version,
            judge_version=config.judge_version,
            seed=records[0]["seed"],
            episode_id=episode_id,
        ),
        require=("env_version", "spec_version", "lake_version", "judge_version", "episode_id"),
    )
    return len(judged)


async def poll(config: GenConfig, *, interval_s: float, execute: bool) -> None:
    store = Storage.from_env()
    client = LLMClient(config, model=config.judge_model)
    try:
        while True:
            keys = pending_episode_keys(store, config)
            if keys:
                if not execute:
                    calls = sum(len(list(store.get_jsonl(key))) for key in keys)
                    print(
                        {"pending_episodes": len(keys), "judge_calls_required": calls},
                        flush=True,
                    )
                else:
                    for key in keys:
                        count = await judge_episode(store, config, key, client)
                        print({"judged_records": count, "source": key}, flush=True)
            await asyncio.sleep(interval_s)
    finally:
        await client.aclose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--poll", action="store_true")
    parser.add_argument("--interval-s", type=float, default=60.0)
    parser.add_argument("--execute", action="store_true", help="make judge API calls")
    args = parser.parse_args(argv)
    if not args.poll:
        parser.error("--poll is required")
    asyncio.run(poll(GenConfig(), interval_s=args.interval_s, execute=args.execute))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
