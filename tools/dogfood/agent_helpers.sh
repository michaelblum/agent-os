#!/bin/bash
# agent_helpers.sh — Shell helpers for agent-os dogfood sessions
# Source this: source tools/dogfood/agent_helpers.sh

AGENT_OS_ROOT="/Users/Michael/Documents/GitHub/agent-os"
HEADS_UP="$AGENT_OS_ROOT/packages/heads-up/heads-up"
SIDE_EYE="$AGENT_OS_ROOT/packages/side-eye/side-eye"
HAND_OFF="$AGENT_OS_ROOT/packages/hand-off/hand-off"
XRAY_TARGET="python3 $AGENT_OS_ROOT/tools/dogfood/xray_target.py"
CHAT_HTML="$AGENT_OS_ROOT/tools/dogfood/chat.html"
HIGHLIGHT_HTML="$AGENT_OS_ROOT/tools/dogfood/highlight.html"
EVENTS_FILE="/tmp/agent-os-dogfood/events.jsonl"
LISTEN_PID_FILE="/tmp/agent-os-dogfood/listen.pid"
CHIME="/System/Library/Sounds/Glass.aiff"

# TTS: set AGENT_TTS=1 to enable Ella (Voice 4) vocalization
# Voice: override with AGENT_VOICE (default: "Voice 4" = Ella)
AGENT_VOICE="${AGENT_VOICE:-Ava (Premium)}"

# ============================================================
# Session lifecycle
# ============================================================

agent_session_start() {
  mkdir -p /tmp/agent-os-dogfood
  kill $(cat "$LISTEN_PID_FILE" 2>/dev/null) 2>/dev/null
  pkill -f "heads-up serve" 2>/dev/null
  sleep 0.3
  rm -f "$EVENTS_FILE"

  "$HEADS_UP" listen > "$EVENTS_FILE" 2>&1 &
  echo $! > "$LISTEN_PID_FILE"
  sleep 0.5

  # Chat overlay — starts dismissed (invisible until first message)
  "$HEADS_UP" create --id agent-chat --at 600,1500,470,500 \
    --file "$CHAT_HTML" --interactive 2>/dev/null
  sleep 0.3
}

agent_session_end() {
  "$HEADS_UP" remove-all 2>/dev/null
  kill $(cat "$LISTEN_PID_FILE" 2>/dev/null) 2>/dev/null
  rm -f "$EVENTS_FILE"
}

# ============================================================
# Core transport — base64-encoded JSON via headsup.receive()
# ============================================================

