#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-sigil-avatar-interactions"
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
  --url 'aos://sigil/renderer/index.html' \
  --track union >/dev/null

./aos show wait \
  --id avatar-main \
  --js 'window.__sigilDebug && window.__sigilDebug.snapshot().hitTargetReady === true && window.liveJs && window.liveJs.currentAgentId === "default" && window.liveJs.avatarPos && window.liveJs.avatarPos.valid === true && Array.isArray(window.liveJs.displays) && window.liveJs.displays.length > 0 && window.__sigilBootError == null' \
  --timeout 10s >/dev/null

./aos show eval \
  --id avatar-main \
  --js 'window.__sigilDebug.dispatch({ type: "status_item.show" }); "ok"' >/dev/null

./aos show wait \
  --id avatar-main \
  --js 'window.__sigilDebug && window.__sigilDebug.snapshot().avatarVisible === true' \
  --timeout 5s >/dev/null

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


def canvas_ids():
    payload = json.loads(run("show", "list", "--json"))
    return {canvas["id"] for canvas in payload.get("canvases", [])}


def wait_until(predicate, timeout=5.0, interval=0.05):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = predicate()
        if last is not None:
            return last
        time.sleep(interval)
    raise SystemExit(f"FAIL: timed out waiting for condition; last={last!r}")


snapshot = show_eval_json("JSON.stringify(window.__sigilDebug.snapshot())")
hit_target_id = snapshot["hitTargetId"]
assert snapshot["hitTargetReady"] is True, snapshot
assert hit_target_id in canvas_ids(), f"missing hit target canvas {hit_target_id}"
assert snapshot["avatarVisible"] is True, snapshot

goto_state = show_eval_json(
    """(() => {
      const p = window.liveJs.avatarPos
      window.__sigilDebug.dispatch({ type: 'left_mouse_down', x: p.x, y: p.y })
      window.__sigilDebug.dispatch({ type: 'left_mouse_up', x: p.x, y: p.y })
      return JSON.stringify(window.__sigilDebug.snapshot())
    })()"""
)
assert goto_state["state"] == "GOTO", goto_state

goto_canceled = show_eval_json(
    """(() => {
      const p = window.liveJs.avatarPos
      window.__sigilDebug.dispatch({ type: 'right_mouse_down', x: p.x, y: p.y })
      return JSON.stringify(window.__sigilDebug.snapshot())
    })()"""
)
assert goto_canceled["state"] == "IDLE", goto_canceled

goto_state = show_eval_json(
    """(() => {
      const p = window.liveJs.avatarPos
      window.__sigilDebug.dispatch({ type: 'left_mouse_down', x: p.x, y: p.y })
      window.__sigilDebug.dispatch({ type: 'left_mouse_up', x: p.x, y: p.y })
      return JSON.stringify(window.__sigilDebug.snapshot())
    })()"""
)
assert goto_state["state"] == "GOTO", goto_state

target = show_eval_json(
    """(() => {
      const d = window.liveJs.displays.find((display) => display.is_main) || window.liveJs.displays[0]
      return JSON.stringify({
        x: d.visible_bounds.x + d.visible_bounds.w / 2,
        y: d.visible_bounds.y + d.visible_bounds.h / 2
      })
    })()"""
)

show_eval(
    f"""(() => {{
      window.__sigilDebug.dispatch({{ type: 'left_mouse_down', x: {target['x']}, y: {target['y']} }})
      window.__sigilDebug.dispatch({{ type: 'left_mouse_up', x: {target['x']}, y: {target['y']} }})
      return 'ok'
    }})()"""
)

wait_until(
    lambda: (
        lambda snap: snap
        if snap["state"] == "IDLE"
        and snap["travel"] is None
        and math.isclose(snap["avatarPos"]["x"], target["x"], abs_tol=1.0)
        and math.isclose(snap["avatarPos"]["y"], target["y"], abs_tol=1.0)
        else None
    )(show_eval_json("JSON.stringify(window.__sigilDebug.snapshot())")),
    timeout=5.0,
)

drag_state = show_eval_json(
    """(() => {
      const p = window.liveJs.avatarPos
      window.__sigilDebug.dispatch({ type: 'left_mouse_down', x: p.x, y: p.y })
      window.__sigilDebug.dispatch({ type: 'left_mouse_dragged', x: p.x + 18, y: p.y })
      return JSON.stringify(window.__sigilDebug.snapshot())
    })()"""
)
assert drag_state["state"] == "DRAG", drag_state

canceled = show_eval_json(
    """(() => {
      window.__sigilDebug.dispatch({ type: 'key_down', key_code: 53 })
      return JSON.stringify(window.__sigilDebug.snapshot())
    })()"""
)
assert canceled["state"] == "IDLE", canceled

goto_canceled_again = show_eval_json(
    """(() => {
      const p = window.liveJs.avatarPos
      window.__sigilDebug.dispatch({ type: 'left_mouse_down', x: p.x, y: p.y })
      window.__sigilDebug.dispatch({ type: 'left_mouse_up', x: p.x, y: p.y })
      window.__sigilDebug.dispatch({ type: 'right_mouse_down', x: p.x, y: p.y })
      return JSON.stringify(window.__sigilDebug.snapshot())
    })()"""
)
assert goto_canceled_again["state"] == "IDLE", goto_canceled_again

assert hit_target_id in canvas_ids(), f"missing hit target canvas after interactions: {hit_target_id}"
print("PASS")
PY
