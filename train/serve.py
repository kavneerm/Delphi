"""One Fireworks deployment, every sweep adapter on it, torn down on demand.

    python -m train.serve --up   --sweep-id sweep-20260906-01
    python -m train.serve --down --sweep-id sweep-20260906-01
    python -m train.serve --status --sweep-id sweep-20260906-01

**This costs money the whole time it is up.** The deployment is billed per
GPU-hour, so it comes up only for dev-set eval, round-2 generation and final
validation, and `--down` deletes it between each. Every up and down is appended
to `docs/VERSIONS.md` with a UTC timestamp — that log is the only record of what
the sweep actually cost, so it is written before the API call for `--up` and
after it for `--down`, and never skipped on the error path.

One deployment, not one per adapter: the sweep's adapters share a base, and
Fireworks multi-LoRA loads many tuned adapters onto a single deployment,
selected by model name per request. Two bases means at most two deployments;
`--base` picks which one this invocation manages.

`ServedAgent` implements `engine.agent_api` (see `train/agent_api_shim.py`) as a
thin client: construct it with an adapter name, and every `decide()` routes that
seat's turn to that adapter on the shared deployment.
"""

from __future__ import annotations

import argparse
import json
import re
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from engine.agent_api import BaseAgent, coerce_decision
from train import filter as filt
from train import storage
from train.fireworks import BASE_MODELS, Client, FireworksError, resource_id
from train.versions import git_sha

VERSIONS_DOC = Path("docs/VERSIONS.md")
DEPLOYMENT_LOG_HEADING = "## Fireworks deployment log"

_JSON_BLOCK = re.compile(r"\{.*\}", re.DOTALL)


def deployment_id(prefix: str, sweep_id: str, base: str) -> str:
    return resource_id(f"{prefix}-{sweep_id}-{base}")


# --------------------------------------------------------------- cost logging


