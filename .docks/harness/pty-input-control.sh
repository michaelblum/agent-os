#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: pty-input-control.sh send [--submit|--no-submit] [--clear|--no-clear] <tmux-target> [text]" >&2
  echo "       pty-input-control.sh key <tmux-target> <key>" >&2
  echo "       printf '%s' text | pty-input-control.sh send [options] <tmux-target>" >&2
  exit 2
}

pty_input_log_path() {
  if [[ -n "${AOS_DOCK_PTY_INPUT_LOG:-}" ]]; then
    printf '%s\n' "$AOS_DOCK_PTY_INPUT_LOG"
    return
  fi
  local state_root mode
  state_root="${AOS_STATE_ROOT:-$HOME/.config/aos}"
  mode="${AOS_RUNTIME_MODE:-repo}"
  printf '%s/%s/docks/pty-input.jsonl\n' "$state_root" "$mode"
}

append_pty_input_record() {
  local record_json="$1"
  local log_path log_dir
  log_path="$(pty_input_log_path)"
  log_dir="$(dirname "$log_path")"
  mkdir -p "$log_dir" 2>/dev/null || true
  umask 077
  printf '%s\n' "$record_json" >>"$log_path" 2>/dev/null || true
}

json_string() {
  python3 - "$1" <<'PY'
import json
import sys
print(json.dumps(sys.argv[1]))
PY
}

command="${1:-}"
if [[ "$command" != "send" && "$command" != "key" ]]; then
  usage
fi
shift

if [[ "$command" == "key" ]]; then
  target="${1:-}"
  key="${2:-}"
  if [[ -z "$target" || -z "$key" || $# -ne 2 ]]; then
    usage
  fi
  case "$target" in
    *[!a-zA-Z0-9_%:.-]*|"") usage ;;
  esac
  case "$key" in
    Enter|C-c|C-d|Up|Down|Left|Right|Tab|Escape|Backspace) ;;
    *) usage ;;
  esac

  tmux_available=0
  if command -v tmux >/dev/null 2>&1; then
    tmux_available=1
  fi
  bridge_session_target="$target"
  if [[ "$tmux_available" == "1" ]]; then
    resolved_session="$(tmux display-message -p -t "$target" '#S' 2>/dev/null || true)"
    if [[ -n "$resolved_session" ]]; then
      bridge_session_target="$resolved_session"
    fi
  fi
  bridge_url="${AOS_DOCK_AGENT_TERMINAL_BRIDGE_URL:-${AGENT_TERMINAL_BRIDGE_URL:-}}"
  if [[ -z "$bridge_url" && -n "${AGENT_TERMINAL_PORT:-}" ]]; then
    bridge_url="http://127.0.0.1:${AGENT_TERMINAL_PORT}"
  fi
  if [[ -z "$bridge_url" && "$tmux_available" == "1" ]]; then
    bridge_session="aos-agent-bridge-${bridge_session_target}"
    bridge_pid="$(tmux list-panes -t "$bridge_session" -F '#{pane_pid}' 2>/dev/null | head -n 1 || true)"
    if [[ -n "$bridge_pid" ]]; then
      bridge_port="$(ps eww -p "$bridge_pid" 2>/dev/null | tr ' ' '\n' | sed -n 's/^AGENT_TERMINAL_PORT=//p' | head -n 1 || true)"
      if [[ -n "$bridge_port" ]]; then
        bridge_url="http://127.0.0.1:${bridge_port}"
      fi
    fi
  fi
  if [[ -n "$bridge_url" ]]; then
    if python3 - "$bridge_url" "$bridge_session_target" "$key" <<'PY'
import json
import sys
import urllib.error
import urllib.request

bridge_url, session, key = sys.argv[1:]
payload = json.dumps({"session": session, "key": key}).encode("utf-8")
request = urllib.request.Request(
    bridge_url.rstrip("/") + "/key",
    data=payload,
    headers={"content-type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(request, timeout=2) as response:
        if response.status < 200 or response.status >= 300:
            raise SystemExit(1)
        response.read()
except (OSError, urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
    raise SystemExit(1)
PY
    then
      append_pty_input_record "$(printf '{"schema":"aos.dock.pty_input.v1","timestamp":%s,"action":"key","target":%s,"driver":"agent-terminal-bridge","session":%s,"key":%s}\n' "$(json_string "$(date -u +"%Y-%m-%dT%H:%M:%SZ")")" "$(json_string "$target")" "$(json_string "$bridge_session_target")" "$(json_string "$key")")"
      exit 0
    fi
  fi
  if [[ "$tmux_available" != "1" ]]; then
    echo "tmux_unavailable" >&2
    exit 1
  fi
  tmux send-keys -t "$target" "$key"
  append_pty_input_record "$(printf '{"schema":"aos.dock.pty_input.v1","timestamp":%s,"action":"key","target":%s,"driver":"tmux","key":%s}\n' "$(json_string "$(date -u +"%Y-%m-%dT%H:%M:%SZ")")" "$(json_string "$target")" "$(json_string "$key")")"
  exit 0
fi

submit=1
clear=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --submit)
      submit=1
      shift
      ;;
    --no-submit|--leave)
      submit=0
      shift
      ;;
    --clear)
      clear=1
      shift
      ;;
    --no-clear)
      clear=0
      shift
      ;;
    --)
      shift
      break
      ;;
    -*)
      usage
      ;;
    *)
      break
      ;;
  esac
