"""Run `specs/devset/` against served adapters and write the metrics table.

    python -m train.devset --sweep-id sweep-20260906-01 --seeds 5

The dev set is the synthetic scenarios with known correct behaviour (storm-only
should stay unattributed; a clean jamming signature should get attributed;
ambiguous should spread) that agent9-specs authors, each with an `expected.json`.
This is not the real evaluation — the replays and the held-out year belong to
agent6-eval and are never touched here.

Metrics come from the machine-readable block of `contracts/targets.md`, parsed
at runtime rather than copied here. That is deliberate on two counts: the targets
stay in one place, and some target rows are named after quarantined replays,
which must not appear in this file at all (`docs/quarantine.md`, AGENTS.md).

The dev set can only speak to the subset a synthetic scenario can carry:
`response_match`, `red_kinetic_rate`, `counterfactual_sensitivity`,
`control_false_positive_rate` on scenarios flagged as controls, and schema
validity. Every other target in `targets.md` is emitted as `n/a (agent6-eval)`
rather than silently dropped, so nobody reads a dev-set table as a validation
table — but it is listed by whatever name `targets.md` gives it, read from the
contract at runtime.

Costs GPU-hours: assumes `train/serve.py --up` has already run.
"""

from __future__ import annotations

import argparse
import json
import math
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from train import filter as filt
from train import storage
from train.fireworks import Client
from train.gates import load_json_dir, validate_decision
from train.serve import ServedAgent, sweep_adapters
from train.versions import Versions, git_sha

IRREVERSIBLE = {"kinetic", "terrestrial_response", "counter_rpo"}

TARGETS_DOC = Path("contracts/targets.md")

#: The only targets a synthetic dev set can honestly measure. Everything else in
#: `targets.md` needs the real replays or the held-out year, which belong to
#: agent6-eval and are never run from here.
DEVSET_MEASURABLE = frozenset(
    {
        "control_false_positive_rate",
        "red_kinetic_rate",
        "counterfactual_sensitivity",
        "response_match",
    }
)

_TARGET_ROW = re.compile(r"^\|\s*([a-z0-9_]+)\s*\|\s*([0-9.]+)\s*\|\s*(min|max)\s*\|")


def load_targets(path: Path = TARGETS_DOC) -> dict[str, tuple[float, str]]:
    """Parse the machine-readable table at the bottom of `contracts/targets.md`.

    Read rather than copied: `targets.md` is frozen, some of its metric names are
    quarantined replay names, and a stale duplicate here would be a silent way to
    grade against the wrong number.
    """
    out: dict[str, tuple[float, str]] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        match = _TARGET_ROW.match(line.strip())
        if match:
            out[match.group(1)] = (float(match.group(2)), match.group(3))
    return out


@dataclass
class ScenarioOutcome:
    scenario_id: str
    seat: str
    seed: int
    action: str | None
    hostile: float | None
    attributed: str | None
    schema_ok: bool
    expected_action: str | None
    is_control: bool


def _attributed(decision: dict[str, Any]) -> str | None:
    """Who the seat named, if it named anyone. `unknown` is not an attribution."""
    action = decision.get("action") or {}
    if action.get("type") == "public_attribution":
        named = (action.get("params") or {}).get("attributed_actor")
        return None if named in (None, "unknown") else str(named)
    beliefs = decision.get("beliefs") or {}
    per_actor = beliefs.get("per_actor") or {}
    if not per_actor:
        return None
    top, mass = max(per_actor.items(), key=lambda kv: kv[1])
    return str(top) if float(mass) >= 0.5 else None


def run_scenario(
    *,
    adapter: str,
    scenario: dict[str, Any],
    spec: dict[str, Any],
    seed: int,
    client: Client,
) -> ScenarioOutcome:
    expected = scenario.get("expected") or {}
    state = scenario.get("filtered_state", scenario)
    agent = ServedAgent(spec.get("seat", "nsc"), adapter, client=client, spec=spec)
    try:
        decision = agent.decide(state)
        schema_ok = not validate_decision(decision)
    except (ValueError, KeyError):
        decision, schema_ok = {}, False
    action = (decision.get("action") or {}).get("type") if decision else None
    hostile = (decision.get("beliefs") or {}).get("hostile") if decision else None
    return ScenarioOutcome(
        scenario_id=str(scenario.get("scenario_id") or scenario.get("id") or "unknown"),
        seat=spec.get("seat", "nsc"),
        seed=seed,
        action=action,
        hostile=float(hostile) if isinstance(hostile, int | float) else None,
        attributed=_attributed(decision) if decision else None,
        schema_ok=schema_ok,
        expected_action=expected.get("action"),
        is_control=bool(scenario.get("is_control") or expected.get("cause") == "natural"),
    )


def entropy_ratio(counts: Counter[str]) -> float:
    """Shannon entropy of an action distribution over its own support, in [0,1]."""
    total = sum(counts.values())
    if total == 0 or len(counts) <= 1:
        return 0.0
    h = -sum((c / total) * math.log(c / total) for c in counts.values() if c)
    return h / math.log(len(counts))


