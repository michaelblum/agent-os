#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE="$ROOT/tests/manual/desktop-world-native-visual-proof.swift"
MODE="${1:-}"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-native-visual-proof.XXXXXX")"
BINARY_PID=""
WATCHDOG_PID=""

stop_owned_pid() {
  local pid="$1"
  if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi

  kill -TERM "$pid" 2>/dev/null || true
  local attempt=0
  while kill -0 "$pid" 2>/dev/null && (( attempt < 5 )); do
    sleep 0.05
    (( attempt += 1 ))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
  wait "$pid" 2>/dev/null || true
}

cleanup() {
  trap - EXIT INT TERM
  stop_owned_pid "$WATCHDOG_PID"
  stop_owned_pid "$BINARY_PID"
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

run_with_deadline() {
  local timeout_hundredths="$1"
  shift
  local timeout_marker="$TMP_ROOT/proof-timed-out"
  rm -f "$timeout_marker"

  "$@" &
  BINARY_PID="$!"
  (
    zmodload zsh/zselect
    zselect -t "$timeout_hundredths" || true
    if kill -0 "$BINARY_PID" 2>/dev/null; then
      print -r -- "timed_out" > "$timeout_marker"
      stop_owned_pid "$BINARY_PID"
    fi
  ) &
  WATCHDOG_PID="$!"

  set +e
  wait "$BINARY_PID"
  local child_status="$?"
  set -e
  BINARY_PID=""
  stop_owned_pid "$WATCHDOG_PID"
  WATCHDOG_PID=""

  if [[ -f "$timeout_marker" ]]; then
    print -r -- '{"cleanup_complete":true,"error_code":"PROOF_TIMEOUT","pixels_persisted":false,"process_exited":true,"status":"failed"}'
    return 124
  fi
  return "$child_status"
}

COMMON_ARGS=(
  -parse-as-library
  -module-cache-path "$TMP_ROOT/module-cache"
  -framework AppKit
  -framework MetalKit
  -framework ScreenCaptureKit
)

case "$MODE" in
  --typecheck)
    swiftc -typecheck "${COMMON_ARGS[@]}" "$SOURCE"
    ;;
  --run)
    if [[ "${AOS_NATIVE_VISUAL_PROOF_OK:-0}" != "1" ]]; then
      print -u2 "refusing live screen capture without AOS_NATIVE_VISUAL_PROOF_OK=1"
      exit 2
    fi
    BINARY="$TMP_ROOT/desktop-world-native-visual-proof"
    swiftc "${COMMON_ARGS[@]}" "$SOURCE" -o "$BINARY"
    set +e
    run_with_deadline 500 "$BINARY"
    STATUS="$?"
    set -e
    exit "$STATUS"
    ;;
  --timeout-self-test)
    set +e
    run_with_deadline 5 /bin/sleep 10
    STATUS="$?"
    set -e
    exit "$STATUS"
    ;;
  --cleanup-self-test)
    /bin/zsh -c 'trap "" TERM; exec /bin/sleep 10' &
    BINARY_PID="$!"
    OWNED_PID="$BINARY_PID"
    stop_owned_pid "$BINARY_PID"
    BINARY_PID=""
    if kill -0 "$OWNED_PID" 2>/dev/null; then
      print -r -- '{"owned_child_reaped":false,"status":"failed"}'
      exit 1
    fi
    print -r -- '{"owned_child_reaped":true,"status":"passed"}'
    ;;
  *)
    print -u2 "usage: AOS_NATIVE_VISUAL_PROOF_OK=1 $0 --run"
    print -u2 "       $0 --typecheck"
    exit 2
    ;;
esac
