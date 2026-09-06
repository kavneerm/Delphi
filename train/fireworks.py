"""Thin Fireworks client: datasets, SFT/DPO jobs, deployments, inference.

Everything goes over REST (`https://api.fireworks.ai/v1`), including dataset
upload, and that is not a preference. `firectl` 1.8.2 refuses every mutating
subcommand when it detects it is running under an agent:

    BLOCKED: mutating command "firectl dataset create" cannot run inside an
    AI agent for account "kavneer-s-majhail-29".

`--dry-run` is blocked too, so firectl is read-only here and `firectl signin`
(which needs a browser) is never invoked. REST also returns JSON we can record
verbatim into `checkpoints/<run_id>/provider.json`.

Dataset upload is therefore the four-step control-plane flow, in this order and
no other — calling `:validateUpload` before the bytes land wedges the dataset in
`UPLOADING` and every later `:getUploadEndpoint` on it answers 405:

1. ``POST  /datasets``                       with ``{datasetId, dataset:{format, exampleCount}}``
2. ``POST  /datasets/<id>:getUploadEndpoint`` with ``{filenameToSize:{name: size}}``
3. ``PUT`` the bytes to the returned signed GCS URL
4. ``POST  /datasets/<id>:validateUpload``

Auth is headless throughout: the API key rides every call as a bearer token.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

API_ROOT = "https://api.fireworks.ai/v1"
INFERENCE_ROOT = "https://api.fireworks.ai/inference/v1"

# Sweep bases, verified 2026-09-06 by actually submitting a 200-example SFT job
# rather than by reading a flag. See TUNABILITY_NOTE below: the flags lie.
BASE_MODELS: dict[str, dict[str, Any]] = {
    "llama31_8b": {
        "id": "accounts/fireworks/models/llama-v3p1-8b-instruct",
        "context_length": 131072,
        # Past its stated Deprecation Date 2025-11-26 and reporting Status:
        # INTERNAL -- and it trains anyway. A 200-example LoRA job ran to
        # JOB_STATE_COMPLETED in 371s and produced a usable adapter.
        "status": "INTERNAL",
        "deprecation_date": "2025-11-26",
        "smoke_verified": "2026-09-06 COMPLETED in 371s",
    },
    "qwen3_8b": {
        "id": "accounts/fireworks/models/qwen3-8b",
        "context_length": 40960,
        "status": "OK",
        "deprecation_date": "2026-05-14",
        "smoke_verified": "2026-09-06 COMPLETED",
        # Stands in for qwen2p5-7b-instruct, which the SFT API rejects outright.
        # NOT YET APPROVED -- see train/QUESTIONS.md #2. Choosing the sweep's
        # bases is a human call, so anything that would spend real budget on this
        # base has to pass --approve-base-swap or set APPROVE_BASE_SWAP=1. The
        # smoke test is exempt: proving it trains is what the question is for.
        "replaces": "qwen25_7b",
        "needs_approval": "train/QUESTIONS.md #2",
    },
}

#: Bases the brief named that turned out not to be trainable. Kept so that a
#: config still referencing one fails with an explanation instead of a KeyError.
REJECTED_BASES: dict[str, str] = {
    "qwen25_7b": (
        "accounts/fireworks/models/qwen2p5-7b-instruct is rejected by the SFT API with "
        "'model is not supported for fine-tuning', despite advertising Tunable: true and "
        "Supports Lora: true. So is qwen2p5-14b-instruct. Use qwen3_8b; see "
        "train/QUESTIONS.md #2."
    ),
}

TUNABILITY_NOTE = """`Tunable: true` and `Supports Lora: true` do NOT mean a model
accepts a supervised LoRA job. The field that tracks acceptance is
`Supervised Lora Tunable`, which `firectl get model` prints only when it is set:

    llama-v3p1-8b-instruct   Tunable Supports-Lora Rl-Tunable Supervised-Lora-Tunable  -> accepted
    qwen3-8b                 Tunable Supports-Lora Rl-Tunable Supervised-Lora-Tunable  -> accepted
    qwen2p5-7b-instruct      Tunable Supports-Lora                                     -> REJECTED
    qwen2p5-14b-instruct     Tunable Supports-Lora Rl-Tunable                          -> REJECTED

