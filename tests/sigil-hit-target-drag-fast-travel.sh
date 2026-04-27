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
    for attempt in range(12):
        try:
            return subprocess.check_output(["./aos", *args], text=True, stderr=subprocess.STDOUT)
        except subprocess.CalledProcessError as error:
            output = error.output or ""
            if len(args) >= 2 and args[0] == "show" and args[1] == "eval" and "IPC failure" in output:
                time.sleep(0.1)
                continue
            raise
    return subprocess.check_output(["./aos", *args], text=True, stderr=subprocess.STDOUT)


def show_eval(js):
    payload = json.loads(run("show", "eval", "--id", "avatar-main", "--js", js))
    assert payload["status"] == "success", payload
    return payload["result"]


def show_eval_json(js):
    return json.loads(show_eval(js))


def canvas_ids():
    payload = json.loads(run("show", "list", "--json"))
    return {canvas["id"] for canvas in payload.get("canvases", [])}

def canvas_by_id(canvas_id):
    payload = json.loads(run("show", "list", "--json"))
    for canvas in payload.get("canvases", []):
        if canvas.get("id") == canvas_id:
            return canvas
    return None


def wait_until(predicate, timeout=5.0, interval=0.05, label="condition"):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = predicate()
        if last is not None and not (isinstance(last, dict) and last.get("__pending")):
            return last
        time.sleep(interval)
    raise SystemExit(f"FAIL: timed out waiting for {label}; last={last!r}")

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

menu_drag_probe = show_eval_json(
    f"""(() => {{
      window.__sigilDebug.dispatch({{
        type: 'canvas_message',
        id: {json.dumps(hit_id)},
        payload: {{ source: 'sigil-hit', kind: 'right_mouse_down', screenX: {start_native["x"]}, screenY: {start_native["y"]} }}
      }})
      const opened = window.liveJs.contextMenu?.open === true
      window.__sigilDebug.dispatch({{
        type: 'canvas_message',
        id: {json.dumps(hit_id)},
        payload: {{ source: 'sigil-hit', kind: 'right_mouse_down', screenX: {start_native["x"]}, screenY: {start_native["y"]} }}
      }})
      const stillOpenAfterDuplicate = window.liveJs.contextMenu?.open === true
      window.__sigilDebug.dispatch({{
        type: 'left_mouse_down',
        x: {start_native["x"]},
        y: {start_native["y"]}
      }})
      window.__sigilDebug.dispatch({{
        type: 'left_mouse_dragged',
        x: {target_native["x"]},
        y: {target_native["y"]}
      }})
      const snap = window.__sigilDebug.snapshot()
      return JSON.stringify({{
        opened,
        stillOpenAfterDuplicate,
        menuOpen: window.liveJs.contextMenu?.open === true,
        state: snap.state,
        pointerPos: window.liveJs.pointerPos
      }})
    }})()"""
)
if (
    menu_drag_probe.get("opened") is not True
    or menu_drag_probe.get("stillOpenAfterDuplicate") is not True
    or menu_drag_probe.get("menuOpen") is not False
    or menu_drag_probe.get("state") != "FAST_TRAVEL"
):
    raise SystemExit(f"FAIL: open context menu swallowed avatar drag: {menu_drag_probe}")

show_eval(
    f"""(() => {{
      window.__sigilDebug.dispatch({{
        type: 'left_mouse_up',
        x: {start_native["x"]},
        y: {start_native["y"]}
      }})
      return 'ok'
    }})()"""
)

drag_state = show_eval_json(
    f"""(() => {{
      window.__sigilDebug.dispatch({{
        type: 'left_mouse_down',
        x: {start_native["x"]},
        y: {start_native["y"]}
      }})
      window.__sigilDebug.dispatch({{
        type: 'left_mouse_dragged',
        x: {target_native["x"]},
        y: {target_native["y"]}
      }})
      window.__sigilDebug.dispatch({{
        type: 'canvas_message',
        id: {json.dumps(hit_id)},
        payload: {{ source: 'sigil-hit', kind: 'left_mouse_dragged', screenX: {start_native["x"]}, screenY: {start_native["y"]}, offsetX: 40, offsetY: 40 }}
      }})
      return JSON.stringify({{
        state: window.liveJs.currentState,
        pointerPos: window.liveJs.pointerPos
      }})
    }})()"""
)

