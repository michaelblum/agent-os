#!/bin/bash
# agent_helpers.sh — Shell helpers for agent-os dogfood sessions
# Source this: source tools/dogfood/agent_helpers.sh

AGENT_OS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
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

  # Mark current position in events file — only parse events after this point.
  # Don't truncate: the listen process has the file handle open.
  local start_offset=$(wc -c < "$EVENTS_FILE" 2>/dev/null || echo 0)
  start_offset=$((start_offset + 0))  # ensure numeric

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

  # Poll every 300ms for a response event.
  # Events file may contain multi-line JSON (e.g. newlines in text input).
  # Use python3 to parse robustly instead of grep.
  # Suppress xtrace to avoid 'value=' spam if caller has set -x.
  { local _xtrace_was_on=0; [[ $- == *x* ]] && _xtrace_was_on=1 && set +x; } 2>/dev/null
  local elapsed=0
  local value
  while true; do
    value=$(python3 -c "
import sys, json
try:
    offset = int(sys.argv[2])
    raw = open(sys.argv[1], 'rb').read()
    raw = raw[offset:].replace(b'\x00', b'')
    text = raw.decode('utf-8', errors='replace')
    if not text.strip():
        sys.exit(1)
    decoder = json.JSONDecoder()
    pos = 0
    last_value = None
    while pos < len(text):
        text_part = text[pos:].lstrip()
        if not text_part:
            break
        try:
            obj, end = decoder.raw_decode(text_part)
            pos += len(text[pos:]) - len(text_part) + end
            p = obj
            if 'payload' in p: p = p['payload']
            if 'payload' in p: p = p['payload']
            if p.get('type') == 'response':
                last_value = p.get('value', '')
        except json.JSONDecodeError:
            pos += 1
    if last_value is not None:
        print(last_value)
        sys.exit(0)
    sys.exit(1)
except Exception:
    sys.exit(1)
" "$EVENTS_FILE" "$start_offset" 2>/dev/null)
    if [[ $? -eq 0 ]]; then
      [[ $_xtrace_was_on -eq 1 ]] && set -x
      echo "$value"
      return 0
    fi
    sleep 0.3
    if [[ "$timeout" -gt 0 ]]; then
      elapsed=$((elapsed + 300))
      if [[ $elapsed -ge $((timeout * 1000)) ]]; then
        [[ $_xtrace_was_on -eq 1 ]] && set -x
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
# Action Events — emit to heads-up pub/sub for avatar effects
# ============================================================

DOGFOOD="$AGENT_OS_ROOT/tools/dogfood"

_emit_action() {
  # Usage: _emit_action "before|after" "action_name" [extra_json_fields]
  # Posts to the "actions" channel for subscribers (e.g. the Sigil renderer).
  local phase="$1" action="$2"
  shift 2
  local extra="$*"
  "$HEADS_UP" post --channel actions \
    --data "{\"type\":\"$phase\",\"action\":\"$action\"$extra}" \
    >/dev/null 2>/dev/null
}

_resolve_target_bounds() {
  # Resolve an element's global bounds via xray_target.py.
  # Returns: ,"bounds":[x,y,w,h]  (or empty string if not found)
  local target="$1"
  local result
  result=$($XRAY_TARGET --role "$target" --no-image 2>/dev/null)
  if [ -n "$result" ]; then
    echo "$result" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    b = d.get('target', {}).get('global_bounds', {})
    x, y, w, h = b.get('x', 0), b.get('y', 0), b.get('w', 0), b.get('h', 0)
    print(f',\"bounds\":[{x},{y},{w},{h}]', end='')
except Exception:
    pass
" 2>/dev/null
  fi
}

agent_action_type() {
  # Usage: agent_action_type "AXTextField:Search" "hello world"
  # Emits before/after events around a hand-off type command.
  # The avatar possesses the keyboard input, then releases.
  local target="$1"; shift
  local text="$*"
  local bounds
  bounds=$(_resolve_target_bounds "$target")
  _emit_action "before" "type" ",\"target\":{\"name\":\"$target\"$bounds},\"text\":\"$text\""
  "$HAND_OFF" type "$target" "$text"
  local rc=$?
  _emit_action "after" "type" ",\"target\":{\"name\":\"$target\"}"
  return $rc
}

agent_action_click() {
  # Usage: agent_action_click "AXButton:Submit"
  # Emits before/after events around a hand-off click command.
  # The avatar possesses the cursor, then releases.
  local target="$1"
  local bounds
  bounds=$(_resolve_target_bounds "$target")
  _emit_action "before" "click" ",\"target\":{\"name\":\"$target\"$bounds}"
  "$HAND_OFF" click "$target"
  local rc=$?
  _emit_action "after" "click" ",\"target\":{\"name\":\"$target\"}"
  return $rc
}

agent_action_trace() {
  # Usage: agent_action_trace "AXButton:Submit"
  # Avatar orbits the element's perimeter (no action — visual only).
  local target="$1"
  local bounds
  bounds=$(_resolve_target_bounds "$target")
  if [ -n "$bounds" ]; then
    _emit_action "before" "trace" ",\"target\":{\"name\":\"$target\"$bounds}"
  fi
}

agent_fast_travel() {
  # Usage: agent_fast_travel X Y
  # Bullet-speed avatar movement to a screen coordinate.
  local x="$1" y="$2"
  _emit_action "before" "fast_travel" ",\"to\":[$x,$y]"
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
