#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-inspector-move-abs"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

if ! python3 - <<'PY'
import json, subprocess
perms = json.loads(subprocess.check_output(["./aos", "permissions", "check", "--json"], text=True)).get("permissions", {})
if not perms.get("accessibility"):
    raise SystemExit(1)
raise SystemExit(0)
PY
then
  echo "SKIP: requires accessibility"
  exit 0
fi

./aos permissions setup --once >/dev/null
./aos set content.roots.toolkit packages/toolkit >/dev/null

./aos serve --idle-timeout none >"$ROOT/daemon.stdout" 2>"$ROOT/daemon.stderr" &
aos_test_wait_for_socket "$ROOT" || { echo "FAIL: isolated daemon socket did not become reachable"; exit 1; }

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
sleep 1

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

python3 - <<'PY'
import json, subprocess, time

def run(*args):
    return json.loads(subprocess.check_output(["./aos", *args], text=True))

displays = run("graph", "displays", "--json")["displays"]
other = next((d for d in displays if not d.get("is_main")), None)
if other is None:
    print("SKIP: no non-main display", flush=True)
    raise SystemExit(0)

offset_x = 100
offset_y = 15
target_x = int(other["bounds"]["x"] + max(offset_x + 10, min(other["bounds"]["w"] - 10, 240)))
target_y = int(other["bounds"]["y"] + max(offset_y + 10, min(other["bounds"]["h"] - 10, 80)))
mouse_x = target_x + offset_x
mouse_y = target_y + offset_y

subprocess.run(["./aos", "do", "hover", f"{mouse_x},{mouse_y}"], check=True)
run(
    "show", "eval", "--id", "canvas-inspector", "--js",
    'window.webkit.messageHandlers.headsup.postMessage({type:"move_abs",screenX:0,screenY:0,offsetX:100,offsetY:15}); "ok"'
)
time.sleep(0.2)

canvas = next(c for c in run("show", "list", "--json")["canvases"] if c["id"] == "canvas-inspector")
new_x, new_y, new_w, new_h = canvas["at"]

layout = None
for _ in range(30):
    payload = run(
        "show", "eval", "--id", "canvas-inspector", "--js",
        'JSON.stringify((() => { const map = document.querySelector(".minimap"); const selfDims = document.querySelector(".canvas-item.self .canvas-dims")?.textContent ?? null; const selfRect = document.querySelector(".minimap-canvas.self"); return { mapW: map?.clientWidth, mapH: map?.clientHeight, selfDims, selfRect: selfRect ? { left: parseInt(selfRect.style.left, 10), top: parseInt(selfRect.style.top, 10), width: parseInt(selfRect.style.width, 10), height: parseInt(selfRect.style.height, 10) } : null }; })())'
    )
    layout = json.loads(payload["result"])
    if layout["selfDims"] is not None:
        break
    time.sleep(0.1)
else:
    print("FAIL: inspector row never appeared after move_abs", flush=True)
    raise SystemExit(1)

if (new_x, new_y) != (target_x, target_y):
    print(f"FAIL: move_abs landed at {(new_x, new_y)}, expected {(target_x, target_y)}", flush=True)
    raise SystemExit(1)

expected_dims = f"{round(new_w)}×{round(new_h)} @ {round(new_x)},{round(new_y)}"
if layout["selfDims"] != expected_dims:
    print(f"FAIL: inspector row did not update after move_abs: expected '{expected_dims}', got '{layout['selfDims']}'", flush=True)
    raise SystemExit(1)

if not layout["selfRect"]:
    print("FAIL: inspector minimap is missing the self canvas rect", flush=True)
    raise SystemExit(1)

rect = layout["selfRect"]
if rect["left"] < 0 or rect["top"] < 0:
    print(f"FAIL: self rect has invalid coordinates: {rect}", flush=True)
    raise SystemExit(1)
if rect["left"] + rect["width"] > layout["mapW"] or rect["top"] + rect["height"] > layout["mapH"]:
    print(f"FAIL: self rect escapes minimap bounds: {rect}", flush=True)
    raise SystemExit(1)

print("PASS", flush=True)
PY
