#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[audit-prompts] Scanning for hardcoded prompt strings in runtime code…"

# Patterns that indicate prompt templates embedded in code (not in DB migration seeds).
PATTERN='(system_prompt\s*=\s*f?"""|user_prompt\s*=\s*f?"""|SPEAKER_SELECTION_PROMPT\s*=|REACTION_CHECK_PROMPT\s*=|GROUP_SYSTEM_PROMPT_TEMPLATE\s*=|REACTION_PROMPT_TEMPLATE\s*=|system_prompt:\s*`|user_prompt:\s*`|systemPrompt\s*=\s*`|userPrompt\s*=\s*`)'

if rg -n "$PATTERN" \
  packages/gateway/src \
  packages/orchestrator/src/orchestrator \
  packages/workers/src \
  --glob '!**/db/migrations/**' \
  --glob '!**/prompts/manager.py' \
  --glob '!**/__tests__/**' \
  --glob '!**/tests/**' \
  --glob '!**/*.test.*' \
  --glob '!**/*.spec.*' \
  --glob '!**/dist/**'
then
  echo ""
  echo "[audit-prompts] ERROR: Found hardcoded prompt strings. Move them into prompt templates."
  exit 1
fi

echo "[audit-prompts] OK"

