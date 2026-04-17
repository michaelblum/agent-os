#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-inspector-tint"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"
ARTIFACT_DIR="${AOS_TEST_ARTIFACT_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}-artifacts.XXXXXX")}"
mkdir -p "$ARTIFACT_DIR"

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
aos_test_start_daemon "$ROOT" toolkit packages/toolkit \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

TARGET_ID="tint-target"
INSPECTOR_ID="canvas-inspector"

./aos show create \
  --id "$TARGET_ID" \
  --at 120,120,260,180 \
  --html '<!doctype html><html><body style="margin:0;width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f0df;color:#2a241a;font:600 20px Menlo, monospace">tint target</body></html>' \
  >/dev/null

bash packages/toolkit/components/canvas-inspector/launch.sh >/dev/null

./aos show wait --id "$INSPECTOR_ID" --manifest canvas-inspector --timeout 5s >/dev/null
./aos show wait \
  --id "$INSPECTOR_ID" \
  --js '!!document.querySelector(".tint-btn[data-id=\"tint-target\"]")' \
  --timeout 5s >/dev/null

BEFORE_PNG="$ARTIFACT_DIR/tint-before.png"
AFTER_PNG="$ARTIFACT_DIR/tint-after.png"
BEFORE_JSON="$ARTIFACT_DIR/tint-before.json"
AFTER_JSON="$ARTIFACT_DIR/tint-after.json"

./aos see capture --canvas "$TARGET_ID" --perception --out "$BEFORE_PNG" >"$BEFORE_JSON"

./aos show eval --id "$INSPECTOR_ID" --js '
(() => {
  const btn = document.querySelector(".tint-btn[data-id=\"tint-target\"]")
  if (!btn) throw new Error("missing tint button")
  btn.click()
  return "ok"
})()
' >/dev/null

python3 - "$TARGET_ID" <<'PY'
import json, subprocess, sys, time

target_id = sys.argv[1]
deadline = time.time() + 5
while time.time() < deadline:
    try:
        payload = json.loads(subprocess.check_output([
            "./aos", "show", "eval", "--id", target_id, "--js",
            '!!document.getElementById("__aos_canvas_inspector_tint__")'
        ], text=True))
    except subprocess.CalledProcessError:
        time.sleep(0.1)
        continue
    result = payload.get("result")
    if result in (True, 1, "1", "true"):
        raise SystemExit(0)
    time.sleep(0.1)

raise SystemExit("FAIL: target canvas never received tint overlay")
PY

./aos show wait \
  --id "$INSPECTOR_ID" \
  --js '(() => { const btn = document.querySelector(".tint-btn[data-id=\"tint-target\"]"); return !!btn && btn.classList.contains("active") && Array.isArray(window.__canvasInspectorState?.tintedIds) && window.__canvasInspectorState.tintedIds.includes("tint-target") })()' \
  --timeout 5s >/dev/null

./aos see capture --canvas "$TARGET_ID" --perception --out "$AFTER_PNG" >"$AFTER_JSON"

./aos show eval --id "$INSPECTOR_ID" --js '
(() => {
  const btn = document.querySelector(".tint-btn[data-id=\"tint-target\"]")
  if (!btn) throw new Error("missing tint button")
  btn.click()
  return "ok"
})()
' >/dev/null

python3 - "$TARGET_ID" <<'PY'
import json, subprocess, sys, time

target_id = sys.argv[1]
deadline = time.time() + 5
while time.time() < deadline:
    try:
        payload = json.loads(subprocess.check_output([
            "./aos", "show", "eval", "--id", target_id, "--js",
            '!document.getElementById("__aos_canvas_inspector_tint__")'
        ], text=True))
    except subprocess.CalledProcessError:
        time.sleep(0.1)
        continue
    result = payload.get("result")
    if result in (True, 1, "1", "true"):
        raise SystemExit(0)
    time.sleep(0.1)

raise SystemExit("FAIL: target canvas never removed tint overlay")
PY

./aos show wait \
  --id "$INSPECTOR_ID" \
  --js '(() => { const btn = document.querySelector(".tint-btn[data-id=\"tint-target\"]"); return !!btn && !btn.classList.contains("active") && Array.isArray(window.__canvasInspectorState?.tintedIds) && !window.__canvasInspectorState.tintedIds.includes("tint-target") })()' \
  --timeout 5s >/dev/null

python3 - "$TARGET_ID" "$BEFORE_PNG" "$AFTER_PNG" "$BEFORE_JSON" "$AFTER_JSON" <<'PY'
import hashlib, json, pathlib, sys

target_id = sys.argv[1]
before_png = pathlib.Path(sys.argv[2]).resolve()
after_png = pathlib.Path(sys.argv[3]).resolve()
before_json = pathlib.Path(sys.argv[4]).resolve()
after_json = pathlib.Path(sys.argv[5]).resolve()

before_payload = json.loads(before_json.read_text())
after_payload = json.loads(after_json.read_text())

def md5(path: pathlib.Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()

for payload, png in ((before_payload, before_png), (after_payload, after_png)):
    files = payload.get("files") or []
    if len(files) != 1 or pathlib.Path(files[0]).resolve() != png:
        raise SystemExit(f"FAIL: capture file mismatch for {png}: {payload}")
    surfaces = payload.get("surfaces") or []
    if len(surfaces) != 1 or surfaces[0].get("id") != target_id:
        raise SystemExit(f"FAIL: capture surface mismatch for {png}: {payload}")

before_hash = md5(before_png)
after_hash = md5(after_png)
if before_hash == after_hash:
    raise SystemExit(f"FAIL: tint did not change capture hash ({before_hash})")

print("PASS")
print(f"Artifacts: {before_png.parent}")
print(f"Before hash: {before_hash}")
print(f"After hash:  {after_hash}")
PY
