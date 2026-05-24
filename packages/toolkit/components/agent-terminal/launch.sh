#!/bin/bash
# Launch the generic toolkit-owned AOS Agent Terminal.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
source "$REPO_ROOT/scripts/aos-content-scope.sh"
AOS="${AOS:-$REPO_ROOT/aos}"
MODE="${MODE:-repo}"
CANVAS_ID="${CANVAS_ID:-aos-agent-terminal}"
SESSION="${SESSION:-aos-agent-terminal-agent-os}"
PORT="${PORT:-17761}"
CWD_TARGET="${CWD_TARGET:-$REPO_ROOT}"
AGENT_COMMAND="${AGENT_COMMAND:-${CODEX_COMMAND:-codex --no-alt-screen}}"
STATE_DIR="${HOME}/.config/aos/${MODE}/toolkit"
BRIDGE_LOG="${STATE_DIR}/agent-terminal-bridge.log"
BRIDGE_SESSION="${BRIDGE_SESSION:-aos-agent-bridge-${PORT}}"
TOOLKIT_CONTENT_ROOT="${AOS_TOOLKIT_CONTENT_ROOT:-$(aos_content_root_key_for toolkit "$REPO_ROOT")}"
BRIDGE_DIR="$REPO_ROOT/packages/toolkit/components/agent-terminal"

usage() {
  printf 'Usage: %s [--new|--new-codex|--new-claude|--pick|--last|--restart]\n' "$0"
  printf 'Default starts a fresh Codex agent CLI without launching Sigil avatar surfaces.\n'
}

RESTART=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --new|--new-codex)
      AGENT_COMMAND="codex --no-alt-screen"
      shift
      ;;
    --new-claude)
      AGENT_COMMAND="claude"
      shift
      ;;
    --pick)
      AGENT_COMMAND="codex --no-alt-screen resume"
      shift
      ;;
    --last)
      AGENT_COMMAND="codex --no-alt-screen resume --last"
      shift
      ;;
    --restart)
      RESTART=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done

ensure_content_roots() {
  aos_ensure_content_roots_live "$AOS" \
    "$TOOLKIT_CONTENT_ROOT" "$REPO_ROOT/packages/toolkit"
}

ensure_runtime_assets() {
  local assets=(
    "$SCRIPT_DIR/node_modules/@xterm/xterm/css/xterm.css"
    "$SCRIPT_DIR/node_modules/@xterm/xterm/lib/xterm.js"
    "$SCRIPT_DIR/node_modules/@xterm/addon-fit/lib/addon-fit.js"
  )
  local missing=0
  local asset
  for asset in "${assets[@]}"; do
    if [[ ! -f "$asset" ]]; then
      missing=1
      break
    fi
  done
  if [[ "$missing" -eq 0 ]]; then
    return 0
  fi
  if [[ ! -f "$SCRIPT_DIR/package-lock.json" || ! -f "$SCRIPT_DIR/package.json" ]]; then
    echo "Agent terminal runtime assets are missing and package metadata is unavailable in $SCRIPT_DIR" >&2
    return 1
  fi
  if ! command -v npm >/dev/null 2>&1; then
    echo "Agent terminal runtime assets are missing and npm is not available to prepare them." >&2
    return 1
  fi

  echo "Preparing toolkit Agent Terminal runtime assets in $SCRIPT_DIR" >&2
  npm ci --prefix "$SCRIPT_DIR" --omit=dev --no-audit --no-fund >/dev/null

  for asset in "${assets[@]}"; do
    if [[ ! -f "$asset" ]]; then
      echo "Agent terminal runtime asset was not prepared: $asset" >&2
      return 1
    fi
  done
}

bridge_running() {
  curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1
}

