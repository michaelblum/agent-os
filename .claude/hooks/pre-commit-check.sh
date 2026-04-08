#!/bin/bash
# Pre-commit guard — runs as PreToolUse on Bash when command contains "git commit"
# Reads the tool_input JSON from stdin.
# Exit 0 = allow, Exit 2 = block.

set -euo pipefail
INPUT=$(cat)
CMD=$(echo "$INPUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null || echo "")

# Only act on git commit commands
echo "$CMD" | grep -q 'git commit' || exit 0

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || exit 0)"
cd "$ROOT"

# Check 1: secrets in staged files
SECRETS=$(git diff --cached --name-only 2>/dev/null | grep -iE '\.env$|\.env\.|credentials|\.pem$|\.key$|secret.*\.json' || true)
if [ -n "$SECRETS" ]; then
  echo "BLOCKED: Staged files may contain secrets: $SECRETS" >&2
  echo "Unstage with: git reset HEAD <file>" >&2
  exit 2
fi

# Check 2: large files (>1MB) staged
LARGE=$(git diff --cached --name-only 2>/dev/null | while read f; do
  [ -f "$f" ] || continue
  SIZE=$(wc -c < "$f" 2>/dev/null | tr -d ' ')
  if [ "$SIZE" -gt 1048576 ]; then echo "$f ($(( SIZE / 1024 ))KB)"; fi
done)
if [ -n "$LARGE" ]; then
  echo "BLOCKED: Large files staged (>1MB): $LARGE" >&2
  exit 2
fi

# Check 3: node_modules or build artifacts staged
BAD_PATHS=$(git diff --cached --name-only 2>/dev/null | grep -E 'node_modules/|\.DS_Store|dist/.*\.js$' || true)
if [ -n "$BAD_PATHS" ]; then
  echo "BLOCKED: Build artifacts or node_modules staged: $(echo "$BAD_PATHS" | head -3)" >&2
  exit 2
fi

exit 0
