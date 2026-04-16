#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-cross-display"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"
DAEMON_PID=""

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

wait_for_ping() {
  for _ in $(seq 1 50); do
    if ./aos show ping >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

if ! python3 - <<'PY'
import json, subprocess
doctor = json.loads(subprocess.check_output(["./aos", "doctor", "--json"], text=True))
perms = doctor.get("permissions", {})
if not perms.get("accessibility") or not perms.get("screen_recording"):
    raise SystemExit(1)
graph = json.loads(subprocess.check_output(["./aos", "graph", "displays", "--json"], text=True))
displays = graph.get("displays", [])
raise SystemExit(0 if len(displays) >= 2 else 1)
PY
then
  echo "SKIP: requires accessibility + screen recording + at least two displays"
  exit 0
fi

./aos permissions setup --once >/dev/null
./aos set content.roots.toolkit packages/toolkit >/dev/null

./aos serve --idle-timeout none >"$ROOT/daemon.stdout" 2>"$ROOT/daemon.stderr" &
wait_for_ping || { echo "FAIL: isolated daemon did not become reachable"; exit 1; }
DAEMON_PID="$(aos_test_wait_for_lock_pid "$ROOT")" || { echo "FAIL: isolated daemon lock pid did not appear"; exit 1; }

bash packages/toolkit/components/canvas-inspector/launch.sh >/dev/null

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
    'JSON.stringify((() => { const map = document.querySelector(".minimap"); return { mapW: map?.clientWidth, mapH: map?.clientHeight, displayRects: [...document.querySelectorAll(".minimap-display")].map(el => ({ left: parseInt(el.style.left, 10), top: parseInt(el.style.top, 10), width: parseInt(el.style.width, 10), height: parseInt(el.style.height, 10) })) }; })())'
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

print("PASS", flush=True)
PY