if drag_state["state"] != "FAST_TRAVEL":
    raise SystemExit(f"FAIL: expected FAST_TRAVEL after radial handoff, got {drag_state}")
if abs(drag_state["pointerPos"]["x"] - target["x"]) > 1 or abs(drag_state["pointerPos"]["y"] - target["y"]) > 1:
    raise SystemExit(f"FAIL: pointer position did not use drag destination: {drag_state}")

show_eval(
    f"""(() => {{
      window.__sigilDebug.dispatch({{
        type: 'canvas_message',
        id: {json.dumps(hit_id)},
        payload: {{ source: 'sigil-hit', kind: 'left_mouse_up', screenX: {start_native["x"]}, screenY: {start_native["y"]}, offsetX: 40, offsetY: 40 }}
      }})
      window.__sigilDebug.dispatch({{
        type: 'left_mouse_up',
        x: {target_native["x"]},
        y: {target_native["y"]}
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
    label="direct fast travel landing",
)

if hit_id not in canvas_ids():
    raise SystemExit(f"FAIL: hit target disappeared after drag release: {sorted(canvas_ids())}")

hit_canvas = canvas_by_id(hit_id)
if not hit_canvas:
    raise SystemExit(f"FAIL: hit target missing from daemon canvas list after travel")
hit_frame = hit_canvas.get("at") or hit_canvas.get("frame")
if (
    not isinstance(hit_frame, list)
    or len(hit_frame) < 4
    or abs((hit_frame[0] + hit_frame[2] / 2) - target_native["x"]) > 2
    or abs((hit_frame[1] + hit_frame[3] / 2) - target_native["y"]) > 2
    or hit_canvas.get("interactive") is not True
):
    raise SystemExit(f"FAIL: daemon hit target not centered/interactive after travel: canvas={hit_canvas} expected={target_native}")

post_travel_menu = wait_until(
    lambda: (
        lambda probe: probe
        if probe.get("ok") is True
        and probe.get("menuOpen") is True
        and probe.get("hitTargetInteractive") is True
        else None
    )(show_eval_json(
        f"""(() => {{
          const before = window.__sigilDebug.snapshot()
          const frame = before.hitTargetFrame || []
          const center = {{ x: frame[0] + frame[2] / 2, y: frame[1] + frame[3] / 2 }}
          window.__sigilDebug.dispatch({{
            type: 'canvas_message',
            id: {json.dumps(hit_id)},
            payload: {{ source: 'sigil-hit', kind: 'right_mouse_down', screenX: {target_native["x"]}, screenY: {target_native["y"]} }}
          }})
          const after = window.__sigilDebug.snapshot()
          return JSON.stringify({{
            ok: Math.abs(center.x - {target_native["x"]}) <= 2 && Math.abs(center.y - {target_native["y"]}) <= 2,
            menuOpen: window.liveJs.contextMenu?.open === true,
            hitTargetFrame: frame,
            hitTargetCenter: center,
            hitTargetInteractive: before.hitTargetInteractive,
            avatarPos: before.avatarPos,
            state: before.state
          }})
        }})()"""
    )),
    timeout=5.0,
    label="post-travel context menu",
)

show_eval(
    """(() => {
      window.__sigilDebug.dispatch({ type: 'key_down', key_code: 53 })
      return 'ok'
    })()"""
)

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
      window.confirm = () => true
      button.click()
      return JSON.stringify({{
        ok: true,
        fastTravelEffect: window.__sigilDebug.snapshot().fastTravelEffect,
        active: button.classList.contains('active'),
        menuOpen: window.liveJs.contextMenu?.open === true
      }})
    }})()"""
)
if (
    not menu_effect.get("ok")
    or menu_effect.get("fastTravelEffect") != "wormhole"
    or menu_effect.get("active") is not True
    or menu_effect.get("menuOpen") is not False
):
    raise SystemExit(f"FAIL: context menu did not switch fast travel to wormhole: {menu_effect}")

