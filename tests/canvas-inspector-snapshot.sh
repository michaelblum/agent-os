#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-inspector-snapshot"
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

bash packages/toolkit/components/canvas-inspector/launch.sh >/dev/null

python3 - <<'PY'
import json, subprocess, time

for _ in range(50):
    payload = json.loads(subprocess.check_output([
        "./aos", "show", "eval", "--id", "canvas-inspector", "--js",
        'JSON.stringify({text: document.body.textContent.replace(/\\s+/g," ").trim(), selfDims: document.querySelector(".tree-row.canvas.self .canvas-dims")?.textContent ?? null, minimapDisplays: document.querySelectorAll(".minimap-display").length})'
    ], text=True))
    result = json.loads(payload.get("result") or "{}")
    text = result.get("text") or ""
    if "aos:// content server unavailable" in text:
        print("FAIL: inspector loaded fallback content-server-unavailable page", flush=True)
        raise SystemExit(1)
    if result.get("selfDims") and result.get("minimapDisplays", 0) > 0:
        print("PASS")
        raise SystemExit(0)
    time.sleep(0.1)

print("FAIL: inspector did not populate from subscription snapshots", flush=True)
raise SystemExit(1)
PY
