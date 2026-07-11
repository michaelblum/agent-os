#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

source tests/lib/isolated-daemon.sh

PREFIX="aos-canvas-lifecycle-stress"
aos_test_cleanup_prefix "$PREFIX"
STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$STATE_ROOT"
export AOS_DISABLE_DAEMON_AUTOSTART=1

cleanup() {
  aos_test_kill_root "$STATE_ROOT"
  rm -rf "$STATE_ROOT"
}
trap cleanup EXIT

aos_test_start_daemon "$STATE_ROOT" \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

DAEMON_PID="$(aos_test_lock_pid "$STATE_ROOT")"
CYCLES="${AOS_CANVAS_LIFECYCLE_CYCLES:-25}"
if ! python3 tests/lib/canvas_lifecycle_stress.py \
  --state-root "$STATE_ROOT" \
  --daemon-pid "$DAEMON_PID" \
  --cycles "$CYCLES"
then
  tail -120 "$STATE_ROOT/daemon.stderr" >&2 || true
  exit 1
fi

echo "PASS: canvas lifecycle stress"
