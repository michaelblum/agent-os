#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-inspector-see-bundle-config"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"
BUNDLE_PATH=""

cleanup() {
  if [[ -n "$BUNDLE_PATH" ]]; then
    rm -rf "$BUNDLE_PATH"
  fi
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

./aos set see.canvas_inspector_bundle.hotkey cmd+shift+x >/dev/null
./aos set see.canvas_inspector_bundle.include.canvas_list false >/dev/null

HOTKEY="$(./aos config get see.canvas_inspector_bundle.hotkey)"
if [[ "$HOTKEY" != "cmd+shift+x" ]]; then
  echo "FAIL: expected configured hotkey cmd+shift+x, got $HOTKEY"
  exit 1
fi

./aos permissions setup --once >/dev/null
aos_test_start_daemon "$ROOT" toolkit packages/toolkit \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

INSPECTOR_ID="canvas-inspector"

bash packages/toolkit/components/canvas-inspector/launch.sh >/dev/null

./aos show wait --id "$INSPECTOR_ID" --manifest canvas-inspector --timeout 5s >/dev/null
./aos show wait \
  --id "$INSPECTOR_ID" \
  --js 'window.__canvasInspectorState?.bundleHotkeyLabel === "cmd+shift+x"' \
  --timeout 5s >/dev/null

./aos show eval --id "$INSPECTOR_ID" --js '
(() => {
  window.__canvasInspectorDebug.requestSeeBundle("config-test")
  return "ok"
})()
' >/dev/null

BUNDLE_PATH="$(python3 - <<'PY'
import json, subprocess, time

deadline = time.time() + 15
while time.time() < deadline:
    payload = json.loads(subprocess.check_output([
        "./aos", "show", "eval", "--id", "canvas-inspector", "--js",
        'JSON.stringify(window.__canvasInspectorState?.bundleCapture || null)'
    ], text=True))
    result = payload.get("result")
    state = json.loads(result) if result else None
    if not state:
        time.sleep(0.2)
        continue
    status = state.get("status")
    if status == "success":
        print(state.get("bundlePath") or "")
        raise SystemExit(0)
    if status == "error":
        raise SystemExit(f"FAIL: configured see bundle export failed: {state}")
    time.sleep(0.2)

raise SystemExit("FAIL: configured see bundle export did not finish")
PY
)"

python3 - "$BUNDLE_PATH" <<'PY'
import json, pathlib, subprocess, sys

bundle = pathlib.Path(sys.argv[1])
if not bundle.is_dir():
    raise SystemExit(f"FAIL: bundle path missing or not a directory: {bundle}")

manifest = json.loads((bundle / "bundle.json").read_text())
config = manifest.get("config") or {}
include = config.get("include") or {}
if config.get("hotkey") != "cmd+shift+x":
    raise SystemExit(f"FAIL: expected manifest hotkey cmd+shift+x, got {config.get('hotkey')!r}")
if include.get("canvas_list") is not False:
    raise SystemExit(f"FAIL: expected canvas_list include false, got {include}")
if (bundle / "canvas-list.json").exists():
    raise SystemExit("FAIL: canvas-list.json should be excluded by config")
for required in ["bundle.json", "capture.json", "capture.png", "display-geometry.json", "inspector-state.json"]:
    if not (bundle / required).exists():
        raise SystemExit(f"FAIL: missing required file {required}")

clipboard = subprocess.check_output(["/usr/bin/pbpaste"], text=True).strip()
if clipboard != str(bundle):
    raise SystemExit(f"FAIL: clipboard mismatch: expected {bundle}, got {clipboard!r}")
PY

echo "PASS: canvas inspector see bundle config"
