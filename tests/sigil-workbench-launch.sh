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

aos_test_start_daemon "$ROOT" toolkit packages/toolkit sigil apps/sigil \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

LAUNCH_OUT="$ROOT/launch.out"
AOS="$(pwd)/aos" \
AOS_BIN="$(pwd)/aos" \
AOS_RUNTIME_MODE=repo \
MODE=repo \
bash apps/sigil/workbench/launch.sh >"$LAUNCH_OUT"

if ! AOS="$(pwd)/aos" AOS_PATH="$(pwd)/aos" AOS_RUNTIME_MODE=repo ./aos launch sigil --dry-run --json >/tmp/aos-sigil-launch-dry-run.json; then
    echo "FAIL: generic Sigil launcher dry-run failed"
    exit 1
fi

./aos show wait \
  --id avatar-main \
  --js 'window.liveJs && window.liveJs.currentAgentId === "default" && window.liveJs.avatarPos && window.liveJs.avatarPos.valid === true && window.__sigilBootError == null' \
  --timeout 10s >/dev/null

./aos show wait \
  --id sigil-workbench \
  --js 'window.__sigilWorkbenchState && window.__sigilWorkbenchState.activationCount === 1 && window.__sigilWorkbenchState.lastActivation && window.__sigilWorkbenchState.lastActivation.title === "Knowledge Base" && window.__sigilWorkbenchState.sequesteredStudio === true && document.querySelector(".aos-title")?.textContent === "SIGIL" && !document.body.textContent.includes("Studio")' \
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

graph = run("graph", "displays")
if isinstance(graph, dict) and isinstance(graph.get("data"), dict):
    displays = graph["data"].get("displays", [])
else:
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

fallback = [120, 120, 960]
if all(math.isclose(float(observed), float(wanted), abs_tol=1.0) for observed, wanted in zip(actual[:3], fallback)):
    if not (360 <= float(actual[3]) <= 720):
        raise SystemExit(f"FAIL: fallback workbench height outside launch bounds: actual={actual}")
else:
    for observed, wanted in zip(actual[:3], expected[:3]):
        if not math.isclose(float(observed), float(wanted), abs_tol=1.0):
            raise SystemExit(f"FAIL: workbench frame drifted from launch geometry: actual={actual} expected={expected}")
    if not (360 <= float(actual[3]) <= float(expected[3]) + 1.0):
        raise SystemExit(f"FAIL: workbench height outside launch bounds: actual={actual} expected={expected}")

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
if state.get("activationCount") != 1 or (state.get("lastActivation") or {}).get("title") != "Knowledge Base":
    raise SystemExit(f"FAIL: workbench state did not initialize on Knowledge Base tab: {state}")
if state.get("sequesteredStudio") is not True:
    raise SystemExit(f"FAIL: workbench did not mark Studio as sequestered: {state}")

print("PASS")
PY
