#!/bin/bash
# test_ask_timeout.sh — Verify agent_ask timeout behavior
# Requires heads-up binary built.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../agent_helpers.sh" 2>/dev/null

PASS=0
FAIL=0

assert_eq() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    PASS=$((PASS + 1))
  else
    FAIL=$((FAIL + 1))
    echo "FAIL: $label (expected '$expected', got '$actual')"
  fi
}

# --- Setup ---
mkdir -p /tmp/agent-os-dogfood
"$HEADS_UP" remove-all 2>/dev/null
pkill -f "heads-up serve" 2>/dev/null
sleep 0.3

rm -f "$EVENTS_FILE"
"$HEADS_UP" listen > "$EVENTS_FILE" 2>&1 &
LISTEN_PID=$!
sleep 0.5

"$HEADS_UP" create --id agent-chat --at 0,0,400,400 \
  --file "$CHAT_HTML" --interactive 2>/dev/null
sleep 0.3

# --- Test 1: timeout returns exit 1 ---
agent_ask --timeout 2 "Are you there?" "Yes" "No" > /dev/null 2>&1
assert_eq "timeout exits 1" "1" "$?"

# --- Test 2: question stays live after timeout ---
pending=$("$HEADS_UP" eval --id agent-chat --js "pendingToolUseId" 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('result', 'null'))
")
# pendingToolUseId should still be set (not null)
if [[ "$pending" != "null" && -n "$pending" ]]; then
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
  echo "FAIL: question stays live (pendingToolUseId=$pending)"
fi

# --- Test 3: simulated response returns exit 0 ---
# Pre-write a response event, then ask with timeout
: > "$EVENTS_FILE"
sleep 0.1

# Write a fake response event in the background after 0.5s
(sleep 0.5 && echo '{"type":"event","id":"agent-chat","payload":{"type":"response","payload":{"type":"response","value":"simulated"}}}' >> "$EVENTS_FILE") &

result=$(agent_ask --timeout 5 "Test?" "A" "B" 2>/dev/null)
exit_code=$?
assert_eq "answered exits 0" "0" "$exit_code"
assert_eq "returns value" "simulated" "$result"

# --- Test 4: AGENT_ASK_TIMEOUT env var ---
: > "$EVENTS_FILE"
AGENT_ASK_TIMEOUT=1 agent_ask "Timeout via env?" "Yes" > /dev/null 2>&1
assert_eq "env var timeout exits 1" "1" "$?"

# --- Test 5: explicit --timeout overrides env ---
: > "$EVENTS_FILE"
(sleep 0.5 && echo '{"type":"event","id":"agent-chat","payload":{"type":"response","payload":{"type":"response","value":"fast"}}}' >> "$EVENTS_FILE") &
AGENT_ASK_TIMEOUT=1 result=$(agent_ask --timeout 10 "Override?" "A" 2>/dev/null)
assert_eq "explicit overrides env" "fast" "$result"

# --- Teardown ---
"$HEADS_UP" remove-all 2>/dev/null
kill $LISTEN_PID 2>/dev/null
rm -f "$EVENTS_FILE"

echo ""
echo "ask timeout: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
