#!/bin/bash
# agent_helpers.sh — Shell helpers for agent-os dogfood sessions
# Source this: source /tmp/agent-os-dogfood/agent_helpers.sh

HEADS_UP="/Users/Michael/Documents/GitHub/agent-os/packages/heads-up/heads-up"
SIDE_EYE="/Users/Michael/Documents/GitHub/agent-os/packages/side-eye/side-eye"
HAND_OFF="/Users/Michael/Documents/GitHub/agent-os/packages/hand-off/hand-off"
XRAY_TARGET="python3 /tmp/agent-os-dogfood/xray_target.py"
EVENTS_FILE="/tmp/agent-os-dogfood/events.jsonl"
LISTEN_PID_FILE="/tmp/agent-os-dogfood/listen.pid"
CHIME="/System/Library/Sounds/Glass.aiff"

# --- Session lifecycle ---

agent_session_start() {
  kill $(cat "$LISTEN_PID_FILE" 2>/dev/null) 2>/dev/null
  pkill -f "heads-up serve" 2>/dev/null
  sleep 0.3
  rm -f "$EVENTS_FILE"

  "$HEADS_UP" listen > "$EVENTS_FILE" 2>&1 &
  echo $! > "$LISTEN_PID_FILE"
  sleep 0.5

  # Create overlay but start dismissed (invisible until first question)
  "$HEADS_UP" create --id agent-confirm --at 600,1500,470,400 \
    --file /tmp/agent-os-dogfood/confirm.html --interactive 2>/dev/null
  sleep 0.3
}

agent_session_end() {
  "$HEADS_UP" remove-all 2>/dev/null
  kill $(cat "$LISTEN_PID_FILE" 2>/dev/null) 2>/dev/null
  rm -f "$EVENTS_FILE"
}

# --- Ask + Wait (reactive, ~300ms latency) ---

agent_ask() {
  # Usage: agent_ask "question html" ["opt1" "opt2" ... "optN"]
  # First arg is the question. Remaining args are numbered options.
  # If no options, shows only the text input escape hatch.
  # Returns the user's response value on stdout.
  local question="$1"
  shift
  local options=("$@")

  # Clear old events
  : > "$EVENTS_FILE"

  # Build JS call
  local escaped_q=$(echo "$question" | sed "s/'/\\\\\\\\'/g")
  local js_call

  if [[ ${#options[@]} -gt 0 ]]; then
    local opts_json="["
    for i in "${!options[@]}"; do
      [[ $i -gt 0 ]] && opts_json+=","
      local escaped_opt=$(echo "${options[$i]}" | sed "s/'/\\\\\\\\'/g")
      opts_json+="'${escaped_opt}'"
    done
    opts_json+="]"
    js_call="setQuestion('${escaped_q}', ${opts_json})"
  else
    js_call="setQuestion('${escaped_q}')"
  fi

  # Chime to get attention
  afplay "$CHIME" &

  # Show the question
  "$HEADS_UP" eval --id agent-confirm --js "$js_call" 2>/dev/null

  # Poll every 300ms for a confirm event
  while true; do
    local event=$(tr -d '\000' < "$EVENTS_FILE" 2>/dev/null | grep '"type":"confirm"' | tail -1)
    if [[ -n "$event" ]]; then
      local value=$(echo "$event" | python3 -c "import sys,json; print(json.loads(sys.stdin.read())['payload']['value'])")
      echo "$value"
      return 0
    fi
    sleep 0.3
  done
}

# --- Acknowledge (immediate visual feedback) ---

agent_ack() {
  "$HEADS_UP" eval --id agent-confirm --js "
var card = document.getElementById('card');
card.classList.remove('dismissed');
card.style.background = 'transparent'; card.style.border = 'none'; card.style.boxShadow = 'none';
card.style.backdropFilter = 'none'; card.style.webkitBackdropFilter = 'none'; card.style.transition = 'none';
card.innerHTML = '<div id=\"thumb\" style=\"text-align:center;font-size:100px;line-height:1;filter:drop-shadow(0 4px 12px rgba(0,0,0,0.4));transform:scale(0);transition:transform 0.4s cubic-bezier(0.34,1.56,0.64,1),opacity 1.5s ease 0.8s;opacity:1;\">👍</div>';
requestAnimationFrame(function(){ requestAnimationFrame(function(){
  document.getElementById('thumb').style.transform = 'scale(1)';
  setTimeout(function(){ document.getElementById('thumb').style.opacity = '0'; }, 100);
}); });
" 2>/dev/null
  sleep 3
  # Reload the overlay so it's ready for next question (starts dismissed)
  "$HEADS_UP" update --id agent-confirm \
    --file /tmp/agent-os-dogfood/confirm.html 2>/dev/null
}

# --- Signal completion ---

agent_done() {
  local msg="${1:-Done.}"
  afplay "$CHIME" &
  local escaped=$(echo "$msg" | sed "s/'/\\\\\\\\'/g")
  "$HEADS_UP" eval --id agent-confirm --js "setQuestion('${escaped}')" 2>/dev/null
}

agent_cleanup() {
  "$HEADS_UP" remove --id agent-confirm 2>/dev/null
  "$HEADS_UP" remove --id highlight 2>/dev/null
}

# --- Highlighting ---

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
    --file /tmp/agent-os-dogfood/highlight.html 2>/dev/null
}

agent_highlight_remove() {
  "$HEADS_UP" remove --id highlight 2>/dev/null
}

# --- Logging ---

agent_log() {
  local msg="$1"
  local level="${2:-info}"
  msg="${msg//\\/\\\\}"
  msg="${msg//\'/\\\'}"
  msg="${msg//\"/\\\"}"
  "$HEADS_UP" eval --id agent-confirm \
    --js "addLog('$msg', '$level')" 2>/dev/null
}

# --- TTS ---

agent_tts_on() {
  "$HEADS_UP" eval --id agent-confirm \
    --js "window._ttsEnabled = true" 2>/dev/null
}

agent_tts_off() {
  "$HEADS_UP" eval --id agent-confirm \
    --js "window._ttsEnabled = false" 2>/dev/null
}

# --- Voice (Apple native say) ---

agent_speak() {
  say -v Samantha "$1" &
}

echo "agent-os helpers loaded."
