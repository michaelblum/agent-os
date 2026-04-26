#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-dws-update-guard"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

./aos permissions setup --once >/dev/null
aos_test_start_daemon "$ROOT" >/dev/null \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

./aos show create --id normal --at 0,0,40,40 --html '<body></body>' >/dev/null

if ./aos show update --id normal --track union >"$ROOT/update-normal.out" 2>&1; then
  echo "FAIL: normal canvas converted to desktop-world surface through update"
  cat "$ROOT/update-normal.out"
  exit 1
fi
grep -q "cannot convert an existing canvas to a desktop-world surface" "$ROOT/update-normal.out" \
  || { echo "FAIL: expected conversion error"; cat "$ROOT/update-normal.out"; exit 1; }

./aos show create --id surface --surface desktop-world --html '<body></body>' >/dev/null

if ./aos show update --id surface --at 0,0,10,10 >"$ROOT/update-surface.out" 2>&1; then
  echo "FAIL: desktop-world surface accepted placement update"
  cat "$ROOT/update-surface.out"
  exit 1
fi
grep -q "desktop-world surface placement is topology-owned" "$ROOT/update-surface.out" \
  || { echo "FAIL: expected topology-owned placement error"; cat "$ROOT/update-surface.out"; exit 1; }

./aos show remove-all >/dev/null
echo "PASS"

