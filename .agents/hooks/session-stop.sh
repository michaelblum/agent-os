#!/bin/bash
# Shared stop hook for unregistering session presence on clean exit.

set -euo pipefail
ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || pwd)"
AOS="$ROOT/aos"
HOOK_INPUT="$(cat || true)"

# shellcheck source=/dev/null
source "$(dirname "$0")/session-common.sh"

SESSION_ID="$(aos_resolve_session_id "$HOOK_INPUT")"
SESSION_HARNESS="$(aos_detect_harness)"
SESSION_NAME="$(aos_resolve_session_name "$SESSION_ID" "$SESSION_HARNESS")"

[ -x "$AOS" ] || exit 0
[ -n "$SESSION_NAME" ] || exit 0

"$AOS" tell --unregister "$SESSION_NAME" >/dev/null 2>&1 || true
