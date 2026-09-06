"""SageMaker training backend — STUB, never exercised.

Every g5 training quota on the account is 0, so no `CreateTrainingJob` call in
this file has ever been made. The intended shape, for whoever picks it up:

1. `train/filter.py` output to `s3://$WARGAME_BUCKET/runs/<sweep>/<run>/dataset_*.jsonl`
   (already how `launch.py` writes it, so nothing changes here).
2. A HuggingFace estimator on `ml.g5.12xlarge` running PEFT LoRA, entry point
   under `train/backends/sagemaker_entry.py` (not written).
3. Adapter weights back to `checkpoints/<run_id>/adapter/`, and the same
   `provider.json` shape `launch.py` writes for Fireworks so that `serve.py`,
   `gates.py` and `devset.py` do not branch on backend.
4. Serving via `infra/serve_vllm.sh` against those weights.

Keeping the `provider.json` contract identical across backends is the point: a
sweep that spans providers must still produce one comparable summary table.
"""

from __future__ import annotations

from typing import Any, NoReturn

from train.backends import BackendUnavailable

QUOTA_NOTE = (
    "SageMaker g5 training quota is 0 on this account. Request an increase before "
    "using --backend sagemaker; agent8-infra tracks provisioning."
)


def launch(**_: Any) -> NoReturn:
    raise BackendUnavailable(QUOTA_NOTE)


def serve(**_: Any) -> NoReturn:
    raise BackendUnavailable(QUOTA_NOTE)
