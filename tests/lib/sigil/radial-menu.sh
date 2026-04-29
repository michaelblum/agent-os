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


initial = eval_json(
    """(() => {
      window.__sigilDebug?.armInteractionTrace?.('radial-brain-real-input');
      const snap = window.__sigilDebug?.snapshot?.() || {};
      return JSON.stringify({
        avatarVisible: snap.avatarVisible,
        hitTargetReady: snap.hitTargetReady,
        hitTargetInteractive: snap.hitTargetInteractive,
        hitTargetFrame: snap.hitTargetFrame,
        avatarPos: snap.avatarPos
      });
    })()"""
)
frame = initial.get("hitTargetFrame")
if not initial.get("avatarVisible") or not initial.get("hitTargetReady") or not frame:
    raise SystemExit(f"FAIL: avatar not ready for radial real-input check: {initial}")

start = {"x": frame[0] + frame[2] / 2, "y": frame[1] + frame[3] / 2}
target = {"x": start["x"] + 24, "y": start["y"]}

# Use a slow real drag so the radial menu remains observable while the mouse is
# physically held down by AOS. This avoids synthetic dispatch for the behavior
# under test, while still letting the agent query structured state mid-gesture.
drag = subprocess.Popen(
    [aos, "do", "drag", point_arg(start), point_arg(target), "--speed", "6"],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
)

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
finally:
    try:
        stdout, _ = drag.communicate(timeout=3)
    except subprocess.TimeoutExpired:
        drag.kill()
        stdout, _ = drag.communicate()
        raise SystemExit(f"FAIL: real drag did not finish cleanly: {stdout}")

if drag.returncode != 0:
    raise SystemExit(f"FAIL: real drag command failed: {stdout}")

print("PASS", json.dumps({
    "initial": initial,
    "proof": proof,
    "drag": json.loads(stdout) if stdout.strip().startswith("{") else stdout.strip(),
}))
PY
}
