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

  if [[ "${MODULE}" == "pytest" ]]; then
    if ! "${PYTHON}" -c 'import importlib.util; raise SystemExit(0 if importlib.util.find_spec("pytest_cov") else 1)' >/dev/null 2>&1; then
      if [[ -n "${PYTEST_ADDOPTS:-}" ]]; then
        FILTERED_PYTEST_ADDOPTS="$(
          "${PYTHON}" - "$PYTEST_ADDOPTS" <<'PY'
import os
import shlex
import sys


def _should_drop(arg: str) -> bool:
    return arg == "--cov" or arg.startswith("--cov=") or arg.startswith("--cov-")


opts = shlex.split(sys.argv[1]) if len(sys.argv) > 1 else []
filtered = []
skip_next = False
next_value_flags = {"--cov", "--cov-report", "--cov-config", "--cov-fail-under", "--cov-context"}

for i, arg in enumerate(opts):
    if skip_next:
        skip_next = False
        continue
    if arg in next_value_flags:
        skip_next = True
        continue
    if _should_drop(arg):
        continue
    filtered.append(arg)

print(" ".join(filtered))
PY
        )"
        if [[ "${FILTERED_PYTEST_ADDOPTS}" != "${PYTEST_ADDOPTS}" ]]; then
          echo "pyproject/test runner requested coverage flags, but pytest-cov is not installed. Running without coverage flags." >&2
          export PYTEST_ADDOPTS="${FILTERED_PYTEST_ADDOPTS}"
        fi
      fi

      if (( $# > 2 )); then
        FILTERED_PYTEST_ARGS=()
        SKIP_NEXT=0
        for ARG in "${@:3}"; do
          if [[ "${SKIP_NEXT}" == "1" ]]; then
            SKIP_NEXT=0
            continue
          fi

          case "${ARG}" in
            --cov|--cov=*|--cov-*)
              continue
              ;;
            --cov-report|--cov-config|--cov-fail-under|--cov-context)
              SKIP_NEXT=1
              continue
              ;;
            *)
              FILTERED_PYTEST_ARGS+=("${ARG}")
              ;;
          esac
        done

        if (( ${#FILTERED_PYTEST_ARGS[@]} != $# - 2 )); then
          set -- "${@:1:2}" "${FILTERED_PYTEST_ARGS[@]}"
        fi
      fi
    fi
  fi
fi

exec "${PYTHON}" "$@"
