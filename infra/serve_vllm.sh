#!/usr/bin/env bash
# serve_vllm.sh <checkpoint_s3_uri> — serve a sweep adapter behind an
# OpenAI-compatible endpoint on this GPU box.
#
#   ./infra/serve_vllm.sh s3://svalbard-wargame/checkpoints/<run_id>/adapter/
#   ./infra/serve_vllm.sh s3://.../adapter/ --base Qwen/Qwen2.5-7B-Instruct --port 8000
#   ./infra/serve_vllm.sh --down                 # stop the server started here
#
# The adapter is pulled from S3 (the instance profile grants read on the bucket and
# nothing else), then loaded as a named LoRA so train/serve.py can select it per
# request with model="<run_id>", the same contract the Fireworks backend uses.
#
# NOT RUN AGAINST ANY INSTANCE as of 2026-09-05: the G-instance quota is 0, so the
# live endpoint for this project is the Fireworks deployment fronted by
# train/serve.py --backend fireworks. This script is the EC2 fallback.

set -euo pipefail

VENV="${VENV:-/opt/svalbard/venv}"
PORT="${PORT:-8000}"
HOST="${HOST:-0.0.0.0}"
BASE_MODEL="${BASE_MODEL:-Qwen/Qwen2.5-7B-Instruct}"
# Tensor parallel follows the GPUs actually present: 4 on a g5.12xlarge, 1 on a
# g5.2xlarge. A hardcoded 4 makes vLLM refuse to start on a single-GPU box.
TP_SIZE="${TP_SIZE:-$(nvidia-smi --list-gpus 2>/dev/null | grep -c . || echo 1)}"
MAX_LEN="${MAX_LEN:-8192}"
LOCAL_ROOT="${LOCAL_ROOT:-/opt/svalbard/checkpoints}"
PIDFILE=/opt/svalbard/vllm.pid
LOGFILE=/opt/svalbard/vllm.log

if [[ "${1:-}" == "--down" ]]; then
  if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    kill "$(cat "$PIDFILE")" && rm -f "$PIDFILE"
    echo "vllm stopped"
  else
    echo "no vllm running from this script"
  fi
  exit 0
fi

CHECKPOINT_URI="${1:?usage: serve_vllm.sh <checkpoint_s3_uri> [--base MODEL] [--port N]}"
shift || true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) BASE_MODEL="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --tp)   TP_SIZE="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

[[ "$CHECKPOINT_URI" == s3://* ]] || { echo "expected an s3:// uri, got: $CHECKPOINT_URI" >&2; exit 2; }

# run_id is the second-to-last segment of checkpoints/<run_id>/adapter/ and is the
# adapter name callers select by.
TRIMMED="${CHECKPOINT_URI%/}"
ADAPTER_NAME="$(basename "$(dirname "$TRIMMED")")"
ADAPTER_DIR="${LOCAL_ROOT}/${ADAPTER_NAME}"

echo "== pulling ${CHECKPOINT_URI} -> ${ADAPTER_DIR}"
mkdir -p "$ADAPTER_DIR"
aws s3 sync "$TRIMMED/" "$ADAPTER_DIR/" --only-show-errors
[[ -f "${ADAPTER_DIR}/adapter_config.json" ]] || {
  echo "no adapter_config.json under ${ADAPTER_DIR}: not a PEFT adapter" >&2; exit 1; }

# shellcheck disable=SC1091
[[ -f "$VENV/bin/activate" ]] && source "$VENV/bin/activate"

echo "== serving base=${BASE_MODEL} adapter=${ADAPTER_NAME} tp=${TP_SIZE} on ${HOST}:${PORT}"
nohup python -m vllm.entrypoints.openai.api_server \
  --model "$BASE_MODEL" \
  --served-model-name "$BASE_MODEL" \
  --enable-lora \
  --lora-modules "${ADAPTER_NAME}=${ADAPTER_DIR}" \
  --max-lora-rank 64 \
  --max-model-len "$MAX_LEN" \
  --tensor-parallel-size "$TP_SIZE" \
  --host "$HOST" --port "$PORT" \
  > "$LOGFILE" 2>&1 &
echo $! > "$PIDFILE"

echo "== waiting for health (log: ${LOGFILE})"
for _ in $(seq 1 120); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    echo "healthy after $(( SECONDS ))s"
    curl -fsS "http://127.0.0.1:${PORT}/v1/models" | jq -r '.data[].id'
    cat <<MSG

  endpoint: http://<instance-ip>:${PORT}/v1
  adapter:  ${ADAPTER_NAME}   (pass as the model field)
  stop:     ./infra/serve_vllm.sh --down

  Billed per GPU-hour. Tear it down the moment the phase ends
  (docs/COORDINATION.md — Fireworks deployment discipline) and log both
  times to docs/VERSIONS.md.
MSG
    exit 0
  fi
  sleep 5
done

echo "vllm did not become healthy in 600s; last lines of ${LOGFILE}:" >&2
tail -40 "$LOGFILE" >&2
exit 1
