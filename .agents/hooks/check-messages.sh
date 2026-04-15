#!/bin/bash
# .agents/hooks/check-messages.sh
# PostToolUse hook — thin gateway message check.
# Returns empty (no tokens consumed) or a short notification.

SESSION_NAME="${AOS_SESSION_NAME:-}"

# Fallback: check for a name file written by the agent for manual sessions.
# The hook receives a JSON payload on stdin with session_id.
if [ -z "$SESSION_NAME" ]; then
  # Read stdin into a variable (hook payload)
  HOOK_INPUT=$(cat)
  SESSION_ID=$(echo "$HOOK_INPUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null || true)
  if [ -n "$SESSION_ID" ]; then
    SESSION_NAME=$(cat "/tmp/aos-session-name-${SESSION_ID}" 2>/dev/null || true)
  fi
fi

[ -z "$SESSION_NAME" ] && exit 0

# Guard: reject session names containing path separators
[[ "$SESSION_NAME" == */* ]] && exit 0

# Gateway DB location
GATEWAY_DB="$HOME/.config/aos-gateway/gateway.db"
[ -f "$GATEWAY_DB" ] || exit 0

# Read last-seen cursor from state file
STATE_FILE="/tmp/aos-session-cursor-${SESSION_NAME}"
SINCE=$(cat "$STATE_FILE" 2>/dev/null || echo "")

# Safely quote values for SQL (escape single quotes)
SAFE_NAME=$(printf '%s' "$SESSION_NAME" | sed "s/'/''/g")
SAFE_SINCE=$(printf '%s' "$SINCE" | sed "s/'/''/g")

if [ -n "$SINCE" ]; then
  WHERE_CLAUSE="channel = '${SAFE_NAME}' AND id > '${SAFE_SINCE}'"
else
  WHERE_CLAUSE="channel = '${SAFE_NAME}'"
fi

RESULT=$(sqlite3 "$GATEWAY_DB" "
  SELECT id, from_session, substr(payload, 1, 80)
  FROM messages
  WHERE ${WHERE_CLAUSE}
  ORDER BY id ASC
  LIMIT 5;
" 2>/dev/null || true)

[ -z "$RESULT" ] && exit 0

# Update cursor to latest message ID
LATEST=$(echo "$RESULT" | tail -1 | cut -d'|' -f1)
echo "$LATEST" > "${STATE_FILE}.tmp" 2>/dev/null && mv "${STATE_FILE}.tmp" "$STATE_FILE" 2>/dev/null

# Count and summarize
COUNT=$(echo "$RESULT" | wc -l | tr -d ' ')
SENDERS=$(echo "$RESULT" | cut -d'|' -f2 | sort -u | tr '\n' ', ' | sed 's/,$//')

echo "## Inbound Messages"
echo "${COUNT} new message(s) from ${SENDERS} on channel '${SESSION_NAME}'."
echo "Use read_stream(channel='${SESSION_NAME}') to read them."
