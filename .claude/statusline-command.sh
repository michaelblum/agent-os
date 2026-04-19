#!/bin/bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

BRANCH="$(git branch --show-current 2>/dev/null || echo '?')"
DIRTY="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"

if [ -x "./aos" ]; then
  STATUS="$(./aos status 2>/dev/null | head -n 1 || true)"
else
  STATUS="aos=missing"
fi

printf 'agent-os | %s | dirty=%s | %s\n' "$BRANCH" "$DIRTY" "${STATUS:-aos=unknown}"
