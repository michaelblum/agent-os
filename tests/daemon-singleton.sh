#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-singleton"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"
PID1=""
PID2=""

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

./aos serve --idle-timeout none >"$ROOT/daemon-1.stdout" 2>"$ROOT/daemon-1.stderr" &
aos_test_wait_for_socket "$ROOT" || { echo "FAIL: first daemon socket did not become reachable"; exit 1; }
PID1="$(aos_test_wait_for_lock_pid "$ROOT")" || { echo "FAIL: first daemon lock pid did not appear"; exit 1; }

set +e
SECOND_OUT="$(./aos serve --idle-timeout 5m 2>&1)"
SECOND_STATUS=$?
set -e

if [[ $SECOND_STATUS -eq 0 ]]; then
  echo "FAIL: second daemon unexpectedly started"
  exit 1
fi
echo "$SECOND_OUT" | grep -q 'DAEMON_ALREADY_RUNNING' || {
  echo "FAIL: expected DAEMON_ALREADY_RUNNING, got:"
  echo "$SECOND_OUT"
  exit 1
}
grep -q "\"pid\":$PID1" "$ROOT/repo/daemon.lock" || {
  echo "FAIL: daemon lock did not record the first daemon pid"
  exit 1
}

aos_test_terminate_pid "$PID1"
PID1=""

./aos serve --idle-timeout none >"$ROOT/daemon-2.stdout" 2>"$ROOT/daemon-2.stderr" &
aos_test_wait_for_socket "$ROOT" || { echo "FAIL: replacement daemon socket did not become reachable"; exit 1; }
PID2="$(aos_test_wait_for_lock_pid "$ROOT")" || { echo "FAIL: replacement daemon lock pid did not appear"; exit 1; }
grep -q "\"pid\":$PID2" "$ROOT/repo/daemon.lock" || {
  echo "FAIL: daemon lock did not move to the replacement daemon pid"
  exit 1
}

echo "PASS"
