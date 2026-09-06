"""Build utility-free Track A candidates from durable streamed decision parts."""

from __future__ import annotations

import json
from pathlib import Path

from gen.config import GenConfig
from gen.run import full_episode_config
from infra.storage import Storage


def main() -> int:
    config = GenConfig()
    store = Storage.from_env()
    output = Path(".wargame-scratch/track_a_candidates.jsonl")
    output.parent.mkdir(exist_ok=True)
    rows: list[dict] = []
    for key in store.list(f"lake/{config.lake_version}/_parts/"):
        if not key.endswith(".json"):
            continue
        part = store.get_json(key)
        cfg = full_episode_config(config, int(part["seed"]))
        view = part["filtered_state"]
        rows.append(
            {
                "record_id": part["record_id"],
                "episode_id": part["episode_id"],
                "seat": part["seat"],
                "spec_id": cfg.seats[part["seat"]],
                "filtered_state": view,
                "injects_seen": view.get("injects_seen", []),
                "messages_seen": view.get("messages_seen", []),
                "output": part["output"],
                "outcome_utility": None,
                "tokens": part.get("tokens", {}),
                "track": "A",
            }
        )
    with output.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row) + "\n")
    print(json.dumps({"track_a_candidates": len(rows), "out": str(output)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
