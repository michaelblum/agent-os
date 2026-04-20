#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

source "$ROOT/.agents/hooks/session-common.sh"

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

SESSION_ID="019da700-0001-7000-b000-000000000001"
COMPACTION_FILE="$(AOS_STATE_ROOT="${AOS_STATE_ROOT:-$HOME/.config/aos}" AOS_RUNTIME_MODE=repo aos_session_compaction_file "$SESSION_ID")"

cleanup() {
  rm -f "$COMPACTION_FILE"
}
trap cleanup EXIT

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

printf '{"hook_event_name":"PreCompact","trigger":"auto","session_id":"%s"}' "$SESSION_ID" | AOS_PRECOMPACT_DISABLE_NOTIFY=1 bash .agents/hooks/pre-compact.sh >/dev/null 2>&1
OUTPUT="$(printf '{"session_id":"%s","model":{"display_name":"Claude Opus 4.7"},"effort_level":"medium","context_window":{"used_percentage":15,"remaining_percentage":85,"context_window_size":200000}}' "$SESSION_ID" | bash .claude/statusline-command.sh)"
FIRST_LINE="$(printf '%s\n' "$OUTPUT" | sed -n '1p')"

case "$FIRST_LINE" in
  *" C")
    ;;
  *)
    echo "FAIL: expected first auto-compact badge C, got: $FIRST_LINE" >&2
    exit 1
    ;;
esac

printf '{"hook_event_name":"PreCompact","trigger":"auto","session_id":"%s"}' "$SESSION_ID" | AOS_PRECOMPACT_DISABLE_NOTIFY=1 bash .agents/hooks/pre-compact.sh >/dev/null 2>&1
OUTPUT="$(printf '{"session_id":"%s","model":{"display_name":"Claude Opus 4.7"},"effort_level":"medium","context_window":{"used_percentage":15,"remaining_percentage":85,"context_window_size":200000}}' "$SESSION_ID" | bash .claude/statusline-command.sh)"
FIRST_LINE="$(printf '%s\n' "$OUTPUT" | sed -n '1p')"

case "$FIRST_LINE" in
  *" C2")
    ;;
  *)
    echo "FAIL: expected second auto-compact badge C2, got: $FIRST_LINE" >&2
    exit 1
    ;;
esac

printf '{"session_id":"%s"}' "$SESSION_ID" | AOS_SESSION_HARNESS=claude-code bash .agents/hooks/session-stop.sh >/dev/null 2>&1 || true
[[ ! -f "$COMPACTION_FILE" ]] || {
  echo "FAIL: expected session-stop to remove compaction file $COMPACTION_FILE" >&2
  exit 1
}

echo "PASS"
