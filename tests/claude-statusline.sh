#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

EXPECTED_FALLBACK="$(python3 - <<'PY'
import json
import os

for path in ('.claude/settings.json', '.runtime/claude/settings.json'):
    try:
        with open(path) as fh:
            payload = json.load(fh)
    except Exception:
        continue
    value = payload.get('effortLevel')
    if isinstance(value, str) and value and value != 'auto':
        print(value)
        break
else:
    print('xhigh')
PY
)"

OUTPUT="$(printf '{"model":{"display_name":"Claude Opus 4.7"}}' | bash .claude/statusline-command.sh)"
FIRST_LINE="$(printf '%s\n' "$OUTPUT" | sed -n '1p')"

case "$FIRST_LINE" in
  "Opus4.7 | ${EXPECTED_FALLBACK} | "*)
    ;;
  *)
    echo "FAIL: expected Opus 4.7 fallback effort to render as ${EXPECTED_FALLBACK}, got: $FIRST_LINE" >&2
    exit 1
    ;;
esac

OUTPUT="$(printf '{"model":{"display_name":"Claude Opus 4.7"},"effort_level":"medium","context_window":{"used_percentage":15,"remaining_percentage":85,"context_window_size":200000}}' | bash .claude/statusline-command.sh)"
FIRST_LINE="$(printf '%s\n' "$OUTPUT" | sed -n '1p')"

case "$FIRST_LINE" in
  "Opus4.7 | medium | "*)
    ;;
  *)
    echo "FAIL: expected explicit effort_level to win, got: $FIRST_LINE" >&2
    exit 1
    ;;
esac

echo "PASS"