`supports_supervised_lora()` below reads it over REST so a base can be checked
before the sweep spends anything. It is a good filter, not a proof: the only
proof is a 200-example job."""

#: Smallest context window across the sweep's bases. `train/filter.py` measures
#: every example against this so the Qwen arm cannot degrade silently.
MIN_CONTEXT_LENGTH = min(m["context_length"] for m in BASE_MODELS.values())

#: Deployments must name one explicitly. One of NVIDIA_A100_80GB,
#: NVIDIA_H100_80GB, NVIDIA_H200_141GB, AMD_MI300X_192GB. H100 is what the
#: account has training quota for (8).
DEFAULT_ACCELERATOR = "NVIDIA_H100_80GB"

#: Multi-LoRA addons cannot ride a quantized deployment (FP8/FP4). BF16 is the
#: default precision both sweep bases are published at.
ADDON_SAFE_PRECISION = "BF16"

# 1-63 chars, must start and end alphanumeric. A single character is legal;
# requiring two silently rejected short ids.
_RESOURCE_ID = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")


class FireworksError(RuntimeError):
    """A Fireworks call failed. Carries the provider's own message where there is one."""


def api_key() -> str:
    key = os.environ.get("FIREWORKS_API_KEY", "").strip()
    if not key:
        raise FireworksError("FIREWORKS_API_KEY is not set; secrets come from env only")
    return key


def resource_id(name: str) -> str:
    """Coerce a run id into the id shape Fireworks accepts (lowercase, hyphens)."""
    out = re.sub(r"[^a-z0-9-]+", "-", name.lower()).strip("-")[:62]
    if not _RESOURCE_ID.match(out):
        raise ValueError(f"cannot form a Fireworks resource id from {name!r}")
    return out


