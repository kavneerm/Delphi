#!/usr/bin/env bash
# gpu_setup.sh — bring a fresh g5.12xlarge to the point where it can fine-tune and
# serve. Runs either as EC2 user-data (provision_gpu.sh passes it that way) or by
# hand over SSM/SSH on any CUDA box:
#
#   sudo bash infra/gpu_setup.sh
#
# Assumes the Deep Learning OSS Nvidia Driver AMI (Ubuntu 22.04): driver + CUDA are
# already there. It installs the training and serving stack into one venv at
# /opt/svalbard/venv and verifies the GPUs are visible from torch before exiting.
#
# NOT RUN AGAINST ANY INSTANCE as of 2026-09-05: the G-instance quota is 0.

set -euo pipefail

VENV="${VENV:-/opt/svalbard/venv}"
TORCH_CUDA="${TORCH_CUDA:-cu124}"
LOG=/var/log/svalbard-gpu-setup.log
exec > >(tee -a "$LOG") 2>&1

echo "== svalbard gpu setup $(date -Is)"

if ! command -v nvidia-smi >/dev/null; then
  echo "no nvidia-smi: this AMI has no driver. Use a Deep Learning AMI." >&2
  exit 1
fi
nvidia-smi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends python3.12 python3.12-venv python3-pip git tmux jq unzip

if ! command -v aws >/dev/null; then
  curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscli.zip
  unzip -q /tmp/awscli.zip -d /tmp && /tmp/aws/install --update
fi

mkdir -p "$(dirname "$VENV")" /opt/svalbard/checkpoints /opt/svalbard/data
python3.12 -m venv "$VENV"
# shellcheck disable=SC1091
source "$VENV/bin/activate"
pip install --upgrade pip wheel

# Torch first and pinned to the CUDA wheel index, so nothing below drags in a
# CPU-only build as a transitive dependency.
pip install --index-url "https://download.pytorch.org/whl/${TORCH_CUDA}" torch torchvision torchaudio

pip install \
  "transformers>=4.44" \
  "peft>=0.13" \
  "trl>=0.11" \
  "accelerate>=0.34" \
  "datasets>=3.0" \
  "bitsandbytes>=0.44" \
  "vllm>=0.6.3" \
  "unsloth" \
  "boto3" \
  "huggingface_hub[hf_transfer]"

python - <<'PY'
import torch
print("torch", torch.__version__, "cuda", torch.version.cuda)
assert torch.cuda.is_available(), "torch cannot see a GPU"
n = torch.cuda.device_count()
print("visible gpus:", n)
for i in range(n):
    p = torch.cuda.get_device_properties(i)
    print(f"  [{i}] {p.name} {p.total_memory / 1e9:.0f} GB")
PY

for mod in peft trl vllm; do
  python -c "import ${mod}, sys; print('${mod}', getattr(${mod}, '__version__', 'ok'))"
done

# hf_transfer makes the base-model pull minutes rather than tens of minutes.
cat > /etc/profile.d/svalbard.sh <<PROFILE
export HF_HUB_ENABLE_HF_TRANSFER=1
export HF_HOME=/opt/svalbard/hf
export WARGAME_BUCKET=\${WARGAME_BUCKET:-svalbard-wargame}
export PATH="${VENV}/bin:\$PATH"
PROFILE
chmod 0644 /etc/profile.d/svalbard.sh
mkdir -p /opt/svalbard/hf

echo "== done $(date -Is). venv at ${VENV}; log at ${LOG}"
echo "   serve a checkpoint with: infra/serve_vllm.sh s3://\$WARGAME_BUCKET/checkpoints/<run_id>/adapter/"
