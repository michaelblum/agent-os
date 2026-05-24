#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: pty-input-control.sh send [--submit|--no-submit] [--clear|--no-clear] <tmux-target> [text]" >&2
  echo "       printf '%s' text | pty-input-control.sh send [options] <tmux-target>" >&2
  exit 2
}

command="${1:-}"
if [[ "$command" != "send" ]]; then
  usage
fi
shift

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
  if python3 - "$bridge_url" "$bridge_session_target" "$text" "$submit" <<'PY'
import json
import sys
import urllib.error
import urllib.request

bridge_url, session, text, submit = sys.argv[1:]
payload = json.dumps({
    "session": session,
    "text": text,
    "enter": submit == "1",
}).encode("utf-8")
request = urllib.request.Request(
    bridge_url.rstrip("/") + "/input",
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
    exit 0
  fi
fi

if [[ "$tmux_available" != "1" ]]; then
  echo "tmux_unavailable" >&2
  exit 1
fi

IFS=$'\n' read -r -d '' -a parts < <(printf '%s\0' "$text") || true
if [[ ${#parts[@]} -eq 0 ]]; then
  parts=("$text")
fi
for ((i = 0; i < ${#parts[@]}; i += 1)); do
  if [[ -n "${parts[$i]}" ]]; then
    tmux send-keys -t "$target" -l "${parts[$i]}"
  fi
  if [[ $i -lt $((${#parts[@]} - 1)) ]]; then
    tmux send-keys -t "$target" Enter
  fi
done

if [[ "$submit" == "1" ]]; then
  tmux send-keys -t "$target" Enter
fi
