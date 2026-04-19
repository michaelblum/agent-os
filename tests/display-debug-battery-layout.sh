#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-display-battery-layout"
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

bash tests/display-debug-battery.sh >/dev/null

python3 - <<'PY'
import json
import subprocess

displays = json.loads(subprocess.check_output(["./aos", "graph", "displays", "--json"], text=True))
canvases = json.loads(subprocess.check_output(["./aos", "show", "list", "--json"], text=True))

display_list = displays.get("data", {}).get("displays", displays.get("displays", []))
main = next((display for display in display_list if display.get("is_main")), display_list[0] if display_list else None)
if main is None:
    raise SystemExit("FAIL: missing main display")

visible = main.get("visible_bounds") or main.get("bounds") or {}
vx = int(visible.get("x", 0))
vy = int(visible.get("y", 0))
vw = int(visible.get("w", 1920))
vh = int(visible.get("h", 1080))

canvas_by_id = {canvas["id"]: canvas for canvas in canvases.get("canvases", [])}
for required in ("canvas-inspector", "spatial-telemetry"):
    if required not in canvas_by_id:
        raise SystemExit(f"FAIL: missing {required} canvas")

inspector = canvas_by_id["canvas-inspector"]["at"]
telemetry = canvas_by_id["spatial-telemetry"]["at"]

expected_inspector = [vx + vw - inspector[2], vy + vh - inspector[3], inspector[2], inspector[3]]
expected_telemetry = [vx, vy + vh - telemetry[3], telemetry[2], telemetry[3]]

if inspector != expected_inspector:
    raise SystemExit(f"FAIL: canvas-inspector not flush bottom-right of main visible bounds: got {inspector}, expected {expected_inspector}")
if telemetry != expected_telemetry:
    raise SystemExit(f"FAIL: spatial-telemetry not flush bottom-left of main visible bounds: got {telemetry}, expected {expected_telemetry}")
PY

echo "PASS"
