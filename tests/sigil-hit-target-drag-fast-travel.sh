#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-sigil-hit-target-drag-fast-travel"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

AOS_BIN="$(pwd)/aos" AOS_RUNTIME_MODE=repo apps/sigil/sigilctl-seed.sh >/dev/null

aos_test_start_daemon "$ROOT" toolkit packages/toolkit sigil apps/sigil \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

./aos show create \
  --id avatar-main \
  --url 'aos://sigil/renderer/index.html?visible=1' \
  --track union >/dev/null

./aos show wait \
  --id avatar-main \
  --js 'window.__sigilStage && window.liveJs && window.liveJs.visible === true && window.liveJs.avatarPos?.valid === true && window.__sigilHitDebug?.ready === true' \
  --timeout 10s >/dev/null

python3 - <<'PY'
import json
import math
import subprocess
import time


def run(*args):
    return subprocess.check_output(["./aos", *args], text=True)


def show_eval(js):
    payload = json.loads(run("show", "eval", "--id", "avatar-main", "--js", js))
    assert payload["status"] == "success", payload
    return payload["result"]


def show_eval_json(js):
    return json.loads(show_eval(js))


def wait_until(predicate, timeout=5.0, interval=0.05):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = predicate()
        if last is not None:
            return last
        time.sleep(interval)
    raise SystemExit(f"FAIL: timed out waiting for condition; last={last!r}")
snapshot = show_eval_json(
    "JSON.stringify({ avatarPos: window.liveJs.avatarPos, displays: window.liveJs.displays, hit: window.__sigilHitDebug })"
)
avatar_pos = snapshot["avatarPos"]
hit = snapshot["hit"]
if not hit or not hit.get("ready"):
    raise SystemExit(f"FAIL: hit target not ready: {snapshot}")

main_display = next((display for display in snapshot["displays"] if display.get("is_main")), snapshot["displays"][0])
visible = main_display.get("visibleBounds") or main_display.get("visible_bounds") or main_display["bounds"]
target = {
    "x": int(round(visible["x"] + (visible["w"] * 0.75))),
    "y": int(round(visible["y"] + (visible["h"] * 0.30))),
}

start = {
    "x": int(round(avatar_pos["x"])),
    "y": int(round(avatar_pos["y"])),
}

drag_state = show_eval_json(
    f"""(() => {{
      window.__sigilStage.dispatch({{
        type: 'canvas_message',
        id: {json.dumps(hit["id"])},
        payload: {{ source: 'sigil-hit', kind: 'left_mouse_down', screenX: {start["x"]}, screenY: {start["y"]} }}
      }})
      window.__sigilStage.dispatch({{
        type: 'canvas_message',
        id: {json.dumps(hit["id"])},
        payload: {{ source: 'sigil-hit', kind: 'left_mouse_dragged', screenX: {target["x"]}, screenY: {target["y"]} }}
      }})
      return JSON.stringify({{
        state: window.liveJs.currentState,
        pointerPos: window.liveJs.pointerPos
      }})
    }})()"""
)

if drag_state["state"] != "DRAG":
    raise SystemExit(f"FAIL: expected DRAG after hit-target drag, got {drag_state}")
if abs(drag_state["pointerPos"]["x"] - target["x"]) > 1 or abs(drag_state["pointerPos"]["y"] - target["y"]) > 1:
    raise SystemExit(f"FAIL: pointer position did not use drag destination: {drag_state}")

show_eval(
    f"""(() => {{
      window.__sigilStage.dispatch({{
        type: 'canvas_message',
        id: {json.dumps(hit["id"])},
        payload: {{ source: 'sigil-hit', kind: 'left_mouse_up', screenX: {target["x"]}, screenY: {target["y"]} }}
      }})
      return 'ok'
    }})()"""
)

landed = wait_until(
    lambda: (
        lambda snap: snap
        if snap["state"] == "IDLE"
        and snap["travel"] is None
        and math.isclose(snap["avatarPos"]["x"], target["x"], abs_tol=1.0)
        and math.isclose(snap["avatarPos"]["y"], target["y"], abs_tol=1.0)
        else None
    )(show_eval_json("JSON.stringify({ state: window.liveJs.currentState, travel: window.liveJs.travel, avatarPos: window.liveJs.avatarPos })")),
    timeout=5.0,
)

canvases = json.loads(run("show", "list", "--json")).get("canvases", [])
if not any(canvas.get("id") == hit["id"] for canvas in canvases):
    raise SystemExit(f"FAIL: hit target disappeared after drag release: {canvases}")

print("PASS", json.dumps({"landed": landed, "hit_id": hit["id"]}))
PY
