#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-sigil-workbench-launch"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

./aos set content.roots.toolkit packages/toolkit >/dev/null
./aos set content.roots.sigil apps/sigil >/dev/null
./aos serve --idle-timeout none >"$ROOT/daemon.stdout" 2>"$ROOT/daemon.stderr" &
aos_test_wait_for_socket "$ROOT" || { echo "FAIL: isolated daemon socket did not become reachable"; exit 1; }

LAUNCH_OUT="$ROOT/launch.out"
AOS="$(pwd)/aos" \
AOS_BIN="$(pwd)/aos" \
AOS_RUNTIME_MODE=repo \
MODE=repo \
bash apps/sigil/workbench/launch.sh >"$LAUNCH_OUT"

./aos show wait \
  --id avatar-main \
  --js 'window.liveJs && window.liveJs.currentAgentId === "default" && window.liveJs.avatarPos && window.liveJs.avatarPos.valid === true && window.__sigilBootError == null' \
  --timeout 10s >/dev/null

./aos show wait \
  --id sigil-workbench \
  --js 'window.__sigilWorkbenchState && window.__sigilWorkbenchState.activationCount === 1 && window.__sigilWorkbenchState.lastActivation && window.__sigilWorkbenchState.lastActivation.title === "Studio" && document.querySelector(".aos-title")?.textContent === "SIGIL" && document.querySelector(".surface-frame")' \
  --timeout 10s >/dev/null

python3 - "$LAUNCH_OUT" <<'PY'
import json
import math
import pathlib
import subprocess
import sys


launch_out = pathlib.Path(sys.argv[1]).read_text()
if "Sigil workbench launched." not in launch_out:
    raise SystemExit(f"FAIL: launcher did not report success:\n{launch_out}")


def run(*args):
    return json.loads(subprocess.check_output(["./aos", *args], text=True))


show = run("show", "list", "--json")
workbench = next((c for c in show.get("canvases", []) if c.get("id") == "sigil-workbench"), None)
avatar = next((c for c in show.get("canvases", []) if c.get("id") == "avatar-main"), None)
if workbench is None or avatar is None:
    raise SystemExit(f"FAIL: launcher missing expected canvases: {show}")

graph = run("graph", "displays", "--json")
displays = graph.get("displays", graph if isinstance(graph, list) else [])
main = next((d for d in displays if d.get("is_main")), None)
if main is None:
    raise SystemExit(f"FAIL: no main display in graph payload: {graph}")

bounds = main.get("visible_bounds") or main.get("bounds") or {}
margin_x = 32
margin_y = 28
usable_w = max(480, int(bounds["w"]) - margin_x * 2)
usable_h = max(360, int(bounds["h"]) - margin_y * 2)
expected = [
    int(bounds["x"]) + int(bounds["w"]) - margin_x - max(480, round(usable_w * 2 / 3)),
    int(bounds["y"]) + margin_y,
    max(480, round(usable_w * 2 / 3)),
    usable_h,
]

actual = workbench.get("at")
if actual is None:
    raise SystemExit(f"FAIL: workbench missing frame: {workbench}")

for observed, wanted in zip(actual, expected):
    if not math.isclose(float(observed), float(wanted), abs_tol=1.0):
        raise SystemExit(f"FAIL: workbench frame drifted from launch geometry: actual={actual} expected={expected}")

if not (float(actual[0]) >= float(bounds["x"]) and float(actual[1]) >= float(bounds["y"])):
    raise SystemExit(f"FAIL: workbench escaped display origin: actual={actual} bounds={bounds}")
if not (float(actual[0]) + float(actual[2]) <= float(bounds["x"]) + float(bounds["w"]) + 1.0):
    raise SystemExit(f"FAIL: workbench overflowed display width: actual={actual} bounds={bounds}")
if not (float(actual[1]) + float(actual[3]) <= float(bounds["y"]) + float(bounds["h"]) + 1.0):
    raise SystemExit(f"FAIL: workbench overflowed display height: actual={actual} bounds={bounds}")

avatar_payload = run("show", "eval", "--id", "avatar-main", "--js", "JSON.stringify(window.liveJs.avatarPos)")
avatar_pos = json.loads(avatar_payload["result"])
expected_avatar = {
    "x": float(bounds["x"]) + float(bounds["w"]) / 6.0,
    "y": float(bounds["y"]) + float(bounds["h"]) / 6.0,
}
if not math.isclose(float(avatar_pos["x"]), expected_avatar["x"], abs_tol=0.01):
    raise SystemExit(f"FAIL: avatar x did not stage to launch home: actual={avatar_pos} expected={expected_avatar}")
if not math.isclose(float(avatar_pos["y"]), expected_avatar["y"], abs_tol=0.01):
    raise SystemExit(f"FAIL: avatar y did not stage to launch home: actual={avatar_pos} expected={expected_avatar}")

workbench_state = run(
    "show",
    "eval",
    "--id",
    "sigil-workbench",
    "--js",
    "JSON.stringify(window.__sigilWorkbenchState)",
)
state = json.loads(workbench_state["result"])
if state.get("activationCount") != 1 or (state.get("lastActivation") or {}).get("title") != "Studio":
    raise SystemExit(f"FAIL: workbench state did not initialize on Studio tab: {state}")

print("PASS")
PY
