#!/usr/bin/env bash

if [[ -z "${AOS_PROCESS_CLEANUP_SERIAL_SH_LOADED:-}" ]]; then
AOS_PROCESS_CLEANUP_SERIAL_SH_LOADED=1

AOS_PROCESS_CLEANUP_LOCK_FILE="${AOS_PROCESS_CLEANUP_LOCK_FILE:-/tmp/aos-process-cleanup-tests-${UID:-${USER:-unknown}}.lock}"
AOS_PROCESS_CLEANUP_LOCK_TIMEOUT_SECONDS="${AOS_PROCESS_CLEANUP_LOCK_TIMEOUT_SECONDS:-120}"

aos_process_cleanup_reexec_serial() {
  local script="${1:?script path required}"
  shift

  if [[ "${AOS_PROCESS_CLEANUP_LOCK_HELD:-}" == "$AOS_PROCESS_CLEANUP_LOCK_FILE" ]]; then
    unset AOS_PROCESS_CLEANUP_LOCK_HELD
    return 0
  fi

  exec /usr/bin/lockf \
    -k \
    -t "$AOS_PROCESS_CLEANUP_LOCK_TIMEOUT_SECONDS" \
    "$AOS_PROCESS_CLEANUP_LOCK_FILE" \
    /usr/bin/env AOS_PROCESS_CLEANUP_LOCK_HELD="$AOS_PROCESS_CLEANUP_LOCK_FILE" \
    /bin/bash "$script" "$@"
}

fi
