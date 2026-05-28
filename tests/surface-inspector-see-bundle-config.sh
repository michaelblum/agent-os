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
OUTPUT_MODE="$(./aos config get see.canvas_inspector_bundle.output.mode)"
if [[ "$OUTPUT_MODE" != "bundle_path" ]]; then
  echo "FAIL: expected default output mode bundle_path, got $OUTPUT_MODE"
  exit 1
fi

./aos permissions setup --once >/dev/null
aos_test_start_daemon "$ROOT" toolkit packages/toolkit \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

INSPECTOR_ID="surface-inspector"

bash packages/toolkit/components/surface-inspector/launch.sh >/dev/null

./aos show wait --id "$INSPECTOR_ID" --manifest surface-inspector --timeout 5s >/dev/null
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
if config.get("output", {}).get("mode") != "bundle_path":
    raise SystemExit(f"FAIL: expected manifest output mode bundle_path, got {config!r}")
if include.get("canvas_list") is not False:
    raise SystemExit(f"FAIL: expected canvas_list include false, got {include}")
if include.get("annotation_snapshot") is not True:
    raise SystemExit(f"FAIL: expected annotation_snapshot include true by default, got {include}")
if (bundle / "canvas-list.json").exists():
    raise SystemExit("FAIL: canvas-list.json should be excluded by config")
for required in ["bundle.json", "capture.json", "capture.png", "annotation-snapshot.json", "context-session.json", "context-keyframe.json", "display-geometry.json", "inspector-state.json"]:
    if not (bundle / required).exists():
        raise SystemExit(f"FAIL: missing required file {required}")
manifest_files = manifest.get("files") or {}
if manifest_files.get("annotation_snapshot_json") != "annotation-snapshot.json":
    raise SystemExit(f"FAIL: manifest missing annotation snapshot entry: {manifest_files}")
if manifest_files.get("context_session_json") != "context-session.json":
    raise SystemExit(f"FAIL: manifest missing context session entry: {manifest_files}")
if manifest_files.get("context_keyframe_json") != "context-keyframe.json":
    raise SystemExit(f"FAIL: manifest missing context keyframe entry: {manifest_files}")

clipboard = subprocess.check_output(["/usr/bin/pbpaste"], text=True).strip()
if clipboard != str(bundle):
    raise SystemExit(f"FAIL: clipboard mismatch: expected {bundle}, got {clipboard!r}")
PY

rm -rf "$BUNDLE_PATH"
BUNDLE_PATH=""

./aos set see.canvas_inspector_bundle.output.mode clipboard_payload >/dev/null

./aos show wait \
  --id "$INSPECTOR_ID" \
  --js 'window.__canvasInspectorState?.bundleOutputMode === "clipboard_payload"' \
  --timeout 5s >/dev/null

./aos show eval --id "$INSPECTOR_ID" --js '
(() => {
  window.__canvasInspectorDebug.requestSeeBundle("clipboard-payload-test")
  return "ok"
})()
' >/dev/null

python3 <<'PY'
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
        if state.get("outputMode") != "clipboard_payload":
            raise SystemExit(f"FAIL: expected clipboard_payload status, got {state}")
        if state.get("bundlePath") or state.get("bundleJSONPath"):
            raise SystemExit(f"FAIL: clipboard payload mode should not report bundle paths: {state}")
        raise SystemExit(0)
    if status == "error":
        raise SystemExit(f"FAIL: clipboard payload see bundle export failed: {state}")
    time.sleep(0.2)

raise SystemExit("FAIL: clipboard payload see bundle export did not finish")
PY

python3 <<'PY'
import json, subprocess

raw = subprocess.check_output(["/usr/bin/pbpaste"], text=True)
payload = json.loads(raw)
if payload.get("kind") != "canvas_inspector_see_bundle_clipboard_payload":
    raise SystemExit(f"FAIL: unexpected clipboard payload kind: {payload.get('kind')}")
if payload.get("status") != "success":
    raise SystemExit(f"FAIL: clipboard payload status is not success: {payload}")
if payload.get("trigger") != "clipboard-payload-test":
    raise SystemExit(f"FAIL: unexpected clipboard payload trigger: {payload.get('trigger')}")
config = payload.get("config") or {}
if config.get("output", {}).get("mode") != "clipboard_payload":
    raise SystemExit(f"FAIL: clipboard payload missing output mode: {config}")
include = config.get("include") or {}
if include.get("canvas_list") is not False:
    raise SystemExit(f"FAIL: expected canvas_list include false in clipboard payload: {include}")
annotation = payload.get("surface_inspector_annotation_snapshot")
if annotation is None:
    raise SystemExit("FAIL: clipboard payload missing annotation snapshot")
