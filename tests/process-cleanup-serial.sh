#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/aos-process-cleanup-serial.XXXXXX")"
LOCK_DIR="$TMP/process-cleanup.lock"
HOLDER_READY="$TMP/holder.ready"
HOLDER_RELEASE="$TMP/holder.release"
WAITER_ACQUIRED="$TMP/waiter.acquired"
HOLDER_PID=""
WAITER_PID=""

cleanup() {
  local status="$?"
  touch "$HOLDER_RELEASE" 2>/dev/null || true
  for pid in "$HOLDER_PID" "$WAITER_PID"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$TMP"
  exit "$status"
}
trap cleanup EXIT

/bin/bash -c '
  set -euo pipefail
  export AOS_PROCESS_CLEANUP_LOCK_DIR="$1"
  source "$2/tests/lib/process-cleanup-serial.sh"
  aos_process_cleanup_acquire_serial_lock holder
  trap aos_process_cleanup_release_serial_lock EXIT
  touch "$3"
  while [[ ! -f "$4" ]]; do sleep 0.05; done
' bash "$LOCK_DIR" "$ROOT" "$HOLDER_READY" "$HOLDER_RELEASE" &
HOLDER_PID="$!"

for _ in $(seq 1 100); do
  [[ -f "$HOLDER_READY" ]] && break
  sleep 0.05
done
[[ -f "$HOLDER_READY" ]] || { echo "FAIL: holder did not acquire process-cleanup lock" >&2; exit 1; }

/bin/bash -c '
  set -euo pipefail
  export AOS_PROCESS_CLEANUP_LOCK_DIR="$1"
  source "$2/tests/lib/process-cleanup-serial.sh"
  aos_process_cleanup_acquire_serial_lock waiter
  trap aos_process_cleanup_release_serial_lock EXIT
  touch "$3"
' bash "$LOCK_DIR" "$ROOT" "$WAITER_ACQUIRED" &
WAITER_PID="$!"

sleep 0.25
[[ ! -f "$WAITER_ACQUIRED" ]] || { echo "FAIL: waiter bypassed active process-cleanup lock" >&2; exit 1; }

touch "$HOLDER_RELEASE"
wait "$HOLDER_PID"
HOLDER_PID=""
wait "$WAITER_PID"
WAITER_PID=""
[[ -f "$WAITER_ACQUIRED" ]] || { echo "FAIL: waiter did not acquire released process-cleanup lock" >&2; exit 1; }

mkdir "$LOCK_DIR"
printf 'pid=99999999\nlabel=stale-test\n' > "$LOCK_DIR/owner"
export AOS_PROCESS_CLEANUP_LOCK_DIR="$LOCK_DIR"
source "$ROOT/tests/lib/process-cleanup-serial.sh"
aos_process_cleanup_acquire_serial_lock stale-reclaimer
aos_process_cleanup_release_serial_lock
[[ ! -d "$LOCK_DIR" ]] || { echo "FAIL: stale process-cleanup lock was not reclaimed" >&2; exit 1; }

echo "PASS: process-cleanup proofs wait, release, and reclaim stale locks."
