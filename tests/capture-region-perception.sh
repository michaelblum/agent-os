#!/usr/bin/env bash
set -euo pipefail

if ! python3 - <<'PY'
import json, subprocess
doctor = json.loads(subprocess.check_output(["./aos", "doctor", "--json"], text=True))
perms = doctor.get("permissions", {})
if not perms.get("screen_recording"):
    raise SystemExit(1)
graph = json.loads(subprocess.check_output(["./aos", "graph", "displays", "--json"], text=True))
displays = graph.get("displays", [])
raise SystemExit(0 if len(displays) >= 1 else 1)
PY
then
  echo "SKIP: requires screen recording and at least one display"
  exit 0
fi

ARTIFACT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/aos-region-capture.XXXXXX")"
trap 'rm -rf "$ARTIFACT_DIR"' EXIT
PNG_PATH="$ARTIFACT_DIR/region.png"
JSON_PATH="$ARTIFACT_DIR/region.json"

./aos see capture --region 0,0,40,40 --perception --out "$PNG_PATH" > "$JSON_PATH"

python3 - "$PNG_PATH" "$JSON_PATH" <<'PY'
import json, pathlib, sys

png_path = pathlib.Path(sys.argv[1])
json_path = pathlib.Path(sys.argv[2])
payload = json.loads(json_path.read_text())

files = payload.get("files") or []
perceptions = payload.get("perceptions") or []
assert len(files) == 1, payload
assert pathlib.Path(files[0]).resolve() == png_path.resolve(), payload
assert len(perceptions) == 1, payload

perception = perceptions[0]
assert perception["capture_bounds_global"] == {"x": 0, "y": 0, "width": 40, "height": 40}, perception
assert perception["topology"]["schema"] == "spatial-topology", perception
assert perception["topology"]["displays"], perception
assert len(perception["segments"]) == 1, perception

display = next(
    d for d in perception["topology"]["displays"]
    if d["bounds"]["x"] <= 0 < d["bounds"]["x"] + d["bounds"]["width"]
    and d["bounds"]["y"] <= 0 < d["bounds"]["y"] + d["bounds"]["height"]
)
expected_w = int(40 * display["scale_factor"])
expected_h = int(40 * display["scale_factor"])
assert perception["capture_bounds_local"] == {"x": 0, "y": 0, "width": expected_w, "height": expected_h}, perception
assert perception["capture_scale_factor"] == display["scale_factor"], perception
print("PASS")
PY
