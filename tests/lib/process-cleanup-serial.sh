#!/usr/bin/env bash

if [[ -z "${AOS_PROCESS_CLEANUP_SERIAL_SH_LOADED:-}" ]]; then
AOS_PROCESS_CLEANUP_SERIAL_SH_LOADED=1

AOS_PROCESS_CLEANUP_LOCK_DIR="${AOS_PROCESS_CLEANUP_LOCK_DIR:-/tmp/aos-process-cleanup-tests-${UID:-${USER:-unknown}}.lock}"
AOS_PROCESS_CLEANUP_LOCK_TIMEOUT_SECONDS="${AOS_PROCESS_CLEANUP_LOCK_TIMEOUT_SECONDS:-120}"
AOS_PROCESS_CLEANUP_LOCK_POLL_SECONDS="${AOS_PROCESS_CLEANUP_LOCK_POLL_SECONDS:-0.1}"

_aos_process_cleanup_owner_pid() {
  local owner_file="$AOS_PROCESS_CLEANUP_LOCK_DIR/owner"
  [[ -f "$owner_file" ]] || return 0
  awk -F= '$1 == "pid" { print $2; exit }' "$owner_file" 2>/dev/null || true
}

_aos_process_cleanup_owner_summary() {
  local owner_file="$AOS_PROCESS_CLEANUP_LOCK_DIR/owner"
  if [[ -f "$owner_file" ]]; then
    tr '\n' ' ' < "$owner_file" | sed 's/[[:space:]]*$//'
  else
    printf 'owner=unknown'
  fi
}

_aos_process_cleanup_pid_alive() {
  local pid="$1"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null
}

aos_process_cleanup_release_serial_lock() {
  [[ "${AOS_PROCESS_CLEANUP_LOCK_HELD:-}" == "1" ]] || return 0
  if [[ ! -d "$AOS_PROCESS_CLEANUP_LOCK_DIR" ]]; then
    unset AOS_PROCESS_CLEANUP_LOCK_HELD AOS_PROCESS_CLEANUP_LOCK_OWNER_PID
    return 0
  fi

  local owner_pid
  owner_pid="$(_aos_process_cleanup_owner_pid)"
  if [[ "$owner_pid" == "${AOS_PROCESS_CLEANUP_LOCK_OWNER_PID:-}" ]]; then
    rm -rf "$AOS_PROCESS_CLEANUP_LOCK_DIR"
  fi
  unset AOS_PROCESS_CLEANUP_LOCK_HELD AOS_PROCESS_CLEANUP_LOCK_OWNER_PID
}

aos_process_cleanup_acquire_serial_lock() {
  local label="${1:-${0##*/}}"
  local start now owner_pid current_pid
  start="$(date +%s)"
  current_pid="${BASHPID:-$$}"

  while true; do
    if mkdir "$AOS_PROCESS_CLEANUP_LOCK_DIR" 2>/dev/null; then
      {
        printf 'pid=%s\n' "$current_pid"
        printf 'label=%s\n' "$label"
        printf 'cwd=%s\n' "$PWD"
        printf 'started_at=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
      } > "$AOS_PROCESS_CLEANUP_LOCK_DIR/owner"
      AOS_PROCESS_CLEANUP_LOCK_HELD=1
      AOS_PROCESS_CLEANUP_LOCK_OWNER_PID="$current_pid"
      return 0
    fi

    owner_pid="$(_aos_process_cleanup_owner_pid)"
    if [[ -n "$owner_pid" ]] && ! _aos_process_cleanup_pid_alive "$owner_pid"; then
      rm -rf "$AOS_PROCESS_CLEANUP_LOCK_DIR"
      continue
    fi

    now="$(date +%s)"
    if (( now - start >= AOS_PROCESS_CLEANUP_LOCK_TIMEOUT_SECONDS )); then
      echo "FAIL: timed out waiting for process-cleanup serial lock at $AOS_PROCESS_CLEANUP_LOCK_DIR" >&2
      echo "Held by: $(_aos_process_cleanup_owner_summary)" >&2
      return 1
    fi

    sleep "$AOS_PROCESS_CLEANUP_LOCK_POLL_SECONDS"
  done
}

fi
