#!/bin/bash
# Shared pre-tool policy hook for agent-os providers.
# Exit 0 = allow, Exit 2 = block.

set -euo pipefail
INPUT=$(cat)
CMD=$(echo "$INPUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null || echo "")
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

echo "$CMD" | grep -qE 'rm -rf /|git push.*--force.*main|git reset --hard' && {
  echo "Blocked: destructive command on main" >&2
  exit 2
}

printf '%s' "$INPUT" | python3 "$ROOT/.agents/hooks/aos-agent-policy.py" pre || exit $?

echo "$CMD" | grep -q 'git commit' || exit 0

cd "$ROOT"

SECRETS=$(git diff --cached --name-only 2>/dev/null | grep -iE '\.env$|\.env\.|credentials|\.pem$|\.key$|secret.*\.json' || true)
if [ -n "$SECRETS" ]; then
  echo "BLOCKED: Staged files may contain secrets: $SECRETS" >&2
  echo "Unstage with: git reset HEAD <file>" >&2
  exit 2
fi

LARGE=$(git diff --cached --name-only 2>/dev/null | while read -r f; do
  [ -f "$f" ] || continue
  SIZE=$(wc -c < "$f" 2>/dev/null | tr -d ' ')
  if [ "$SIZE" -gt 1048576 ]; then echo "$f ($(( SIZE / 1024 ))KB)"; fi
done)
if [ -n "$LARGE" ]; then
  echo "BLOCKED: Large files staged (>1MB): $LARGE" >&2
  exit 2
fi

BAD_PATHS=$(git diff --cached --name-only 2>/dev/null | grep -E 'node_modules/|\.DS_Store|dist/.*\.js$' || true)
if [ -n "$BAD_PATHS" ]; then
  echo "BLOCKED: Build artifacts or node_modules staged: $(echo "$BAD_PATHS" | head -3)" >&2
  exit 2
fi

exit 0
