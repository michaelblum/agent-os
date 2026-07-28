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

/usr/bin/xcrun swiftc -parse-as-library \
  "$ROOT/tests/lib/desktop-pixel-metal-pipeline-tests.swift" \
  -framework Foundation \
  -framework Metal \
  -o "$TMP/desktop-pixel-metal-pipeline-tests"
"$TMP/desktop-pixel-metal-pipeline-tests" \
  "$ROOT/src/commands/desktop-pixel-native-baseline-metal.swift"

echo "PASS desktop pixel native baseline integration typecheck"
