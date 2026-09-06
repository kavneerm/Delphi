"""Turn lake records into a chat-format training set, config-driven.

    python -m train.filter --filter filter_v1 --out runs/local/dataset.jsonl

Reads `train/config.yaml`. Every knob — judge threshold, per-persona utility
percentile, counterfactual oversampling, seat weighting — lives in a named
`filter_vN` block; changing a number without bumping the name invalidates the
run. Emits JSONL in chat format (system = the persona spec, user = filtered
state + injects + messages, assistant = the decision JSON) plus a manifest
carrying the lake and filter versions.

Two drops are structural rather than tuneable:

* **Identical counterfactual pairs.** A pair whose two arms produced the same
  decision teaches the model that the flipped spec field does not matter, which
  is exactly the opposite of `counterfactual_sensitivity` in
  `contracts/targets.md`. Both arms go.
* **Over-length prompts.** The sweep's two bases differ 4x in context (Llama
  131072, Qwen 32768). An example over the *floor* trains on Llama and is
  silently truncated on Qwen, so the Qwen arm degrades without erroring. Every
  example is measured against the floor, from the lake record's own token count
  where it has one and a tokenizer estimate otherwise.
"""

from __future__ import annotations

import argparse
import json
import math
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from train import storage
from train.versions import Versions, git_sha

CONFIG_PATH = Path(__file__).with_name("config.yaml")

SPEC_STUB = (
    "You are the {seat} seat in a Svalbard counterspace crisis. Spec {spec_id} "
    "({spec_version}) was not available at filter time; this is a placeholder "
    "system turn. Act inside your authority envelope and reason only from what "
    "you can see."
)


def load_config(path: Path = CONFIG_PATH) -> dict[str, Any]:
    cfg = yaml.safe_load(path.read_text(encoding="utf-8"))
    seen = set(cfg["filters"])
    if len(seen) != len(cfg["filters"]):
        raise ValueError("duplicate filter version in config")
    return cfg


# --------------------------------------------------------------------- tokens


def count_tokens(text: str) -> int:
    """Token count for `text`. tiktoken when installed, a 3.6-chars/token
    estimate otherwise — the estimate only ever has to be good enough to catch
    something four times over the floor."""
    try:
        import tiktoken

        return len(tiktoken.get_encoding("cl100k_base").encode(text))
    except Exception:
        return math.ceil(len(text) / 3.6)


# ---------------------------------------------------------------- chat format


def spec_system_turn(record: dict[str, Any], specs: dict[str, str]) -> str:
    spec_id = record["spec_id"]
    if spec_id in specs:
        return specs[spec_id]
    return SPEC_STUB.format(
        seat=record["seat"], spec_id=spec_id, spec_version=record["spec_version"]
    )


def user_turn(record: dict[str, Any]) -> str:
    """State + injects + messages, in the order the seat received them."""
    blocks = [
        "## FILTERED STATE",
        json.dumps(record["filtered_state"], indent=2, sort_keys=True),
    ]
    injects = record.get("injects_seen") or []
    blocks += [
        "\n## INJECTS SEEN",
        json.dumps(injects, indent=2, sort_keys=True) if injects else "(none)",
    ]
    messages = record.get("messages_seen") or []
    blocks += [
        "\n## MESSAGES SEEN",
        json.dumps(messages, indent=2, sort_keys=True) if messages else "(none)",
    ]
    blocks.append(
        "\n## DECISION\nEmit one JSON object with keys beliefs, messages, action, reasoning."
    )
    return "\n".join(blocks)


def to_chat(record: dict[str, Any], specs: dict[str, str]) -> dict[str, Any]:
    return {
        "messages": [
            {"role": "system", "content": spec_system_turn(record, specs)},
            {"role": "user", "content": user_turn(record)},
            {
                "role": "assistant",
                "content": json.dumps(record["output"], ensure_ascii=False, sort_keys=True),
            },
        ]
    }


def load_specs(specs_dir: Path | None) -> dict[str, str]:
    """spec_id -> system turn, from approved specs on disk. Missing is fine."""
    if specs_dir is None or not specs_dir.exists():
        return {}
    out: dict[str, str] = {}
    for path in sorted(specs_dir.glob("*.json")):
        try:
            spec = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        spec_id = spec.get("spec_id")
        if spec_id:
            out[spec_id] = render_spec(spec)
    return out


