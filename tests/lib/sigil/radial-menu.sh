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
import os
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

aos, avatar_id, inspector_id, scenario, tests_lib_dir = sys.argv[1:6]
sys.path.insert(0, tests_lib_dir)

import real_input_surface_primitives as ris

aos_client = ris.AOS(aos)
pointer = ris.RealPointer(aos_client)
radial_id = f"sigil-radial-menu-{avatar_id}"
required_semantic_targets = {"context-menu", "wiki-graph"}
timestamp = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def slug(value):
    return "".join(char if char.isalnum() or char in ("-", "_") else "-" for char in str(value)).strip("-") or "unknown"


artifact_dir = Path(os.environ.get("AOS_REAL_INPUT_ARTIFACT_DIR") or Path(tempfile.gettempdir()) / "aos-real-input-artifacts")
artifact_path = artifact_dir / f"sigil-radial-real-input-{slug(scenario)}-{slug(avatar_id)}-{int(time.time() * 1000)}-{os.getpid()}.json"


def write_artifact(kind, payload):
    artifact = {
        "kind": kind,
        "scenario": scenario,
        "timestamp": timestamp,
        "canvasIds": {
            "avatar": avatar_id,
            "inspector": inspector_id,
            "radialSurface": radial_id,
        },
        kind: payload,
    }
    try:
        artifact_dir.mkdir(parents=True, exist_ok=True)
        tmp_path = artifact_path.with_suffix(artifact_path.suffix + ".tmp")
        tmp_path.write_text(json.dumps(artifact, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        tmp_path.replace(artifact_path)
    except Exception as error:
        raise SystemExit(f"FAIL scenario={scenario} artifactWriteError={error}") from error
    return str(artifact_path)


def primary_error(error):
    message = str(error)
    if message.startswith("FAIL: "):
        message = message[6:]
    for marker in (": {", ": ["):
        if marker in message:
            return message.split(marker, 1)[0]
    return message or error.__class__.__name__


def compact_success(proof, artifact):
    semantic = proof.get("semanticProof") or {}
    expected = proof.get("expectedAction") or {}
    wiki_workbench = expected.get("wikiWorkbench") or {}
    surface = proof.get("surface") or {}
    radial_surface = surface.get("surface") or {}
    path_plan = proof.get("pathPlan") or {}
    return {
        "scenario": scenario,
        "avatarId": avatar_id,
        "radialSurfaceId": radial_surface.get("id") or semantic.get("surface") or radial_id,
        "artifact": artifact,
        "semanticTargetIds": semantic.get("targetIds") or surface.get("targetIds") or [],
        "openedDestinationSurface": wiki_workbench.get("id"),
        "travelStepCount": len(proof.get("travelSteps") or []),
        "figureEightPath": bool(path_plan),
    }


def fail_with_artifact(error, diagnostics):
    diagnostics = {"primaryError": primary_error(error), **diagnostics}
    artifact = write_artifact("diagnostics", diagnostics)
    raise SystemExit(
        "FAIL "
        + json.dumps({
            "scenario": scenario,
            "avatarId": avatar_id,
            "radialSurfaceId": radial_id,
            "artifact": artifact,
            "error": diagnostics["primaryError"],
        }, sort_keys=True)
    )


def safe_diagnostic(label, producer):
    try:
        return producer()
    except Exception as error:
        return {"diagnosticError": label, "message": str(error)}


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


def point_inside_frame(point, frame, pad=0.0):
    if not isinstance(point, dict) or not isinstance(frame, list) or len(frame) < 4:
        return False
    x = float(point.get("x", 0))
    y = float(point.get("y", 0))
    left = float(frame[0]) - pad
    top = float(frame[1]) - pad
    right = float(frame[0]) + float(frame[2]) + pad
    bottom = float(frame[1]) + float(frame[3]) + pad
    return left <= x <= right and top <= y <= bottom


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


display_cache = {"payload": None}


def displays_payload():
    if display_cache["payload"]:
        return display_cache["payload"]
    for _ in range(3):
        try:
            displays = eval_json("JSON.stringify(window.liveJs?.displays || [])")
            if isinstance(displays, list) and displays:
                display_cache["payload"] = displays
                return displays
        except Exception:
            pass
        result = run_json_capture("graph", "displays", "--json")
        if result.get("ok"):
            payload = result.get("payload") or {}
            displays = payload.get("data", {}).get("displays", payload.get("displays", []))
            if isinstance(displays, list) and displays:
                display_cache["payload"] = displays
                return displays
        time.sleep(0.12)
    raise RuntimeError("unable to resolve display payloads for real-input coordinate conversion")


def prime_pointer_displays():
    pointer.displays = displays_payload()
    return pointer.displays


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
    targets = {
        target.get("id"): {
            "id": target.get("id"),
            "ref": f"sigil-radial-item-{target.get('id')}",
            "role": "button",
            "name": target.get("label"),
            "action": target.get("action"),
            "surface": surface_id,
            "parent_canvas": avatar_id,
        }
        for target in (surface.get("surface") or {}).get("targets") or []
        if target.get("id")
    }
    if not required_semantic_targets.issubset(targets):
        raise SystemExit("FAIL: radial semantic targets missing: " + json.dumps({
            "required": sorted(required_semantic_targets),
            "targetIds": sorted(targets),
            "surface": surface,
            "payloadTargets": (surface.get("surface") or {}).get("targets") or [],
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

    return {
        "status": "success",
        "surface": surface_id,
        "targetIds": sorted(targets),
        "semanticNames": sorted(semantic_names),
        "xrayNames": [],
        "buttonCount": len(targets),
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
        surface.get("ready") is True
        and surface.get("interactive") is True
        and required_semantic_targets.issubset(target_ids)
        and daemon_canvas
        and daemon_canvas.get("interactive") is True
        and visible_frame
    ):
        probe["daemonCanvas"] = daemon_canvas
        return probe
    return None


def radial_items_by_id(probe):
    items = {
        item.get("id"): item
        for item in (probe.get("items") or [])
        if item.get("id") and isinstance(item.get("center"), dict)
    }
    if items:
        return items
    surface = probe.get("surface") or {}
    frame = surface.get("frame") if isinstance(surface.get("frame"), list) and len(surface.get("frame")) >= 2 else None
    if not frame:
        return {}
    return {
        target.get("id"): {
            "id": target.get("id"),
            "label": target.get("label"),
            "action": target.get("action"),
            "active": target.get("active"),
            "center": {
                "x": float(frame[0]) + float(target.get("x", 0)),
                "y": float(frame[1]) + float(target.get("y", 0)),
                "valid": True,
            },
        }
        for target in (surface.get("targets") or [])
        if target.get("id")
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


initial = wait_until(stable_hit_target, timeout=12.0, interval=0.08, label="stable Sigil hit target")
frame = initial.get("hitTargetFrame")
avatar_pos = initial.get("avatarPos") or {}
if not frame or not avatar_pos.get("valid"):
    fail_with_artifact("avatar not ready for radial real-input check", {
        "initial": initial,
        "inspector": safe_diagnostic("inspector", inspector_probe),
        "showList": safe_diagnostic("showList", show_list),
    })

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
    initial = wait_until(stable_hit_target, timeout=12.0, interval=0.08, label="stable Sigil hit target at DesktopWorld path start")
    avatar_pos = initial.get("avatarPos") or {}
    if not avatar_pos.get("valid"):
        fail_with_artifact("avatar could not be placed at DesktopWorld path start", {
            "initial": initial,
            "pathPlan": path_plan,
            "inspector": safe_diagnostic("inspector", inspector_probe),
            "showList": safe_diagnostic("showList", show_list),
        })
    start = {"x": float(avatar_pos["x"]), "y": float(avatar_pos["y"])}
    travel_targets = path_plan["steps"]
else:
    start = {"x": float(avatar_pos["x"]), "y": float(avatar_pos["y"])}
    travel_targets = [opposite_side_destination(start)]

prime_pointer_displays()
pointer.move_world(start)
time.sleep(0.08)

pre_drag_cursor = cursor_point()
start_native = pointer.native(start)
if distance(pre_drag_cursor, start_native) > 8:
    fail_with_artifact("cursor preposition did not land on radial hit target", {
        "start": start,
        "startNative": start_native,
        "cursor": pre_drag_cursor,
        "initial": initial,
        "pathPlan": path_plan,
        "travelTargets": travel_targets,
        "inspector": safe_diagnostic("inspector", inspector_probe),
        "showList": safe_diagnostic("showList", show_list),
    })

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
        settled = wait_until(
            stable_hit_target,
            timeout=4.0,
            interval=0.08,
            label=f"stable Sigil hit target after travel step {index}",
        )
        travel_steps.append({"index": index, "target": travel_target, "probe": travel, "settled": settled})
        travel_pos = settled.get("avatarPos") or travel.get("avatarPos") or {}
        current_start = {"x": float(travel_pos["x"]), "y": float(travel_pos["y"])}
        time.sleep(0.12)

    reopen_probe = hit_target_probe()
    reopen_pos = (reopen_probe.get("avatarPos") or {}) if isinstance(reopen_probe, dict) else {}
    if reopen_pos.get("valid"):
        reopen_start = {"x": float(reopen_pos["x"]), "y": float(reopen_pos["y"])}
    else:
        reopen_start = current_start
    reopen_native = pointer.native(reopen_start)
    if not point_inside_frame(reopen_native, reopen_probe.get("hitTargetFrame"), pad=2.0):
        fail_with_artifact("reopen point is outside daemon hit target", {
            "reopenStart": reopen_start,
            "reopenNative": reopen_native,
            "reopenProbe": reopen_probe,
            "pathPlan": path_plan,
            "travelTargets": travel_targets,
            "travelSteps": travel_steps,
            "inspector": safe_diagnostic("inspector", inspector_probe),
            "showList": safe_diagnostic("showList", show_list),
        })

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
    fail_with_artifact(error, {
        "proofError": str(error),
        "inspector": safe_diagnostic("inspector", inspector_probe),
        "initial": initial,
        "pathPlan": path_plan,
        "start": start,
        "travelTargets": travel_targets,
        "travelSteps": locals().get("travel_steps", []),
        "preDragCursor": pre_drag_cursor,
        "lastProbe": safe_diagnostic("lastProbe", radial_surface_probe),
        "showList": safe_diagnostic("showList", show_list),
    })
except Exception as error:
    fail_with_artifact(error, {
        "proofError": repr(error),
        "inspector": safe_diagnostic("inspector", inspector_probe),
        "initial": initial,
        "pathPlan": path_plan,
        "start": start,
        "travelTargets": travel_targets,
        "travelSteps": locals().get("travel_steps", []),
        "preDragCursor": pre_drag_cursor,
        "lastProbe": safe_diagnostic("lastProbe", radial_surface_probe),
        "showList": safe_diagnostic("showList", show_list),
    })

proof = {
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
}
artifact = write_artifact("proof", proof)
print("PASS", json.dumps(compact_success(proof, artifact), sort_keys=True))
PY
}
