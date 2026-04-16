#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-canvas-capture"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

if ! python3 - <<'PY'
import json, subprocess
perms = json.loads(subprocess.check_output(["./aos", "permissions", "check", "--json"], text=True)).get("permissions", {})
raise SystemExit(0 if perms.get("screen_recording") else 1)
PY
then
  echo "SKIP: requires screen recording"
  exit 0
fi

./aos permissions setup --once >/dev/null
./aos serve --idle-timeout none >"$ROOT/daemon.stdout" 2>"$ROOT/daemon.stderr" &
aos_test_wait_for_socket "$ROOT" || { echo "FAIL: isolated daemon socket did not become reachable"; exit 1; }

./aos show create \
  --id surface-probe \
  --at 40,40,120,80 \
  --html '<div style="width:100%;height:100%;background:#123;color:white">probe</div>' >/dev/null

ARTIFACT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}-artifacts.XXXXXX")"
PNG_PATH="$ARTIFACT_DIR/canvas.png"
JSON_PATH="$ARTIFACT_DIR/canvas.json"

./aos see capture --canvas surface-probe --perception --out "$PNG_PATH" > "$JSON_PATH"

python3 - "$PNG_PATH" "$JSON_PATH" <<'PY'
import json, pathlib, sys

png_path = pathlib.Path(sys.argv[1]).resolve()
json_path = pathlib.Path(sys.argv[2]).resolve()
payload = json.loads(json_path.read_text())

assert len(payload.get("files") or []) == 1, payload
assert pathlib.Path(payload["files"][0]).resolve() == png_path, payload

surfaces = payload.get("surfaces") or []
assert len(surfaces) == 1, payload
surface = surfaces[0]
assert surface["kind"] == "canvas", surface
assert surface["id"] == "surface-probe", surface
assert surface["bounds_global"] == {"x": 40, "y": 40, "width": 120, "height": 80}, surface
assert surface["displays"] == [surface["display"]], surface
assert len(surface["segments"]) == 1, surface
assert surface["capture_scale_factor"] == surface["scale_factor"], surface

perceptions = payload.get("perceptions") or []
assert len(perceptions) == 1, payload
assert perceptions[0]["capture_bounds_global"] == {"x": 40, "y": 40, "width": 120, "height": 80}, perceptions[0]
assert perceptions[0]["topology"]["schema"] == "spatial-topology", perceptions[0]
assert len(perceptions[0]["segments"]) == 1, perceptions[0]
assert perceptions[0]["capture_scale_factor"] == surface["capture_scale_factor"], perceptions[0]

print("PASS")
print(f"Artifacts: {json_path.parent}")
PY
