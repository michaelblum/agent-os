#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE="$ROOT/tests/manual/desktop-world-native-visual-proof.swift"
MODE="${1:-}"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-native-visual-proof.XXXXXX")"
BINARY_PID=""
WATCHDOG_PID=""

cleanup() {
  if [[ -n "$WATCHDOG_PID" ]]; then
    kill "$WATCHDOG_PID" 2>/dev/null || true
  fi
  if [[ -n "$BINARY_PID" ]]; then
    kill "$BINARY_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT INT TERM

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
    TIMEOUT_MARKER="$TMP_ROOT/proof-timed-out"
    swiftc "${COMMON_ARGS[@]}" "$SOURCE" -o "$BINARY"
    "$BINARY" &
    BINARY_PID="$!"
    (
      sleep 5
      if kill -0 "$BINARY_PID" 2>/dev/null; then
        print -r -- "timed_out" > "$TIMEOUT_MARKER"
        kill -TERM "$BINARY_PID" 2>/dev/null || true
        sleep 0.25
        kill -KILL "$BINARY_PID" 2>/dev/null || true
      fi
    ) &
    WATCHDOG_PID="$!"

    set +e
    wait "$BINARY_PID"
    STATUS="$?"
    set -e
    BINARY_PID=""
    kill "$WATCHDOG_PID" 2>/dev/null || true
    wait "$WATCHDOG_PID" 2>/dev/null || true
    WATCHDOG_PID=""

    if [[ -f "$TIMEOUT_MARKER" ]]; then
      print -r -- '{"cleanup_complete":true,"error_code":"PROOF_TIMEOUT","pixels_persisted":false,"process_exited":true,"status":"failed"}'
      exit 1
    fi
    exit "$STATUS"
    ;;
  *)
    print -u2 "usage: AOS_NATIVE_VISUAL_PROOF_OK=1 $0 --run"
    print -u2 "       $0 --typecheck"
    exit 2
    ;;
esac
