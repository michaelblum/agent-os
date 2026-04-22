#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-request-client-autostart"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

./aos tell --who >/dev/null
aos_test_wait_for_socket "$ROOT" || { echo "FAIL: request client did not auto-start an isolated daemon"; exit 1; }
PID="$(aos_test_wait_for_lock_pid "$ROOT")" || { echo "FAIL: isolated daemon lock pid did not appear"; exit 1; }

ROOT_PIDS="$(aos_test_pids_for_root "$ROOT")"
printf '%s\n' "$ROOT_PIDS" | grep -q "^${PID}$" || {
  echo "FAIL: auto-started daemon pid was not associated with the explicit AOS_STATE_ROOT"
  echo "pids_for_root=$ROOT_PIDS expected=$PID"
  exit 1
}

DOCTOR_JSON="$(./aos doctor --json)"
python3 - "$DOCTOR_JSON" "$PID" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
expected_pid = int(sys.argv[2])
runtime = payload.get("runtime", {})

if runtime.get("serving_pid") != expected_pid:
    raise SystemExit(f"FAIL: doctor did not report the isolated serving pid: {runtime}")
if runtime.get("ownership_state") != "consistent":
    raise SystemExit(f"FAIL: isolated daemon should have consistent ownership: {runtime}")
if runtime.get("socket_reachable") is not True:
    raise SystemExit(f"FAIL: isolated daemon socket not reachable: {runtime}")
PY

echo "PASS"
