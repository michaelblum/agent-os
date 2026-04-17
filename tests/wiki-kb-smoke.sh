#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-wiki-kb-smoke"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"
CANVAS_ID="wiki-kb-smoke"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

aos_test_start_daemon "$ROOT" toolkit packages/toolkit \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

AOS=./aos CANVAS_ID="$CANVAS_ID" bash packages/toolkit/components/wiki-kb/launch.sh >/dev/null

python3 - "$CANVAS_ID" <<'PY'
import json, subprocess, sys, time

canvas_id = sys.argv[1]

def eval_js(script):
    payload = json.loads(subprocess.check_output([
        "./aos", "show", "eval", "--id", canvas_id, "--js", script
    ], text=True))
    return json.loads(payload.get("result") or "{}")

for _ in range(50):
    result = eval_js(
        'JSON.stringify({'
        'text: document.body.textContent.replace(/\\s+/g," ").trim(),'
        'status: document.querySelector(".wiki-kb-status")?.textContent.trim() ?? "",'
        'active: document.querySelector(".wiki-kb-view-tab.active")?.dataset.view ?? null'
        '})'
    )
    text = result.get("text") or ""
    if "aos:// content server unavailable" in text:
      print("FAIL: wiki-kb loaded fallback content-server-unavailable page", flush=True)
      raise SystemExit(1)
    if result.get("active") == "graph" and "5 nodes" in result.get("status", "") and "6 links" in result.get("status", ""):
      break
    time.sleep(0.1)
else:
    print("FAIL: wiki-kb did not populate sample graph state", flush=True)
    raise SystemExit(1)

mindmap = eval_js(
    'document.querySelector(".wiki-kb-view-tab[data-view=\\"mindmap\\"]").click();'
    'JSON.stringify({'
    'active: document.querySelector(".wiki-kb-view-tab.active")?.dataset.view ?? null,'
    'breadcrumb: document.querySelector(".wiki-kb-breadcrumb")?.textContent ?? ""'
    '})'
)

if mindmap.get("active") != "mindmap":
    print("FAIL: wiki-kb did not switch to mindmap tab", flush=True)
    raise SystemExit(1)

if mindmap.get("breadcrumb") != "root: Toolkit":
    print(f"FAIL: unexpected mindmap root {mindmap.get('breadcrumb')!r}", flush=True)
    raise SystemExit(1)
PY

if python3 - <<'PY'
import json, subprocess
perms = json.loads(subprocess.check_output(["./aos", "permissions", "check", "--json"], text=True)).get("permissions", {})
raise SystemExit(0 if perms.get("screen_recording") else 1)
PY
then
  ./aos permissions setup --once >/dev/null
  ARTIFACT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}-artifacts.XXXXXX")"
  PNG_PATH="$ARTIFACT_DIR/wiki-kb.png"
  JSON_PATH="$ARTIFACT_DIR/wiki-kb.json"

  ./aos see capture --canvas "$CANVAS_ID" --perception --out "$PNG_PATH" >"$JSON_PATH"

  python3 - "$CANVAS_ID" "$PNG_PATH" "$JSON_PATH" <<'PY'
import json, pathlib, sys

canvas_id, png_path, json_path = sys.argv[1], pathlib.Path(sys.argv[2]).resolve(), pathlib.Path(sys.argv[3]).resolve()
payload = json.loads(json_path.read_text())

assert len(payload.get("files") or []) == 1, payload
assert pathlib.Path(payload["files"][0]).resolve() == png_path, payload
surfaces = payload.get("surfaces") or []
assert len(surfaces) == 1, payload
surface = surfaces[0]
assert surface["kind"] == "canvas", surface
assert surface["id"] == canvas_id, surface
print("PASS")
PY
else
  echo "PASS (screen capture skipped)"
fi
