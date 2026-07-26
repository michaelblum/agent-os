#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE="$ROOT/tests/manual/desktop-world-native-visual-proof.swift"
MODE="${1:-}"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-native-visual-proof.XXXXXX")"

cleanup() {
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
    swiftc "${COMMON_ARGS[@]}" "$SOURCE" -o "$BINARY"
    "$BINARY"
    ;;
  *)
    print -u2 "usage: AOS_NATIVE_VISUAL_PROOF_OK=1 $0 --run"
    print -u2 "       $0 --typecheck"
    exit 2
    ;;
esac
