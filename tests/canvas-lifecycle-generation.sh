#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aos-canvas-lifecycle-generation.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

swiftc \
  src/display/canvas-generation.swift \
  src/display/canvas-lifecycle.swift \
  tests/lib/canvas-lifecycle-generation.swift \
  -o "$TMP_DIR/canvas-lifecycle-generation"

"$TMP_DIR/canvas-lifecycle-generation"
