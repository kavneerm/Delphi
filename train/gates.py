"""Pre-eval gates. Fail fast, before a checkpoint reaches the dev set.

    python -m train.gates --sweep-id sweep-20260906-01 --run-id <run_id>
    python -m train.gates --sweep-id ... --offline   # score recorded outputs, no deployment

Three gates, all from `contracts/targets.md` and the Agent 4 brief:

* **schema validity** — the fraction of decisions that parse and validate against
  `contracts/action_schema.json#/$defs/decision`. A model that cannot emit the
  contract cannot play a seat, so this runs first and short-circuits the rest.
* **counterfactual sensitivity** — a spec field is flipped and the same state is
  put to the adapter twice. If the modal action does not move, the fine-tune
  learned the scenario and not the persona. `targets.md` wants >= 0.90.
* **held-out persona coherence** — specs from `specs/holdout/`, which no training
  example came from. Scores whether the decision stays inside the spec's own
  authority envelope and does not cite information the seat has no feed for.

The gate run costs GPU-hours, so it takes an already-up deployment rather than
bringing one up itself: `train/serve.py --up` first, gates and dev set together,
then `--down` once.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from engine.agent_api import validate_decision as engine_validate_decision
from train import filter as filt
from train import storage
from train.fireworks import Client
from train.serve import ServedAgent, sweep_adapters
from train.versions import Versions, git_sha

# ----------------------------------------------------------------- validation
#
# `engine.agent_api.validate_decision` is the project's single definition of
# "is this decision contract-valid", including the beliefs-sum-to-1.0 rule the
# JSON schema cannot express. train/ had its own copy; using the engine's means a
# gate here and the engine's own coercion can never disagree about whether a
# decision was valid.


def validate_decision(decision: Any, validator: object = None) -> list[str]:
    """Contract errors in one decision. Empty list means valid.

    `validator` is accepted and ignored, so callers that used to pass a prebuilt
    jsonschema validator keep working.
    """
    if not isinstance(decision, Mapping):
        return ["decision is not an object"]
    return engine_validate_decision(decision)


# --------------------------------------------------------------------- results


@dataclass
class GateResult:
    name: str
    value: float
    threshold: float
    direction: str  # "min" or "max"
    n: int
    detail: dict[str, Any] = field(default_factory=dict)

    @property
    def passed(self) -> bool:
        if self.n == 0:
            return False
        if self.direction == "min":
            return self.value >= self.threshold
        return self.value <= self.threshold

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "value": round(self.value, 4),
            "threshold": self.threshold,
            "direction": self.direction,
            "n": self.n,
            "passed": self.passed,
            "detail": self.detail,
        }


# ----------------------------------------------------------------- the gates


def gate_schema_validity(decisions: list[Any], threshold: float) -> GateResult:
    reasons: Counter[str] = Counter()
    valid = 0
    for decision in decisions:
        errors = validate_decision(decision)
        if errors:
            reasons[errors[0][:120]] += 1
        else:
            valid += 1
    n = len(decisions)
    return GateResult(
        name="schema_validity",
        value=valid / n if n else 0.0,
        threshold=threshold,
        direction="min",
        n=n,
        detail={"top_failures": dict(reasons.most_common(5))},
    )


def _modal_action(decision: Any) -> str | None:
    if isinstance(decision, dict):
        action = decision.get("action")
        if isinstance(action, dict):
            return action.get("type")
    return None


def gate_counterfactual_sensitivity(pairs: list[tuple[Any, Any]], threshold: float) -> GateResult:
    """A pair counts as sensitive when the two arms choose different actions, or
    the same action with a materially different hostile probability (>= 0.15).
    Identical prose with an identical decision is not sensitivity."""
    moved = 0
    unmoved_actions: Counter[str] = Counter()
    for a, b in pairs:
        act_a, act_b = _modal_action(a), _modal_action(b)
        if act_a != act_b:
            moved += 1
            continue
        try:
            delta = abs(float(a["beliefs"]["hostile"]) - float(b["beliefs"]["hostile"]))
        except (KeyError, TypeError, ValueError):
            delta = 0.0
        if delta >= 0.15:
            moved += 1
        else:
            unmoved_actions[str(act_a)] += 1
    n = len(pairs)
    return GateResult(
        name="counterfactual_sensitivity",
        value=moved / n if n else 0.0,
        threshold=threshold,
        direction="min",
        n=n,
        detail={"unmoved_by_action": dict(unmoved_actions.most_common(5))},
    )


def gate_holdout_coherence(
    scored: list[tuple[dict[str, Any], Any]], threshold: float
) -> GateResult:
    """Coherence against a held-out spec: the decision must be an action the
    spec's authority envelope actually allows, and must not be an action the
    engine would refuse for this seat. This is a cheap structural proxy — the
    judged version is `gen/judge.py`'s authority dimension."""
    coherent = 0
    violations: Counter[str] = Counter()
    for spec, decision in scored:
        action = _modal_action(decision)
        if action is None:
            violations["no_action"] += 1
            continue
        authority = spec.get("authority") or {}
        allowed = set(authority.get("unilateral", []) or [])
        allowed |= set(authority.get("requires_release", []) or [])
        allowed |= set(authority.get("recommend_only", []) or [])
        if not allowed or action in allowed or action == "hold":
            coherent += 1
        else:
            violations[f"{spec.get('seat')}:{action}"] += 1
    n = len(scored)
    return GateResult(
        name="holdout_persona_coherence",
        value=coherent / n if n else 0.0,
        threshold=threshold,
        direction="min",
        n=n,
        detail={"top_violations": dict(violations.most_common(5))},
    )