done

target="${1:-}"
if [[ -z "$target" ]]; then
  usage
fi
shift

case "$target" in
  *[!a-zA-Z0-9_%:.-]*|"") usage ;;
esac

text="${1:-}"
if [[ $# -gt 0 ]]; then
  shift || true
fi
if [[ $# -gt 0 ]]; then
  usage
fi

if [[ -z "$text" ]]; then
  text="$(cat || true)"
fi
if [[ -z "$text" ]]; then
  usage
fi

tmux_available=0
if command -v tmux >/dev/null 2>&1; then
  tmux_available=1
fi
bridge_session_target="$target"
if [[ "$tmux_available" == "1" ]]; then
  resolved_session="$(tmux display-message -p -t "$target" '#S' 2>/dev/null || true)"
  if [[ -n "$resolved_session" ]]; then
    bridge_session_target="$resolved_session"
  fi
fi

bridge_url="${AOS_DOCK_AGENT_TERMINAL_BRIDGE_URL:-${AGENT_TERMINAL_BRIDGE_URL:-}}"
if [[ -z "$bridge_url" && -n "${AGENT_TERMINAL_PORT:-}" ]]; then
  bridge_url="http://127.0.0.1:${AGENT_TERMINAL_PORT}"
fi
if [[ -z "$bridge_url" && "$tmux_available" == "1" ]]; then
  bridge_session="aos-agent-bridge-${bridge_session_target}"
  bridge_pid="$(tmux list-panes -t "$bridge_session" -F '#{pane_pid}' 2>/dev/null | head -n 1 || true)"
  if [[ -n "$bridge_pid" ]]; then
    bridge_port="$(ps eww -p "$bridge_pid" 2>/dev/null | tr ' ' '\n' | sed -n 's/^AGENT_TERMINAL_PORT=//p' | head -n 1 || true)"
    if [[ -n "$bridge_port" ]]; then
      bridge_url="http://127.0.0.1:${bridge_port}"
    fi
  fi
fi

if [[ "$clear" == "1" && "$tmux_available" == "1" ]]; then
  tmux send-keys -t "$target" C-u
fi

if [[ -n "$bridge_url" ]]; then
  if python3 - "$bridge_url" "$bridge_session_target" "$text" "$submit" "${AOS_DOCK_PTY_PRE_SUBMIT_DELAY_MS:-300}" <<'PY'
import json
import sys
import time
import urllib.error
import urllib.request

bridge_url, session, text, submit, delay_ms = sys.argv[1:]

def post_input(payload):
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        bridge_url.rstrip("/") + "/input",
        data=data,
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=2) as response:
        if response.status < 200 or response.status >= 300:
            raise SystemExit(1)
        response.read()

try:
    post_input({"session": session, "text": text, "enter": False})
    if submit == "1":
        time.sleep(max(0, int(delay_ms)) / 1000)
        post_input({"session": session, "text": "", "enter": True})
except (OSError, urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
    raise SystemExit(1)
PY
  then
    append_pty_input_record "$(python3 - "$target" "$bridge_session_target" "$text" "$submit" "$clear" <<'PY'
import json
import sys
from datetime import datetime, timezone

target, session, text, submit, clear = sys.argv[1:]
payload = {
    "schema": "aos.dock.pty_input.v1",
    "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "action": "send",
    "target": target,
    "driver": "agent-terminal-bridge",
    "session": session,
    "text": text,
    "utf8_hex": text.encode("utf-8").hex(),
    "clear_sent": clear == "1",
    "submit_sent": submit == "1",
}
print(json.dumps(payload, sort_keys=True))
PY
)"
    exit 0
  fi
fi

if [[ "$tmux_available" != "1" ]]; then
  echo "tmux_unavailable" >&2
  exit 1
fi

buffer_name="aos-dock-pty-input-$$"
printf '%s' "$text" | tmux load-buffer -b "$buffer_name" -
tmux paste-buffer -d -b "$buffer_name" -t "$target"

if [[ "$submit" == "1" ]]; then
  sleep "$(python3 - <<'PY'
import os
try:
    print(max(0, int(os.environ.get("AOS_DOCK_PTY_PRE_SUBMIT_DELAY_MS", "300"))) / 1000)
except ValueError:
    print(0.3)
PY
)"
  tmux send-keys -t "$target" Enter
fi

append_pty_input_record "$(python3 - "$target" "$text" "$submit" "$clear" "$buffer_name" <<'PY'
import json
import sys
from datetime import datetime, timezone

target, text, submit, clear, buffer_name = sys.argv[1:]
payload = {
    "schema": "aos.dock.pty_input.v1",
    "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "action": "send",
    "target": target,
    "driver": "tmux",
    "paste_buffer": buffer_name,
    "text": text,
    "utf8_hex": text.encode("utf-8").hex(),
    "clear_sent": clear == "1",
    "submit_sent": submit == "1",
}
print(json.dumps(payload, sort_keys=True))
PY
)"
