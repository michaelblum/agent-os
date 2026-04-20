#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUTPUT="$(printf '{"model":{"display_name":"Claude Opus 4.7"}}' | bash .claude/statusline-command.sh)"
FIRST_LINE="$(printf '%s\n' "$OUTPUT" | sed -n '1p')"

case "$FIRST_LINE" in
  "Opus4.7 | xhigh | "*)
    ;;
  *)
    echo "FAIL: expected Opus 4.7 fallback effort to render as xhigh, got: $FIRST_LINE" >&2
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
