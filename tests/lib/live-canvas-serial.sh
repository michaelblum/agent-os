#!/usr/bin/env bash

# Shared repo-daemon canvas tests must not overlap. The lock lives outside the
# repo so independent shells and worktrees still serialize against one daemon.

AOS_LIVE_CANVAS_LOCK_DIR="${AOS_LIVE_CANVAS_LOCK_DIR:-/tmp/aos-live-canvas-tests.lock}"
AOS_LIVE_CANVAS_LOCK_TIMEOUT_SECONDS="${AOS_LIVE_CANVAS_LOCK_TIMEOUT_SECONDS:-120}"
AOS_LIVE_CANVAS_LOCK_POLL_SECONDS="${AOS_LIVE_CANVAS_LOCK_POLL_SECONDS:-0.2}"

aos_live_canvas_lock_pid_alive() {
  local pid="$1"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

aos_live_canvas_lock_owner_pid() {
  local owner_file="$AOS_LIVE_CANVAS_LOCK_DIR/owner"
  [[ -f "$owner_file" ]] || return 0
  awk -F= '$1 == "pid" { print $2; exit }' "$owner_file" 2>/dev/null || true
}

aos_live_canvas_lock_owner_summary() {
  local owner_file="$AOS_LIVE_CANVAS_LOCK_DIR/owner"
  if [[ -f "$owner_file" ]]; then
    tr '\n' ' ' < "$owner_file" | sed 's/[[:space:]]*$//'
  else
    printf 'owner=unknown'
  fi
}

aos_live_canvas_release_serial_lock() {
  [[ "${AOS_LIVE_CANVAS_LOCK_HELD:-}" == "1" ]] || return 0
  [[ -d "$AOS_LIVE_CANVAS_LOCK_DIR" ]] || return 0

  local owner_pid
  owner_pid="$(aos_live_canvas_lock_owner_pid)"
  if [[ "$owner_pid" == "$$" ]]; then
    rm -rf "$AOS_LIVE_CANVAS_LOCK_DIR"
  fi
  unset AOS_LIVE_CANVAS_LOCK_HELD
}

aos_live_canvas_acquire_serial_lock() {
  local label="${1:-${0##*/}}"
  local start now owner_pid
  start="$(date +%s)"

  while true; do
    if mkdir "$AOS_LIVE_CANVAS_LOCK_DIR" 2>/dev/null; then
      {
        printf 'pid=%s\n' "$$"
        printf 'label=%s\n' "$label"
        printf 'started_at=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
      } > "$AOS_LIVE_CANVAS_LOCK_DIR/owner"
      AOS_LIVE_CANVAS_LOCK_HELD=1
      return 0
    fi

    owner_pid="$(aos_live_canvas_lock_owner_pid)"
    if [[ -n "$owner_pid" ]] && ! aos_live_canvas_lock_pid_alive "$owner_pid"; then
      rm -rf "$AOS_LIVE_CANVAS_LOCK_DIR"
      continue
    fi

    now="$(date +%s)"
    if (( now - start >= AOS_LIVE_CANVAS_LOCK_TIMEOUT_SECONDS )); then
      echo "FAIL: timed out waiting for live canvas serial lock at $AOS_LIVE_CANVAS_LOCK_DIR" >&2
      echo "Held by: $(aos_live_canvas_lock_owner_summary)" >&2
      return 1
    fi

    sleep "$AOS_LIVE_CANVAS_LOCK_POLL_SECONDS"
  done
}
