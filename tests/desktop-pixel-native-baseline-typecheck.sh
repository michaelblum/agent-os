#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/aos-native-sheet-geometry.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

"$ROOT/tests/swift-runtime-typecheck.sh"

/usr/bin/xcrun swiftc -parse-as-library \
  "$ROOT/src/shared/desktop-world-display-geometry.swift" \
  "$ROOT/tests/lib/desktop-world-display-geometry-tests.swift" \
  -framework CoreGraphics \
  -framework Foundation \
  -o "$TMP/desktop-world-display-geometry-tests"
"$TMP/desktop-world-display-geometry-tests"

/usr/bin/xcrun swiftc -parse-as-library \
  "$ROOT/src/display/desktop-world-native-sheet-geometry.swift" \
  "$ROOT/tests/lib/desktop-world-native-sheet-geometry-tests.swift" \
  -framework CoreGraphics \
  -framework Foundation \
  -framework Metal \
  -o "$TMP/native-sheet-geometry-tests"
"$TMP/native-sheet-geometry-tests"

/usr/bin/xcrun swiftc -parse-as-library \
  "$ROOT/src/display/desktop-world-native-sheet-lease.swift" \
  "$ROOT/tests/lib/desktop-world-native-sheet-lease-tests.swift" \
  -framework Foundation \
  -o "$TMP/native-sheet-lease-tests"
"$TMP/native-sheet-lease-tests"

/usr/bin/xcrun swiftc -parse-as-library \
  "$ROOT/src/display/desktop-world-native-projection-lifecycle.swift" \
  "$ROOT/tests/lib/desktop-world-native-projection-lifecycle-tests.swift" \
  -framework Foundation \
  -o "$TMP/native-projection-lifecycle-tests"
"$TMP/native-projection-lifecycle-tests"

/usr/bin/xcrun swiftc -parse-as-library \
  "$ROOT/src/shared/desktop-pixel-sample-admission.swift" \
  "$ROOT/src/daemon/desktop-pixel-retirement.swift" \
  "$ROOT/src/daemon/desktop-pixel-native-operation.swift" \
  "$ROOT/src/daemon/desktop-pixel-stream-lifecycle.swift" \
  "$ROOT/src/daemon/desktop-pixel-capture-filter.swift" \
  "$ROOT/src/commands/desktop-pixel-native-baseline-capture.swift" \
  "$ROOT/tests/lib/desktop-pixel-native-baseline-lifecycle-tests.swift" \
  -framework CoreGraphics \
  -framework CoreMedia \
  -framework CoreVideo \
  -framework Foundation \
  -framework ScreenCaptureKit \
  -o "$TMP/desktop-pixel-native-baseline-lifecycle-tests"
"$TMP/desktop-pixel-native-baseline-lifecycle-tests"

/usr/bin/xcrun swiftc -parse-as-library \
  "$ROOT/tests/lib/desktop-pixel-metal-pipeline-tests.swift" \
  -framework Foundation \
  -framework Metal \
  -o "$TMP/desktop-pixel-metal-pipeline-tests"
"$TMP/desktop-pixel-metal-pipeline-tests" \
  "$ROOT/src/commands/desktop-pixel-native-baseline-metal.swift"

echo "PASS desktop pixel native baseline integration typecheck"
