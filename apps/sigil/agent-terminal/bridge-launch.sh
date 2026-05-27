#!/bin/bash
# Sigil Agent Terminal hook: start only the provider bridge/session substrate.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
MODE="${MODE:-repo}"
SESSION="${SESSION:-sigil-agent-terminal-agent-os}"
PORT="${PORT:-17761}"
CWD_TARGET="${CWD_TARGET:-$REPO_ROOT}"
AGENT_COMMAND="${AGENT_COMMAND:-codex --no-alt-screen}"
STATE_DIR="${HOME}/.config/aos/${MODE}/sigil"
BRIDGE_LOG="${STATE_DIR}/agent-terminal-bridge.log"
BRIDGE_SESSION="${BRIDGE_SESSION:-sigil-agent-bridge-${PORT}}"
BRIDGE_DIR="$REPO_ROOT/packages/toolkit/components/agent-terminal"
RESTART="${RESTART:-0}"

bridge_health_matches() {
  local health
  health="$(curl -fsS "http://127.0.0.1:${PORT}/health" 2>/dev/null || true)"
  if [[ -z "$health" ]]; then
    return 1
  fi
  AGENT_TERMINAL_HEALTH_JSON="$health" python3 - "$SESSION" "$CWD_TARGET" <<'PY'
import json, os, sys
session, cwd = sys.argv[1:]
try:
    payload = json.loads(os.environ.get("AGENT_TERMINAL_HEALTH_JSON") or "")
except json.JSONDecodeError:
    raise SystemExit(1)
if payload.get("defaultSession") != session:
    raise SystemExit(1)
if payload.get("defaultCwd") != cwd:
    raise SystemExit(1)
PY
}

start_bridge() {
  mkdir -p "$STATE_DIR"
  if [[ "$RESTART" -eq 0 ]] && bridge_health_matches; then
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
    bridge_health_matches && return 0
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

start_bridge
ensure_bridge_session