_agent_send() {
  # Usage: _agent_send '{"type":"assistant","content":[...]}'
  # Base64 encoding eliminates all bash/JS escaping problems.
  # Python handles the full pipeline — bash echo corrupts escaped chars.
  local json="$1"
  local b64=$(python3 -c "
import sys, base64
b = base64.b64encode(sys.argv[1].encode('utf-8')).decode('ascii')
print(b, end='')
" "$json")
  "$HEADS_UP" eval --id agent-chat --js "headsup.receive('${b64}')" >/dev/null 2>/dev/null
}

_agent_tts() {
  # Speak text if TTS enabled. Strips markdown formatting.
  # Kills any in-flight speech to prevent overlap.
  if [[ "${AGENT_TTS:-0}" == "1" ]]; then
    pkill -x say 2>/dev/null
    local clean=$(echo "$1" | sed 's/[*_`#>]//g' | sed -E 's/\[([^]]*)\]\([^)]*\)/\1/g')
    say -v "$AGENT_VOICE" "$clean" &
  fi
}

# ============================================================
# Agent → Human messages
# ============================================================

agent_say() {
  # Usage: agent_say "markdown text"
  # Sends an assistant text message. Overlay renders markdown.
  local text="$1"
  local json
  json=$(python3 -c "
import json, sys
msg = {'type': 'assistant', 'content': [{'type': 'text', 'text': sys.argv[1]}]}
print(json.dumps(msg))
" "$text")
  _agent_send "$json"
  _agent_tts "$text"
}

agent_ask() {
  # Usage: agent_ask [--timeout SECONDS] "question" ["opt1" "opt2" ... "optN"]
  # Sends an AskUserQuestion-shaped message. Blocks for response.
  # Returns user's response on stdout, exit 0.
  # On timeout: returns nothing, exit 1. Question stays live on overlay.
  # Default timeout: AGENT_ASK_TIMEOUT env var, or infinite if unset.
  local timeout="${AGENT_ASK_TIMEOUT:-0}"
  if [[ "$1" == "--timeout" ]]; then
    timeout="$2"
    shift 2
  fi
  local question="$1"
  shift
  local options=("$@")

  # Clear old events
  : > "$EVENTS_FILE"

  # Build Anthropic-shaped AskUserQuestion JSON
  local json
  json=$(python3 -c "
import json, sys, time
question = sys.argv[1]
options = sys.argv[2:]
opts = [{'label': o} for o in options]
msg = {
  'type': 'assistant',
  'content': [{
    'type': 'tool_use',
    'name': 'AskUserQuestion',
    'id': 'ask-' + str(int(time.time() * 1000)),
    'input': {'questions': [{'question': question, 'options': opts}]}
  }]
}
print(json.dumps(msg))
" "$question" "${options[@]}")

  _agent_send "$json"

  # Chime then TTS — kill previous audio, chime, then speak
  pkill -x say 2>/dev/null
  afplay "$CHIME"
  _agent_tts "$question"

  # Poll every 300ms for a response event
  local elapsed=0
  while true; do
    local event=$(tr -d '\000' < "$EVENTS_FILE" 2>/dev/null | grep '"type":"response"' | tail -1)
    if [[ -n "$event" ]]; then
      local value=$(echo "$event" | python3 -c "
import sys, json
data = json.loads(sys.stdin.read())
p = data
if 'payload' in p:
  p = p['payload']
if 'payload' in p:
  p = p['payload']
print(p.get('value', ''))
")
      echo "$value"
      return 0
    fi
    sleep 0.3
    if [[ "$timeout" -gt 0 ]]; then
      elapsed=$((elapsed + 300))
      if [[ $elapsed -ge $((timeout * 1000)) ]]; then
        return 1
      fi
    fi
  done
}

agent_status() {
  # Usage: agent_status "Analyzing..."
  # Shows a transient status indicator. Replaces previous status.
  local text="$1"
  local json
  json=$(python3 -c "
import json, sys
msg = {'type': 'status', 'text': sys.argv[1]}
print(json.dumps(msg))
" "$text")
  _agent_send "$json"
}

agent_ack() {
  # Quick acknowledgment message
  agent_say "Got it."
}

agent_done() {
  # Usage: agent_done "Completed successfully."
  local msg="${1:-Done.}"
  afplay "$CHIME" &
  agent_say "$msg"
}

agent_cleanup() {
  "$HEADS_UP" remove --id agent-chat 2>/dev/null
  "$HEADS_UP" remove --id highlight 2>/dev/null
}

# ============================================================
# Highlighting
# ============================================================

agent_highlight() {
  local at
  if [[ $# -eq 1 ]]; then
    at="$1"
  elif [[ $# -eq 4 ]]; then
    at="$1,$2,$3,$4"
  else
    echo "Usage: agent_highlight x,y,w,h" >&2
    return 1
  fi
  IFS=',' read -r x y w h <<< "$at"
  local px=6
  at="$((x - px)),$((y - px)),$((w + px*2)),$((h + px*2))"
  "$HEADS_UP" create --id highlight --at "$at" \
    --file "$HIGHLIGHT_HTML" 2>/dev/null
}

agent_highlight_remove() {
  "$HEADS_UP" remove --id highlight 2>/dev/null
}

# ============================================================
# Logging
# ============================================================

agent_log() {
  # Usage: agent_log "message" "level"
  # level: info, error, warn, success
  local msg="$1"
  local level="${2:-info}"
  local json
  json=$(python3 -c "
import json, sys
print(json.dumps({'msg': sys.argv[1], 'level': sys.argv[2]}))
" "$msg" "$level")
  local b64=$(echo -n "$json" | base64 | tr -d '\n')
  "$HEADS_UP" eval --id agent-chat --js "
    var d = JSON.parse(atob('${b64}'));
    addLog(d.msg, d.level);
  " >/dev/null 2>/dev/null
}

echo "agent-os helpers loaded. (TTS: ${AGENT_TTS:-off}, Voice: $AGENT_VOICE)"
