#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

source "$ROOT/.agents/hooks/session-common.sh"

SESSION_ID="019da700-0001-7000-b000-000000000001"
COMPACTION_FILE="$(AOS_STATE_ROOT="${AOS_STATE_ROOT:-$HOME/.config/aos}" AOS_RUNTIME_MODE=repo aos_session_compaction_file "$SESSION_ID")"

cleanup() {
  rm -f "$COMPACTION_FILE"
}
trap cleanup EXIT

# Bare model input: no output_style, no context window. Line should be "Opus4.7 | ctx ..." with no middle slot.
OUTPUT="$(printf '{"model":{"display_name":"Claude Opus 4.7"}}' | bash .claude/statusline-command.sh)"
FIRST_LINE="$(printf '%s\n' "$OUTPUT" | sed -n '1p')"

case "$FIRST_LINE" in
  "Opus4.7 | ctx "*)
    ;;
  *)
    echo "FAIL: expected bare model line to collapse the middle slot, got: $FIRST_LINE" >&2
    exit 1
    ;;
esac

# Non-default output_style should render in the middle slot.
OUTPUT="$(printf '{"model":{"display_name":"Claude Opus 4.7"},"output_style":{"name":"Explanatory"},"context_window":{"used_percentage":15,"remaining_percentage":85,"context_window_size":200000}}' | bash .claude/statusline-command.sh)"
FIRST_LINE="$(printf '%s\n' "$OUTPUT" | sed -n '1p')"

case "$FIRST_LINE" in
  "Opus4.7 | Explanatory | "*)
    ;;
  *)
    echo "FAIL: expected output_style to render in middle slot, got: $FIRST_LINE" >&2
    exit 1
    ;;
esac

# Default output_style should be omitted.
OUTPUT="$(printf '{"model":{"display_name":"Claude Opus 4.7"},"output_style":{"name":"default"},"context_window":{"used_percentage":15,"remaining_percentage":85,"context_window_size":200000}}' | bash .claude/statusline-command.sh)"
FIRST_LINE="$(printf '%s\n' "$OUTPUT" | sed -n '1p')"

case "$FIRST_LINE" in
  "Opus4.7 | ctx "*)
    ;;
  *)
    echo "FAIL: expected default output_style to be omitted, got: $FIRST_LINE" >&2
    exit 1
    ;;
esac

printf '{"hook_event_name":"PreCompact","trigger":"auto","session_id":"%s"}' "$SESSION_ID" | AOS_PRECOMPACT_DISABLE_NOTIFY=1 bash .agents/hooks/pre-compact.sh >/dev/null 2>&1
OUTPUT="$(printf '{"session_id":"%s","model":{"display_name":"Claude Opus 4.7"},"context_window":{"used_percentage":15,"remaining_percentage":85,"context_window_size":200000}}' "$SESSION_ID" | bash .claude/statusline-command.sh)"
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
OUTPUT="$(printf '{"session_id":"%s","model":{"display_name":"Claude Opus 4.7"},"context_window":{"used_percentage":15,"remaining_percentage":85,"context_window_size":200000}}' "$SESSION_ID" | bash .claude/statusline-command.sh)"
FIRST_LINE="$(printf '%s\n' "$OUTPUT" | sed -n '1p')"

case "$FIRST_LINE" in
  *" C2")
    ;;
  *)
    echo "FAIL: expected second auto-compact badge C2, got: $FIRST_LINE" >&2
    exit 1
    ;;
esac

echo "PASS"
