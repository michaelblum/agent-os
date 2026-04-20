#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || pwd)"
HOOK_INPUT="$(cat || true)"

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

MESSAGE="Claude Code is auto-compacting this agent-os session."

# Audible terminal bell for the focused terminal.
printf '\a' >&2 || true
printf '%s\n' "$MESSAGE" >&2

# Best-effort macOS desktop notification.
if [[ "${AOS_PRECOMPACT_DISABLE_NOTIFY:-0}" != "1" ]] && command -v osascript >/dev/null 2>&1; then
  osascript -e "display notification \"${MESSAGE//\"/\\\"}\" with title \"agent-os\" subtitle \"Claude Code\"" >/dev/null 2>&1 || true
fi

exit 0
