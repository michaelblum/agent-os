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

INSPECTOR_ID="surface-inspector"

bash packages/toolkit/components/surface-inspector/launch.sh >/dev/null

./aos show wait --id "$INSPECTOR_ID" --manifest surface-inspector --timeout 5s >/dev/null
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
        "./aos", "show", "eval", "--id", "surface-inspector", "--js",
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
    "annotation-snapshot.json",
    "context-session.json",
    "context-keyframe.json",
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
if manifest.get("config", {}).get("output", {}).get("mode") != "bundle_path":
    raise SystemExit(f"FAIL: default output mode should be bundle_path: {manifest.get('config')}")
if manifest.get("files", {}).get("annotation_snapshot_json") != "annotation-snapshot.json":
    raise SystemExit(f"FAIL: bundle manifest missing annotation snapshot entry: {manifest.get('files')}")
if manifest.get("files", {}).get("context_session_json") != "context-session.json":
    raise SystemExit(f"FAIL: bundle manifest missing context session entry: {manifest.get('files')}")
if manifest.get("files", {}).get("context_keyframe_json") != "context-keyframe.json":
    raise SystemExit(f"FAIL: bundle manifest missing context keyframe entry: {manifest.get('files')}")
if manifest.get("context", {}).get("status") != "included":
    raise SystemExit(f"FAIL: bundle manifest should include context evidence: {manifest.get('context')}")

state = json.loads((bundle / "inspector-state.json").read_text())
if "state" not in state:
    raise SystemExit(f"FAIL: inspector-state.json missing state payload: {state}")

annotation = json.loads((bundle / "annotation-snapshot.json").read_text())
if annotation.get("schema") != "surface_inspector_annotation_snapshot" or annotation.get("version") != "0.1.0":
    raise SystemExit(f"FAIL: unexpected annotation snapshot identity: {annotation}")
if annotation.get("capture", {}).get("trigger") != "test":
    raise SystemExit(f"FAIL: unexpected annotation snapshot trigger: {annotation.get('capture')}")
if "pins" not in annotation or "comments" not in annotation or "adapter_capability_summary" not in annotation:
    raise SystemExit(f"FAIL: annotation snapshot missing public state arrays: {annotation}")
if "data:image/" in json.dumps(annotation):
    raise SystemExit("FAIL: annotation snapshot embedded image data")

context_session = json.loads((bundle / "context-session.json").read_text())
if context_session.get("schema") != "aos_context_session":
    raise SystemExit(f"FAIL: unexpected context session identity: {context_session}")
context_keyframe = json.loads((bundle / "context-keyframe.json").read_text())
if context_keyframe.get("schema") != "aos_context_keyframe":
    raise SystemExit(f"FAIL: unexpected context keyframe identity: {context_keyframe}")
asset_refs = context_keyframe.get("asset_refs") or {}
if asset_refs.get("surface_inspector_annotation_snapshot") != "annotation-snapshot.json":
    raise SystemExit(f"FAIL: context keyframe missing annotation snapshot asset ref: {asset_refs}")
if "data:image/" in json.dumps(context_session) or "data:image/" in json.dumps(context_keyframe):
    raise SystemExit("FAIL: context JSON embedded image data")

capture = json.loads((bundle / "capture.json").read_text())
files = capture.get("files") or []
if not files:
    raise SystemExit(f"FAIL: capture response missing files: {capture}")

clipboard = subprocess.check_output(["/usr/bin/pbpaste"], text=True).strip()
if clipboard != str(bundle):
    raise SystemExit(f"FAIL: clipboard mismatch: expected {bundle}, got {clipboard!r}")
PY

rm -rf "$BUNDLE_PATH"
BUNDLE_PATH=""

./aos show create \
  --id avatar-main \
  --at 120,120,240,160 \
  --interactive \
  --html '<!doctype html><html><body>bundle requester<script type="module">
import { wireBridge, emit } from "aos://toolkit/runtime/index.js"
window.__bundleStatuses = []
wireBridge((msg) => {
  if (msg.type === "canvas_inspector.see_bundle_status") {
    window.__bundleStatuses.push(msg.payload || msg)
  }
})
window.__requestExternalBundle = () => emit("canvas_inspector.capture_bundle", { trigger: "external-source-test" })
</script></body></html>' >/dev/null

./aos show wait \
  --id avatar-main \
  --js 'typeof window.__requestExternalBundle === "function"' \
  --timeout 5s >/dev/null

sleep 1

./aos show eval --id avatar-main --js 'window.__requestExternalBundle(); "ok"' >/dev/null

BUNDLE_PATH="$(python3 - <<'PY'
import json, subprocess, time

deadline = time.time() + 15
while time.time() < deadline:
    payload = json.loads(subprocess.check_output([
        "./aos", "show", "eval", "--id", "avatar-main", "--js",
        'JSON.stringify(window.__bundleStatuses || [])'
    ], text=True))
    result = payload.get("result")
    statuses = json.loads(result) if result else []
    for state in statuses:
        status = state.get("status")
        if status == "success":
            print(state.get("bundle_path") or "")
            raise SystemExit(0)
        if status == "error":
            raise SystemExit(f"FAIL: external see bundle export failed: {state}")
    time.sleep(0.2)

raise SystemExit("FAIL: external see bundle export did not finish")
PY
)"

if [[ -z "$BUNDLE_PATH" || ! -d "$BUNDLE_PATH" ]]; then
  echo "FAIL: external bundle path missing or not a directory: $BUNDLE_PATH"
  exit 1
fi

python3 - "$BUNDLE_PATH" <<'PY'
import json, pathlib, sys

bundle = pathlib.Path(sys.argv[1])
manifest = json.loads((bundle / "bundle.json").read_text())
if manifest.get("status") != "success":
    raise SystemExit(f"FAIL: external bundle manifest is not success: {manifest}")
if manifest.get("trigger") != "external-source-test":
    raise SystemExit(f"FAIL: expected external trigger, got: {manifest.get('trigger')}")
if manifest.get("canvas_id") != "surface-inspector":
    raise SystemExit(f"FAIL: bundle owner should remain surface-inspector: {manifest}")
if manifest.get("source_canvas_id") != "avatar-main":
    raise SystemExit(f"FAIL: external requester not recorded: {manifest}")
PY

echo "PASS: Surface Inspector see bundle"
