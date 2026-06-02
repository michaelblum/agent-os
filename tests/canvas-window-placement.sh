#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-canvas-window-placement"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

aos_test_start_daemon "$ROOT" toolkit packages/toolkit \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }
DAEMON_PID="$(aos_test_wait_for_lock_pid "$ROOT")" || { echo "FAIL: isolated daemon lock pid did not appear"; exit 1; }

TARGET_JSON="$(python3 - <<'PY'
import json
import subprocess

graph = json.loads(subprocess.check_output(["./aos", "graph", "displays"], text=True))
displays = graph.get("data", {}).get("displays", graph.get("displays", []))
display = next((display for display in displays if display.get("is_main")), displays[0] if displays else None)
if display is None:
    raise SystemExit(1)

visible = display.get("native_visible_bounds") or display.get("visible_bounds") or display.get("bounds")
if visible is None:
    visible = display["bounds"]
width = 320
height = 220
requested_x = int(visible["x"] + visible["w"] - 100)
requested_y = int(visible["y"] + 80)
final_x = int(visible["x"] + visible["w"] - width)
final_y = requested_y
print(json.dumps({
    "requested": {"x": requested_x, "y": requested_y, "w": width, "h": height},
    "final": {"x": final_x, "y": final_y, "w": width, "h": height},
}))
PY
)" || {
  echo "SKIP: requires display geometry"
  exit 0
}

TARGET_AT="$(python3 - "$TARGET_JSON" <<'PY'
import json
import sys

target = json.loads(sys.argv[1])["requested"]
print(f"{target['x']},{target['y']},{target['w']},{target['h']}")
PY
)"

./aos show create \
  --id placement-smoke \
  --at "$TARGET_AT" \
  --interactive \
  --focus \
  --url aos://toolkit/components/aos-action-demo/index.html >/dev/null

./aos show wait --id placement-smoke --manifest aos-action-demo --timeout 5s >/dev/null

python3 - "$DAEMON_PID" "$TARGET_JSON" <<'PY'
import json
import subprocess
import sys
import time

from Quartz import (
    CGWindowListCopyWindowInfo,
    kCGNullWindowID,
    kCGWindowAlpha,
    kCGWindowBounds,
    kCGWindowListOptionAll,
    kCGWindowOwnerPID,
)


pid = int(sys.argv[1])
target = json.loads(sys.argv[2])["final"]
tolerance = 2.5


def run(*args):
    return json.loads(subprocess.check_output(["./aos", *args], text=True))


def canvas_at():
    payload = run("show", "list", "--json")
    for canvas in payload.get("canvases", []):
        if canvas.get("id") == "placement-smoke":
            return canvas["at"]
    raise SystemExit("FAIL: placement-smoke missing from show list")


def windows_for_pid():
    infos = CGWindowListCopyWindowInfo(kCGWindowListOptionAll, kCGNullWindowID) or []
    result = []
    for info in infos:
        if int(info.get(kCGWindowOwnerPID, 0)) != pid:
            continue
        if float(info.get(kCGWindowAlpha, 1.0)) <= 0:
            continue
        bounds = info.get(kCGWindowBounds) or {}
        result.append({
            "x": float(bounds.get("X", 0)),
            "y": float(bounds.get("Y", 0)),
            "w": float(bounds.get("Width", 0)),
            "h": float(bounds.get("Height", 0)),
        })
    return result


def score(bounds):
    return (
        abs(bounds["x"] - target["x"]) +
        abs(bounds["y"] - target["y"]) +
        abs(bounds["w"] - target["w"]) +
        abs(bounds["h"] - target["h"])
    )


deadline = time.time() + 2.5
best = None
while time.time() < deadline:
    windows = windows_for_pid()
    if windows:
        best = min(windows, key=score)
        if score(best) <= tolerance * 4:
            break
    time.sleep(0.05)

if best is None:
    raise SystemExit(f"FAIL: isolated daemon canvas never appeared in CGWindowList: pid={pid}")

daemon = canvas_at()
if any(abs(actual - expected) > tolerance for actual, expected in zip(daemon, [target["x"], target["y"], target["w"], target["h"]])):
    raise SystemExit(f"FAIL: daemon frame drifted from requested frame: {daemon} vs {target}")

actual = [best["x"], best["y"], best["w"], best["h"]]
expected = [target["x"], target["y"], target["w"], target["h"]]
if any(abs(a - e) > tolerance for a, e in zip(actual, expected)):
    raise SystemExit(f"FAIL: window server bounds drifted from requested frame: {actual} vs {expected}")

print("PASS")
PY

python3 - "$TARGET_JSON" <<'PY'
import json
import subprocess
import sys
import time

target = json.loads(sys.argv[1])
expected_final = [target["final"]["x"], target["final"]["y"], target["final"]["w"], target["final"]["h"]]
expected_requested = [target["requested"]["x"], target["requested"]["y"], target["requested"]["w"], target["requested"]["h"]]


def run(*args):
    return json.loads(subprocess.check_output(["./aos", *args], text=True))


deadline = time.time() + 2.5
row = None
while time.time() < deadline:
    payload = run("show", "list", "--json")
    row = next((canvas for canvas in payload.get("canvases", []) if canvas.get("id") == "placement-smoke"), None)
    placement = row.get("placement") if row else None
    if placement and placement.get("final_settled_frame") == expected_final:
        break
    time.sleep(0.05)

if not row:
    raise SystemExit("FAIL: placement-smoke missing from show list after placement update")
placement = row.get("placement") or {}
assert placement.get("requested_frame") == expected_requested, placement
assert placement.get("policy_adjusted_frame") == expected_final, placement
assert placement.get("final_settled_frame") == expected_final, placement
assert placement.get("viewport_overflow_policy") == "clamp", placement
assert placement.get("cause") == "placement.initial", placement

audit = run("show", "audit", "--json", "--point", f"{expected_final[0] + 10},{expected_final[1] + 10}")
registered = audit.get("registered_canvases", audit.get("registered", []))
audit_row = next((entry for entry in registered if entry.get("id") == "placement-smoke"), None)
if not audit_row:
    raise SystemExit(f"FAIL: placement-smoke missing from audit: {audit}")
audit_placement = audit_row.get("placement") or {}
assert audit_row.get("requested_frame") == expected_final, audit_row
assert audit_row.get("requested_frame_source") == "Canvas.desiredCGFrame", audit_row
assert "placement_unavailable_reason" not in audit_row, audit_row
assert audit_placement.get("requested_frame") == expected_requested, audit_placement
assert audit_placement.get("policy_adjusted_frame") == expected_final, audit_placement
assert audit_placement.get("final_settled_frame") == expected_final, audit_placement
native = audit_row.get("actual_native_windows") or []
if not native:
    raise SystemExit(f"FAIL: audit did not expose actual native frame: {audit_row}")
actual_native_frame = audit_row.get("actual_native_frame") or {}
for key, index in (("x", 0), ("y", 1), ("w", 2), ("h", 3)):
    if abs(float(actual_native_frame.get(key, 0)) - expected_final[index]) > 2.5:
        raise SystemExit(f"FAIL: actual_native_frame {key} mismatch: {audit_row}")

print("PASS")
PY
