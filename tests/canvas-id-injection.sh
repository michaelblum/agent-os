#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-canvas-id-injection"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

aos_test_start_daemon "$ROOT" \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

./aos show create \
  --id canvas-id-smoke \
  --at 40,40,240,120 \
  --html '<!doctype html><html><body style="margin:0;background:transparent"></body></html>' >/dev/null

python3 - <<'PY'
import json
import subprocess
import time

for _ in range(50):
    payload = json.loads(subprocess.check_output([
        "./aos", "show", "eval",
        "--id", "canvas-id-smoke",
        "--js", "JSON.stringify(window.__aosCanvasId)",
    ], text=True))
    if payload.get("status") == "success" and json.loads(payload.get("result") or "null") == "canvas-id-smoke":
        print("PASS")
        raise SystemExit(0)
    time.sleep(0.1)

raise SystemExit("FAIL: window.__aosCanvasId was not injected")
PY
