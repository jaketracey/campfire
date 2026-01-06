#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

VENV_PY="${PKG_DIR}/.venv/bin/python"

if [[ -x "${VENV_PY}" ]]; then
  PYTHON="${VENV_PY}"
elif command -v python >/dev/null 2>&1; then
  PYTHON="python"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON="python3"
else
  echo "python not found. Create a venv in ${PKG_DIR}/.venv and install deps (e.g. pip install -e '.[dev]')." >&2
  exit 127
fi

if [[ "${1:-}" == "-m" && -n "${2:-}" ]]; then
  MODULE="${2}"
  if ! "${PYTHON}" -c "import ${MODULE}" >/dev/null 2>&1; then
    echo "Missing Python module '${MODULE}' for orchestrator." >&2
    echo "Install deps: (cd ${PKG_DIR} && ${PYTHON} -m pip install -e '.[dev]')" >&2
    exit 1
  fi
fi

exec "${PYTHON}" "$@"
