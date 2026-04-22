#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-spatial-telemetry"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

if ! python3 - <<'PY'
import json
import subprocess

perms = json.loads(subprocess.check_output(["./aos", "permissions", "check", "--json"], text=True)).get("permissions", {})
raise SystemExit(0 if perms.get("accessibility") else 1)
PY
then
  echo "SKIP: requires accessibility"
  exit 0
fi

./aos permissions setup --once >/dev/null
aos_test_start_daemon "$ROOT" toolkit packages/toolkit \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

./aos show create --id demo-canvas --at 40,60,180,120 --html '<div>demo</div>' >/dev/null
bash packages/toolkit/components/spatial-telemetry/launch.sh >/dev/null

python3 - <<'PY'
import json
import subprocess

payload = json.loads(subprocess.check_output([
    "./aos", "show", "eval", "--id", "spatial-telemetry", "--js",
    "JSON.stringify(window.__spatialTelemetryState?.snapshot || null)"
], text=True))
snapshot = json.loads(payload["result"])

canvas_ids = [row["id"] for row in snapshot["canvasRows"]]
if "spatial-telemetry" not in canvas_ids or "demo-canvas" not in canvas_ids:
    raise SystemExit("FAIL: subscribe snapshots are missing expected canvases")

if not snapshot["displayRows"]:
    raise SystemExit("FAIL: subscribe snapshots are missing displays")
PY

./aos show post --id spatial-telemetry --event '{"type":"input_event","payload":{"type":"mouse_move","x":140,"y":170}}' >/dev/null
./aos show post --id spatial-telemetry --event '{"type":"canvas_object.marks","payload":{"canvas_id":"demo-canvas","objects":[{"id":"demo-mark","x":90,"y":110,"name":"Demo Mark","rect":true,"ellipse":false,"cross":true}]}}' >/dev/null

python3 - <<'PY'
import json
import subprocess

payload = json.loads(subprocess.check_output([
    "./aos", "show", "eval", "--id", "spatial-telemetry", "--js",
    "JSON.stringify(window.__spatialTelemetryState || null)"
], text=True))
state = json.loads(payload["result"])
snapshot = state["snapshot"]

cursor = snapshot["cursorRow"]
per_display_points = list((cursor or {}).get("perDisplay", {}).values())
if cursor is None or not any(round(point["x"]) == 140 and round(point["y"]) == 170 for point in per_display_points):
    raise SystemExit(f"FAIL: cursor row did not update from input_event: {cursor}")

marks = snapshot["markRows"]
if not any(row["id"] == "demo-mark" and row["canvasId"] == "demo-canvas" for row in marks):
    raise SystemExit(f"FAIL: mark row missing from telemetry snapshot: {marks}")

if len(state["events"]) < 3:
    raise SystemExit(f"FAIL: expected event log entries, got {len(state['events'])}")
PY

echo "PASS"