if annotation.get("schema") != "surface_inspector_annotation_snapshot" or annotation.get("version") != "0.1.0":
    raise SystemExit(f"FAIL: unexpected annotation snapshot identity: {annotation}")
context_session = payload.get("context_session")
if not isinstance(context_session, dict) or context_session.get("schema") != "aos_context_session":
    raise SystemExit(f"FAIL: clipboard payload missing context session: {context_session}")
context_keyframe = payload.get("context_keyframe")
if not isinstance(context_keyframe, dict) or context_keyframe.get("schema") != "aos_context_keyframe":
    raise SystemExit(f"FAIL: clipboard payload missing context keyframe: {context_keyframe}")
artifacts = payload.get("artifacts") or {}
for name in ["capture_image", "capture_metadata", "xray"]:
    if artifacts.get(name, {}).get("status") not in ["skipped", "disabled"]:
        raise SystemExit(f"FAIL: expected {name} to be skipped or disabled: {artifacts}")
if payload.get("canvas_list") is not None:
    raise SystemExit("FAIL: canvas_list should be omitted when include.canvas_list=false")
raw_lower = raw.lower()
if "data:" in raw_lower or "blob:" in raw_lower:
    raise SystemExit("FAIL: clipboard payload embedded data/blob asset ref")
PY

./aos show create \
  --id clipboard-invalid-context-requester \
  --at 120,120,240,160 \
  --interactive \
  --html '<!doctype html><html><body>clipboard invalid context requester<script type="module">
import { wireBridge, emit } from "aos://toolkit/runtime/index.js"
window.__bundleStatuses = []
wireBridge((msg) => {
  if (msg.type === "canvas_inspector.see_bundle_status") {
    window.__bundleStatuses.push(msg.payload || msg)
  }
})
window.__requestInvalidClipboardBundle = () => {
  window.__bundleStatuses = []
  emit("canvas_inspector.capture_bundle", {
    trigger: "invalid-context-clipboard-test",
    context_session: {
      schema: "aos_context_session",
      version: "0.1.0",
      id: "context-session:invalid",
      keyframes: [{
        schema: "aos_context_keyframe",
        version: "0.1.0",
        id: "keyframe:invalid-data",
        captured_at: "2026-05-28T12:00:00.000Z",
        trigger: "invalid",
        artifact_ids: [],
        asset_refs: { transcript: " Data:text/plain;base64,SGk=" }
      }]
    },
    context_keyframe: {
      schema: "aos_context_keyframe",
      version: "0.1.0",
      id: "keyframe:invalid-blob",
      captured_at: "2026-05-28T12:00:01.000Z",
      trigger: "invalid",
      artifact_ids: [],
      asset_refs: { capture: { uri: "blob:https://example.test/capture" } }
    }
  })
}
</script></body></html>' >/dev/null

./aos show wait \
  --id clipboard-invalid-context-requester \
  --js 'typeof window.__requestInvalidClipboardBundle === "function"' \
  --timeout 5s >/dev/null

sleep 1

./aos show eval --id clipboard-invalid-context-requester --js 'window.__requestInvalidClipboardBundle(); "ok"' >/dev/null

python3 <<'PY'
import json, subprocess, time

deadline = time.time() + 15
while time.time() < deadline:
    payload = json.loads(subprocess.check_output([
        "./aos", "show", "eval", "--id", "clipboard-invalid-context-requester", "--js",
        'JSON.stringify(window.__bundleStatuses || [])'
    ], text=True))
    result = payload.get("result")
    statuses = json.loads(result) if result else []
    for state in statuses:
        status = state.get("status")
        if status == "success":
            raise SystemExit(f"FAIL: invalid clipboard context unexpectedly succeeded: {state}")
        if status == "error":
            error = state.get("error") or {}
            if error.get("code") != "CONTEXT_PAYLOAD_INVALID_ASSET_REF":
                raise SystemExit(f"FAIL: invalid clipboard context returned wrong error: {state}")
            if error.get("phase") != "context_payload_validation":
                raise SystemExit(f"FAIL: invalid clipboard context returned wrong phase: {state}")
            if "context_session" not in (error.get("path") or ""):
                raise SystemExit(f"FAIL: invalid clipboard context did not report context_session path: {state}")
            if "data:" not in json.dumps(state).lower() and "blob:" not in json.dumps(state).lower():
                raise SystemExit(f"FAIL: invalid clipboard context error did not mention rejected URI class: {state}")
            raise SystemExit(0)
    time.sleep(0.2)

raise SystemExit("FAIL: invalid clipboard context did not report validation error")
PY

./aos set see.canvas_inspector_bundle.output.mode bundle_path >/dev/null

echo "PASS: Surface Inspector see bundle config"