def render_spec(spec: dict[str, Any]) -> str:
    """A persona spec as the system turn. Order is fixed so the prefix caches."""
    parts = [f"You are the {spec['seat']} seat ({spec['spec_id']})."]
    for key in (
        "backstory",
        "voice",
        "authority",
        "information",
        "decision_clock",
        "utility_weights",
        "risk_posture",
        "time_horizon",
        "priors",
        "private_type",
        "psyche",
        "temperament",
    ):
        if key not in spec or spec[key] in (None, "", [], {}):
            continue
        value = spec[key]
        rendered = value if isinstance(value, str) else json.dumps(value, sort_keys=True)
        parts.append(f"\n### {key}\n{rendered}")
    return "\n".join(parts)


# -------------------------------------------------------------------- filtering


@dataclass
class FilterStats:
    """Why each record did or did not make it in. Written into the manifest."""

    seen: int = 0
    kept: int = 0
    dropped: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    oversampled: int = 0
    over_length_flagged: int = 0
    max_prompt_tokens: int = 0
    pairs_seen: int = 0
    pairs_identical: int = 0
    seats: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    specs_missing: set[str] = field(default_factory=set)

    def as_dict(self) -> dict[str, Any]:
        return {
            "seen": self.seen,
            "kept": self.kept,
            "dropped": dict(sorted(self.dropped.items())),
            "oversampled": self.oversampled,
            "over_length_flagged": self.over_length_flagged,
            "max_prompt_tokens": self.max_prompt_tokens,
            "pairs_seen": self.pairs_seen,
            "pairs_identical": self.pairs_identical,
            "seats": dict(sorted(self.seats.items())),
            "specs_missing": sorted(self.specs_missing),
        }


def _decision_key(output: dict[str, Any]) -> str:
    """Identity of a decision for pair comparison: the action and the beliefs,
    not the prose. Two arms that reason differently but do the same thing at the
    same confidence still teach insensitivity."""
    beliefs = output.get("beliefs", {})
    return json.dumps(
        {
            "action": output.get("action"),
            "hostile": round(float(beliefs.get("hostile", 0)), 2),
            "per_actor": beliefs.get("per_actor", {}),
        },
        sort_keys=True,
    )


def identical_pair_ids(records: list[dict[str, Any]]) -> set[str]:
    """pair_ids whose two arms produced the same decision."""
    arms: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in records:
        if r.get("pair_id"):
            arms[r["pair_id"]].append(r)
    return {
        pid
        for pid, group in arms.items()
        if len(group) >= 2 and len({_decision_key(r["output"]) for r in group}) == 1
    }


def utility_cutoffs(records: list[dict[str, Any]], percentile: float) -> dict[str, float]:
    """Per-persona utility cutoff. Percentile is taken within each spec_id so a
    seat whose utilities are structurally low is not filtered out entirely."""
    if percentile <= 0:
        return {}
    by_spec: dict[str, list[float]] = defaultdict(list)
    for r in records:
        u = r.get("outcome_utility")
        if isinstance(u, int | float):
            by_spec[r["spec_id"]].append(float(u))
    cutoffs: dict[str, float] = {}
    for spec_id, values in by_spec.items():
        if len(values) < 4:
            continue  # too few to cut on; keep them all
        quantiles = statistics.quantiles(sorted(values), n=100, method="inclusive")
        cutoffs[spec_id] = quantiles[min(int(percentile), 99) - 1]
    return cutoffs


def _judge_ok(record: dict[str, Any], fcfg: dict[str, Any]) -> bool:
    scores = record.get("judge_scores")
    if not scores:
        return not fcfg.get("require_judged", True)
    for dim, floor in fcfg["judge_min"].items():
        if scores.get(dim, 0) < floor:
            return False
    mean = sum(scores[d] for d in fcfg["judge_min"]) / len(fcfg["judge_min"])
    return mean >= fcfg["judge_mean_min"]


def _prompt_tokens(record: dict[str, Any], chat: dict[str, Any]) -> int:
    """Prompt length in tokens: the lake record's own count when the generator
    recorded one, else measured off the rendered system+user turns."""
    recorded = (record.get("tokens") or {}).get("prompt")
    if isinstance(recorded, int) and recorded > 0:
        return recorded
    return sum(count_tokens(m["content"]) for m in chat["messages"][:2])