def log_deployment_event(
    event: str,
    *,
    deployment: str,
    base: str,
    sweep_id: str,
    detail: str = "",
    path: Path = VERSIONS_DOC,
) -> str:
    """Append one row to the deployment log in `docs/VERSIONS.md`.

    Billed per GPU-hour: an unlogged `--up` is an unaccounted bill, so this runs
    before the create call and after the delete call, on every path.
    """
    stamp = datetime.now(UTC).isoformat(timespec="seconds")
    row = f"| {stamp} | {event} | `{deployment}` | {base} | `{sweep_id}` | {git_sha()} | {detail} |"
    header = [
        DEPLOYMENT_LOG_HEADING,
        "",
        "`train/serve.py` writes one row per up/down. The deployment is billed per",
        "GPU-hour; a gap between an `up` row and its `down` row is money spent.",
        "",
        "| utc | event | deployment | base | sweep | git | detail |",
        "|---|---|---|---|---|---|---|",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    if DEPLOYMENT_LOG_HEADING not in existing:
        prefix = existing.rstrip("\n") + "\n\n" if existing.strip() else ""
        existing = prefix + "\n".join(header) + "\n"
    path.write_text(existing.rstrip("\n") + "\n" + row + "\n", encoding="utf-8")
    return row


# -------------------------------------------------------------- adapter table


def sweep_adapters(sweep_id: str, base: str | None = None) -> list[dict[str, Any]]:
    """Every completed run in a sweep, from `checkpoints/<run_id>/provider.json`."""
    out: list[dict[str, Any]] = []
    for key in storage.list_keys(f"runs/{sweep_id}/"):
        if not key.endswith("/manifest.json"):
            continue
        try:
            record = json.loads(storage.get_text(key))
        except (json.JSONDecodeError, KeyError):
            continue
        if not record.get("output_model"):
            continue
        if base and record.get("variant", {}).get("base") != base:
            continue
        out.append(record)
    return sorted(out, key=lambda r: r["run_id"])


# ------------------------------------------------------------------- lifecycle


def up(
    *,
    sweep_id: str,
    base: str,
    config: dict[str, Any],
    client: Client,
    adapters: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Create the deployment and load every sweep adapter for `base` onto it."""
    scfg = config["serve"]
    base_model = BASE_MODELS[base]["id"]
    dep = deployment_id(scfg["deployment_id_prefix"], sweep_id, base)
    adapters = sweep_adapters(sweep_id, base) if adapters is None else adapters

    log_deployment_event(
        "up_requested",
        deployment=dep,
        base=base,
        sweep_id=sweep_id,
        detail=f"{len(adapters)} adapter(s)",
    )
    client.create_deployment(
        deployment_id=dep,
        base_model=base_model,
        min_replica_count=int(scfg.get("min_replica_count", 0)),
        max_replica_count=int(scfg.get("max_replica_count", 1)),
        accelerator_type=scfg.get("accelerator_type"),
    )
    client.wait(
        lambda: client.get_deployment(dep),
        done=("READY",),
        failed=("FAILED", "DELETING", "UNSPECIFIED"),
        interval=15,
        timeout=2400,
    )

    loaded: list[str] = []
    errors: list[str] = []
    for record in adapters:
        model = record["output_model"]
        try:
            client.load_lora_and_wait(dep, model)
            loaded.append(client.inference_ref(model, dep))
        except FireworksError as exc:
            errors.append(f"{record['run_id']}: {str(exc)[:200]}")

    log_deployment_event(
        "up",
        deployment=dep,
        base=base,
        sweep_id=sweep_id,
        detail=f"{len(loaded)} loaded, {len(errors)} failed",
    )
    return {"deployment": dep, "base": base, "loaded": loaded, "errors": errors}


def down(*, sweep_id: str, base: str, config: dict[str, Any], client: Client) -> dict[str, Any]:
    """Delete the deployment. Logs the row whether or not the delete succeeds."""
    dep = deployment_id(config["serve"]["deployment_id_prefix"], sweep_id, base)
    gone = client.ensure_deployment_gone(dep)
    detail = "deleted and confirmed gone" if gone["deleted"] else f"STILL UP: {gone}"
    log_deployment_event("down", deployment=dep, base=base, sweep_id=sweep_id, detail=detail)
    return {"deployment": dep, "base": base, "confirmed_gone": gone["deleted"], "detail": detail}


def status(*, sweep_id: str, base: str, config: dict[str, Any], client: Client) -> dict[str, Any]:
    dep = deployment_id(config["serve"]["deployment_id_prefix"], sweep_id, base)
    try:
        return {"deployment": dep, **client.get_deployment(dep)}
    except FireworksError as exc:
        return {"deployment": dep, "state": "ABSENT", "detail": str(exc)[:200]}


# ---------------------------------------------------------------- served agent


class ServedAgent(BaseAgent):
    """`engine.agent_api.Agent` over one adapter on the shared deployment.

    The adapter is chosen per instance, not per deployment, which is the whole
    point of multi-LoRA: nine seats can be nine different sweep adapters against
    one billed GPU.

    `act()` never raises. `engine/agent_api.py` is explicit that "an invalid
    decision becomes a logged `hold` rather than a crashed episode — a served
    model that drifts should cost one decision point, not a sweep cell", so a
    malformed completion, a refusal, or a network error all come back as a hold
    that says why. `schema_failures` counts them, and `train/gates.py` reads that
    count as the schema-validity gate rather than inferring it.
    """

    def __init__(
        self,
        seat: str,
        adapter: str,
        *,
        deployment: str | None = None,
        client: Client | None = None,
        spec: Mapping[str, Any] | None = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
    ) -> None:
        super().__init__(seat, dict(spec or {}))
        self.client = client or Client.from_env()
        # An adapter on a dedicated deployment must be addressed as
        # <model>#<deployment>, or inference 404s despite the adapter being loaded.
        self.adapter = (
            self.client.inference_ref(adapter, deployment)
            if deployment and "#" not in adapter
            else adapter
        )
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.last_raw: str | None = None
        self.schema_failures = 0
        self.calls = 0

    # ------------------------------------------------------------------ prompt

    def system_turn(self) -> str:
        """The same system turn `filter.py` trained on. Identical rendering or the
        served model sees a prompt shape it never saw in training."""
        if self.spec:
            return filt.render_spec(dict(self.spec))
        return filt.SPEC_STUB.format(
            seat=self.seat,
            spec_id=self.spec.get("spec_id", "unknown"),
            spec_version=self.spec.get("spec_version", "unknown"),
        )

    def user_turn(self, view: Mapping[str, Any]) -> str:
        record = {
            "filtered_state": dict(view),
            "injects_seen": view.get("injects_seen") or [],
            "messages_seen": view.get("messages_seen") or [],
        }
        return filt.user_turn(record)

    # ------------------------------------------------------------------- act

    def act(self, view: Mapping[str, Any]) -> Mapping[str, Any]:
        """One decision from the served adapter. Always contract-valid."""
        self.calls += 1
        try:
            reply = self.client.chat(
                model=self.adapter,
                messages=[
                    {"role": "system", "content": self.system_turn()},
                    {"role": "user", "content": self.user_turn(view)},
                ],
                temperature=self.temperature,
                max_tokens=self.max_tokens,
                response_format={"type": "json_object"},
            )
            self.last_raw = reply["choices"][0]["message"]["content"]
        except (FireworksError, KeyError, IndexError) as exc:
            self.schema_failures += 1
            return hold(f"Served adapter {self.adapter} did not answer: {str(exc)[:200]}")

        parsed = parse_decision(self.last_raw)
        decision, errors = coerce_decision(parsed, seat=self.seat)
        if errors:
            self.schema_failures += 1
        return decision

    def decide_release(
        self, request: Mapping[str, Any], view: Mapping[str, Any]
    ) -> tuple[bool, str]:
        """Ask the adapter to answer a release request, in the persona's voice.

        `BaseAgent` denies by default, which is the right default for silence but
        the wrong one for a seat that is supposed to be exercising judgement: a
        releasing seat that always denies makes every `requires_release` action
        unreachable and the sweep would never see one. Anything that does not
        parse falls back to the deny.
        """
        prompt = (
            "A release request has been routed to you.\n\n"
            f"{json.dumps(dict(request), indent=2, sort_keys=True)}\n\n"
            "Answer with a JSON object: "
            '{"granted": true|false, "rationale": "one sentence in your own voice"}'
        )
        try:
            reply = self.client.chat(
                model=self.adapter,
                messages=[
                    {"role": "system", "content": self.system_turn()},
                    {"role": "user", "content": self.user_turn(view) + "\n\n" + prompt},
                ],
                temperature=self.temperature,
                max_tokens=256,
                response_format={"type": "json_object"},
            )
            answer = parse_decision(reply["choices"][0]["message"]["content"]) or {}
        except (FireworksError, KeyError, IndexError):
            return super().decide_release(request, view)
        if "granted" not in answer:
            return super().decide_release(request, view)
        rationale = str(answer.get("rationale") or "").strip()
        return bool(answer["granted"]), rationale or "No rationale given."


def hold(reasoning: str) -> dict[str, Any]:
    """A contract-valid hold. Thin wrapper so the import site reads clearly."""
    from engine.agent_api import hold_decision

    return hold_decision(reasoning)


def parse_decision(text: str) -> dict[str, Any] | None:
    """Best-effort JSON extraction. Returns None rather than raising, so
    `gates.py` can count a schema failure instead of dying on one."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    match = _JSON_BLOCK.search(text or "")
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


# ------------------------------------------------------------------------- cli


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Manage the shared Fireworks deployment.")
    p.add_argument("--backend", choices=("fireworks", "sagemaker", "ec2"), default="fireworks")
    p.add_argument("--sweep-id", required=True)
    p.add_argument("--base", default="qwen25_7b", choices=sorted(BASE_MODELS))
    p.add_argument("--config", type=Path, default=filt.CONFIG_PATH)
    action = p.add_mutually_exclusive_group(required=True)
    action.add_argument("--up", action="store_true")
    action.add_argument("--down", action="store_true")
    action.add_argument("--status", action="store_true")
    args = p.parse_args(argv)

    if args.backend != "fireworks":
        raise SystemExit(
            f"backend {args.backend!r} would need vLLM on an EC2 GPU; quota L-DB2E81BA is 0. "
            "See train/backends/."
        )

    config = filt.load_config(args.config)
    client = Client.from_env()
    if args.up:
        result = up(sweep_id=args.sweep_id, base=args.base, config=config, client=client)
    elif args.down:
        result = down(sweep_id=args.sweep_id, base=args.base, config=config, client=client)
    else:
        result = status(sweep_id=args.sweep_id, base=args.base, config=config, client=client)
    print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
