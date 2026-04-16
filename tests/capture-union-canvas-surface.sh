#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-union-capture"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

wait_for_ping() {
  for _ in $(seq 1 50); do
    if ./aos show ping >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

if ! python3 - <<'PY'
import json, subprocess
doctor = json.loads(subprocess.check_output(["./aos", "doctor", "--json"], text=True))
perms = doctor.get("permissions", {})
if not perms.get("screen_recording"):
    raise SystemExit(1)
graph = json.loads(subprocess.check_output(["./aos", "graph", "displays", "--json"], text=True))
displays = graph.get("displays", [])
raise SystemExit(0 if len(displays) >= 2 else 1)
PY
then
  echo "SKIP: requires screen recording and at least two displays"
  exit 0
fi

./aos permissions setup --once >/dev/null
./aos serve --idle-timeout none >"$ROOT/daemon.stdout" 2>"$ROOT/daemon.stderr" &
wait_for_ping || { echo "FAIL: isolated daemon did not become reachable"; exit 1; }

./aos show create \
  --id union-probe \
  --track union \
  --html '<div style="width:100%;height:100%;background:rgba(18,52,86,0.25)"></div>' >/dev/null

ARTIFACT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}-artifacts.XXXXXX")"
PNG_PATH="$ARTIFACT_DIR/union.png"
JSON_PATH="$ARTIFACT_DIR/union.json"

./aos see capture --canvas union-probe --perception --out "$PNG_PATH" > "$JSON_PATH"

python3 - "$PNG_PATH" "$JSON_PATH" <<'PY'
import json, math, pathlib, subprocess, sys

png_path = pathlib.Path(sys.argv[1]).resolve()
json_path = pathlib.Path(sys.argv[2]).resolve()
payload = json.loads(json_path.read_text())
show = json.loads(subprocess.check_output(["./aos", "show", "list", "--json"], text=True))
canvas = next(c for c in show["canvases"] if c["id"] == "union-probe")
cx, cy, cw, ch = canvas["at"]

assert len(payload.get("files") or []) == 1, payload
assert pathlib.Path(payload["files"][0]).resolve() == png_path, payload

surfaces = payload.get("surfaces") or []
assert len(surfaces) == 1, payload
surface = surfaces[0]
assert surface["kind"] == "canvas", surface
assert surface["id"] == "union-probe", surface
assert surface["bounds_global"] == {"x": cx, "y": cy, "width": cw, "height": ch}, surface
assert len(surface["segments"]) >= 2, surface
assert len(surface["displays"]) >= 2, surface
assert surface.get("display") is None, surface
assert surface.get("scale_factor") is None, surface
assert surface["capture_scale_factor"] == max(seg["scale_factor"] for seg in surface["segments"]), surface

perceptions = payload.get("perceptions") or []
assert len(perceptions) == 1, payload
perception = perceptions[0]
assert perception["capture_bounds_global"] == surface["bounds_global"], perception
assert len(perception["segments"]) == len(surface["segments"]), perception
assert perception["capture_scale_factor"] == surface["capture_scale_factor"], perception

expected_w = round(cw * surface["capture_scale_factor"])
expected_h = round(ch * surface["capture_scale_factor"])
assert perception["capture_bounds_local"] == {"x": 0, "y": 0, "width": expected_w, "height": expected_h}, perception

offset_segments = [
    seg for seg in surface["segments"]
    if seg["bounds_local"]["x"] > 0 or seg["bounds_local"]["y"] > 0
]
assert offset_segments, surface

for seg in surface["segments"]:
    local = seg["bounds_local"]
    assert local["x"] >= 0 and local["y"] >= 0, seg
    assert local["x"] + local["width"] <= expected_w, seg
    assert local["y"] + local["height"] <= expected_h, seg

print("PASS")
print(f"Artifacts: {json_path.parent}")
PY
