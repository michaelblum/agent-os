#!/bin/bash
# Shared final-response relay for provider Stop hooks.

set -euo pipefail
ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || pwd)"
AOS="$ROOT/aos"
HOOK_INPUT="$(cat || true)"

# shellcheck source=/dev/null
source "$(dirname "$0")/session-common.sh"

SESSION_ID="$(aos_resolve_session_id "$HOOK_INPUT")"
MESSAGE="$(aos_resolve_last_assistant_message_from_input "$HOOK_INPUT")"

[ -x "$AOS" ] || exit 0
[ -n "${MESSAGE:-}" ] || exit 0

if [[ -n "$SESSION_ID" ]]; then
  printf '%s' "$MESSAGE" | "$AOS" tell human --from-session-id "$SESSION_ID" --purpose final_response >/dev/null 2>&1 || true
else
  printf '%s' "$MESSAGE" | "$AOS" tell human --purpose final_response >/dev/null 2>&1 || true
fi