start_bridge() {
  mkdir -p "$STATE_DIR"
  if bridge_running; then
    return 0
  fi
  if command -v tmux >/dev/null 2>&1; then
    tmux kill-session -t "$BRIDGE_SESSION" >/dev/null 2>&1 || true
    local bridge_cmd
    bridge_cmd="$(python3 - "$PORT" "$SESSION" "$CWD_TARGET" "$REPO_ROOT" "$AGENT_COMMAND" "$BRIDGE_DIR/bridge-server.mjs" "$BRIDGE_LOG" <<'PY'
import shlex, sys
port, session, cwd, repo_root, command, server, log = sys.argv[1:]
parts = [
    "AGENT_TERMINAL_PORT=" + shlex.quote(port),
    "AGENT_TERMINAL_TMUX_SESSION=" + shlex.quote(session),
    "AGENT_TERMINAL_CWD=" + shlex.quote(cwd),
    "AGENT_TERMINAL_REPO_ROOT=" + shlex.quote(repo_root),
    "AGENT_TERMINAL_COMMAND=" + shlex.quote(command),
    "node",
    shlex.quote(server),
    ">>",
    shlex.quote(log),
    "2>&1",
]
print(" ".join(parts))
PY
)"
    : >"$BRIDGE_LOG"
    tmux new-session -d -s "$BRIDGE_SESSION" -c "$REPO_ROOT" "$bridge_cmd"
  else
    AGENT_TERMINAL_PORT="$PORT" \
    AGENT_TERMINAL_TMUX_SESSION="$SESSION" \
    AGENT_TERMINAL_CWD="$CWD_TARGET" \
    AGENT_TERMINAL_REPO_ROOT="$REPO_ROOT" \
    AGENT_TERMINAL_COMMAND="$AGENT_COMMAND" \
      nohup node "$BRIDGE_DIR/bridge-server.mjs" >"$BRIDGE_LOG" 2>&1 &
  fi
  for _ in $(seq 1 30); do
    bridge_running && return 0
    sleep 0.1
  done
  echo "Agent terminal bridge did not start. See $BRIDGE_LOG" >&2
  return 1
}

ensure_bridge_session() {
  local payload
  payload="$(python3 - "$SESSION" "$CWD_TARGET" "$AGENT_COMMAND" "$RESTART" <<'PY'
import json, sys
print(json.dumps({
    "session": sys.argv[1],
    "cwd": sys.argv[2],
    "command": sys.argv[3],
    "force": sys.argv[4] == "1",
}))
PY
)"
  curl -fsS \
    -H 'content-type: application/json' \
    -d "$payload" \
    "http://127.0.0.1:${PORT}/ensure" >/dev/null
}

urlencode() {
  python3 - "$1" <<'PY'
from urllib.parse import quote
import sys
print(quote(sys.argv[1], safe=""))
PY
}

compute_frame() {
  AOS_DISPLAY_JSON="$("$AOS" graph displays --json 2>/dev/null || echo '{"displays":[]}')" python3 - <<'PY'
import json, os
raw = json.loads(os.environ.get("AOS_DISPLAY_JSON") or '{"displays":[]}')
if isinstance(raw, dict) and isinstance(raw.get("data"), dict):
    displays = raw["data"].get("displays", [])
else:
    displays = raw.get("displays", raw) if isinstance(raw, dict) else raw
if not isinstance(displays, list):
    displays = []
main = next((d for d in displays if d.get("is_main")), None) or (displays[0] if displays else None)
if not main:
    print("240,180,860,560")
    raise SystemExit
b = main.get("visible_bounds") or main.get("visibleBounds") or main.get("bounds") or {"x": 0, "y": 0, "w": 1512, "h": 875}
w = min(1140, max(920, round(b["w"] * 0.70)))
h = min(620, max(480, round(b["h"] * 0.58)))
x = round(b["x"] + b["w"] - w - 28)
y = round(b["y"] + b["h"] - h - 28)
print(f"{x},{y},{w},{h}")
PY
}

main() {
  ensure_runtime_assets
  ensure_content_roots
  "$AOS" service start --mode "$MODE" >/dev/null 2>&1 || true
  start_bridge
  ensure_bridge_session

  "$AOS" show remove --id "$CANVAS_ID" >/dev/null 2>&1 || true
  local frame
  local encoded_cwd
  frame="$(compute_frame)"
  encoded_cwd="$(urlencode "$CWD_TARGET")"
  "$AOS" show create --id "$CANVAS_ID" \
    --at "$frame" \
    --interactive \
    --focus \
    --url "aos://$TOOLKIT_CONTENT_ROOT/components/agent-terminal/index.html?port=${PORT}&session=${SESSION}&cwd=${encoded_cwd}&surface=generic" >/dev/null

  echo "AOS Agent Terminal launched."
  echo "  canvas:  $CANVAS_ID ($frame)"
  echo "  session: $SESSION"
  echo "  bridge:  http://127.0.0.1:$PORT"
  echo "  command: $AGENT_COMMAND"
}

main "$@"
