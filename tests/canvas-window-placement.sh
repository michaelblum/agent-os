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

./aos serve --idle-timeout none >"$ROOT/daemon.stdout" 2>"$ROOT/daemon.stderr" &
aos_test_wait_for_socket "$ROOT" || { echo "FAIL: isolated daemon socket did not become reachable"; exit 1; }
DAEMON_PID="$(aos_test_wait_for_lock_pid "$ROOT")" || { echo "FAIL: isolated daemon lock pid did not appear"; exit 1; }

TARGET_JSON="$(python3 - <<'PY'
import json
import subprocess

graph = json.loads(subprocess.check_output(["./aos", "graph", "displays"], text=True))
displays = graph.get("data", {}).get("displays", graph.get("displays", []))
other = next((display for display in displays if not display.get("is_main")), None)
if other is None:
    raise SystemExit(1)

bounds = other["bounds"]
width = 320
height = 220
margin_x = 120
margin_y = 100
x = int(bounds["x"] + max(margin_x, min(bounds["w"] - width - 40, 320)))
y = int(bounds["y"] + max(margin_y, min(bounds["h"] - height - 40, 180)))
print(json.dumps({"x": x, "y": y, "w": width, "h": height}))
PY
)" || {
  echo "SKIP: requires at least two displays"
  exit 0
}

TARGET_AT="$(python3 - "$TARGET_JSON" <<'PY'
import json
import sys

target = json.loads(sys.argv[1])
print(f"{target['x']},{target['y']},{target['w']},{target['h']}")
PY
)"

./aos show create \
  --id placement-smoke \
  --at "$TARGET_AT" \
  --html '<html><body style="margin:0;background:rgba(255,0,0,0.18);border:2px solid red;"></body></html>' >/dev/null

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
target = json.loads(sys.argv[2])
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

PLACEMENT_JSON="$(python3 - "$TARGET_JSON" <<'PY'
import json
import sys

target = json.loads(sys.argv[1])
requested = [target["x"] + 180, target["y"], target["w"], target["h"]]
final = [target["x"], target["y"], target["w"], target["h"]]
print(json.dumps({
    "requested_frame": requested,
    "policy_adjusted_frame": final,
    "final_settled_frame": final,
    "viewport_overflow_policy": "clamp",
    "cause": "placement.test",
}))
PY
)"

./aos show eval --id placement-smoke --js "window.webkit.messageHandlers.headsup.postMessage({type:'canvas.update',payload:{frame:[$TARGET_AT],geometry:{change:'frame',cause:'placement.test',phase:'settled',transaction_id:'placement-test-contract',placement:$PLACEMENT_JSON}}})" >/dev/null

python3 - "$TARGET_JSON" <<'PY'
import json
import subprocess
import sys
import time

target = json.loads(sys.argv[1])
expected_final = [target["x"], target["y"], target["w"], target["h"]]
expected_requested = [target["x"] + 180, target["y"], target["w"], target["h"]]


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

audit = run("show", "audit", "--json", "--point", f"{target['x'] + 10},{target['y'] + 10}")
registered = audit.get("registered_canvases", audit.get("registered", []))
audit_row = next((entry for entry in registered if entry.get("id") == "placement-smoke"), None)
if not audit_row:
    raise SystemExit(f"FAIL: placement-smoke missing from audit: {audit}")
audit_placement = audit_row.get("placement") or {}
assert audit_row.get("requested_frame") == expected_final, audit_row
assert audit_row.get("requested_frame_source") == "Canvas.desiredCGFrame", audit_row
assert audit_placement.get("requested_frame") == expected_requested, audit_placement
assert audit_placement.get("final_settled_frame") == expected_final, audit_placement
native = audit_row.get("actual_native_windows") or []
if not native:
    raise SystemExit(f"FAIL: audit did not expose actual native frame: {audit_row}")
actual_native_frame = audit_row.get("actual_native_frame") or {}
assert actual_native_frame.get("x") == expected_final[0], audit_row
assert actual_native_frame.get("y") == expected_final[1], audit_row

print("PASS")
PY
