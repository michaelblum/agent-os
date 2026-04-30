#!/usr/bin/env bash

SIGIL_RADIAL_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SIGIL_RADIAL_LIB_DIR/../visual-harness.sh"

aos_sigil_radial_verify_brain_real_input() {
  local avatar_id="${1:-avatar-main}"
  local aos_bin
  aos_bin="$(aos_visual_aos)"

  python3 - "$aos_bin" "$avatar_id" <<'PY'
import json
import subprocess
import sys
import time

aos, avatar_id = sys.argv[1:3]


def run(*args):
    return subprocess.check_output([aos, *args], text=True, stderr=subprocess.STDOUT)


def eval_json(js):
    payload = json.loads(run("show", "eval", "--id", avatar_id, "--js", js))
    if payload.get("status") != "success":
        raise SystemExit(f"FAIL: show eval failed: {payload}")
    return json.loads(payload.get("result") or "null")


def wait_until(predicate, timeout=8.0, interval=0.08, label="condition"):
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


def run_json(*args):
    return json.loads(run(*args))


def cursor_point():
    payload = run_json("see", "cursor")
    cursor = payload.get("cursor") or {}
    return {"x": cursor.get("x", 0), "y": cursor.get("y", 0)}


def brain_probe():
    return eval_json(
        """(() => {
          const snap = window.__sigilDebug?.snapshot?.() || {};
          const items = window.state?.radialGestureMenu?.items || [];
          const wikiItem = items.find((item) => item.id === 'wiki-graph');
          const scene = window.state?.scene;
          const composite = scene?.getObjectByName?.('wiki-brain-composite') || null;
          const modelHost = scene?.getObjectByName?.('wiki-brain-model-host') || null;
          const treeHost = scene?.getObjectByName?.('wiki-brain-tree-host') || null;
          return JSON.stringify({
            state: snap.state || null,
            phase: snap.radialGestureMenu?.phase || null,
            visuals: snap.radialGestureVisuals || null,
            wikiGeometry: wikiItem?.geometry || null,
            compositeVisible: composite?.visible ?? null,
            modelChildren: modelHost?.children?.length ?? null,
            treeChildren: treeHost?.children?.length ?? null,
            treeVisible: treeHost?.visible ?? null
          });
        })()"""
    )


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
        surface,
        targetIds: (surface?.targets || []).map((target) => target.id)
      });
    })()"""
    )


def radial_surface_xray(surface_id):
    payload = run_json("see", "capture", "--canvas", surface_id, "--xray")
    elements = payload.get("elements") or []
    names = []
    for element in elements:
        for key in ("title", "label", "value"):
            value = element.get(key)
            if isinstance(value, str) and value:
                names.append(value)
    return {
        "status": payload.get("status"),
        "canvas": surface_id,
        "names": names,
        "buttonCount": sum(1 for element in elements if element.get("role") == "AXButton"),
        "elements": elements,
    }


eval_json("window.__sigilDebug?.armInteractionTrace?.('radial-brain-real-input'); JSON.stringify(true)")

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


initial = wait_until(stable_hit_target, timeout=6.0, interval=0.08, label="stable radial hit target")
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
    raise SystemExit(json.dumps({
        "status": "FAIL",
        "message": "cursor preposition did not land on radial hit target",
        "start": start,
        "cursor": pre_drag_cursor,
        "initial": initial,
        "hover": hover.stdout.strip(),
    }, sort_keys=True))

# Use a slow short real drag so the radial menu remains observable while the
# mouse is physically held down by AOS. The cursor is prepositioned first so
# this action is only the intentional press/drag/release, not the cross-display
# travel from wherever the user's cursor happened to be.
drag = subprocess.Popen(
    [aos, "do", "drag", point_arg(start), point_arg(target), "--speed", "6"],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
)

surface = wait_until(
    lambda: (
        lambda probe: probe
        if (
            probe.get("state") == "RADIAL"
            and probe.get("phase") == "radial"
            and (probe.get("surface") or {}).get("ready") is True
            and (probe.get("surface") or {}).get("interactive") is True
            and "wiki-graph" in (probe.get("targetIds") or [])
        )
        else None
    )(radial_surface_probe()),
    timeout=4.0,
    interval=0.08,
    label="AOS radial menu target surface",
)

surface_xray = radial_surface_xray(surface["surface"]["id"])
surface_names = " ".join(surface_xray.get("names") or [])
if surface_xray.get("buttonCount", 0) < 2 or "Context Menu" not in surface_names or "Wiki Graph" not in surface_names:
    raise SystemExit("FAIL: aos see could not discover radial menu item buttons: " + json.dumps({
        "surface": surface,
        "xray": surface_xray,
    }, sort_keys=True))
if "Sigil radial item:" in surface_names:
    raise SystemExit("FAIL: radial menu item AX labels should be command names only: " + json.dumps({
        "surface": surface,
        "xray": surface_xray,
    }, sort_keys=True))
if "Sigil radial menu" not in surface_names:
    raise SystemExit("FAIL: radial menu AX group context missing: " + json.dumps({
        "surface": surface,
        "xray": surface_xray,
    }, sort_keys=True))

proof = None
proof_error = None
stdout = ""
drag_timeout_error = None
drag_timeout = max(6.0, distance(start, target) / 6.0 + 2.0)

try:
    proof = wait_until(
        lambda: (
            lambda probe: probe
            if (
                probe.get("state") == "RADIAL"
                and probe.get("phase") == "radial"
                and probe.get("visuals", {}).get("visible") is True
                and "wiki-graph" in (probe.get("visuals", {}).get("itemIds") or [])
                and (probe.get("visuals", {}).get("scales") or {}).get("wiki-graph", 0) > 0
                and ((probe.get("wikiGeometry") or {}).get("src") or "").endswith("/human-brain/scene.gltf")
                and probe.get("compositeVisible") is True
                and (probe.get("modelChildren") or 0) > 0
                and (probe.get("treeChildren") or 0) > 0
            )
            else None
        )(brain_probe()),
        label="radial wiki brain visual under real drag",
    )
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
    "surfaceXray": surface_xray,
    "start": start,
    "target": target,
    "preDragCursor": pre_drag_cursor,
    "hover": hover.stdout.strip(),
    "drag": stdout.strip(),
    "lastProbe": brain_probe(),
}

if proof_error:
    diagnostics["proofError"] = proof_error
    raise SystemExit("FAIL: radial brain proof failed: " + json.dumps(diagnostics, sort_keys=True))
if drag_timeout_error:
    diagnostics["dragTimeoutError"] = drag_timeout_error
    raise SystemExit("FAIL: real drag did not finish cleanly: " + json.dumps(diagnostics, sort_keys=True))
if drag.returncode != 0:
    diagnostics["dragReturnCode"] = drag.returncode
    raise SystemExit("FAIL: real drag command failed: " + json.dumps(diagnostics, sort_keys=True))

print("PASS", json.dumps({
    "initial": initial,
    "surface": surface,
    "surfaceXray": {
        "buttonCount": surface_xray.get("buttonCount"),
        "names": surface_xray.get("names"),
    },
    "proof": proof,
    "preDragCursor": pre_drag_cursor,
    "drag": json.loads(stdout) if stdout.strip().startswith("{") else stdout.strip(),
}))
PY
}
