#!/bin/bash
# Shared session-start hook for agent-os providers.
#
# Ensures the aos daemon is up, then prints a compact session snapshot
# (daemon health, git state, stale resources).

set -euo pipefail
ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || pwd)"
AOS="$ROOT/aos"
cd "$ROOT"

# shellcheck source=/dev/null
source "$(dirname "$0")/session-common.sh"

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
ready = bool(runtime.get('socket_reachable'))
ownership = runtime.get('ownership_state')
if ready and ownership not in (None, 'consistent', 'unknown'):
    ready = False
tap_expected = bool(runtime.get('event_tap_expected'))
tap_status = runtime.get('input_tap_status')
if ready and tap_expected and tap_status not in (None, 'active'):
    ready = False
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

  if aos_session_uses_explicit_state_root_override; then
    AOS_STARTUP_STATE="started-via-serve"
    if command -v nohup >/dev/null 2>&1; then
      nohup "$AOS" serve --idle-timeout none >/dev/null 2>&1 &
    else
      "$AOS" serve --idle-timeout none >/dev/null 2>&1 &
    fi
  elif "$AOS" service start --json >/dev/null 2>&1; then
    AOS_STARTUP_STATE="started-via-service"
  else
    AOS_STARTUP_STATE="service-start-failed"
    refresh_aos_doctor_json || true
    return 1
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

ensure_aos_runtime || true

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
UPSTREAM="$(git -C "$ROOT" rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || true)"
if [ -z "$UPSTREAM" ]; then
  DEFAULT_REMOTE_HEAD="$(git -C "$ROOT" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null || true)"
  UPSTREAM="${DEFAULT_REMOTE_HEAD:-origin/main}"
fi
AHEAD=$(git -C "$ROOT" rev-list --count "$UPSTREAM"..HEAD 2>/dev/null || echo "?")
DIRTY=$(git -C "$ROOT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')

echo ""
echo "## Snapshot"
if [ -x "$AOS" ]; then
  STATUS="$(printf '%s' "$AOS_DOCTOR_JSON" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    mode = d.get('identity',{}).get('mode','?')
    status = d.get('status','?')
    runtime = d.get('runtime', {})
    pid = runtime.get('daemon_pid','?')
    acc = d.get('permissions',{}).get('accessibility', False)
    scr = d.get('permissions',{}).get('screen_recording', False)
    commit = d.get('identity',{}).get('git_commit','?')
    socket_reachable = runtime.get('socket_reachable', False)
    tap_block = runtime.get('input_tap')
    if not socket_reachable:
        tap_value = 'unknown'
    elif isinstance(tap_block, dict):
        tap_value = tap_block.get('status', 'unknown')
    else:
        tap_value = runtime.get('input_tap_status', 'unknown')
    print(f'mode={mode} status={status} pid={pid} startup=${AOS_STARTUP_STATE} commit={commit} acc={\"ok\" if acc else \"NO\"} scr={\"ok\" if scr else \"NO\"} tap={tap_value}')
except Exception:
    print('aos doctor failed to parse')
" 2>/dev/null || echo "aos not running or not built")"
  echo "aos=$STATUS"
else
  echo "aos=missing"
fi

# When tap is non-active and the daemon is reachable, point at status for full
# guidance. Skip when daemon=unreachable: the daemon-recovery story is the
# bigger signal in that case.
if [ -x "$AOS" ]; then
  TAP_PTR="$(printf '%s' "$AOS_DOCTOR_JSON" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    runtime = d.get('runtime', {})
    if not runtime.get('socket_reachable', False):
        sys.exit(0)
    tap_block = runtime.get('input_tap')
    status = tap_block.get('status') if isinstance(tap_block, dict) else runtime.get('input_tap_status')
    if status and status != 'active':
        print(f\"input_tap inactive (status={status}) — run './aos service restart' (see './aos status' for full guidance)\")
except Exception:
    pass
" 2>/dev/null)"
  if [ -n "$TAP_PTR" ]; then
    echo "$TAP_PTR"
  fi
fi

echo "branch=$BRANCH upstream=$UPSTREAM ahead=$AHEAD dirty=$DIRTY"
echo "stale=$STALE_STATUS"
echo "trust=AGENTS.md"
echo "entry=./aos status"
echo "visual=./aos see"
