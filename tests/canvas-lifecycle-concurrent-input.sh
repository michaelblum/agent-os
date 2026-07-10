#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT_DIR"

if [[ "${AOS_REAL_INPUT_OK:-}" != "1" ]]; then
  echo "SKIP: set AOS_REAL_INPUT_OK=1 to run concurrent mouse/key lifecycle proof; user input may continue during the test."
  exit 77
fi

source tests/lib/isolated-daemon.sh

PREFIX="aos-canvas-lifecycle-concurrent-input"
aos_test_cleanup_prefix "$PREFIX"
STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$STATE_ROOT"
export AOS_DISABLE_DAEMON_AUTOSTART=1

OBSERVER_PID=""
cleanup() {
  if [[ -n "$OBSERVER_PID" ]]; then
    kill "$OBSERVER_PID" 2>/dev/null || true
    wait "$OBSERVER_PID" 2>/dev/null || true
  fi
  aos_test_kill_root "$STATE_ROOT"
  rm -rf "$STATE_ROOT"
}
trap cleanup EXIT

aos_test_start_daemon "$STATE_ROOT" \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

TARGETED_KEY_HELPER="$STATE_ROOT/post-key-to-pid"
swiftc tests/lib/post-key-to-pid.swift -o "$TARGETED_KEY_HELPER"

SOCKET_PATH="$(aos_test_socket_path "$STATE_ROOT")"
OBSERVER_LOG="$STATE_ROOT/input-events.ndjson"
OBSERVER_READY="$STATE_ROOT/input-observer.ready"
node tests/lib/input-event-observer.mjs \
  --socket "$SOCKET_PATH" \
  --ready-file "$OBSERVER_READY" \
  >"$OBSERVER_LOG" 2>"$STATE_ROOT/input-observer.stderr" &
OBSERVER_PID=$!

for _ in $(seq 1 50); do
  [[ -f "$OBSERVER_READY" ]] && break
  kill -0 "$OBSERVER_PID" 2>/dev/null || {
    cat "$OBSERVER_LOG" "$STATE_ROOT/input-observer.stderr" >&2 || true
    echo "FAIL: canonical input observer exited before readiness" >&2
    exit 1
  }
  sleep 0.1
done
[[ -f "$OBSERVER_READY" ]] || { echo "FAIL: canonical input observer did not become ready" >&2; exit 1; }

DAEMON_PID="$(aos_test_lock_pid "$STATE_ROOT")"
CYCLES="${AOS_CANVAS_LIFECYCLE_CYCLES:-25}"
if ! python3 tests/lib/canvas_lifecycle_stress.py \
  --state-root "$STATE_ROOT" \
  --daemon-pid "$DAEMON_PID" \
  --cycles "$CYCLES" \
  --concurrent-input \
  --targeted-key-helper "$TARGETED_KEY_HELPER" \
  --observer-log "$OBSERVER_LOG"
then
  tail -120 "$STATE_ROOT/daemon.stderr" >&2 || true
  exit 1
fi

kill "$OBSERVER_PID" 2>/dev/null || true
wait "$OBSERVER_PID"
OBSERVER_PID=""

python3 - "$OBSERVER_LOG" <<'PY'
import json
import pathlib
import sys

records = [json.loads(line) for line in pathlib.Path(sys.argv[1]).read_text().splitlines() if line]
errors = [record for record in records if record.get("observer") == "error"]
assert not errors, errors
assert any(record.get("observer") == "ready" for record in records), records
events = [record["event"] for record in records if record.get("observer") == "input_event"]
assert events, records
assert all(event.get("input_schema_version") == 2 for event in events), events
assert any(event.get("event_kind") == "pointer" for event in events), events
print(json.dumps({
    "canonical_input_events": len(events),
    "pointer_events": sum(event.get("event_kind") == "pointer" for event in events),
    "key_events": sum(event.get("event_kind") == "key" for event in events),
}, sort_keys=True))
PY

echo "PASS: canvas lifecycle remains coherent during concurrent user input"
