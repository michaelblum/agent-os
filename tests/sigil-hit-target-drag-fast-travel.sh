#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/visual-harness.sh"

PREFIX="aos-sigil-hit-target-drag-fast-travel"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

aos_visual_seed_sigil repo

aos_visual_start_isolated_daemon "$ROOT" toolkit packages/toolkit sigil apps/sigil \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

aos_visual_launch_sigil_with_inspector avatar-main canvas-inspector

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

snapshot = show_eval_json(
    "JSON.stringify({ avatarPos: window.liveJs.avatarPos, displays: window.liveJs.displays, sigil: window.__sigilDebug.snapshot() })"
)
avatar_pos = snapshot["avatarPos"]
sigil = snapshot["sigil"]
if not sigil or not sigil.get("hitTargetReady"):
    raise SystemExit(f"FAIL: hit target not ready: {snapshot}")
hit_id = sigil["hitTargetId"]
if hit_id not in canvas_ids():
    raise SystemExit(f"FAIL: missing hit target canvas {hit_id}")

native_origin = {
    "x": min((display.get("nativeBounds") or display["bounds"])["x"] for display in snapshot["displays"]),
    "y": min((display.get("nativeBounds") or display["bounds"])["y"] for display in snapshot["displays"]),
}

def world_to_native(point):
    return {
        "x": int(round(point["x"] + native_origin["x"])),
        "y": int(round(point["y"] + native_origin["y"])),
    }

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
start_native = world_to_native(start)
target_native = world_to_native(target)

drag_state = show_eval_json(
    f"""(() => {{
      window.__sigilDebug.dispatch({{
        type: 'canvas_message',
        id: {json.dumps(hit_id)},
        payload: {{ source: 'sigil-hit', kind: 'left_mouse_down', screenX: {start_native["x"]}, screenY: {start_native["y"]} }}
      }})
      window.__sigilDebug.dispatch({{
        type: 'canvas_message',
        id: {json.dumps(hit_id)},
        payload: {{ source: 'sigil-hit', kind: 'left_mouse_dragged', screenX: {target_native["x"]}, screenY: {target_native["y"]} }}
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
      window.__sigilDebug.dispatch({{
        type: 'canvas_message',
        id: {json.dumps(hit_id)},
        payload: {{ source: 'sigil-hit', kind: 'left_mouse_up', screenX: {target_native["x"]}, screenY: {target_native["y"]} }}
      }})
      return 'ok'
    }})()"""
)

landed = wait_until(
    lambda: (
        lambda snap: snap
        if snap["state"] == "IDLE"
        and snap["travel"] is None
        and snap["omegaEnabled"] is False
        and snap["omegaInterDimensional"] is False
        and math.isclose(snap["avatarPos"]["x"], target["x"], abs_tol=1.0)
        and math.isclose(snap["avatarPos"]["y"], target["y"], abs_tol=1.0)
        else None
    )(show_eval_json("JSON.stringify({ state: window.liveJs.currentState, travel: window.liveJs.travel, avatarPos: window.liveJs.avatarPos, omegaEnabled: window.state.isOmegaEnabled, omegaInterDimensional: window.state.omegaInterDimensional })")),
    timeout=5.0,
)

if hit_id not in canvas_ids():
    raise SystemExit(f"FAIL: hit target disappeared after drag release: {sorted(canvas_ids())}")

wormhole_target = {
    "x": int(round(visible["x"] + (visible["w"] * 0.35))),
    "y": int(round(visible["y"] + (visible["h"] * 0.62))),
}
wormhole_start = {
    "x": int(round(landed["avatarPos"]["x"])),
    "y": int(round(landed["avatarPos"]["y"])),
}
wormhole_start_native = world_to_native(wormhole_start)
wormhole_target_native = world_to_native(wormhole_target)

