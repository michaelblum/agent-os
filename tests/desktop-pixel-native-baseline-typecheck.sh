#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/aos-native-sheet-geometry.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

"$ROOT/tests/swift-runtime-typecheck.sh"

/usr/bin/xcrun swiftc -parse-as-library \
  "$ROOT/src/display/desktop-world-native-sheet-geometry.swift" \
  "$ROOT/tests/lib/desktop-world-native-sheet-geometry-tests.swift" \
  -framework CoreGraphics \
  -framework Foundation \
  -framework Metal \
  -o "$TMP/native-sheet-geometry-tests"
"$TMP/native-sheet-geometry-tests"

echo "PASS desktop pixel native baseline integration typecheck"
