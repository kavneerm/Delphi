#!/usr/bin/env bash
set -euo pipefail

# Bring the workspace's env file across from the root checkout, if present.
if [ -f "${SUPERSET_ROOT_PATH:-}/.env" ]; then
  cp "${SUPERSET_ROOT_PATH}/.env" .env
  echo "copied .env from ${SUPERSET_ROOT_PATH}"
fi

# Python 3.12 is the pinned interpreter; fall back to python3 only if absent.
if command -v python3.12 >/dev/null 2>&1; then
  PY=python3.12
else
  PY=python3
  echo "warning: python3.12 not found, falling back to $($PY --version 2>&1)"
fi

"$PY" -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate

pip install -q -U pip

if [ -f pyproject.toml ]; then
  pip install -q -e ".[dev]" || true
fi

git fetch origin --quiet || true

echo "workspace ${SUPERSET_WORKSPACE_NAME:-unnamed} ready — read AGENTS.md first"
