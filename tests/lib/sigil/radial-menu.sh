#!/usr/bin/env bash

SIGIL_RADIAL_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SIGIL_RADIAL_LIB_DIR/../visual-harness.sh"

aos_sigil_radial_verify_real_input() {
  local avatar_id="${1:-avatar-main}"
  local aos_bin
  aos_bin="$(aos_visual_aos)"

  python3 - "$aos_bin" "$avatar_id" <<'PY'
import json
import os
import subprocess
import sys
import tempfile
import time

aos, avatar_id = sys.argv[1:3]


def run(*args):
    return subprocess.check_output([aos, *args], text=True, stderr=subprocess.STDOUT)


def run_json(*args):
    return json.loads(run(*args))


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


def point_arg(point):
    return f"{round(point['x'])},{round(point['y'])}"


def distance(a, b):
    dx = float(a["x"]) - float(b["x"])
    dy = float(a["y"]) - float(b["y"])
    return (dx * dx + dy * dy) ** 0.5


def cursor_point():
    payload = run_json("see", "cursor")
    cursor = payload.get("cursor") or {}
    return {"x": cursor.get("x", 0), "y": cursor.get("y", 0)}


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
            targetIds: (surface?.targets || []).map((target) => target.id)
          });
        })()"""
    )


def radial_surface_capture(surface_id):
    fd, path = tempfile.mkstemp(prefix="aos-sigil-radial-", suffix=".png")
    os.close(fd)
    try:
        return run_json("see", "capture", "--canvas", surface_id, "--xray", "--out", path)
    finally:
        try:
            os.remove(path)
        except FileNotFoundError:
            pass


def semantic_target_map(payload):
    result = {}
    for target in payload.get("semantic_targets") or []:
        target_id = target.get("id")
        if target_id:
            result[target_id] = target
    return result


def element_names(payload):
    names = []
    for element in payload.get("elements") or []:
        for key in ("title", "label", "value"):
            value = element.get(key)
            if isinstance(value, str) and value:
                names.append(value)
    return names


def verify_radial_semantics(surface):
    surface_id = surface["surface"]["id"]
    payload = radial_surface_capture(surface_id)
    targets = semantic_target_map(payload)
    required = {"context-menu", "wiki-graph"}
    if not required.issubset(targets):
        raise SystemExit("FAIL: radial semantic targets missing: " + json.dumps({
            "required": sorted(required),
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
if not frame:
    raise SystemExit(f"FAIL: avatar not ready for radial real-input check: {initial}")

start = {"x": frame[0] + frame[2] / 2, "y": frame[1] + frame[3] / 2}
target = {"x": start["x"] + 24, "y": start["y"]}

hover = subprocess.run(
    [aos, "do", "hover", point_arg(start)],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
    timeout=8,
)
if hover.returncode != 0:
    raise SystemExit(f"FAIL: cursor preposition failed: {hover.stdout}")

pre_drag_cursor = cursor_point()
if distance(pre_drag_cursor, start) > 8:
    raise SystemExit("FAIL: cursor preposition did not land on radial hit target: " + json.dumps({
        "start": start,
        "cursor": pre_drag_cursor,
        "initial": initial,
        "hover": hover.stdout.strip(),
    }, sort_keys=True))

drag = subprocess.Popen(
    [aos, "do", "drag", point_arg(start), point_arg(target), "--speed", "6"],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
)

surface = None
semantic_proof = None
proof_error = None
stdout = ""
drag_timeout_error = None
drag_timeout = max(6.0, distance(start, target) / 6.0 + 2.0)

try:
    surface = wait_until(
        lambda: (
            lambda probe: probe
            if (
                probe.get("state") == "RADIAL"
                and probe.get("phase") == "radial"
                and (probe.get("surface") or {}).get("ready") is True
                and (probe.get("surface") or {}).get("interactive") is True
                and {"context-menu", "wiki-graph"}.issubset(set(probe.get("targetIds") or []))
                and (probe.get("visuals") or {}).get("visible") is True
            )
            else None
        )(radial_surface_probe()),
        timeout=4.0,
        interval=0.08,
        label="AOS radial menu target surface",
    )
    semantic_proof = verify_radial_semantics(surface)
except SystemExit as error:
    proof_error = str(error)
finally:
    try:
        stdout, _ = drag.communicate(timeout=drag_timeout)
    except subprocess.TimeoutExpired:
        drag.kill()
        stdout, _ = drag.communicate()
        drag_timeout_error = f"real drag did not finish within {drag_timeout:.1f}s"

diagnostics = {
    "initial": initial,
    "surface": surface,
    "semanticProof": semantic_proof,
    "start": start,
    "target": target,
    "preDragCursor": pre_drag_cursor,
    "hover": hover.stdout.strip(),
    "drag": stdout.strip(),
    "lastProbe": radial_surface_probe(),
}

if proof_error:
    diagnostics["proofError"] = proof_error
    raise SystemExit("FAIL: radial semantic proof failed: " + json.dumps(diagnostics, sort_keys=True))
if drag_timeout_error:
    diagnostics["dragTimeoutError"] = drag_timeout_error
    raise SystemExit("FAIL: real drag did not finish cleanly: " + json.dumps(diagnostics, sort_keys=True))
if drag.returncode != 0:
    diagnostics["dragReturnCode"] = drag.returncode
    raise SystemExit("FAIL: real drag command failed: " + json.dumps(diagnostics, sort_keys=True))

try:
    drag_payload = json.loads(stdout) if stdout.strip().startswith("{") else stdout.strip()
except json.JSONDecodeError:
    drag_payload = stdout.strip()

print("PASS", json.dumps({
    "initial": initial,
    "surface": surface,
    "semanticProof": semantic_proof,
    "preDragCursor": pre_drag_cursor,
    "drag": drag_payload,
}, sort_keys=True))
PY
}
