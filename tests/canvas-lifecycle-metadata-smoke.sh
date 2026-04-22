#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-canvas-lifecycle-metadata"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

./aos permissions setup --once >/dev/null
aos_test_start_daemon "$ROOT" toolkit packages/toolkit \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

bash packages/toolkit/components/canvas-inspector/launch.sh >/dev/null
bash packages/toolkit/components/spatial-telemetry/launch.sh >/dev/null

./aos show create --id parent-canvas --track union --scope global --html '<!doctype html><html><body style="margin:0;background:transparent"></body></html>' >/dev/null
sleep 1
./aos show eval --id parent-canvas --js 'window.webkit.messageHandlers.headsup.postMessage({type:"canvas.create",payload:{id:"child-canvas",frame:[120,140,80,80],url:"aos://toolkit/runtime/_smoke/index.html"}})' >/dev/null

python3 - <<'PY'
import json
import subprocess
import time

deadline = time.time() + 10
while time.time() < deadline:
    canvases = json.loads(subprocess.check_output(["./aos", "show", "list", "--json"], text=True)).get("canvases", [])
    ids = {canvas["id"] for canvas in canvases}
    if {"parent-canvas", "child-canvas"}.issubset(ids):
        break
    time.sleep(0.2)
else:
    raise SystemExit("FAIL: expected parent-canvas and child-canvas in show list")

def eval_json(canvas_id, expr):
    payload = json.loads(subprocess.check_output([
        "./aos", "show", "eval", "--id", canvas_id, "--js", expr
    ], text=True))
    return json.loads(payload["result"])

for _ in range(50):
    inspector_canvases = eval_json("canvas-inspector", "JSON.stringify(window.__canvasInspectorState?.canvases || [])")
    telemetry_canvases = eval_json("spatial-telemetry", "JSON.stringify(window.__spatialTelemetryState?.raw?.canvases || [])")

    states = {
        "canvas-inspector": {canvas["id"]: canvas for canvas in inspector_canvases},
        "spatial-telemetry": {canvas["id"]: canvas for canvas in telemetry_canvases},
    }
    ready = True
    for by_id in states.values():
        parent = by_id.get("parent-canvas")
        child = by_id.get("child-canvas")
        if not parent or not child:
            ready = False
            break
        if parent.get("track") != "union" or child.get("parent") != "parent-canvas" or child.get("scope") != "global":
            ready = False
            break
    if ready:
        break
    time.sleep(0.2)
else:
    raise SystemExit(
        "FAIL: subscribed surfaces did not converge on parent/track metadata\n"
        f"inspector={inspector_canvases}\ntelemetry={telemetry_canvases}"
    )
PY

echo "PASS"
