#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-inspector-snapshot"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

aos_test_start_daemon "$ROOT" toolkit packages/toolkit \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

bash packages/toolkit/components/canvas-inspector/launch.sh >/dev/null

python3 - <<'PY'
import json, subprocess, time

for _ in range(50):
    payload = json.loads(subprocess.check_output([
        "./aos", "show", "eval", "--id", "canvas-inspector", "--js",
        'JSON.stringify({text: document.body.textContent.replace(/\\s+/g," ").trim(), selfDims: document.querySelector(".tree-row.canvas.self .canvas-dims")?.textContent ?? null, minimapDisplays: document.querySelectorAll(".minimap-display").length})'
    ], text=True))
    result = json.loads(payload.get("result") or "{}")
    text = result.get("text") or ""
    if "aos:// content server unavailable" in text:
        print("FAIL: inspector loaded fallback content-server-unavailable page", flush=True)
        raise SystemExit(1)
    if result.get("selfDims") and result.get("minimapDisplays", 0) > 0:
        print("PASS")
        raise SystemExit(0)
    time.sleep(0.1)

print("FAIL: inspector did not populate from subscription snapshots", flush=True)
raise SystemExit(1)
PY

./aos show post --id canvas-inspector --event '{"type":"mouse_moved","x":140,"y":170}' >/dev/null

python3 - <<'PY'
import json, subprocess, time

for _ in range(50):
    payload = json.loads(subprocess.check_output([
        "./aos", "show", "eval", "--id", "canvas-inspector", "--js",
        '''JSON.stringify((() => {
          const state = window.__canvasInspectorState ?? {}
          const displays = state.displays ?? []
          const nativeXs = displays.map((display) => display?.nativeBounds?.x).filter((value) => Number.isFinite(value))
          const nativeYs = displays.map((display) => display?.nativeBounds?.y).filter((value) => Number.isFinite(value))
          const originX = nativeXs.length ? Math.min(...nativeXs) : 0
          const originY = nativeYs.length ? Math.min(...nativeYs) : 0
          return {
            cursor: state.cursor ?? null,
            minimapCursor: !!document.querySelector(".minimap-cursor"),
            expected: { x: 140 - originX, y: 170 - originY },
          }
        })())'''
    ], text=True))
    result = json.loads(payload.get("result") or "{}")
    cursor = result.get("cursor") or {}
    expected = result.get("expected") or {}
    if round(cursor.get("x", -1)) == round(expected.get("x", -1)) and round(cursor.get("y", -1)) == round(expected.get("y", -1)) and result.get("minimapCursor"):
        print("PASS")
        raise SystemExit(0)
    time.sleep(0.1)

print("FAIL: inspector did not render DesktopWorld minimap cursor from raw mouse_moved event", flush=True)
raise SystemExit(1)
PY
