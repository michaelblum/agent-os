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
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path("tests/lib").resolve()))
import real_input_surface_primitives as ris


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


def see_canvas(canvas_id):
    safe_id = "".join(char if char.isalnum() or char in "-_" else "-" for char in canvas_id)
    out_path = f"/tmp/aos-sigil-semantic-{safe_id}-{os.getpid()}.png"
    try:
        return json.loads(run("see", "capture", "main", "--canvas", canvas_id, "--perception", "--xray", "--out", out_path))
    finally:
        try:
            os.remove(out_path)
        except FileNotFoundError:
            pass


def semantic_target(canvas_id, target_id):
    payload = see_canvas(canvas_id)
    for target in payload.get("semantic_targets") or []:
        if target.get("id") == target_id:
            return {"payload": payload, "target": target}
    dom_target = json.loads(run(
        "show", "eval", "--id", canvas_id, "--js",
        """(() => {
          const el = document.querySelector(`[data-semantic-target-id="avatar"]`)
          if (!el) return JSON.stringify(null)
          const rect = el.getBoundingClientRect()
          return JSON.stringify({
            id: el.dataset.semanticTargetId,
            ref: el.dataset.aosRef,
            role: 'button',
            name: el.getAttribute('aria-label'),
            surface: el.dataset.aosSurface,
            parent_canvas: el.dataset.aosParentCanvas,
            enabled: !el.disabled,
            bounds: { width: rect.width, height: rect.height },
            center: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
            source: 'hit-canvas-dom-fallback'
          })
        })()"""
    ))
    if dom_target.get("status") == "success":
        target = json.loads(dom_target.get("result") or "null")
        if target and target.get("id") == target_id:
            return {"payload": payload, "target": target}
    return None


def native_desktop_bounds(displays):
    rects = [display.get("native_bounds") for display in displays if display.get("native_bounds")]
    if not rects:
        return {"x": 0, "y": 0}
    min_x = min(rect.get("x", 0) for rect in rects)
    min_y = min(rect.get("y", 0) for rect in rects)
    return {"x": min_x, "y": min_y}


def semantic_target_world_point(surface_snapshot, capture_payload, target, displays):
    frame = surface_snapshot.get("frame") or [0, 0, 0, 0]
    surface = (capture_payload.get("surfaces") or [{}])[0]
    scale = surface.get("capture_scale_factor") or 1
    native_point = {
        "x": frame[0] + target["center"]["x"] / scale,
        "y": frame[1] + target["center"]["y"] / scale,
    }
    origin = native_desktop_bounds(displays)
    return {
        "x": native_point["x"] - origin["x"],
        "y": native_point["y"] - origin["y"],
    }


def wait_until(predicate, timeout=5.0, interval=0.05, label="condition"):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = predicate()
        if last is not None:
            return last
        time.sleep(interval)
    raise SystemExit(f"FAIL: timed out waiting for {label}; last={last!r}")


snapshot = show_eval_json("JSON.stringify(window.__sigilDebug.snapshot())")
hit_target_id = snapshot["hitTargetId"]
assert snapshot["hitTargetReady"] is True, snapshot
assert hit_target_id in canvas_ids(), f"missing hit target canvas {hit_target_id}"
assert snapshot["avatarVisible"] is True, snapshot

hit_semantic = wait_until(lambda: semantic_target(hit_target_id, "avatar"), timeout=5.0, label="avatar hit semantic target")
hit_target = hit_semantic["target"]
assert hit_target["ref"] == hit_target_id, hit_target
assert hit_target["role"] == "button", hit_target
assert hit_target["name"] == "Sigil avatar", hit_target
assert hit_target["surface"] == "sigil.avatar", hit_target
assert hit_target["parent_canvas"] == "avatar-main", hit_target
assert hit_target["enabled"] is True, hit_target
assert hit_target["bounds"]["width"] > 0 and hit_target["bounds"]["height"] > 0, hit_target

hover_state = show_eval_json(
    """(() => {
      const p = window.liveJs.avatarPos
      window.__sigilDebug.dispatchDesktop({ type: 'mouse_moved', x: p.x, y: p.y })
      return JSON.stringify(window.__sigilDebug.snapshot())
    })()"""
)
assert hover_state["avatarHover"] is True, hover_state

hover_cleared = show_eval_json(
    """(() => {
      const p = window.liveJs.avatarPos
      const radius = window.liveJs.avatarHitRadius || 40
      window.__sigilDebug.dispatchDesktop({ type: 'mouse_moved', x: p.x + radius * 2.5, y: p.y })
      return JSON.stringify(window.__sigilDebug.snapshot())
    })()"""
)
assert hover_cleared["avatarHover"] is False, hover_cleared

