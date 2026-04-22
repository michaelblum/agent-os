#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-daemon-health-contract"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"
PID=""

cleanup() {
  if [[ -n "$PID" ]]; then
    aos_test_terminate_pid "$PID"
  fi
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

./aos permissions setup --once >/dev/null
./aos serve --idle-timeout none >"$ROOT/daemon.stdout" 2>"$ROOT/daemon.stderr" &
aos_test_wait_for_socket "$ROOT" || { echo "FAIL: isolated daemon did not start"; exit 1; }
PID="$(aos_test_wait_for_lock_pid "$ROOT")" || { echo "FAIL: daemon lock pid did not appear"; exit 1; }

python3 - "$PID" <<'PY'
import json
import subprocess
import sys
import time

expected_pid = int(sys.argv[1])
deadline = time.time() + 10
while time.time() < deadline:
    payload = json.loads(subprocess.check_output(["./aos", "doctor", "--json"], text=True))
    runtime = payload.get("runtime", {})
    if runtime.get("serving_pid") == expected_pid and runtime.get("ownership_state") == "consistent":
        raise SystemExit(0)
    time.sleep(0.2)
raise SystemExit(f"FAIL: daemon health never stabilized: {payload}")
PY

python3 - "$ROOT" <<'PY'
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
lock = root / "repo" / "daemon.lock"
payload = json.loads(lock.read_text())
payload["pid"] = 99999
lock.write_text(json.dumps(payload), encoding="utf-8")
PY

DOCTOR_JSON="$(./aos doctor --json)"
python3 - "$DOCTOR_JSON" "$PID" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
expected_pid = int(sys.argv[2])
runtime = payload.get("runtime", {})
notes = payload.get("notes", [])

if payload.get("status") != "degraded":
    raise SystemExit(f"FAIL: expected degraded doctor status after lock mismatch: {payload}")
if runtime.get("serving_pid") != expected_pid:
    raise SystemExit(f"FAIL: serving pid mismatch: {runtime}")
if runtime.get("lock_owner_pid") != 99999:
    raise SystemExit(f"FAIL: lock owner pid mismatch not surfaced: {runtime}")
if runtime.get("ownership_state") != "mismatch":
    raise SystemExit(f"FAIL: ownership mismatch not detected: {runtime}")
if not any("ownership mismatch" in note.lower() for note in notes):
    raise SystemExit(f"FAIL: doctor notes missing ownership mismatch: {notes}")
PY

echo "PASS"
