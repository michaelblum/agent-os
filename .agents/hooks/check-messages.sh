#!/bin/bash
# .agents/hooks/check-messages.sh
# PostToolUse hook — thin coordination message check.
# Returns empty (no tokens consumed) or a short notification.

set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || pwd)"
AOS="$ROOT/aos"
HOOK_INPUT="$(cat || true)"
SOCKET_TIMEOUT_SECONDS="${AOS_POSTTOOL_SOCKET_TIMEOUT:-0.2}"
REGISTER_TIMEOUT_SECONDS="${AOS_POSTTOOL_REGISTER_TIMEOUT:-1.0}"
LISTEN_TIMEOUT_SECONDS="${AOS_POSTTOOL_LISTEN_TIMEOUT:-1.5}"
REGISTER_TTL_SECONDS="${AOS_POSTTOOL_REGISTER_TTL:-30}"
LISTEN_TTL_SECONDS="${AOS_POSTTOOL_LISTEN_TTL:-2}"

# shellcheck source=/dev/null
source "$(dirname "$0")/session-common.sh"

socket_reachable() {
  local socket_path="${1:-}"
  [[ -n "$socket_path" ]] || return 1
  python3 - "$socket_path" "$SOCKET_TIMEOUT_SECONDS" <<'PY' >/dev/null 2>&1
import os
import socket
import sys

path = sys.argv[1]
timeout = float(sys.argv[2])

if not os.path.exists(path):
    raise SystemExit(1)

sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
sock.settimeout(timeout)
try:
    sock.connect(path)
except Exception:
    raise SystemExit(1)
finally:
    sock.close()
PY
}

run_with_timeout() {
  local timeout_seconds="$1"
  shift
  python3 - "$timeout_seconds" "$@" <<'PY'
import subprocess
import sys

timeout = float(sys.argv[1])
command = sys.argv[2:]

try:
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
except subprocess.TimeoutExpired:
    raise SystemExit(124)

sys.stdout.write(result.stdout)
sys.stderr.write(result.stderr)
raise SystemExit(result.returncode)
PY
}

should_run_now() {
  local state_file="$1"
  local ttl_seconds="$2"
  local now last
  now="$(date +%s)"
  last="$(cat "$state_file" 2>/dev/null || true)"
  [[ -z "$last" ]] && return 0
  (( now - last >= ttl_seconds ))
}

mark_now() {
  local state_file="$1"
  printf '%s\n' "$(date +%s)" > "${state_file}.tmp"
  mv "${state_file}.tmp" "$state_file"
}

SESSION_ID="$(aos_resolve_session_id "$HOOK_INPUT")"
SESSION_HARNESS="$(aos_detect_harness)"
SESSION_NAME="$(aos_resolve_session_name "$SESSION_ID" "$SESSION_HARNESS")"
SESSION_CHANNEL="$(aos_session_channel "$SESSION_ID" "$SESSION_NAME")"

[ -z "$SESSION_CHANNEL" ] && exit 0

[ ! -x "$AOS" ] && exit 0

SOCKET_PATH="$(aos_session_runtime_state_dir)/sock"
socket_reachable "$SOCKET_PATH" || exit 0

REGISTER_STATE_FILE="$(aos_session_cursor_file "${SESSION_CHANNEL}-register")"
if should_run_now "$REGISTER_STATE_FILE" "$REGISTER_TTL_SECONDS"; then
  if [[ -n "$SESSION_ID" ]]; then
    REGISTER_ARGS=(tell --register --session-id "$SESSION_ID" --name "$SESSION_NAME" --role worker --harness "$SESSION_HARNESS")
  else
    REGISTER_ARGS=(tell --register "$SESSION_NAME" --role worker --harness "$SESSION_HARNESS")
  fi
  if run_with_timeout "$REGISTER_TIMEOUT_SECONDS" "$AOS" "${REGISTER_ARGS[@]}" >/dev/null 2>&1; then
    mark_now "$REGISTER_STATE_FILE"
  fi
fi

STATE_FILE="$(aos_session_cursor_file "$SESSION_CHANNEL")"
LISTEN_STATE_FILE="$(aos_session_cursor_file "${SESSION_CHANNEL}-listen")"
should_run_now "$LISTEN_STATE_FILE" "$LISTEN_TTL_SECONDS" || exit 0
SINCE="$(cat "$STATE_FILE" 2>/dev/null || echo "")"

if [[ -n "$SESSION_ID" ]]; then
  LISTEN_ARGS=(listen --session-id "$SESSION_ID" --limit 5)
else
  LISTEN_ARGS=(listen "$SESSION_NAME" --limit 5)
fi
if [ -n "$SINCE" ]; then
  LISTEN_ARGS+=(--since "$SINCE")
fi

LISTEN_JSON="$(run_with_timeout "$LISTEN_TIMEOUT_SECONDS" "$AOS" "${LISTEN_ARGS[@]}" 2>/dev/null || true)"
mark_now "$LISTEN_STATE_FILE"
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
if [[ -n "$SESSION_ID" ]]; then
  echo "${COUNT} new message(s) from ${SENDERS} on session '${SESSION_NAME}' (${SESSION_ID})."
  echo "Use ./aos listen --session-id ${SESSION_ID} to read them."
else
  echo "${COUNT} new message(s) from ${SENDERS} on channel '${SESSION_NAME}'."
  echo "Use ./aos listen ${SESSION_NAME} to read them."
fi
