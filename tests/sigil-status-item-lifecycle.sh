#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"
source "$(dirname "$0")/lib/status-item.sh"

PREFIX="aos-sigil-status-item-lifecycle"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

./aos set content.roots.toolkit packages/toolkit >/dev/null
./aos set content.roots.sigil apps/sigil >/dev/null
./aos set status_item.enabled true >/dev/null
./aos set status_item.toggle_id sigil-status-demo >/dev/null
./aos set status_item.toggle_url 'aos://sigil/renderer/index.html' >/dev/null
./aos set status_item.toggle_track union >/dev/null
AOS_BIN="$(pwd)/aos" AOS_RUNTIME_MODE=repo apps/sigil/sigilctl-seed.sh >/dev/null

aos_test_start_daemon "$ROOT" toolkit packages/toolkit sigil apps/sigil \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }
PID="$(aos_test_wait_for_lock_pid "$ROOT")"
[[ -n "$PID" ]] || { echo "FAIL: daemon pid missing"; exit 1; }

assert_canvas_present() {
  python3 - <<'PY'
import json, subprocess, sys

payload = json.loads(subprocess.check_output(["./aos", "show", "list", "--json"], text=True))
for canvas in payload.get("canvases", []):
    if canvas.get("id") == "sigil-status-demo":
        if canvas.get("suspended") is False:
            raise SystemExit(0)
        raise SystemExit(f"FAIL: tracked canvas unexpectedly suspended: {canvas}")
raise SystemExit("FAIL: sigil-status-demo canvas missing")
PY
}

wait_for_avatar_visible() {
  local expected="$1"
  local timeout="$2"
  python3 - "$expected" "$timeout" <<'PY'
import json, subprocess, sys, time

expected = sys.argv[1] == "true"
deadline = time.time() + float(sys.argv[2])

while time.time() < deadline:
    payload = json.loads(subprocess.check_output([
        "./aos", "show", "eval",
        "--id", "sigil-status-demo",
        "--js", "JSON.stringify(window.__sigilDebug ? window.__sigilDebug.snapshot() : null)",
    ], text=True))
    if payload.get("status") == "success":
        state = json.loads(payload["result"]) if payload.get("result") else None
        if state and state.get("avatarVisible") is expected:
            raise SystemExit(0)
    time.sleep(0.05)

raise SystemExit(f"FAIL: sigil-status-demo did not reach avatarVisible={expected}")
PY
}

wait_for_ready() {
  ./aos show wait \
    --id sigil-status-demo \
    --js 'window.__sigilDebug && window.liveJs && window.liveJs.currentAgentId === "default" && window.liveJs.avatarPos && window.liveJs.avatarPos.valid === true && Array.isArray(window.liveJs.displays) && window.liveJs.displays.length > 0 && !!window.headsup && window.__sigilBootError == null' \
    --timeout 10s >/dev/null
}

press_aos_status_item "$PID"
wait_for_ready
wait_for_avatar_visible true 5.0
assert_canvas_present

press_aos_status_item "$PID"
wait_for_avatar_visible false 3.0
assert_canvas_present

press_aos_status_item "$PID"
wait_for_ready
wait_for_avatar_visible true 3.0
assert_canvas_present

JSON_PATH="$ROOT/sigil-status-state.json"
./aos show eval \
  --id sigil-status-demo \
  --js 'JSON.stringify({agentId: window.liveJs.currentAgentId, avatarPos: window.liveJs.avatarPos, displays: window.liveJs.displays.length, state: window.liveJs.currentState, avatarVisible: window.__sigilDebug?.snapshot().avatarVisible, bootError: window.__sigilBootError})' \
  >"$JSON_PATH"

python3 - "$JSON_PATH" <<'PY'
import json, pathlib, sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert payload["status"] == "success", payload
state = json.loads(payload["result"])
assert state["agentId"] == "default", state
assert state["avatarPos"]["valid"] is True, state
assert state["displays"] >= 1, state
assert state["state"] == "IDLE", state
assert state["avatarVisible"] is True, state
assert state["bootError"] is None, state
print("PASS")
PY