def filter_records(
    records: list[dict[str, Any]],
    *,
    filter_version: str,
    config: dict[str, Any],
    specs: dict[str, str] | None = None,
) -> tuple[list[dict[str, Any]], FilterStats]:
    """Apply one named filter block. Returns (chat examples, stats)."""
    fcfg = config["filters"][filter_version]
    ctx = config["context"]
    specs = specs or {}
    budget = int(ctx["min_context_tokens"]) - int(ctx["completion_reserve_tokens"])
    policy = ctx.get("over_length_policy", "drop")

    stats = FilterStats()
    identical = identical_pair_ids(records) if fcfg.get("drop_identical_pairs", True) else set()
    stats.pairs_seen = len({r["pair_id"] for r in records if r.get("pair_id")})
    stats.pairs_identical = len(identical)
    cutoffs = utility_cutoffs(records, float(fcfg.get("utility_percentile", 0)))
    weights: dict[str, float] = fcfg.get("seat_weights") or {}
    oversample = float(fcfg.get("counterfactual_oversample", 1.0))

    out: list[dict[str, Any]] = []
    out_seats: list[str] = []
    for record in records:
        stats.seen += 1
        if record.get("pair_id") in identical:
            stats.dropped["identical_counterfactual_pair"] += 1
            continue
        if not _judge_ok(record, fcfg):
            stats.dropped["judge_threshold"] += 1
            continue
        cutoff = cutoffs.get(record["spec_id"])
        utility = record.get("outcome_utility")
        if cutoff is not None:
            if utility is None:
                stats.dropped["unscored_utility"] += 1
                continue
            if float(utility) < cutoff:
                stats.dropped["utility_percentile"] += 1
                continue

        chat = to_chat(record, specs)
        if record["spec_id"] not in specs:
            stats.specs_missing.add(record["spec_id"])
        tokens = _prompt_tokens(record, chat)
        stats.max_prompt_tokens = max(stats.max_prompt_tokens, tokens)
        if tokens > budget:
            if policy == "drop":
                stats.dropped["over_min_context"] += 1
                continue
            stats.over_length_flagged += 1
            chat = {**chat, "over_min_context": True, "prompt_tokens": tokens}

        copies = 1
        if record.get("pair_id"):
            copies = max(1, round(oversample))
            stats.oversampled += copies - 1
        copies = max(1, round(copies * float(weights.get(record["seat"], 1.0))))
        for _ in range(copies):
            out.append(chat)
            out_seats.append(record["seat"])

    limit = fcfg.get("max_examples")
    if limit and len(out) > int(limit):
        out = out[: int(limit)]
        out_seats = out_seats[: int(limit)]
    stats.kept = len(out)
    stats.seats = defaultdict(int, Counter(out_seats))
    return out, stats


# --------------------------------------------------------------------- manifest


def build_manifest(
    *,
    filter_version: str,
    config: dict[str, Any],
    versions: Versions,
    stats: FilterStats,
    dataset_key: str,
    source: str,
) -> dict[str, Any]:
    return {
        "filter_version": filter_version,
        "filter_config": config["filters"][filter_version],
        "context_policy": config["context"],
        "versions": {
            "env_version": versions.env_version,
            "spec_version": versions.spec_version,
            "lake_version": versions.lake_version,
            "filter_version": versions.filter_version,
            "judge_version": versions.judge_version,
            "contracts_version": versions.contracts_version,
        },
        "git_commit": git_sha(),
        "source": source,
        "dataset_key": dataset_key,
        "stats": stats.as_dict(),
    }


# ------------------------------------------------------------------------- cli


def judged_lake_prefix(lake_version: str, judge_version: str) -> str:
    """The prefix to train from: `lake/<lake_v>/_judge/<judge_v>/`.

    `gen/judge.py` writes COMPLETE lake records there, every field of
    `lake_record_schema.json` rather than a scores-only sidecar, so the judged
    tree is self-sufficient and needs no join back to the base tree.
    """
    return f"lake/{lake_version}/_judge/{judge_version}/"


def dedupe_records(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], int]:
    """Collapse duplicate `record_id`s, preferring the judged copy.

    `contracts/s3_layout.md` §3 nests the judged tree *inside* the same version
    prefix as the base records, so a prefix of `lake/<lake_v>/` matches both
    `.../seed=<n>/<episode>.jsonl` (unjudged) and `_judge/<judge_v>/<episode>.jsonl`
    (judged) — every decision, twice. With `require_judged: true` the unjudged
    copies happen to be dropped later and the damage is only to the manifest
    counts; with `require_judged: false` they are not, and the judged records
    silently train at double weight. Neither is acceptable, and neither errors on
    its own, so the duplicates die here regardless of what prefix was passed.
    """
    best: dict[str, dict[str, Any]] = {}
    duplicates = 0
    for row in rows:
        key = row.get("record_id")
        if not key:
            # No id to dedupe on; keep it, but under a key that cannot collide.
            best[f"_anon_{len(best)}"] = row
            continue
        existing = best.get(key)
        if existing is None:
            best[key] = row
            continue
        duplicates += 1
        if row.get("judge_scores") and not existing.get("judge_scores"):
            best[key] = row
    return list(best.values()), duplicates


