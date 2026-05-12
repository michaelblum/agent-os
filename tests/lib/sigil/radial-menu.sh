#!/usr/bin/env bash

SIGIL_RADIAL_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SIGIL_RADIAL_LIB_DIR/../real-input-surface-harness.sh"

aos_sigil_radial_verify_real_input() {
  local avatar_id="${1:-avatar-main}"
  local inspector_id="${2:-surface-inspector}"
  local scenario="${3:-base}"
  local aos_bin
  aos_bin="$(aos_visual_aos)"

  python3 - "$aos_bin" "$avatar_id" "$inspector_id" "$scenario" "$SIGIL_RADIAL_LIB_DIR/.." <<'PY'
import json
import sys
import time

aos, avatar_id, inspector_id, scenario, tests_lib_dir = sys.argv[1:6]
sys.path.insert(0, tests_lib_dir)

import real_input_surface_primitives as ris

aos_client = ris.AOS(aos)
pointer = ris.RealPointer(aos_client)
radial_id = f"sigil-radial-menu-{avatar_id}"
required_semantic_targets = {"context-menu", "wiki-graph"}


def run(*args):
    return aos_client.run(*args)


def run_json(*args):
    return json.loads(run(*args))


def run_json_capture(*args):
    return aos_client.run_json_capture(*args)


def eval_json(js):
    payload = run_json("show", "eval", "--id", avatar_id, "--js", js)
    if payload.get("status") != "success":
        raise SystemExit(f"FAIL: show eval failed: {payload}")
    return json.loads(payload.get("result") or "null")


def wait_until(predicate, timeout=6.0, interval=0.08, label="condition"):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = predicate()
        if last is not None:
            return last
        time.sleep(interval)
    raise SystemExit(f"FAIL: timed out waiting for {label}; last={last!r}")


def distance(a, b):
    dx = float(a["x"]) - float(b["x"])
    dy = float(a["y"]) - float(b["y"])
    return (dx * dx + dy * dy) ** 0.5


def cursor_point():
    payload = run_json("see", "cursor")
    cursor = payload.get("cursor") or {}
    return {"x": cursor.get("x", 0), "y": cursor.get("y", 0)}


def show_list():
    return run_json("show", "list")


def canvas_info(canvas_id):
    result = run_json_capture("show", "get", "--id", canvas_id)
    if not result.get("ok"):
        return {"error": result}
    return result.get("payload", {}).get("canvas")


def inspector_probe():
    canvas = canvas_info(inspector_id)
    ui = run_json_capture(
        "show", "eval", "--id", inspector_id, "--js",
        """(() => JSON.stringify({
          visible: document.visibilityState === 'visible',
          rows: document.querySelectorAll('.tree-row.canvas').length,
          minimap: !!document.querySelector('.minimap-display'),
          ready: !!window.__canvasInspectorState
        }))()""",
    )
    parsed_ui = None
    if ui.get("ok"):
        try:
            parsed_ui = json.loads(ui["payload"].get("result") or "null")
        except Exception as error:
            parsed_ui = {"error": str(error), "payload": ui.get("payload")}
    return {"id": inspector_id, "canvas": canvas, "ui": parsed_ui or ui}


def displays_payload():
    try:
        displays = eval_json("JSON.stringify(window.liveJs?.displays || [])")
        if isinstance(displays, list) and displays:
            return displays
    except Exception:
        pass
    payload = run_json("graph", "displays", "--json")
    return payload.get("data", {}).get("displays", payload.get("displays", []))


def canvas_frame(canvas):
    if not isinstance(canvas, dict):
        return None
    frame = canvas.get("at") or canvas.get("frame")
    return frame[:4] if isinstance(frame, list) and len(frame) >= 4 else None


def hit_target_probe():
    return eval_json(
        """(() => {
          const snap = window.__sigilDebug?.snapshot?.() || {};
          return JSON.stringify({
            avatarVisible: snap.avatarVisible,
            hitTargetReady: snap.hitTargetReady,
            hitTargetInteractive: snap.hitTargetInteractive,
            hitTargetFrame: snap.hitTargetFrame,
            avatarPos: snap.avatarPos,
            state: snap.state || null
          });
        })()"""
    )


def radial_surface_probe():
    return eval_json(
        """(() => {
          const snap = window.__sigilDebug?.snapshot?.() || {};
          const surface = snap.radialTargetSurface || null;
          return JSON.stringify({
            state: snap.state || null,
            phase: snap.radialGestureMenu?.phase || null,
            visuals: snap.radialGestureVisuals || null,
            surface,
            targetIds: (surface?.targets || []).map((target) => target.id),
            items: (snap.radialGestureMenu?.items || []).map((item) => ({
              id: item.id,
              label: item.label,
              action: item.action,
              center: item.center,
              active: item.active
            })),
            trace: window.__sigilDebug?.interactionTrace?.() || null
          });
        })()"""
    )


def radial_surface_capture(surface_id):
    return ris.capture_xray(aos_client, surface_id, lambda: {
        "surfaceCanvas": canvas_info(surface_id),
        "showList": show_list(),
        "lastProbe": radial_surface_probe(),
        "inspector": inspector_probe(),
    })


def semantic_target_map(payload):
    return ris.semantic_target_map(payload)


def element_names(payload):
    return ris.element_names(payload)


def verify_radial_semantics(surface):
    surface_id = surface["surface"]["id"]
    payload = radial_surface_capture(surface_id)
    targets = semantic_target_map(payload)
    if not required_semantic_targets.issubset(targets):
        raise SystemExit("FAIL: radial semantic targets missing: " + json.dumps({
            "required": sorted(required_semantic_targets),
            "targetIds": sorted(targets),
            "surface": surface,
            "payloadTargets": payload.get("semantic_targets") or [],
        }, sort_keys=True))

    context = targets["context-menu"]
    wiki = targets["wiki-graph"]
    assertions = [
        (context.get("ref") == "sigil-radial-item-context-menu", "context menu ref", context),
        (context.get("role") == "button", "context menu role", context),
        (context.get("name") == "Context Menu", "context menu name", context),
        (context.get("action") == "contextMenu", "context menu action", context),
        (context.get("surface") == surface_id, "context menu surface", context),
        (context.get("parent_canvas") == avatar_id, "context menu parent", context),
        (wiki.get("ref") == "sigil-radial-item-wiki-graph", "wiki graph ref", wiki),
        (wiki.get("role") == "button", "wiki graph role", wiki),
        (wiki.get("name") == "Wiki Graph", "wiki graph name", wiki),
        (wiki.get("surface") == surface_id, "wiki graph surface", wiki),
        (wiki.get("parent_canvas") == avatar_id, "wiki graph parent", wiki),
    ]
    for ok, label, target in assertions:
        if not ok:
            raise SystemExit(f"FAIL: radial semantic target failed {label}: " + json.dumps(target, sort_keys=True))

    semantic_names = [target.get("name") for target in targets.values() if isinstance(target.get("name"), str)]
    if any(name.startswith("Sigil radial item:") for name in semantic_names):
        raise SystemExit("FAIL: radial item semantic names should be command names only: " + json.dumps(semantic_names))

    names = element_names(payload)
    return {
        "status": payload.get("status"),
        "surface": surface_id,
        "targetIds": sorted(targets),
        "semanticNames": sorted(semantic_names),
        "xrayNames": names,
        "buttonCount": sum(1 for element in payload.get("elements") or [] if element.get("role") == "AXButton"),
    }


def radial_surface_observable_probe():
    probe = radial_surface_probe()
    surface = probe.get("surface") or {}
    surface_id = surface.get("id") or radial_id
    daemon_canvas = canvas_info(surface_id)
    daemon_frame = canvas_frame(daemon_canvas)
    target_ids = set(probe.get("targetIds") or [])
    visible_frame = ris.native_rect_intersects_visible_display(daemon_frame or surface.get("frame"), displays_payload())
    if (
        probe.get("state") == "RADIAL"
        and probe.get("phase") == "radial"
        and surface.get("ready") is True
        and surface.get("interactive") is True
        and required_semantic_targets.issubset(target_ids)
        and (probe.get("visuals") or {}).get("visible") is True
        and daemon_canvas
        and daemon_canvas.get("interactive") is True
        and visible_frame
    ):
        probe["daemonCanvas"] = daemon_canvas
        return probe
    return None


def radial_items_by_id(probe):
    return {
        item.get("id"): item
        for item in (probe.get("items") or [])
        if item.get("id") and isinstance(item.get("center"), dict)
    }


def wait_wiki_workbench_open():
    return wait_until(
        lambda: (
            lambda canvas: canvas
            if isinstance(canvas, dict) and canvas.get("id") == "sigil-wiki-workbench" and canvas.get("interactive") is True
            else None
        )(canvas_info("sigil-wiki-workbench")),
        timeout=8.0,
        interval=0.08,
        label="wiki workbench opened by radial release",
    )


def close_context_menu():
    try:
        eval_json("window.__sigilDebug?.dispatch?.({ type: 'key_down', key_code: 53 }); JSON.stringify(true)")
    except Exception:
        pass


def opposite_side_destination(point):
    return ris.opposite_visible_display_point(point, displays_payload(), pad=260)


def confirm_avatar_travel(prior_start, destination, label="avatar travel after fast-travel drag"):
    def probe():
        hit = hit_target_probe()
        center = hit.get("avatarPos")
        if not center or not center.get("valid"):
            return None
        if distance(center, prior_start) < 120:
            return None
        if distance(center, destination) > 220:
            return None
        hit["center"] = center
        return hit
    return wait_until(probe, timeout=10.0, interval=0.1, label=label)


eval_json("window.__sigilDebug?.armInteractionTrace?.('radial-real-input-harness'); JSON.stringify(true)")

last_stable = {"probe": None, "count": 0}


def stable_hit_target():
    probe = hit_target_probe()
    frame = probe.get("hitTargetFrame")
    if not probe.get("avatarVisible") or not probe.get("hitTargetReady") or not probe.get("hitTargetInteractive") or not frame:
        last_stable["probe"] = probe
        last_stable["count"] = 0
        return None

    previous = (last_stable.get("probe") or {}).get("hitTargetFrame")
    if previous and all(abs(float(frame[i]) - float(previous[i])) <= 1.0 for i in range(4)):
        last_stable["count"] += 1
    else:
        last_stable["count"] = 1
    last_stable["probe"] = probe
    if last_stable["count"] >= 4:
        return probe
    return None


initial = wait_until(stable_hit_target, timeout=6.0, interval=0.08, label="stable Sigil hit target")
frame = initial.get("hitTargetFrame")
avatar_pos = initial.get("avatarPos") or {}
if not frame or not avatar_pos.get("valid"):
    raise SystemExit(f"FAIL: avatar not ready for radial real-input check: {initial}")

path_plan = None
if scenario in ("desktop-world-path", "figure-eight"):
    path_plan = ris.desktop_world_figure_eight_path(displays_payload(), radial_menu_radius=260, min_span=240)
    if path_plan.get("skipped"):
        print("SKIP: " + path_plan.get("reason", "no usable DesktopWorld figure-eight path"))
        raise SystemExit(77)
    eval_json("window.__sigilDebug?.dispatch?.({ type: 'sigil.set_position', x: %s, y: %s }); JSON.stringify(true)" % (
        json.dumps(path_plan["points"][0]["x"]),
        json.dumps(path_plan["points"][0]["y"]),
    ))
    initial = wait_until(stable_hit_target, timeout=6.0, interval=0.08, label="stable Sigil hit target at DesktopWorld path start")
    avatar_pos = initial.get("avatarPos") or {}
    if not avatar_pos.get("valid"):
        raise SystemExit(f"FAIL: avatar could not be placed at DesktopWorld path start: {initial}")
    start = {"x": float(avatar_pos["x"]), "y": float(avatar_pos["y"])}
    travel_targets = path_plan["steps"]
else:
    start = {"x": float(avatar_pos["x"]), "y": float(avatar_pos["y"])}
    travel_targets = [opposite_side_destination(start)]

pointer.move_world(start)
time.sleep(0.08)

pre_drag_cursor = cursor_point()
start_native = pointer.native(start)
if distance(pre_drag_cursor, start_native) > 8:
    raise SystemExit("FAIL: cursor preposition did not land on radial hit target: " + json.dumps({
        "start": start,
        "startNative": start_native,
        "cursor": pre_drag_cursor,
        "initial": initial,
        "inspector": inspector_probe(),
    }, sort_keys=True))

try:
    travel_steps = []
    current_start = start
    for index, travel_target in enumerate(travel_targets, start=1):
        pointer.drag_path_world([current_start, travel_target], segment_duration=0.9, hold=0.05)
        travel = confirm_avatar_travel(
            current_start,
            travel_target,
            label=f"avatar travel step {index} to {travel_target.get('id', 'target')}",
        )
        travel_steps.append({"index": index, "target": travel_target, "probe": travel})
        travel_pos = travel.get("avatarPos") or {}
        current_start = {"x": float(travel_pos["x"]), "y": float(travel_pos["y"])}
        time.sleep(0.12)

    travel_pos = travel.get("avatarPos") or {}
    reopen_start = {"x": float(travel_pos["x"]), "y": float(travel_pos["y"])}
    reopen_probe = hit_target_probe()

    pointer.down_world(reopen_start)
    radial_probe = None
    semantic_proof = None
    expected_action = None
    last_point = reopen_start
    try:
        away = {"x": reopen_start["x"] + 34, "y": reopen_start["y"]}
        back = {"x": reopen_start["x"] + 12, "y": reopen_start["y"]}
        zone = {"x": reopen_start["x"] + 44, "y": reopen_start["y"]}
        last_point = pointer.drag_world(last_point, away, duration=0.22, hold=0.08)
        last_point = pointer.drag_world(last_point, back, duration=0.18, hold=0.08)
        last_point = pointer.drag_world(last_point, zone, duration=0.24, hold=0.12)

        radial_probe = wait_until(radial_surface_observable_probe, timeout=4.0, interval=0.08, label="daemon-observable AOS radial menu target surface")
        semantic_proof = verify_radial_semantics(radial_probe)

        items = radial_items_by_id(radial_probe)
        missing_items = [item_id for item_id in ("agent-terminal", "wiki-graph", "context-menu") if item_id not in items]
        if missing_items:
            raise SystemExit("FAIL: radial menu did not expose expected item centers: " + json.dumps({"missing": missing_items, "probe": radial_probe}, sort_keys=True))

        for item_id in ("context-menu", "agent-terminal", "wiki-graph"):
            center = items[item_id]["center"]
            last_point = pointer.drag_world(last_point, center, duration=0.34, hold=0.16)
        pointer.up_world(last_point)
        expected_action = {"wikiWorkbench": wait_wiki_workbench_open()}
    finally:
        if expected_action is None:
            try:
                pointer.up_world(last_point)
            except Exception:
                pass
        close_context_menu()
except SystemExit as error:
    diagnostics = {
        "proofError": str(error),
        "inspector": inspector_probe(),
        "initial": initial,
        "pathPlan": path_plan,
        "start": start,
        "travelTargets": travel_targets,
        "travelSteps": locals().get("travel_steps", []),
        "preDragCursor": pre_drag_cursor,
        "lastProbe": radial_surface_probe(),
        "showList": show_list(),
    }
    raise SystemExit("FAIL: radial semantic proof failed: " + json.dumps(diagnostics, sort_keys=True))

print("PASS", json.dumps({
    "inspector": inspector_probe(),
    "initial": initial,
    "travel": travel,
    "travelSteps": travel_steps,
    "reopen": reopen_probe,
    "pathPlan": path_plan,
    "surface": radial_probe,
    "semanticProof": semantic_proof,
    "preDragCursor": pre_drag_cursor,
    "expectedAction": expected_action,
}, sort_keys=True))
PY
}
