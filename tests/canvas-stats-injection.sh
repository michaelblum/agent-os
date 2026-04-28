#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-canvas-stats-injection"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

aos_test_start_daemon "$ROOT" toolkit packages/toolkit \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

./aos show create \
  --id canvas-stats-smoke \
  --at 40,40,240,120 \
  --html '<!doctype html><html><body style="margin:0;background:transparent"></body></html>' >/dev/null

python3 - <<'PY'
import json
import subprocess
import time

def eval_js(js):
    return json.loads(subprocess.check_output([
        "./aos", "show", "eval",
        "--id", "canvas-stats-smoke",
        "--js", js,
    ], text=True))

for _ in range(50):
    payload = eval_js('JSON.stringify({ hasStats: typeof window.aosStats === "object", status: window.aosStats?.status?.() })')
    result = json.loads(payload.get("result") or "{}")
    status = result.get("status") or {}
    if result.get("hasStats") and status.get("canvasId") == "canvas-stats-smoke":
        break
    time.sleep(0.1)
else:
    raise SystemExit("FAIL: window.aosStats was not injected")

eval_js('window.aosStats.enable({ panel: 1, position: "top-right" }); "queued"')

for _ in range(50):
    payload = eval_js('JSON.stringify({ status: window.aosStats.status(), dom: !!document.querySelector("[data-aos-stats=true]"), id: document.querySelector("[data-aos-stats=true]")?.dataset?.aosStatsCanvasId || null })')
    result = json.loads(payload.get("result") or "{}")
    status = result.get("status") or {}
    sample = status.get("sample") or {}
    if (
        status.get("available")
        and status.get("enabled")
        and result.get("dom")
        and result.get("id") == "canvas-stats-smoke"
        and isinstance(sample.get("frameMs"), (int, float))
        and isinstance(sample.get("fps"), (int, float))
    ):
        break
    time.sleep(0.1)
else:
    raise SystemExit("FAIL: stats.js overlay did not enable")

eval_js('window.aosStats.disable(); "disabled"')
payload = eval_js('JSON.stringify({ status: window.aosStats.status(), dom: !!document.querySelector("[data-aos-stats=true]") })')
result = json.loads(payload.get("result") or "{}")
if result.get("dom") or result.get("status", {}).get("enabled"):
    raise SystemExit("FAIL: stats.js overlay did not disable")

print("PASS")
PY