def score(outcomes: list[ScenarioOutcome], sensitivity: float | None) -> dict[str, Any]:
    n = len(outcomes)
    if n == 0:
        return {}
    controls = [o for o in outcomes if o.is_control]
    matched = [o for o in outcomes if o.expected_action is not None]
    return {
        "n": n,
        "schema_validity": sum(o.schema_ok for o in outcomes) / n,
        "control_false_positive_rate": (
            sum(o.attributed is not None for o in controls) / len(controls) if controls else None
        ),
        "red_kinetic_rate": sum(o.action == "kinetic" for o in outcomes) / n,
        "irreversible_action_rate_devset": sum(o.action in IRREVERSIBLE for o in outcomes) / n,
        "response_match": (
            sum(o.action == o.expected_action for o in matched) / len(matched) if matched else None
        ),
        "counterfactual_sensitivity": sensitivity,
        "action_entropy_ratio": entropy_ratio(Counter(o.action or "none" for o in outcomes)),
        "mean_hostile": (
            sum(o.hostile for o in outcomes if o.hostile is not None)
            / max(1, sum(o.hostile is not None for o in outcomes))
        ),
    }


def render_table(rows: list[tuple[str, dict[str, Any]]]) -> str:
    """One row per run, one column per target metric, verdict against targets.md."""
    metrics = [
        "schema_validity",
        "response_match",
        "counterfactual_sensitivity",
        "control_false_positive_rate",
        "red_kinetic_rate",
        "irreversible_action_rate_devset",
        "action_entropy_ratio",
        "mean_hostile",
    ]
    lines = [
        "| run_id | " + " | ".join(metrics) + " | verdict |",
        "|---" * (len(metrics) + 2) + "|",
    ]
    for run_id, m in rows:
        cells = []
        for name in metrics:
            v = m.get(name)
            cells.append("-" if v is None else f"{v:.3f}")
        lines.append(f"| `{run_id}` | " + " | ".join(cells) + f" | {verdict(m)} |")
    eval_only = sorted(set(load_targets()) - DEVSET_MEASURABLE)
    if eval_only:
        lines += [
            "",
            "Targets a synthetic dev set cannot measure — agent6-eval owns these, on "
            "the real replays and the held-out year:",
            "",
        ]
        lines += [f"- `{name}` — n/a (agent6-eval)" for name in eval_only]
    return "\n".join(lines) + "\n"


def verdict(m: dict[str, Any], targets: dict[str, tuple[float, str]] | None = None) -> str:
    """PASS only if every target the dev set *can* measure is met."""
    targets = load_targets() if targets is None else targets
    misses = []
    for name, (target, direction) in targets.items():
        if name not in DEVSET_MEASURABLE:
            continue
        value = m.get(name)
        if value is None:
            continue
        if direction == "min" and value < target:
            misses.append(name)
        if direction == "max" and value > target:
            misses.append(name)
    return "PASS" if not misses else "FAIL: " + ", ".join(misses)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Dev-set metrics for served adapters.")
    p.add_argument("--sweep-id", required=True)
    p.add_argument("--run-id", help="one run; default every run with an output model")
    p.add_argument("--config", type=Path, default=filt.CONFIG_PATH)
    p.add_argument("--devset-dir", type=Path, default=Path("specs/devset"))
    p.add_argument("--specs-dir", type=Path, default=Path("specs/train"))
    p.add_argument("--seeds", type=int, default=3)
    p.add_argument("--no-s3", action="store_true")
    p.add_argument("--out", type=Path)
    args = p.parse_args(argv)

    config = filt.load_config(args.config)
    scenarios = load_json_dir(args.devset_dir)
    specs = load_json_dir(args.specs_dir)
    if not scenarios:
        raise SystemExit(f"no dev scenarios in {args.devset_dir}; agent9-specs has not landed")
    if not specs:
        raise SystemExit(f"no specs in {args.specs_dir}; agent9-specs has not landed")

    client = Client.from_env()
    runs = sweep_adapters(args.sweep_id)
    if args.run_id:
        runs = [r for r in runs if r["run_id"] == args.run_id]
    if not runs:
        raise SystemExit(f"no completed runs in {args.sweep_id}")

    cfgv = config["versions"]
    rows: list[tuple[str, dict[str, Any]]] = []
    for record in runs:
        outcomes: list[ScenarioOutcome] = []
        for scenario in scenarios:
            for spec in specs:
                if spec.get("seat") != scenario.get("seat", spec.get("seat")):
                    continue
                for seed in range(args.seeds):
                    outcomes.append(
                        run_scenario(
                            adapter=record["output_model"],
                            scenario=scenario,
                            spec=spec,
                            seed=seed,
                            client=client,
                        )
                    )
        gates_key = f"runs/{args.sweep_id}/{record['run_id']}/gates.json"
        sensitivity = None
        try:
            gates = json.loads(storage.get_text(gates_key))
            sensitivity = next(
                g["value"] for g in gates["gates"] if g["name"] == "counterfactual_sensitivity"
            )
        except Exception:  # noqa: BLE001 - gates may not have run yet
            sensitivity = None
        metrics = score(outcomes, sensitivity)
        rows.append((record["run_id"], metrics))

        if not args.no_s3:
            versions = Versions(
                env_version=cfgv["env_version"],
                spec_version=cfgv["spec_version"],
                lake_version=cfgv["lake_version"],
                filter_version=record["variant"]["filter_version"],
                judge_version=cfgv["judge_version"],
            )
            table = render_table([(record["run_id"], metrics)])
            storage.put_markdown(
                f"runs/{args.sweep_id}/{record['run_id']}/devset_table.md",
                f"# dev set — `{record['run_id']}`\n\n"
                f"adapter `{record['output_model']}`, git `{git_sha()}`\n\n{table}",
                versions.as_metadata(),
            )

    table = render_table(rows)
    print(table)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(table, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
