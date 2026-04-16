#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-cross-display"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"
DAEMON_PID=""
ARTIFACT_DIR="${AOS_TEST_ARTIFACT_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}-artifacts.XXXXXX")}"
mkdir -p "$ARTIFACT_DIR"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

if ! python3 - <<'PY'
import json, subprocess
perms = json.loads(subprocess.check_output(["./aos", "permissions", "check", "--json"], text=True)).get("permissions", {})
if not perms.get("accessibility") or not perms.get("screen_recording"):
    raise SystemExit(1)
raise SystemExit(0)
PY
then
  echo "SKIP: requires accessibility + screen recording"
  exit 0
fi

./aos permissions setup --once >/dev/null
./aos set content.roots.toolkit packages/toolkit >/dev/null

./aos serve --idle-timeout none >"$ROOT/daemon.stdout" 2>"$ROOT/daemon.stderr" &
aos_test_wait_for_socket "$ROOT" || { echo "FAIL: isolated daemon socket did not become reachable"; exit 1; }
DAEMON_PID="$(aos_test_wait_for_lock_pid "$ROOT")" || { echo "FAIL: isolated daemon lock pid did not appear"; exit 1; }

if ! python3 - <<'PY'
import json, subprocess
graph = json.loads(subprocess.check_output(["./aos", "graph", "displays", "--json"], text=True))
displays = graph.get("displays", [])
raise SystemExit(0 if len(displays) >= 2 else 1)
PY
then
  echo "SKIP: requires at least two displays"
  exit 0
fi

bash packages/toolkit/components/canvas-inspector/launch.sh >/dev/null

python3 - <<'PY'
import json, subprocess
payload = json.loads(subprocess.check_output([
    "./aos", "show", "eval", "--id", "canvas-inspector", "--js",
    'document.body.textContent.replace(/\\s+/g," ").trim()'
], text=True))
text = payload.get("result") or ""
if "aos:// content server unavailable" in text:
    print("FAIL: inspector loaded fallback content-server-unavailable page", flush=True)
    raise SystemExit(1)
PY

PRE_DRAG_CAPTURE_PNG="$ARTIFACT_DIR/pre-drag-inspector.png"
PRE_DRAG_CAPTURE_JSON="$ARTIFACT_DIR/pre-drag-inspector.json"

python3 - "$PRE_DRAG_CAPTURE_PNG" "$PRE_DRAG_CAPTURE_JSON" <<'PY'
import json, pathlib, subprocess, sys

png_path = pathlib.Path(sys.argv[1])
json_path = pathlib.Path(sys.argv[2])
capture = json.loads(subprocess.check_output([
    "./aos", "see", "capture",
    "--canvas", "canvas-inspector",
    "--perception",
    "--out", str(png_path),
], text=True))
json_path.write_text(json.dumps(capture, indent=2) + "\n")
print(f"Artifacts: {png_path.parent}", flush=True)
print(f"Pre-drag capture: {png_path}", flush=True)
print(f"Pre-drag perception: {json_path}", flush=True)
PY

PAUSE_BEFORE_DRAG_SECONDS="${AOS_TEST_PAUSE_BEFORE_DRAG_SECONDS:-10}"
if [[ "$PAUSE_BEFORE_DRAG_SECONDS" =~ ^[0-9]+$ ]] && (( PAUSE_BEFORE_DRAG_SECONDS > 0 )); then
  echo "Pausing ${PAUSE_BEFORE_DRAG_SECONDS}s before drag..."
  sleep "$PAUSE_BEFORE_DRAG_SECONDS"
fi

python3 - <<'PY'
import json, subprocess

def run(*args):
    return json.loads(subprocess.check_output(["./aos", *args], text=True))

displays = run("graph", "displays", "--json")["displays"]
other = next((d for d in displays if not d.get("is_main")), None)
if other is None:
    print("SKIP: no non-main display", flush=True)
    raise SystemExit(0)

