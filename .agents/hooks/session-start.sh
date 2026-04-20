#!/bin/bash
# Shared session-start hook for agent-os providers.

set -euo pipefail
ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || pwd)"
AOS="$ROOT/aos"
cd "$ROOT"
HOOK_INPUT="$(cat || true)"

# shellcheck source=/dev/null
source "$(dirname "$0")/session-common.sh"

SESSION_ID="$(aos_resolve_session_id "$HOOK_INPUT")"
SESSION_HARNESS="$(aos_detect_harness)"
SESSION_NAME="$(aos_resolve_session_name "$SESSION_ID" "$SESSION_HARNESS")"
SESSION_CHANNEL="$(aos_session_channel "$SESSION_ID" "$SESSION_NAME")"
SESSION_SOURCE="$(aos_session_name_source "$SESSION_ID")"
REGISTRATION_STATUS="skipped"
BOOTSTRAP_FILE=""
AOS_DOCTOR_JSON=""
AOS_STARTUP_STATE="missing"

refresh_aos_doctor_json() {
  if [ ! -x "$AOS" ]; then
    AOS_DOCTOR_JSON=""
    return 1
  fi
  if ! AOS_DOCTOR_JSON="$("$AOS" doctor --json 2>/dev/null)"; then
    AOS_DOCTOR_JSON=""
    return 1
  fi
  return 0
}

aos_runtime_ready() {
  [ -n "${AOS_DOCTOR_JSON:-}" ] || return 1
  printf '%s' "$AOS_DOCTOR_JSON" | python3 -c "
import json, sys
try:
    payload = json.load(sys.stdin)
except Exception:
    raise SystemExit(1)
runtime = payload.get('runtime', {})
service = payload.get('aos_service', {})
ready = bool(runtime.get('socket_reachable') or runtime.get('daemon_running') or service.get('running'))
raise SystemExit(0 if ready else 1)
" >/dev/null 2>&1
}

ensure_aos_runtime() {
  if [ ! -x "$AOS" ]; then
    AOS_STARTUP_STATE="missing"
    return 1
  fi

  if refresh_aos_doctor_json && aos_runtime_ready; then
    AOS_STARTUP_STATE="already-running"
    return 0
  fi

  if "$AOS" service start --json >/dev/null 2>&1; then
    AOS_STARTUP_STATE="started-via-service"
  else
    AOS_STARTUP_STATE="started-via-serve"
    if command -v nohup >/dev/null 2>&1; then
      nohup "$AOS" serve --idle-timeout none >/dev/null 2>&1 &
    else
      "$AOS" serve --idle-timeout none >/dev/null 2>&1 &
    fi
  fi

  for _ in $(seq 1 20); do
    sleep 0.2
    if refresh_aos_doctor_json && aos_runtime_ready; then
      return 0
    fi
  done

  AOS_STARTUP_STATE="startup-failed"
  refresh_aos_doctor_json || true
  return 1
}

if [ -n "$SESSION_NAME" ]; then
  BOOTSTRAP_FILE="$(aos_session_bootstrap_payload_file "$SESSION_NAME")"
  if [ -f "$BOOTSTRAP_FILE" ]; then
    if ! BRIEF="$(python3 - "$BOOTSTRAP_FILE" <<'PY' 2>/dev/null
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    payload = json.load(handle)

print(payload.get("brief", ""))
PY
    )"; then
      BRIEF="(failed to parse bootstrap file)"
    fi
    echo ""
    echo "## Handoff Brief"
    echo "$BRIEF"
    rm -f "$BOOTSTRAP_FILE"
  fi
fi

ensure_aos_runtime || true

if [ -x "$AOS" ] && [ -n "$SESSION_NAME" ]; then
  if aos_refresh_session_registration "$SESSION_ID" "$SESSION_NAME" "worker" "$SESSION_HARNESS" "$AOS"; then
    REGISTRATION_STATUS="ok"
  else
    REGISTRATION_STATUS="failed"
  fi
fi

STALE_STATUS="UNKNOWN"
if [ -x "$AOS" ]; then
  STALE_STATUS="$("$AOS" clean --dry-run --json 2>/dev/null | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    if d.get('status') == 'dirty':
        parts = []
        sd = d.get('stale_daemons', [])
        cv = d.get('canvases', [])
        if sd:
            parts.append(f'{len(sd)} stale daemon(s)')
        if cv:
            parts.append(f'{len(cv)} orphaned canvas(es)')
        print('DIRTY: ' + '; '.join(parts))
    else:
        print('CLEAN')
except Exception:
    print('UNKNOWN')
" 2>/dev/null || echo "UNKNOWN")"
fi

BRANCH=$(git -C "$ROOT" branch --show-current 2>/dev/null || echo "?")
AHEAD=$(git -C "$ROOT" rev-list --count origin/main..HEAD 2>/dev/null || echo "?")
DIRTY=$(git -C "$ROOT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')

echo ""
echo "## Session"
if [ -n "$SESSION_ID" ]; then
  echo "name=${SESSION_NAME} harness=${SESSION_HARNESS} session_id=${SESSION_ID} channel=${SESSION_CHANNEL} source=${SESSION_SOURCE} registered=${REGISTRATION_STATUS}"
else
  echo "name=${SESSION_NAME} harness=${SESSION_HARNESS} source=${SESSION_SOURCE} registered=${REGISTRATION_STATUS}"
fi
if [ "$SESSION_SOURCE" = "generated" ]; then
  echo "Rename later with: scripts/session-name --name <meaningful-name>"
fi

echo ""
echo "## Snapshot"
if [ -x "$AOS" ]; then
  STATUS="$(printf '%s' "$AOS_DOCTOR_JSON" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    mode = d.get('identity',{}).get('mode','?')
    status = d.get('status','?')
    pid = d.get('runtime',{}).get('daemon_pid','?')
    acc = d.get('permissions',{}).get('accessibility', False)
    scr = d.get('permissions',{}).get('screen_recording', False)
    commit = d.get('identity',{}).get('git_commit','?')
    print(f'mode={mode} status={status} pid={pid} startup=${AOS_STARTUP_STATE} commit={commit} acc={\"ok\" if acc else \"NO\"} scr={\"ok\" if scr else \"NO\"}')
except Exception:
    print('aos doctor failed to parse')
" 2>/dev/null || echo "aos not running or not built")"
  echo "aos=$STATUS"
else
  echo "aos=missing"
fi

echo "branch=$BRANCH ahead=$AHEAD dirty=$DIRTY"
echo "stale=$STALE_STATUS"
echo "trust=AGENTS.md docs/SESSION_CONTRACT.md"
echo "entry=./aos status"
echo "visual=./aos see"
echo "handoff=scripts/handoff"