def read_lake(prefix: str | None, mock: int) -> tuple[list[dict[str, Any]], str]:
    if mock:
        from train.mocklake import records as mock_records

        return mock_records(mock), f"mocklake:{mock}"
    if not prefix:
        raise SystemExit("pass --lake-prefix or --mock N")
    rows: list[dict[str, Any]] = []
    for key in storage.list_keys(prefix):
        # `_index/<episode>.json` and `_parts/<episode>/*.json` are .json, not
        # .jsonl, so this filter already skips them. Keep it.
        if key.endswith(".jsonl"):
            rows.extend(storage.read_jsonl(key))
    rows, duplicates = dedupe_records(rows)
    if duplicates:
        print(
            f"NOTE: dropped {duplicates} duplicate record_id(s) reading {prefix!r}, keeping the "
            "judged copy of each. That prefix spans both the base and _judge trees; "
            "--lake-prefix lake/<lake_v>/_judge/<judge_v>/ reads each decision once."
        )
    return rows, storage.uri(prefix)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Filter the lake into chat-format training JSONL.")
    p.add_argument("--filter", dest="filter_version", required=True)
    p.add_argument("--config", type=Path, default=CONFIG_PATH)
    p.add_argument(
        "--lake-prefix",
        help="prefix under lake/ to read. Prefer lake/<lake_v>/_judge/<judge_v>/ -- "
        "the judged tree holds complete records and reads each decision once, where "
        "lake/<lake_v>/ spans the base tree too and matches everything twice.",
    )
    p.add_argument(
        "--judged",
        action="store_true",
        help="read lake/<lake_version>/_judge/<judge_version>/ from config; "
        "shorthand for the correct --lake-prefix",
    )
    p.add_argument("--mock", type=int, default=0, help="use N mock lake records instead")
    p.add_argument("--specs-dir", type=Path, default=Path("specs/train"))
    p.add_argument("--out", type=Path, required=True, help="local JSONL path to write")
    p.add_argument("--manifest", type=Path, help="manifest path (default: <out>.manifest.json)")
    p.add_argument("--sweep-id")
    p.add_argument("--run-id")
    p.add_argument("--upload", action="store_true", help="also write to runs/ in the bucket")
    args = p.parse_args(argv)

    config = load_config(args.config)
    if args.filter_version not in config["filters"]:
        raise SystemExit(f"unknown filter {args.filter_version}; have {list(config['filters'])}")

    cfgv = config["versions"]
    lake_prefix = args.lake_prefix
    if args.judged:
        lake_prefix = judged_lake_prefix(cfgv["lake_version"], cfgv["judge_version"])
    records, source = read_lake(lake_prefix, args.mock)
    specs = load_specs(args.specs_dir)
    examples, stats = filter_records(
        records, filter_version=args.filter_version, config=config, specs=specs
    )

    versions = Versions(
        env_version=cfgv["env_version"],
        spec_version=cfgv["spec_version"],
        lake_version=cfgv["lake_version"],
        filter_version=args.filter_version,
        judge_version=cfgv["judge_version"],
    )
    versions.validate()

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8") as fh:
        for ex in examples:
            fh.write(json.dumps(ex, ensure_ascii=False) + "\n")

    sweep_id = args.sweep_id or "local"
    run_id = args.run_id or "filter"
    dataset_key = f"runs/{sweep_id}/{run_id}/dataset_{args.filter_version}.jsonl"
    manifest = build_manifest(
        filter_version=args.filter_version,
        config=config,
        versions=versions,
        stats=stats,
        dataset_key=dataset_key,
        source=source,
    )
    manifest_path = args.manifest or args.out.with_suffix(".manifest.json")
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True), encoding="utf-8")

    if args.upload:
        meta = versions.as_metadata()
        storage.put_text(
            dataset_key, args.out.read_text(encoding="utf-8"), meta, "application/x-ndjson"
        )
        storage.put_json(f"runs/{sweep_id}/{run_id}/manifest.json", manifest, meta)

    summary = {"out": str(args.out), "examples": len(examples), **stats.as_dict()}
    print(json.dumps(summary, indent=2))
    if stats.specs_missing:
        print(f"WARNING: {len(stats.specs_missing)} spec ids had no approved spec; used the stub.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
