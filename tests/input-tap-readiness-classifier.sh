#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

PREFIX="aos-readiness-classifier"
STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$STATE_ROOT"
SOCK="$STATE_ROOT/repo/sock"
mkdir -p "$(dirname "$SOCK")"

cleanup() {
  if [[ -n "${MOCK_PID:-}" ]] && kill -0 "$MOCK_PID" 2>/dev/null; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
  fi
  rm -rf "$STATE_ROOT"
}
trap cleanup EXIT

start_mock() {
  local status="$1"
  python3 tests/lib/mock-daemon.py \
      --socket "$SOCK" \
      --tap-status "$status" \
      --listen-access true \
      --post-access true \
      --accessibility true \
      >"$STATE_ROOT/mock.stdout" 2>"$STATE_ROOT/mock.stderr" &
  MOCK_PID=$!
  for _ in $(seq 1 20); do
    if [[ -S "$SOCK" ]]; then return 0; fi
    sleep 0.1
  done
  echo "FAIL: mock did not bind"; exit 1
}

stop_mock() {
  if kill -0 "$MOCK_PID" 2>/dev/null; then
    kill "$MOCK_PID" 2>/dev/null || true
    wait "$MOCK_PID" 2>/dev/null || true
  fi
  rm -f "$SOCK"
}

# Case 1: active tap -> outcome ok, exit 0.
# The merged response intentionally preserves launchd-state degradations even
# when the readiness probe is .ok (see service.swift readinessResponse merge:
# .ok must not upgrade a base launchd-degraded status). On a developer machine
# with a real ~/Library/LaunchAgents plist whose paths don't match
# $AOS_STATE_ROOT, the top-level `status` may be "degraded". The probe-level
# discriminator for the .ok outcome is: exit 0 + reason is None +
# input_tap.status == "active".
start_mock active
set +e
OUT="$(./aos service _verify-readiness --json --budget-ms 1000)"
RC=$?
set -e
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("input_tap", {}).get("status") == "active", d
assert "reason" not in d or d.get("reason") is None, d
'
[ "$RC" -eq 0 ] || { echo "FAIL: active case exit=$RC"; exit 1; }
echo "PASS: classifier active -> ok"
stop_mock

# Case 2: retrying tap -> outcome inputTapInactive, exit 1.
start_mock retrying
set +e
OUT="$(./aos service _verify-readiness --json --budget-ms 1000)"
RC=$?
set -e
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") == "degraded", d
assert d.get("reason") == "input_tap_not_active", d
assert d.get("input_tap", {}).get("status") == "retrying", d
'
[ "$RC" -eq 1 ] || { echo "FAIL: retrying case exit=$RC"; exit 1; }
echo "PASS: classifier retrying -> input_tap_not_active"
stop_mock

# Case 3: no mock listening -> outcome socketUnreachable, exit 1.
# (Mock not started; rely on the empty $SOCK.)
rm -f "$SOCK"
set +e
OUT="$(./aos service _verify-readiness --json --budget-ms 500)"
RC=$?
set -e
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") == "degraded", d
assert d.get("reason") == "socket_unreachable", d
assert d.get("input_tap") is None, d
'
[ "$RC" -eq 1 ] || { echo "FAIL: unreachable case exit=$RC"; exit 1; }
echo "PASS: classifier unreachable -> socket_unreachable"

echo "PASS"