menu_effect = show_eval_json(
    f"""(() => {{
      window.__sigilDebug.dispatch({{
        type: 'canvas_message',
        id: {json.dumps(hit_id)},
        payload: {{ source: 'sigil-hit', kind: 'right_mouse_down', screenX: {wormhole_start_native["x"]}, screenY: {wormhole_start_native["y"]} }}
      }})
      const button = document.querySelector('[data-sigil-fast-travel-effect="wormhole"]')
      if (!button) return JSON.stringify({{ ok: false, error: 'missing fast-travel menu button' }})
      button.click()
      window.__sigilDebug.dispatch({{ type: 'key_down', key_code: 53 }})
      return JSON.stringify({{
        ok: true,
        fastTravelEffect: window.__sigilDebug.snapshot().fastTravelEffect,
        active: button.classList.contains('active')
      }})
    }})()"""
)
if not menu_effect.get("ok") or menu_effect.get("fastTravelEffect") != "wormhole" or menu_effect.get("active") is not True:
    raise SystemExit(f"FAIL: context menu did not switch fast travel to wormhole: {menu_effect}")

wormhole_started = show_eval_json(
    f"""(() => {{
      window.liveJs.fastTravelEvents = []
      window.__sigilDebug.dispatch({{
        type: 'canvas_message',
        id: {json.dumps(hit_id)},
        payload: {{ source: 'sigil-hit', kind: 'left_mouse_down', screenX: {wormhole_start_native["x"]}, screenY: {wormhole_start_native["y"]} }}
      }})
      window.__sigilDebug.dispatch({{
        type: 'canvas_message',
        id: {json.dumps(hit_id)},
        payload: {{ source: 'sigil-hit', kind: 'left_mouse_dragged', screenX: {wormhole_target_native["x"]}, screenY: {wormhole_target_native["y"]} }}
      }})
      window.__sigilDebug.dispatch({{
        type: 'canvas_message',
        id: {json.dumps(hit_id)},
        payload: {{ source: 'sigil-hit', kind: 'left_mouse_up', screenX: {wormhole_target_native["x"]}, screenY: {wormhole_target_native["y"]} }}
      }})
      return JSON.stringify({{
        state: window.liveJs.currentState,
        travel: window.liveJs.travel,
        events: window.liveJs.fastTravelEvents
      }})
    }})()"""
)

event_stages = {event["stage"] for event in wormhole_started["events"]}
for required in ["wormhole.entry.created", "wormhole.exit.created", "wormhole.release"]:
    if required not in event_stages:
        raise SystemExit(f"FAIL: missing wormhole startup event {required}: {wormhole_started}")
if not wormhole_started["travel"] or wormhole_started["travel"].get("effect") != "wormhole":
    raise SystemExit(f"FAIL: expected active wormhole travel: {wormhole_started}")

wormhole_landed = wait_until(
    lambda: (
        lambda snap: snap
        if snap["state"] == "IDLE"
        and snap["travel"] is None
        and snap["omegaEnabled"] is False
        and snap["omegaInterDimensional"] is False
        and math.isclose(snap["avatarPos"]["x"], wormhole_target["x"], abs_tol=1.0)
        and math.isclose(snap["avatarPos"]["y"], wormhole_target["y"], abs_tol=1.0)
        and "wormhole.complete" in {event["stage"] for event in snap["events"]}
        else None
    )(show_eval_json("JSON.stringify({ state: window.liveJs.currentState, travel: window.liveJs.travel, avatarPos: window.liveJs.avatarPos, omegaEnabled: window.state.isOmegaEnabled, omegaInterDimensional: window.state.omegaInterDimensional, events: window.liveJs.fastTravelEvents })")),
    timeout=5.0,
)

setup = json.loads(run("permissions", "check", "--json")).get("setup") or {}
if setup.get("setup_completed"):
    setup_errors = [
        event.get("error", "")
        for event in wormhole_landed["events"]
        if isinstance(event.get("error"), str)
    ]
    if any("PERMISSIONS_SETUP_REQUIRED" in error for error in setup_errors):
        raise SystemExit(f"FAIL: isolated runtime has permissions setup but wormhole capture hit onboarding gate: {setup_errors}")

print("PASS", json.dumps({"landed": landed, "wormhole_landed": wormhole_landed, "hit_id": hit_id}))
PY
