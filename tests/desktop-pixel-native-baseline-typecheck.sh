#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE_ROOT="$(mktemp -d)"
trap 'rm -rf "$CACHE_ROOT"' EXIT

cd "$ROOT"
CLANG_MODULE_CACHE_PATH="$CACHE_ROOT/clang" \
SWIFT_MODULECACHE_PATH="$CACHE_ROOT/swift" \
xcrun swiftc -parse-as-library -typecheck \
  src/commands/desktop-pixel-native-baseline.swift \
  src/commands/desktop-pixel-native-baseline-capture.swift \
  src/commands/desktop-pixel-native-baseline-metal.swift

echo "PASS desktop pixel native baseline typecheck"