wait_until(
    lambda: (
        lambda state: state
        if state.get("lastSavedFastTravel") == "wormhole"
        and state.get("dirty") is False
        and not state.get("saving")
        and not state.get("lastError")
        else None
    )(show_eval_json("JSON.stringify(window.liveJs.defaultAvatarSave || {})")),
    timeout=5.0,
    label="default avatar fast-travel save",
)

wormhole_started = show_eval_json(
    f"""(() => {{
      window.liveJs.fastTravelEvents = []
      window.state.wormholeCaptureEnabled = false
      window.__sigilDebug.dispatch({{
        type: 'left_mouse_down',
        x: {wormhole_start_native["x"]},
        y: {wormhole_start_native["y"]}
      }})
      window.__sigilDebug.dispatch({{
        type: 'left_mouse_dragged',
        x: {wormhole_target_native["x"]},
        y: {wormhole_target_native["y"]}
      }})
      const gesture = window.__sigilDebug.snapshot().fastTravel?.gesture
      window.__sigilDebug.dispatch({{
        type: 'left_mouse_up',
        x: {wormhole_target_native["x"]},
        y: {wormhole_target_native["y"]}
      }})
      return JSON.stringify({{
        state: window.liveJs.currentState,
        travel: window.liveJs.travel,
        gesture,
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

gesture = wormhole_started.get("gesture")
if not gesture or gesture.get("exitCreated") is not True:
    raise SystemExit(f"FAIL: expected wormhole exit to appear during drag: {wormhole_started}")
if gesture.get("distance", 0) <= gesture.get("exitThreshold", 0):
    raise SystemExit(f"FAIL: wormhole exit appeared before leaving entry footprint: {wormhole_started}")
dx = wormhole_target["x"] - wormhole_start["x"]
dy = wormhole_target["y"] - wormhole_start["y"]
entry_curve = gesture.get("entryCurve") or {}
exit_curve = gesture.get("exitCurve") or {}
entry_dot = (entry_curve.get("x", 0) * dx) + (entry_curve.get("y", 0) * dy)
exit_dot = (exit_curve.get("x", 0) * dx) + (exit_curve.get("y", 0) * dy)
if entry_dot <= 0 or exit_dot >= 0:
    raise SystemExit(f"FAIL: wormhole curves do not oppose correctly: {wormhole_started}")

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
    label="wormhole landing",
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

extended_display = next((display for display in snapshot["displays"] if not display.get("is_main")), None)
extended_landed = None
if extended_display:
    ext_visible = extended_display.get("visibleBounds") or extended_display.get("visible_bounds") or extended_display["bounds"]
    ext_target = {
        "x": int(round(ext_visible["x"] + (ext_visible["w"] * 0.40))),
        "y": int(round(ext_visible["y"] + (ext_visible["h"] * 0.45))),
    }
    ext_start = {
        "x": int(round(wormhole_landed["avatarPos"]["x"])),
        "y": int(round(wormhole_landed["avatarPos"]["y"])),
    }
    ext_start_native = world_to_native(ext_start)
    ext_target_native = world_to_native(ext_target)
    show_eval(
        f"""(() => {{
          window.state.transitionFastTravelEffect = 'line'
          window.__sigilDebug.dispatch({{
            type: 'left_mouse_down',
            x: {ext_start_native["x"]},
            y: {ext_start_native["y"]}
          }})
          window.__sigilDebug.dispatch({{
            type: 'left_mouse_dragged',
            x: {ext_target_native["x"]},
            y: {ext_target_native["y"]}
          }})
          window.__sigilDebug.dispatch({{
            type: 'left_mouse_up',
            x: {ext_target_native["x"]},
            y: {ext_target_native["y"]}
          }})
          return 'ok'
        }})()"""
    )
    extended_landed = wait_until(
        lambda: (
            lambda snap: snap
            if snap["state"] == "IDLE"
            and snap["travel"] is None
            and math.isclose(snap["avatarPos"]["x"], ext_target["x"], abs_tol=1.0)
            and math.isclose(snap["avatarPos"]["y"], ext_target["y"], abs_tol=1.0)
            else {**snap, "__pending": True, "expected": ext_target}
        )(show_eval_json("JSON.stringify(window.__sigilDebug.snapshot())")),
        timeout=5.0,
        label="extended-display direct fast travel landing",
    )
    ext_hit_canvas = canvas_by_id(hit_id)
    ext_hit_frame = ext_hit_canvas.get("at") or ext_hit_canvas.get("frame")
    if (
        not isinstance(ext_hit_frame, list)
        or len(ext_hit_frame) < 4
        or abs((ext_hit_frame[0] + ext_hit_frame[2] / 2) - ext_target_native["x"]) > 2
        or abs((ext_hit_frame[1] + ext_hit_frame[3] / 2) - ext_target_native["y"]) > 2
        or ext_hit_canvas.get("interactive") is not True
    ):
        raise SystemExit(f"FAIL: extended display hit target not centered/interactive: canvas={ext_hit_canvas} expected={ext_target_native}")
    ext_menu = show_eval_json(
        f"""(() => {{
          const frame = window.__sigilDebug.snapshot().hitTargetFrame
          window.__sigilDebug.dispatch({{
            type: 'canvas_message',
            id: {json.dumps(hit_id)},
            payload: {{ source: 'sigil-hit', kind: 'right_mouse_down', screenX: 0, screenY: 0, offsetX: frame[2] / 2, offsetY: frame[3] / 2 }}
          }})
          return JSON.stringify({{
            menuOpen: window.liveJs.contextMenu?.open === true,
            state: window.__sigilDebug.snapshot().state,
            avatarPos: window.__sigilDebug.snapshot().avatarPos
          }})
        }})()"""
    )
    if ext_menu.get("menuOpen") is not True:
        raise SystemExit(f"FAIL: extended display right click did not open context menu with local hit coords: {ext_menu}")

    ext_menu_control = show_eval_json(
        f"""(() => {{
          const pointFor = (selector, ratio = 0.5) => {{
            const el = document.querySelector(selector)
            if (!el) return null
            const rect = el.getBoundingClientRect()
            const dw = window.__sigilDebug.snapshot().surface?.segment?.dw_bounds || [0, 0, 0, 0]
            return {{
              x: dw[0] + rect.left + rect.width * ratio,
              y: dw[1] + rect.top + rect.height / 2,
              rect: {{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
            }}
          }}
          const clickWorld = (point) => {{
            window.__sigilDebug.dispatch({{
              type: 'canvas_message',
              id: {json.dumps(hit_id)},
              payload: {{ source: 'sigil-hit', kind: 'left_mouse_down', screenX: point.x + {native_origin["x"]}, screenY: point.y + {native_origin["y"]} }}
            }})
            window.__sigilDebug.dispatch({{
              type: 'canvas_message',
              id: {json.dumps(hit_id)},
              payload: {{ source: 'sigil-hit', kind: 'left_mouse_up', screenX: point.x + {native_origin["x"]}, screenY: point.y + {native_origin["y"]} }}
            }})
          }}
          const effectsTab = pointFor('[data-ctx-tab="sigil-menu-effects"]')
          if (!effectsTab) return JSON.stringify({{ ok: false, error: 'missing effects tab' }})
          clickWorld(effectsTab)
          const lineButton = pointFor('[data-ctx-open="sigil-menu-line-card"]')
          if (!lineButton) return JSON.stringify({{ ok: false, error: 'missing line settings button' }})
          clickWorld(lineButton)
          const activeId = window.__sigilDebug.snapshot().contextMenu?.stack?.activeId
          const before = window.state.fastTravelLineDuration
          const rangeStart = pointFor('#sigil-menu-line-duration', 0.15)
          const rangeEnd = pointFor('#sigil-menu-line-duration', 0.85)
          if (!rangeStart || !rangeEnd) return JSON.stringify({{ ok: false, error: 'missing line duration range', activeId }})
          window.__sigilDebug.dispatch({{
            type: 'canvas_message',
            id: {json.dumps(hit_id)},
            payload: {{ source: 'sigil-hit', kind: 'left_mouse_down', screenX: rangeStart.x + {native_origin["x"]}, screenY: rangeStart.y + {native_origin["y"]} }}
          }})
          window.__sigilDebug.dispatch({{
            type: 'canvas_message',
            id: {json.dumps(hit_id)},
            payload: {{ source: 'sigil-hit', kind: 'left_mouse_dragged', screenX: rangeEnd.x + {native_origin["x"]}, screenY: rangeEnd.y + {native_origin["y"]} }}
          }})
          window.__sigilDebug.dispatch({{
            type: 'canvas_message',
            id: {json.dumps(hit_id)},
            payload: {{ source: 'sigil-hit', kind: 'left_mouse_up', screenX: rangeEnd.x + {native_origin["x"]}, screenY: rangeEnd.y + {native_origin["y"]} }}
          }})
          const lineCardWasActive = document.querySelector('#sigil-menu-line-card')?.classList.contains('active')
          const back = pointFor('#sigil-menu-line-card [data-ctx-back]')
          if (!back) return JSON.stringify({{ ok: false, error: 'missing line card back button' }})
          clickWorld(back)
          const wormholeButton = pointFor('[data-ctx-open="sigil-menu-wormhole-card"]')
          if (!wormholeButton) return JSON.stringify({{ ok: false, error: 'missing wormhole settings button' }})
          clickWorld(wormholeButton)
          const wormholeCard = document.querySelector('#sigil-menu-wormhole-card')
          const scrollPoint = pointFor('#sigil-menu-wormhole-card')
          const beforeScrollTop = wormholeCard?.scrollTop ?? null
          if (!scrollPoint || !wormholeCard) return JSON.stringify({{ ok: false, error: 'missing wormhole card scroll target' }})
          window.__sigilDebug.dispatch({{
            type: 'canvas_message',
            id: {json.dumps(hit_id)},
            payload: {{ source: 'sigil-hit', kind: 'scroll_wheel', screenX: scrollPoint.x + {native_origin["x"]}, screenY: scrollPoint.y + {native_origin["y"]}, dy: 120 }}
          }})
          return JSON.stringify({{
            ok: true,
            activeId,
            lineCardWasActive,
            before,
            after: window.state.fastTravelLineDuration,
            rangeValue: document.querySelector('#sigil-menu-line-duration')?.value,
            wormholeCardActive: wormholeCard.classList.contains('active'),
            beforeScrollTop,
            afterScrollTop: wormholeCard.scrollTop,
            menuOpen: window.liveJs.contextMenu?.open === true
          }})
        }})()"""
    )
    if (
        ext_menu_control.get("ok") is not True
        or ext_menu_control.get("lineCardWasActive") is not True
        or ext_menu_control.get("wormholeCardActive") is not True
        or ext_menu_control.get("menuOpen") is not True
        or math.isclose(float(ext_menu_control.get("before")), float(ext_menu_control.get("after")), abs_tol=0.001)
        or float(ext_menu_control.get("afterScrollTop", 0)) <= float(ext_menu_control.get("beforeScrollTop", 0))
    ):
        raise SystemExit(f"FAIL: extended display context menu controls did not route through hit target: {ext_menu_control}")

print("PASS", json.dumps({"landed": landed, "wormhole_landed": wormhole_landed, "extended_landed": extended_landed, "hit_id": hit_id}))
PY