@dataclass(frozen=True)
class Client:
    """Fireworks account handle. `account` is the bare id, not the resource name."""

    account: str
    key: str
    dry_run: bool = False

    @classmethod
    def from_env(cls, dry_run: bool = False) -> Client:
        key = api_key()
        account = os.environ.get("FIREWORKS_ACCOUNT_ID", "").strip()
        if not account:
            account = cls._discover_account(key)
        return cls(account=account, key=key, dry_run=dry_run)

    @staticmethod
    def _discover_account(key: str) -> str:
        import httpx

        # firectl whoami needs a signin session; the REST list works off the key alone.
        resp = httpx.get(
            f"{API_ROOT}/accounts",
            headers={"Authorization": f"Bearer {key}"},
            timeout=30,
        )
        if resp.status_code != 200:
            raise FireworksError(f"cannot resolve account: {resp.status_code} {resp.text}")
        accounts = resp.json().get("accounts", [])
        if not accounts:
            raise FireworksError("API key is not attached to any account")
        return accounts[0]["name"].split("/")[-1]

    # ---------------------------------------------------------------- REST

    def _request(self, method: str, path: str, body: dict | None = None) -> dict:
        import httpx

        url = f"{API_ROOT}/{path.lstrip('/')}"
        if self.dry_run and method != "GET":
            return {"dry_run": True, "method": method, "url": url, "body": body}
        resp = httpx.request(
            method,
            url,
            headers={
                "Authorization": f"Bearer {self.key}",
                "Content-Type": "application/json",
            },
            json=body,
            timeout=120,
        )
        if resp.status_code >= 400:
            raise FireworksError(f"{method} {url} -> {resp.status_code} {resp.text}")
        return resp.json() if resp.content else {}

    def get(self, path: str) -> dict:
        return self._request("GET", path)

    def post(self, path: str, body: dict) -> dict:
        return self._request("POST", path, body)

    def delete(self, path: str) -> dict:
        return self._request("DELETE", path)

    # ------------------------------------------------------------- firectl

    def firectl(self, args: list[str], timeout: int = 900) -> str:
        cmd = ["firectl", *args, "--api-key", self.key, "--account-id", self.account]
        if self.dry_run:
            return f"DRY RUN: {' '.join(a for a in cmd if not a.startswith('fw_'))}"
        env = {**os.environ, "FIRECTL_NO_UPDATE_NOTICE": "1"}
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=env)
        if proc.returncode != 0:
            redacted = " ".join(a for a in cmd if not a.startswith("fw_"))
            raise FireworksError(f"{redacted}\n{proc.stdout}\n{proc.stderr}")
        return proc.stdout

    # ------------------------------------------------------------ datasets

    def create_dataset(self, dataset_id: str, path: Path, *, fmt: str = "CHAT") -> str:
        """Upload a JSONL file as a dataset. Returns the full resource name.

        Four steps, in order; see the module docstring for why the order matters.
        """
        import httpx

        dataset_id = resource_id(dataset_id)
        name = f"accounts/{self.account}/datasets/{dataset_id}"
        lines = path.read_text(encoding="utf-8").splitlines()
        example_count = sum(1 for line in lines if line.strip())
        if example_count == 0:
            raise FireworksError(f"{path} is empty; nothing to upload")

        self.post(
            f"accounts/{self.account}/datasets",
            {
                "datasetId": dataset_id,
                "dataset": {"format": fmt, "exampleCount": str(example_count)},
            },
        )
        if self.dry_run:
            return name

        filename = path.name
        endpoint = self.post(
            f"accounts/{self.account}/datasets/{dataset_id}:getUploadEndpoint",
            {"filenameToSize": {filename: str(path.stat().st_size)}},
        )
        signed = endpoint.get("filenameToSignedUrls", {}).get(filename)
        if not signed:
            detail = json.dumps(endpoint)[:400]
            raise FireworksError(f"no signed upload URL for {filename}: {detail}")

        # The signed URL's X-Goog-SignedHeaders is
        # `content-type;host;x-goog-content-length-range`, so both headers must be
        # sent verbatim or GCS answers 400 MalformedSecurityHeader.
        size = path.stat().st_size
        put = httpx.put(
            signed,
            content=path.read_bytes(),
            headers={
                "Content-Type": "application/octet-stream",
                "x-goog-content-length-range": f"{size},{size}",
            },
            timeout=600,
        )
        if put.status_code >= 400:
            raise FireworksError(f"upload PUT -> {put.status_code} {put.text[:400]}")

        self.post(f"accounts/{self.account}/datasets/{dataset_id}:validateUpload", {})
        state = self.get_dataset(dataset_id).get("state")
        if state not in ("READY", "STATE_UNSPECIFIED"):
            raise FireworksError(f"dataset {dataset_id} is {state!r} after validateUpload")
        return name

    def delete_dataset(self, dataset_id: str) -> dict:
        return self.delete(f"accounts/{self.account}/datasets/{resource_id(dataset_id)}")

    def get_dataset(self, dataset_id: str) -> dict:
        return self.get(f"accounts/{self.account}/datasets/{resource_id(dataset_id)}")

    # ------------------------------------------------------------- preflight

    def get_model(self, model_id: str) -> dict:
        if not model_id.startswith("accounts/"):
            model_id = f"accounts/fireworks/models/{model_id}"
        return self.get(model_id)

    def supports_supervised_lora(self, model_id: str) -> bool:
        """Whether a base will accept a supervised LoRA job. See TUNABILITY_NOTE.

        `supervisedLoraTunable` sits at the TOP level of the model resource, not
        under `baseModelDetails` where `tunable` lives — reading it from the
        wrong level makes every base look untrainable.
        """
        return bool(self.get_model(model_id).get("supervisedLoraTunable"))

    def preflight(self, base_keys: list[str], *, allow_unapproved: bool = True) -> dict[str, str]:
        """Check every sweep base before spending. Returns key -> problem, empty if fine.

        `allow_unapproved=False` also blocks bases carrying `needs_approval`, so a
        sweep cannot quietly spend budget on a base substitution a human has not
        signed off. The smoke test leaves it True: demonstrating that a candidate
        base trains is precisely the evidence the question is waiting on.
        """
        problems: dict[str, str] = {}
        for key in base_keys:
            base_entry = BASE_MODELS.get(key) or {}
            if not allow_unapproved and base_entry.get("needs_approval"):
                problems[key] = (
                    f"{key} is an unapproved base substitution pending "
                    f"{base_entry['needs_approval']}. Re-run with --approve-base-swap "
                    "(or APPROVE_BASE_SWAP=1) once a human has answered."
                )
                continue
            if key in REJECTED_BASES:
                problems[key] = REJECTED_BASES[key]
                continue
            base = BASE_MODELS.get(key)
            if base is None:
                problems[key] = f"unknown base {key!r}; have {sorted(BASE_MODELS)}"
                continue
            try:
                if not self.supports_supervised_lora(base["id"]):
                    problems[key] = (
                        f"{base['id']} does not report Supervised Lora Tunable; the SFT API "
                        "will refuse it. See TUNABILITY_NOTE."
                    )
            except FireworksError as exc:
                problems[key] = f"{base['id']} could not be fetched: {str(exc)[:200]}"
        return problems

    # ----------------------------------------------------------- SFT / DPO

    def create_sft_job(
        self,
        *,
        job_id: str,
        dataset_id: str,
        output_model_id: str,
        base_model: str | None = None,
        warm_start_from: str | None = None,
        lora_rank: int = 16,
        epochs: int = 2,
        learning_rate: float | None = None,
        max_context_length: int | None = None,
    ) -> dict:
        """Create an SFT LoRA job. Exactly one of base_model / warm_start_from."""
        if (base_model is None) == (warm_start_from is None):
            raise ValueError("pass exactly one of base_model or warm_start_from")
        body: dict[str, Any] = {
            "dataset": f"accounts/{self.account}/datasets/{resource_id(dataset_id)}",
            "outputModel": f"accounts/{self.account}/models/{resource_id(output_model_id)}",
            "loraRank": lora_rank,
            "epochs": epochs,
        }
        if base_model:
            body["baseModel"] = base_model
        else:
            body["warmStartFrom"] = warm_start_from
        if learning_rate is not None:
            body["learningRate"] = learning_rate
        if max_context_length is not None:
            body["maxContextLength"] = max_context_length
        job = resource_id(job_id)
        return self.post(
            f"accounts/{self.account}/supervisedFineTuningJobs?supervisedFineTuningJobId={job}",
            body,
        )

    def get_sft_job(self, job_id: str) -> dict:
        return self.get(f"accounts/{self.account}/supervisedFineTuningJobs/{resource_id(job_id)}")

    def create_dpo_job(
        self,
        *,
        job_id: str,
        dataset_id: str,
        output_model_id: str,
        warm_start_from: str,
        lora_rank: int = 16,
        epochs: int = 1,
        learning_rate: float | None = None,
    ) -> dict:
        body: dict[str, Any] = {
            "dataset": f"accounts/{self.account}/datasets/{resource_id(dataset_id)}",
            "outputModel": f"accounts/{self.account}/models/{resource_id(output_model_id)}",
            "warmStartFrom": warm_start_from,
            "loraRank": lora_rank,
            "epochs": epochs,
        }
        if learning_rate is not None:
            body["learningRate"] = learning_rate
        job = resource_id(job_id)
        return self.post(f"accounts/{self.account}/dpoJobs?dpoJobId={job}", body)

    def get_dpo_job(self, job_id: str) -> dict:
        return self.get(f"accounts/{self.account}/dpoJobs/{resource_id(job_id)}")

    # --------------------------------------------------------- deployments

    def create_deployment(
        self,
        *,
        deployment_id: str,
        base_model: str,
        min_replica_count: int = 0,
        max_replica_count: int = 1,
        accelerator_type: str | None = None,
        precision: str | None = None,
    ) -> dict:
        body: dict[str, Any] = {
            "baseModel": base_model,
            "minReplicaCount": min_replica_count,
            "maxReplicaCount": max_replica_count,
            # Multi-LoRA: every sweep adapter rides one deployment.
            "enableAddons": True,
            # Addons and quantized precision are mutually exclusive. Fireworks
            # picks a quantized default for some bases (qwen3-8b among them) and
            # then refuses the deployment with "addons cannot be enabled with
            # quantized precisions (FP8/FP4)", so name an unquantized precision
            # rather than inherit one.
            "precision": precision or ADDON_SAFE_PRECISION,
        }
        # Fireworks refuses a non-embeddings deployment without one:
        # 400 "accelerator_type must be specified for non-embeddings engines".
        body["acceleratorType"] = accelerator_type or DEFAULT_ACCELERATOR
        dep = resource_id(deployment_id)
        return self.post(f"accounts/{self.account}/deployments?deploymentId={dep}", body)

    def get_deployment(self, deployment_id: str) -> dict:
        return self.get(f"accounts/{self.account}/deployments/{resource_id(deployment_id)}")

    def delete_deployment(self, deployment_id: str) -> dict:
        return self.delete(f"accounts/{self.account}/deployments/{resource_id(deployment_id)}")

    def model_name(self, model_id: str) -> str:
        if model_id.startswith("accounts/"):
            return model_id
        return f"accounts/{self.account}/models/{resource_id(model_id)}"

    def inference_refs(self, model_id: str, deployment_id: str) -> list[str]:
        """Candidate `model` strings for an adapter on a dedicated deployment.

        Fireworks does not document one canonical form and the failure modes are
        unhelpfully different — a bare model name answers
        `404 "Model not found, inaccessible, and/or not deployed"`, while a
        fully-qualified `#accounts/.../deployments/...` suffix answers
        `404 fault filter abort` from the edge proxy. `probe_inference_ref()`
        tries these in order once, inside a deployment that is already up, and
        the winner is cached in `docs/VERSIONS.md` so it is paid for once.
        """
        dep_short = resource_id(deployment_id)
        model = self.model_name(model_id)
        return [
            f"{model}#{dep_short}",
            f"{model}#accounts/{self.account}/deployments/{dep_short}",
            model,
            model.split("/")[-1],
        ]

    def inference_ref(self, model_id: str, deployment_id: str) -> str:
        """The preferred ref form. See `inference_refs` for why there is a list."""
        return self.inference_refs(model_id, deployment_id)[0]

    def probe_inference_ref(
        self, model_id: str, deployment_id: str, **chat_kwargs: Any
    ) -> tuple[str | None, list[dict[str, str]]]:
        """Try each candidate ref against a live deployment. Returns (winner, trail)."""
        trail: list[dict[str, str]] = []
        for ref in self.inference_refs(model_id, deployment_id):
            try:
                self.chat(
                    ref,
                    [{"role": "user", "content": "ping"}],
                    max_tokens=4,
                    temperature=0.0,
                    **chat_kwargs,
                )
            except FireworksError as exc:
                trail.append({"ref": ref, "result": str(exc)[:160]})
                continue
            trail.append({"ref": ref, "result": "ok"})
            return ref, trail
        return None, trail

    def load_lora(self, deployment_id: str, model_id: str) -> dict:
        """Attach a tuned adapter to a deployment as a deployed model (multi-LoRA)."""
        dep = f"accounts/{self.account}/deployments/{resource_id(deployment_id)}"
        body = {"model": self.model_name(model_id), "deployment": dep}
        return self.post(f"accounts/{self.account}/deployedModels", body)

    def get_deployed_model(self, deployed_model_id: str) -> dict:
        return self.get(f"accounts/{self.account}/deployedModels/{resource_id(deployed_model_id)}")

    def load_lora_and_wait(self, deployment_id: str, model_id: str, *, timeout: int = 900) -> dict:
        """Attach an adapter and wait for it to actually be servable.

        `POST /deployedModels` returns as soon as the attach is accepted, not when
        the adapter can answer. Sending inference in that window 404s.
        """
        created = self.load_lora(deployment_id, model_id)
        name = created.get("name", "")
        deployed_id = name.split("/")[-1] if name else ""
        if not deployed_id or self.dry_run:
            return created
        return self.wait(
            lambda: self.get_deployed_model(deployed_id),
            done=("DEPLOYED", "READY", "STATE_UNSPECIFIED"),
            failed=("FAILED", "DELETING", "UNDEPLOYING"),
            interval=10,
            timeout=timeout,
        )

    def unload_lora(self, deployed_model_id: str) -> dict:
        return self.delete(
            f"accounts/{self.account}/deployedModels/{resource_id(deployed_model_id)}"
        )

    # ----------------------------------------------------------- inference

    def chat(self, model: str, messages: list[dict], **kwargs: Any) -> dict:
        import httpx

        body = {"model": model, "messages": messages, **kwargs}
        resp = httpx.post(
            f"{INFERENCE_ROOT}/chat/completions",
            headers={
                "Authorization": f"Bearer {self.key}",
                "Content-Type": "application/json",
            },
            json=body,
            timeout=180,
        )
        if resp.status_code >= 400:
            raise FireworksError(f"chat -> {resp.status_code} {resp.text}")
        return resp.json()

    # -------------------------------------------------------------- polling

    def wait(
        self,
        fetch,
        *,
        done: tuple[str, ...] = ("JOB_STATE_COMPLETED", "COMPLETED"),
        failed: tuple[str, ...] = (
            "JOB_STATE_FAILED",
            "JOB_STATE_CANCELLED",
            "JOB_STATE_DELETING",
            "FAILED",
        ),
        interval: int = 20,
        timeout: int = 5400,
    ) -> dict:
        """Poll `fetch()` until its `state` lands in `done` or `failed`."""
        deadline = time.monotonic() + timeout
        last: dict = {}
        while time.monotonic() < deadline:
            last = fetch()
            state = str(last.get("state", ""))
            if state in done:
                return last
            if state in failed:
                raise FireworksError(f"terminal state {state}: {json.dumps(last)[:1200]}")
            time.sleep(interval)
        raise FireworksError(f"timed out after {timeout}s in state {last.get('state')!r}")