show = run("show", "list", "--json")
canvas = next(c for c in show["canvases"] if c["id"] == "canvas-inspector")
x, y, w, h = canvas["at"]

safe_offset_x = 100
safe_offset_y = 15
target_x = int(other["bounds"]["x"] + max(safe_offset_x + 10, min(other["bounds"]["w"] - 10, 200)))
target_y = int(other["bounds"]["y"] + max(safe_offset_y + 10, min(other["bounds"]["h"] - 10, 60)))
source_x = int(x + safe_offset_x)
source_y = int(y + safe_offset_y)

subprocess.run(
    ["./aos", "do", "drag", f"{source_x},{source_y}", f"{target_x},{target_y}", "--speed", "600"],
    check=True,
)

show = run("show", "list", "--json")
canvas = next(c for c in show["canvases"] if c["id"] == "canvas-inspector")
new_x, new_y, new_w, new_h = canvas["at"]

if (new_x, new_y) == (x, y):
    print("SKIP: environment did not route the real drag gesture to the isolated inspector window", flush=True)
    raise SystemExit(0)

ox = other["bounds"]["x"]
oy = other["bounds"]["y"]
ow = other["bounds"]["w"]
oh = other["bounds"]["h"]

if not (ox <= new_x < ox + ow and oy <= new_y < oy + oh):
    print(f"FAIL: canvas top-left {new_x},{new_y} not within target display {other['bounds']}", flush=True)
    raise SystemExit(1)

layout = json.loads(run(
    "show", "eval", "--id", "canvas-inspector", "--js",
    'JSON.stringify((() => { const map = document.querySelector(".minimap"); const selfRect = document.querySelector(".minimap-canvas.self"); const selfDims = document.querySelector(".canvas-item.self .canvas-dims"); return { mapW: map?.clientWidth, mapH: map?.clientHeight, self: selfRect ? { left: parseInt(selfRect.style.left, 10), top: parseInt(selfRect.style.top, 10), width: parseInt(selfRect.style.width, 10), height: parseInt(selfRect.style.height, 10) } : null, selfDims: selfDims?.textContent ?? null, displayRects: [...document.querySelectorAll(".minimap-display")].map(el => ({ left: parseInt(el.style.left, 10), top: parseInt(el.style.top, 10), width: parseInt(el.style.width, 10), height: parseInt(el.style.height, 10) })) }; })())'
)["result"])

for rect in layout["displayRects"]:
    if rect["left"] <= 0 or rect["top"] <= 0:
        print(f"FAIL: display rect touches top/left edge: {rect}", flush=True)
        raise SystemExit(1)
    if rect["left"] + rect["width"] >= layout["mapW"]:
        print(f"FAIL: display rect touches right edge: {rect}", flush=True)
        raise SystemExit(1)
    if rect["top"] + rect["height"] >= layout["mapH"]:
        print(f"FAIL: display rect touches bottom edge: {rect}", flush=True)
        raise SystemExit(1)

expected_dims = f"{round(new_w)}×{round(new_h)} @ {round(new_x)},{round(new_y)}"
if layout["selfDims"] != expected_dims:
    print(f"FAIL: inspector row did not update after drag: expected '{expected_dims}', got '{layout['selfDims']}'", flush=True)
    raise SystemExit(1)

if not layout["self"]:
    print("FAIL: inspector minimap is missing the self canvas rect", flush=True)
    raise SystemExit(1)

rect = layout["self"]
if rect["left"] < 0 or rect["top"] < 0:
    print(f"FAIL: self rect has invalid coordinates: {rect}", flush=True)
    raise SystemExit(1)
if rect["left"] + rect["width"] > layout["mapW"] or rect["top"] + rect["height"] > layout["mapH"]:
    print(f"FAIL: self rect escapes minimap bounds: {rect}", flush=True)
    raise SystemExit(1)

print("PASS", flush=True)
PY
