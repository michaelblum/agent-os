#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || pwd)"
HOOK_INPUT="$(cat || true)"

# shellcheck source=/dev/null
source "$(dirname "$0")/session-common.sh"

read_trigger() {
  local input="${1:-}"
  if [[ -z "$input" ]]; then
    return 0
  fi
  printf '%s' "$input" | python3 -c '
import json, sys
try:
    payload = json.load(sys.stdin)
except Exception:
    raise SystemExit(0)
trigger = payload.get("trigger")
if isinstance(trigger, str) and trigger:
    print(trigger)
'
}

TRIGGER="$(read_trigger "$HOOK_INPUT")"
if [[ "$TRIGGER" != "auto" ]]; then
  exit 0
fi

SESSION_ID="$(aos_resolve_session_id "$HOOK_INPUT")"
if [[ -n "$SESSION_ID" ]]; then
  COMPACTION_FILE="$(aos_session_compaction_file "$SESSION_ID")"
  CURRENT_COUNT=0
  if [[ -f "$COMPACTION_FILE" ]]; then
    CURRENT_COUNT="$(tr -dc '0-9' < "$COMPACTION_FILE" 2>/dev/null || printf '0')"
  fi
  NEXT_COUNT=$(( ${CURRENT_COUNT:-0} + 1 ))
  printf '%s\n' "$NEXT_COUNT" > "$COMPACTION_FILE"
fi

MESSAGE="Claude Code is auto-compacting this agent-os session."

# Audible terminal bell for the focused terminal.
printf '\a' >&2 || true
printf '%s\n' "$MESSAGE" >&2

# Best-effort macOS desktop notification.
if [[ "${AOS_PRECOMPACT_DISABLE_NOTIFY:-0}" != "1" ]] && command -v osascript >/dev/null 2>&1; then
  osascript -e "display notification \"${MESSAGE//\"/\\\"}\" with title \"agent-os\" subtitle \"Claude Code\"" >/dev/null 2>&1 || true
fi

exit 0
