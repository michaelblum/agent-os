#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
REPO_ROOT="$(cd ../.. && pwd)"
BUILD_DIR="$PWD/build"
OUTPUT_PATH="${SIGIL_OUTPUT_PATH:-$BUILD_DIR/avatar-sub}"

mkdir -p "$(dirname "$OUTPUT_PATH")"
echo "Compiling avatar-sub..."
swiftc -parse-as-library -O -o "$OUTPUT_PATH" \
    avatar-easing.swift \
    avatar-ipc.swift \
    avatar-animate.swift \
    avatar-spatial.swift \
    avatar-behaviors.swift \
    avatar-sub.swift \
    "$REPO_ROOT"/shared/swift/ipc/*.swift
echo "Done: $OUTPUT_PATH ($(du -h "$OUTPUT_PATH" | cut -f1 | xargs))"
