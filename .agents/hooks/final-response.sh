#!/bin/bash
# Shared final-response relay for provider Stop hooks.

set -euo pipefail
ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || pwd)"
AOS="$ROOT/aos"
HOOK_INPUT="$(cat || true)"

# shellcheck source=/dev/null
source "$(dirname "$0")/session-common.sh"

SESSION_HARNESS="$(aos_detect_harness)"
SESSION_ID="$(aos_resolve_session_id "$HOOK_INPUT")"

if [[ -x "$AOS" ]]; then
  if [[ -n "$SESSION_ID" ]]; then
    printf '%s' "$HOOK_INPUT" | "$AOS" voice final-response --harness "$SESSION_HARNESS" --session-id "$SESSION_ID" >/dev/null 2>&1 || true
  else
    printf '%s' "$HOOK_INPUT" | "$AOS" voice final-response --harness "$SESSION_HARNESS" >/dev/null 2>&1 || true
  fi
fi

aos_emit_stop_hook_success "$SESSION_HARNESS"