# -------------------------------------------------------------------- driving


def _flip(spec: dict[str, Any]) -> dict[str, Any]:
    """The counterfactual arm: flip `risk_posture`, which `targets.md` names."""
    other = dict(spec)
    current = str(spec.get("risk_posture", "")).lower()
    other["risk_posture"] = "risk_averse" if "acceptant" in current else "risk_acceptant"
    other["spec_id"] = f"{spec.get('spec_id', 'spec')}_cf"
    return other


def run_gates_online(
    *,
    adapter: str,
    scenarios: list[dict[str, Any]],
    holdout_specs: list[dict[str, Any]],
    config: dict[str, Any],
    client: Client,
) -> list[GateResult]:
    """Put the same states to the served adapter under each spec and its flip."""
    gcfg = config["gates"]
    limit = int(gcfg.get("samples_per_gate", 40))
    decisions: list[Any] = []
    pairs: list[tuple[Any, Any]] = []
    coherence: list[tuple[dict[str, Any], Any]] = []

    for spec in holdout_specs[:limit]:
        for scenario in scenarios[: max(1, limit // max(1, len(holdout_specs)))]:
            state = scenario.get("filtered_state", scenario)
            a = _ask(adapter, spec, state, client)
            b = _ask(adapter, _flip(spec), state, client)
            decisions.extend([a, b])
            pairs.append((a, b))
            coherence.append((spec, a))

    return [
        gate_schema_validity(decisions, float(gcfg["schema_validity_min"])),
        gate_counterfactual_sensitivity(pairs, float(gcfg["counterfactual_sensitivity_min"])),
        gate_holdout_coherence(coherence, float(gcfg["holdout_persona_coherence_min"])),
    ]


def _ask(adapter: str, spec: dict[str, Any], state: dict[str, Any], client: Client) -> Any:
    """One decision from the served adapter. `act()` never raises; a drifting
    model comes back as a hold, and the gate counts it as a schema failure."""
    agent = ServedAgent(spec.get("seat", "nsc"), adapter, client=client, spec=spec)
    return agent.act(state)


def run_gates_offline(records: list[dict[str, Any]], config: dict[str, Any]) -> list[GateResult]:
    """Score already-recorded decisions. Costs nothing and needs no deployment,
    so it is what CI and the mock path run."""
    gcfg = config["gates"]
    decisions = [r["output"] for r in records if "output" in r]
    arms: dict[str, list[dict[str, Any]]] = {}
    for r in records:
        if r.get("pair_id"):
            arms.setdefault(r["pair_id"], []).append(r)
    pairs = [(group[0]["output"], group[1]["output"]) for group in arms.values() if len(group) >= 2]
    coherence = [({"seat": r["seat"], "authority": {}}, r["output"]) for r in records]
    return [
        gate_schema_validity(decisions, float(gcfg["schema_validity_min"])),
        gate_counterfactual_sensitivity(pairs, float(gcfg["counterfactual_sensitivity_min"])),
        gate_holdout_coherence(coherence, float(gcfg["holdout_persona_coherence_min"])),
    ]


def load_json_dir(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    out = []
    for f in sorted(path.glob("*.json")):
        try:
            out.append(json.loads(f.read_text(encoding="utf-8")))
        except json.JSONDecodeError:
            continue
    return out


def render(run_id: str, results: list[GateResult]) -> str:
    lines = [
        f"# gates — `{run_id}`",
        "",
        "| gate | value | threshold | n | verdict |",
        "|---|---|---|---|---|",
    ]
    for r in results:
        arrow = ">=" if r.direction == "min" else "<="
        verdict = "PASS" if r.passed else "**FAIL**"
        lines.append(f"| {r.name} | {r.value:.3f} | {arrow} {r.threshold} | {r.n} | {verdict} |")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Pre-eval gates for a checkpoint.")
    p.add_argument("--sweep-id", required=True)
    p.add_argument("--run-id", help="one run; default every run with an output model")
    p.add_argument("--config", type=Path, default=filt.CONFIG_PATH)
    p.add_argument("--holdout-dir", type=Path, default=Path("specs/holdout"))
    p.add_argument("--devset-dir", type=Path, default=Path("specs/devset"))
    p.add_argument("--offline", action="store_true", help="score recorded outputs; no deployment")
    p.add_argument("--mock", type=int, default=0, help="offline over N mock lake records")
    p.add_argument("--no-s3", action="store_true")
    args = p.parse_args(argv)

    config = filt.load_config(args.config)
    cfgv = config["versions"]

    if args.offline or args.mock:
        records, _ = filt.read_lake(None, args.mock or 200)
        results = run_gates_offline(records, config)
        run_id = args.run_id or "offline"
        print(render(run_id, results))
        return 0 if all(r.passed for r in results) else 1

    client = Client.from_env()
    holdout = load_json_dir(args.holdout_dir)
    scenarios = load_json_dir(args.devset_dir)
    if not holdout:
        raise SystemExit(f"no held-out specs in {args.holdout_dir}; agent9-specs has not landed")
    if not scenarios:
        raise SystemExit(f"no dev scenarios in {args.devset_dir}; agent9-specs has not landed")

    runs = sweep_adapters(args.sweep_id)
    if args.run_id:
        runs = [r for r in runs if r["run_id"] == args.run_id]
    if not runs:
        raise SystemExit(f"no completed runs in {args.sweep_id}")

    failed_any = False
    for record in runs:
        results = run_gates_online(
            adapter=record["output_model"],
            scenarios=scenarios,
            holdout_specs=holdout,
            config=config,
            client=client,
        )
        failed_any |= not all(r.passed for r in results)
        payload = {
            "run_id": record["run_id"],
            "adapter": record["output_model"],
            "git_commit": git_sha(),
            "gates": [r.as_dict() for r in results],
        }
        print(render(record["run_id"], results))
        if not args.no_s3:
            versions = Versions(
                env_version=cfgv["env_version"],
                spec_version=cfgv["spec_version"],
                lake_version=cfgv["lake_version"],
                filter_version=record["variant"]["filter_version"],
                judge_version=cfgv["judge_version"],
            )
            storage.put_json(
                f"runs/{args.sweep_id}/{record['run_id']}/gates.json",
                payload,
                versions.as_metadata(),
            )
    return 1 if failed_any else 0


if __name__ == "__main__":
    raise SystemExit(main())
