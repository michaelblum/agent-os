#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/tests/process-cleanup-serial.sh"

if [[ "${1:-}" == "--worker" ]]; then
  source "$ROOT/tests/lib/process-cleanup-serial.sh"
  aos_process_cleanup_reexec_serial "$SCRIPT" "$@"
  shift

  guard_dir="${1:?guard directory required}"
  event_log="${2:?event log required}"
  hold_seconds="${3:?hold duration required}"
  ready_file="${4:--}"
  if ! mkdir "$guard_dir" 2>/dev/null; then
    printf 'overlap pid=%s\n' "$$" >> "$event_log"
    exit 91
  fi
  printf 'start pid=%s\n' "$$" >> "$event_log"
  [[ "$ready_file" == "-" ]] || touch "$ready_file"
  sleep "$hold_seconds"
  printf 'end pid=%s\n' "$$" >> "$event_log"
  rmdir "$guard_dir"
  exit 0
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/aos-process-cleanup-serial.XXXXXX")"
LOCK_FILE="$TMP/process-cleanup.lock"
GUARD_DIR="$TMP/critical-section"
EVENT_LOG="$TMP/events.log"
HOLDER_READY="$TMP/holder.ready"
PIDS=()

cleanup() {
  local status="$?"
  for pid in "${PIDS[@]:-}"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  rm -rf "$TMP"
  exit "$status"
}
trap cleanup EXIT

for _ in $(seq 1 30); do
  AOS_PROCESS_CLEANUP_LOCK_FILE="$LOCK_FILE" \
    "$SCRIPT" --worker "$GUARD_DIR" "$EVENT_LOG" 0.02 - &
  PIDS+=("$!")
done
for pid in "${PIDS[@]}"; do wait "$pid"; done
PIDS=()

[[ "$(grep -c '^start ' "$EVENT_LOG")" -eq 30 ]]
[[ "$(grep -c '^end ' "$EVENT_LOG")" -eq 30 ]]
if grep -q '^overlap ' "$EVENT_LOG"; then
  echo "FAIL: lockf permitted overlapping critical sections" >&2
  exit 1
fi

AOS_PROCESS_CLEANUP_LOCK_FILE="$LOCK_FILE" \
  "$SCRIPT" --worker "$GUARD_DIR" "$EVENT_LOG" 2 "$HOLDER_READY" &
HOLDER_PID="$!"
PIDS=("$HOLDER_PID")
for _ in $(seq 1 100); do
  [[ -f "$HOLDER_READY" ]] && break
  sleep 0.02
done
[[ -f "$HOLDER_READY" ]] || { echo "FAIL: timeout holder did not acquire lock" >&2; exit 1; }

set +e
AOS_PROCESS_CLEANUP_LOCK_FILE="$LOCK_FILE" \
  AOS_PROCESS_CLEANUP_LOCK_TIMEOUT_SECONDS=1 \
  "$SCRIPT" --worker "$GUARD_DIR" "$EVENT_LOG" 0 - \
  >"$TMP/timeout.out" 2>"$TMP/timeout.err"
TIMEOUT_RC=$?
set -e
[[ "$TIMEOUT_RC" -eq 75 ]] || {
  echo "FAIL: expected lockf timeout exit 75, got $TIMEOUT_RC" >&2
  cat "$TMP/timeout.err" >&2
  exit 1
}

wait "$HOLDER_PID"
PIDS=()
/usr/bin/lockf -k -t 0 "$LOCK_FILE" /usr/bin/true

echo "PASS: lockf serializes 30 contenders and enforces bounded waiting."
