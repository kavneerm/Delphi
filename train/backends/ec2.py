"""EC2 (Unsloth/PEFT + vLLM) training backend — STUB, never exercised.

EC2 G/VT on-demand quota `L-DB2E81BA` is 0; the increase request
`312f3b0f78754d25920d9b0f6482d2feWs3fPUjY` is `CASE_OPENED`. Nothing here has
run. The intended shape:

1. Provision g5.12xlarge or p4d via `infra/gpu_setup.sh` (agent8-infra owns it);
   the AMI carries CUDA, PyTorch, PEFT, Unsloth and vLLM.
2. Pull `runs/<sweep>/<run>/dataset_*.jsonl`, train LoRA with Unsloth at the
   rank/epochs from `train/config.yaml`.
3. Push adapter weights to `checkpoints/<run_id>/adapter/` and write the same
   `provider.json` `launch.py` writes for Fireworks.
4. Serve with `infra/serve_vllm.sh <checkpoint_s3_uri>`; `train/serve.py` points
   its client at that endpoint instead of the Fireworks deployment.
5. `infra/teardown.sh` keys on `project=svalbard`, so tag the instance.

Cost discipline is the same as Fireworks: the box is billed by the hour, so it
comes up for a phase and goes down at the end of it, logged to `docs/VERSIONS.md`.
"""

from __future__ import annotations

from typing import Any, NoReturn

from train.backends import BackendUnavailable

QUOTA_NOTE = (
    "EC2 G/VT on-demand quota L-DB2E81BA is 0 (increase "
    "312f3b0f78754d25920d9b0f6482d2feWs3fPUjY, CASE_OPENED). No GPU instance exists; "
    "use --backend fireworks."
)


def launch(**_: Any) -> NoReturn:
    raise BackendUnavailable(QUOTA_NOTE)


def serve(**_: Any) -> NoReturn:
    raise BackendUnavailable(QUOTA_NOTE)
