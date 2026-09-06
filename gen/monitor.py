"""Read-only progress and spend report for the production lake run."""

from __future__ import annotations

import argparse
from typing import Any

from gen.config import GenConfig
from gen.keys import is_record_key, records_prefix
from infra.storage import Storage


def usd(records: list[dict[str, Any]], config: GenConfig) -> float:
    """Cost from provider-reported token fields, including cached-input pricing."""
    prompt = sum(int((r.get("tokens") or {}).get("prompt", 0)) for r in records)
    cached = sum(int((r.get("tokens") or {}).get("cached_prompt", 0)) for r in records)
    completion = sum(int((r.get("tokens") or {}).get("completion", 0)) for r in records)
    return (
        (prompt - cached) * config.price_input_per_mtok
        + cached * config.price_cached_input_per_mtok
        + completion * config.price_output_per_mtok
    ) / 1_000_000


def report(config: GenConfig) -> dict[str, Any]:
    store = Storage.from_env()
    prefix = records_prefix(config.lake_version, config.env_version, config.spec_version)
    keys = [key for key in store.list(prefix) if is_record_key(key)]
    records = [record for key in keys for record in store.get_jsonl(key)]
    episode_ids = {str(record["episode_id"]) for record in records}
    failures = sum(
        bool((record.get("output") or {}).get("reasoning", "").startswith("No staff"))
        for record in records
    )
    spent = usd(records, config)
    return {
        "episodes_complete": len(episode_ids),
        "records_complete": len(records),
        "generation_usd_observed": round(spent, 2),
        "generation_usd_remaining_to_cap": round(max(0.0, 1500.0 - spent), 2),
        "hold_outputs": failures,
        "record_keys": len(keys),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args(argv)
    print(report(GenConfig()))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
