#!/bin/bash
# Shared git health check for agent-os providers.

set -uo pipefail
ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || exit 0)"
cd "$ROOT"

WARNINGS=""

AHEAD=$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)
if [ "$AHEAD" -gt 50 ]; then
  WARNINGS="${WARNINGS}\n- $AHEAD commits ahead of origin/main (consider pushing)"
fi

PRUNABLE=$(git worktree list --porcelain 2>/dev/null | grep -c 'prunable' || true)
if [ "$PRUNABLE" -gt 0 ]; then
  WARNINGS="${WARNINGS}\n- $PRUNABLE prunable worktree(s) — run: git worktree prune"
fi

OLD_DIRTY=$(find . -maxdepth 2 \( -name '*.swift' -o -name '*.ts' -o -name '*.js' -o -name '*.html' \) | while read -r f; do
  if git diff --quiet -- "$f" 2>/dev/null; then continue; fi
  if [ "$(uname)" = "Darwin" ]; then
    MOD=$(stat -f %m "$f" 2>/dev/null || echo 0)
    NOW=$(date +%s)
    AGE=$(( (NOW - MOD) / 3600 ))
    if [ "$AGE" -gt 24 ]; then echo "$f ($AGE hours old)"; fi
  fi
done 2>/dev/null | head -5)
if [ -n "$OLD_DIRTY" ]; then
  WARNINGS="${WARNINGS}\n- Stale uncommitted changes (>24h):"
  while IFS= read -r line; do
    WARNINGS="${WARNINGS}\n    $line"
  done <<< "$OLD_DIRTY"
fi

SUSPECT_UNTRACKED=$(git status --porcelain 2>/dev/null | grep '^??' | grep -E '\.(code-workspace|txt)$' | sed 's/^?? //' | head -5)
if [ -n "$SUSPECT_UNTRACKED" ]; then
  WARNINGS="${WARNINGS}\n- Untracked files that may need .gitignore:"
  while IFS= read -r line; do
    WARNINGS="${WARNINGS}\n    $line"
  done <<< "$SUSPECT_UNTRACKED"
fi

STAGED_SECRETS=$(git diff --cached --name-only 2>/dev/null | grep -iE '\.env$|credentials|secret|\.pem$|\.key$' || true)
if [ -n "$STAGED_SECRETS" ]; then
  WARNINGS="${WARNINGS}\n- DANGER: Possible secrets staged for commit: $STAGED_SECRETS"
fi

if [ -n "$WARNINGS" ]; then
  echo ""
  echo "## Git Health"
  echo -e "$WARNINGS"
fi

