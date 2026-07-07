#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-serve-idle-timeout.XXXXXX")"
export AOS_STATE_ROOT="$TMP_ROOT"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

assert_invalid_duration() {
  local value="$1"
  local out
  local status

  set +e
  out="$(./aos serve --idle-timeout "$value" 2>&1)"
  status=$?
  set -e

  if [[ $status -eq 0 ]]; then
    echo "FAIL: --idle-timeout $value unexpectedly succeeded"
    exit 1
  fi
  if [[ "$out" != *'"code" : "INVALID_DURATION"'* ]] && [[ "$out" != *'"code": "INVALID_DURATION"'* ]]; then
    echo "FAIL: --idle-timeout $value did not report INVALID_DURATION"
    echo "$out"
    exit 1
  fi
}

assert_invalid_duration none
assert_invalid_duration inf
assert_invalid_duration nan
assert_invalid_duration 1e308h

echo "PASS"
