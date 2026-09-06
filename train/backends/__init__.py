"""Non-Fireworks training backends. Both are unexercised stubs.

There is no GPU to run them on:

* EC2 G/VT on-demand quota `L-DB2E81BA` is **0**, with an increase request
  pending (`312f3b0f78754d25920d9b0f6482d2feWs3fPUjY`, `CASE_OPENED`).
* Every SageMaker g5 training quota is **0**.

They exist so that when quota lands the shape of the work is already written
down, and so `--backend sagemaker` fails with a sentence explaining why rather
than an AttributeError. Neither has ever been run; do not treat either as
tested. `agent8-infra` owns the provisioning side (`infra/gpu_setup.sh`,
`infra/serve_vllm.sh`).
"""

from __future__ import annotations


class BackendUnavailable(RuntimeError):
    """Raised by every stub entry point. Carries the quota that blocks it."""
