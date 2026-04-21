#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-inspector-see-bundle"
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

./aos permissions setup --once >/dev/null
aos_test_start_daemon "$ROOT" toolkit packages/toolkit \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

INSPECTOR_ID="canvas-inspector"

bash packages/toolkit/components/canvas-inspector/launch.sh >/dev/null

./aos show wait --id "$INSPECTOR_ID" --manifest canvas-inspector --timeout 5s >/dev/null
./aos show wait \
  --id "$INSPECTOR_ID" \
  --js '!!window.__canvasInspectorDebug?.requestSeeBundle' \
  --timeout 5s >/dev/null

./aos show eval --id "$INSPECTOR_ID" --js '
(() => {
  window.__canvasInspectorDebug.requestSeeBundle("test")
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
        raise SystemExit(f"FAIL: see bundle export failed: {state}")
    time.sleep(0.2)

raise SystemExit("FAIL: see bundle export did not finish")
PY
)"

if [[ -z "$BUNDLE_PATH" || ! -d "$BUNDLE_PATH" ]]; then
  echo "FAIL: bundle path missing or not a directory: $BUNDLE_PATH"
  exit 1
fi

python3 - "$BUNDLE_PATH" <<'PY'
import json, pathlib, subprocess, sys

bundle = pathlib.Path(sys.argv[1])
required = [
    "bundle.json",
    "capture.json",
    "capture.png",
    "inspector-state.json",
    "display-geometry.json",
    "canvas-list.json",
]
missing = [name for name in required if not (bundle / name).exists()]
if missing:
    raise SystemExit(f"FAIL: missing bundle files: {missing}")

manifest = json.loads((bundle / "bundle.json").read_text())
if manifest.get("status") != "success":
    raise SystemExit(f"FAIL: bundle manifest is not success: {manifest}")
if manifest.get("trigger") != "test":
    raise SystemExit(f"FAIL: expected trigger 'test', got: {manifest.get('trigger')}")

state = json.loads((bundle / "inspector-state.json").read_text())
if "state" not in state:
    raise SystemExit(f"FAIL: inspector-state.json missing state payload: {state}")

capture = json.loads((bundle / "capture.json").read_text())
files = capture.get("files") or []
if not files:
    raise SystemExit(f"FAIL: capture response missing files: {capture}")

clipboard = subprocess.check_output(["/usr/bin/pbpaste"], text=True).strip()
if clipboard != str(bundle):
    raise SystemExit(f"FAIL: clipboard mismatch: expected {bundle}, got {clipboard!r}")
PY

echo "PASS: canvas inspector see bundle"
