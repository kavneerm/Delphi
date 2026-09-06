#!/usr/bin/env bash
set -euo pipefail

# shellcheck disable=SC1091
source .venv/bin/activate

python -m engine.run --seed 1 --storm G5 --stubs --hours 72
