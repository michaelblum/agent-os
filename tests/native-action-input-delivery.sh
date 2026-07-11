#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aos-native-action-input-delivery.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

swiftc \
  "$ROOT/src/act/input-delivery-state.swift" \
  "$ROOT/tests/lib/native-action-input-delivery.swift" \
  -o "$TMP_DIR/native-action-input-delivery"

"$TMP_DIR/native-action-input-delivery"
