#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-ready-foreground-serve-owner"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"
export AOS_TEST_ASSUME_PERMISSIONS_GRANTED=1
export AOS_TEST_CLASSIFY_STATE_ROOT_AS_NORMAL=1

PID=""

cleanup() {
  if [[ -n "$PID" ]]; then
    aos_test_terminate_pid "$PID"
  fi
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

MARKER="$ROOT/repo/permissions-onboarding.json"
mkdir -p "$(dirname "$MARKER")"
python3 - "$MARKER" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
path.write_text(json.dumps({"completed_at": "2026-07-08T00:00:00Z"}), encoding="utf-8")
PY

./aos serve --idle-timeout 30m >"$ROOT/daemon.stdout" 2>"$ROOT/daemon.stderr" &
aos_test_wait_for_socket "$ROOT" || {
  echo "FAIL: foreground daemon did not bind socket"
  cat "$ROOT/daemon.stderr" 2>/dev/null || true
  exit 1
}
PID="$(aos_test_wait_for_lock_pid "$ROOT")" || {
  echo "FAIL: foreground daemon lock pid did not appear"
  cat "$ROOT/daemon.stderr" 2>/dev/null || true
  exit 1
}

RUNTIME_JSON="$(./aos __runtime status-facts --json)"
python3 - "$RUNTIME_JSON" "$PID" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
expected_pid = int(sys.argv[2])

tap = payload.get("input_tap", {})
assert payload.get("serving_pid") == expected_pid, payload
assert payload.get("lock_owner_pid") == expected_pid, payload
assert payload.get("ownership_state") == "consistent", payload
assert payload.get("ownership_kind") == "foreground_dev", payload
assert payload.get("owner_launchd_managed") is False, payload
assert tap.get("owner_pid") == expected_pid, tap
assert tap.get("owner_kind") == "foreground_dev", tap
assert tap.get("launchd_managed") is False, tap
PY

VERIFY_JSON="$(./aos service _verify-readiness --mode repo --json --budget-ms 1000)"
python3 - "$VERIFY_JSON" "$PID" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
expected_pid = int(sys.argv[2])

assert payload.get("reason") not in {"service_not_running", "daemon_ownership_mismatch"}, payload
assert payload.get("daemon_view", {}).get("pid") == expected_pid, payload
assert payload.get("input_tap", {}).get("status") == "active", payload
PY

CLEAN_DRY_RUN="$(./aos clean --dry-run --json)"
OWNER_PPID="$(ps -p "$PID" -o ppid= | tr -d '[:space:]')"
python3 - "$CLEAN_DRY_RUN" "$PID" "$OWNER_PPID" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
expected_pid = int(sys.argv[2])
parent_pid = int(sys.argv[3])

assert payload.get("status") == "dirty", payload
assert any(item.get("pid") == expected_pid for item in payload.get("foreground_dev_owners", [])), payload
assert any(item.get("pid") == expected_pid for item in payload.get("stale_daemons", [])), payload
assert not any(item.get("pid") == parent_pid for item in payload.get("stale_daemons", [])), payload
PY

set +e
READY_JSON="$(./aos ready --json)"
READY_STATUS=$?
set -e
if [[ $READY_STATUS -eq 0 ]]; then
  echo "FAIL: default-root foreground daemon unexpectedly passed readiness"
  echo "$READY_JSON"
  exit 1
fi
python3 - "$READY_JSON" "$PID" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
expected_pid = int(sys.argv[2])
blockers = payload.get("blockers", [])
cleanup = payload.get("runtime_verdict", {}).get("cleanup", {})

assert payload.get("ready") is False, payload
assert payload.get("phase") == "runtime_blocked", payload
assert payload.get("diagnosis") == "daemon_foreground_dev_default", payload
assert any(item.get("id") == "daemon_foreground_dev_default" for item in blockers), payload
assert any(item.get("pid") == expected_pid for item in cleanup.get("foreground_dev_owners", [])), payload
assert any(item.get("pid") == expected_pid for item in cleanup.get("stale_daemons", [])), payload
assert payload.get("action_trace", [{}])[0].get("result") == "cleanup_required", payload
PY

echo "PASS"
