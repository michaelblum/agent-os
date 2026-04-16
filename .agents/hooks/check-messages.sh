#!/bin/bash
# .agents/hooks/check-messages.sh
# PostToolUse hook — thin coordination message check.
# Returns empty (no tokens consumed) or a short notification.

set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || pwd)"
AOS="$ROOT/aos"
HOOK_INPUT="$(cat || true)"

# shellcheck source=/dev/null
source "$(dirname "$0")/session-common.sh"

SESSION_ID="$(aos_resolve_session_id "$HOOK_INPUT")"
SESSION_HARNESS="$(aos_detect_harness)"
SESSION_NAME="$(aos_resolve_session_name "$SESSION_ID" "$SESSION_HARNESS")"

[ -z "$SESSION_NAME" ] && exit 0

[ ! -x "$AOS" ] && exit 0

STATE_FILE="$(aos_session_cursor_file "$SESSION_NAME")"
SINCE="$(cat "$STATE_FILE" 2>/dev/null || echo "")"

LISTEN_ARGS=(listen "$SESSION_NAME" --limit 5)
if [ -n "$SINCE" ]; then
  LISTEN_ARGS+=(--since "$SINCE")
fi

LISTEN_JSON="$("$AOS" "${LISTEN_ARGS[@]}" 2>/dev/null || true)"
[ -z "$LISTEN_JSON" ] && exit 0

PARSED="$(printf '%s' "$LISTEN_JSON" | python3 -c 'import json, sys
try:
    payload = json.load(sys.stdin)
except Exception:
    raise SystemExit(0)
messages = payload.get("messages", [])
if not messages:
    raise SystemExit(0)
latest = messages[-1].get("id", "")
senders = sorted({(msg.get("from") or "unknown") for msg in messages})
print(len(messages))
print(",".join(senders))
print(latest)
')"
[ -z "$PARSED" ] && exit 0

COUNT="$(printf '%s\n' "$PARSED" | sed -n '1p')"
SENDERS="$(printf '%s\n' "$PARSED" | sed -n '2p' | sed 's/,/, /g')"
LATEST="$(printf '%s\n' "$PARSED" | sed -n '3p')"

if [ -n "$LATEST" ]; then
  printf '%s\n' "$LATEST" > "${STATE_FILE}.tmp"
  mv "${STATE_FILE}.tmp" "$STATE_FILE"
fi

echo "## Inbound Messages"
echo "${COUNT} new message(s) from ${SENDERS} on channel '${SESSION_NAME}'."
echo "Use ./aos listen ${SESSION_NAME} to read them."