right_click_duplicate = show_eval_json(
    """(() => {
      const frame = window.__sigilDebug.snapshot().hitTargetFrame
      const p = { x: frame[0] + frame[2] / 2, y: frame[1] + frame[3] / 2 }
      window.__sigilDebug.dispatch({ type: 'right_mouse_down', x: p.x, y: p.y })
      window.__sigilDebug.dispatch({ type: 'right_mouse_down', x: p.x + 20, y: p.y + 4 })
      return JSON.stringify(window.__sigilDebug.snapshot())
    })()"""
)
assert right_click_duplicate["contextMenu"]["open"] is True, right_click_duplicate

daemon_echo = show_eval_json(
    f"""(() => {{
      window.__sigilDebug.clearInteractionTrace()
      const snap = window.__sigilDebug.snapshot()
      const bounds = snap.contextMenu?.bounds
      if (!bounds || bounds.w <= 0 || bounds.h <= 0) {{
        return JSON.stringify({{ ok: false, error: 'missing open context menu bounds', contextMenu: snap.contextMenu }})
      }}
      const dwBounds = snap.surface?.segment?.dw_bounds || [0, 0, 0, 0]
      const nativeBounds = snap.surface?.segment?.native_bounds || dwBounds
      const point = {{
        x: bounds.x + bounds.w / 2,
        y: bounds.y + bounds.h / 2,
      }}
      const nativePoint = {{
        x: nativeBounds[0] + point.x - dwBounds[0],
        y: nativeBounds[1] + point.y - dwBounds[1],
      }}
      window.__sigilDebug.dispatchDesktop({{ type: 'left_mouse_dragged', x: point.x, y: point.y }})
      window.__sigilDebug.dispatch({{
        type: 'canvas_message',
        id: {json.dumps(hit_target_id)},
        payload: {{
          source: 'sigil-hit',
          kind: 'left_mouse_dragged',
          screenX: nativePoint.x,
          screenY: nativePoint.y
        }}
      }})
      const trace = window.__sigilDebug.interactionTrace().entries
      return JSON.stringify({{
        ok: true,
        ignored: trace.find((entry) => entry.stage === 'hit-canvas:ignored' && entry.data?.reason === 'daemon-echo') || null,
        traceTail: trace.slice(-12),
      }})
    }})()"""
)
assert daemon_echo["ok"] is True, daemon_echo
assert daemon_echo["ignored"] is not None, daemon_echo

show_eval("window.__sigilDebug.dispatch({ type: 'key_down', key_code: 53 }); 'ok'")
radial_drag_source = show_eval_json(
    """(() => {
      const p = window.__sigilDebug.snapshot().avatarPos
      return JSON.stringify({ p, config: window.state.radialGestureMenu })
    })()"""
)
drag_plan = ris.radial_drag_point(
    radial_drag_source["p"],
    radial_drag_source["config"],
    phase="fastTravel",
    source="state.radialGestureMenu",
)
mutated_basis = {**radial_drag_source["config"], "radiusBasis": radial_drag_source["config"]["radiusBasis"] + 7}
mutated_handoff = {**radial_drag_source["config"], "handoffRadius": radial_drag_source["config"]["handoffRadius"] + 0.5}
basis_plan = ris.radial_drag_point(radial_drag_source["p"], mutated_basis, phase="fastTravel")
handoff_plan = ris.radial_drag_point(radial_drag_source["p"], mutated_handoff, phase="fastTravel")
assert basis_plan["distancePx"] != drag_plan["distancePx"], {"drag_plan": drag_plan, "basis_plan": basis_plan}
assert handoff_plan["distancePx"] != drag_plan["distancePx"], {"drag_plan": drag_plan, "handoff_plan": handoff_plan}
print("radial_drag_plan", json.dumps({
    "source": drag_plan["source"],
    "configField": drag_plan["configField"],
    "thresholdField": drag_plan["thresholdField"],
    "radiusBasis": drag_plan["radiusBasis"],
    "distancePx": drag_plan["distancePx"],
}, sort_keys=True))

direct_drag_state = show_eval_json(
    f"""(() => {{
      const p = window.__sigilDebug.snapshot().avatarPos
      window.__sigilDebug.dispatchDesktop({{ type: 'left_mouse_down', x: p.x, y: p.y }})
      window.__sigilDebug.dispatchDesktop({{
        type: 'left_mouse_dragged',
        x: {json.dumps(drag_plan["point"]["x"])},
        y: {json.dumps(drag_plan["point"]["y"])}
      }})
      return JSON.stringify(window.__sigilDebug.snapshot())
    }})()"""
)
assert direct_drag_state["state"] == "FAST_TRAVEL", direct_drag_state
assert direct_drag_state["fastTravelEffect"] == "line", direct_drag_state

assert hit_target_id in canvas_ids(), f"missing hit target canvas after interactions: {hit_target_id}"
print("PASS")
PY
