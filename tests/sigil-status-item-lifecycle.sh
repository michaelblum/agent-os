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

./aos set content.roots.sigil apps/sigil >/dev/null
./aos set status_item.enabled true >/dev/null
./aos set status_item.toggle_id sigil-status-demo >/dev/null
./aos set status_item.toggle_url 'aos://sigil/renderer/index.html' >/dev/null
./aos set status_item.toggle_track union >/dev/null
aos_test_start_daemon "$ROOT" sigil apps/sigil \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }
PID="$(aos_test_wait_for_lock_pid "$ROOT")"
[[ -n "$PID" ]] || { echo "FAIL: daemon pid missing"; exit 1; }

assert_avatar_visible() {
  local expected="$1"
  python3 - "$expected" <<'PY'
import json, subprocess, sys

expected = sys.argv[1] == "true"
payload = json.loads(subprocess.check_output([
    "./aos", "show", "eval", "--id", "sigil-status-demo",
    "--js", "JSON.stringify(window.__sigilStage.snapshot())"
], text=True))
if payload.get("status") != "success":
    raise SystemExit(f"FAIL: eval failed: {payload}")
state = json.loads(payload["result"])
actual = state.get("visible")
if actual is expected:
    raise SystemExit(0)
raise SystemExit(f"FAIL: visible={actual} expected {expected}; state={state}")
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
        "./aos", "show", "eval", "--id", "sigil-status-demo",
        "--js", "JSON.stringify(window.__sigilStage.snapshot())"
    ], text=True))
    if payload.get("status") == "success":
        state = json.loads(payload["result"])
        if state.get("visible") is expected:
            raise SystemExit(0)
    time.sleep(0.05)

raise SystemExit(f"FAIL: sigil-status-demo did not reach visible={expected}")
PY
}

wait_for_ready() {
  ./aos show wait \
    --id sigil-status-demo \
    --js 'window.__sigilStage && window.liveJs && window.liveJs.avatarId === "default" && window.liveJs.avatarPos && window.liveJs.avatarPos.valid === true && Array.isArray(window.liveJs.displays) && window.liveJs.displays.length > 0 && !!window.headsup && window.__sigilBootError == null' \
    --timeout 10s >/dev/null
}

wait_for_ready
assert_avatar_visible false

press_aos_status_item "$PID"
wait_for_avatar_visible true 3.0
assert_avatar_visible true

press_aos_status_item "$PID"
wait_for_avatar_visible false 3.0
assert_avatar_visible false

press_aos_status_item "$PID"
wait_for_avatar_visible true 3.0

JSON_PATH="$ROOT/sigil-status-state.json"
./aos show eval \
  --id sigil-status-demo \
  --js 'JSON.stringify({avatarId: window.liveJs.avatarId, avatarPos: window.liveJs.avatarPos, displays: window.liveJs.displays.length, visible: window.__sigilStage.snapshot().visible, lifecycle: window.__sigilStage.snapshot().lifecycle, bootError: window.__sigilBootError})' \
  >"$JSON_PATH"

python3 - "$JSON_PATH" <<'PY'
import json, pathlib, sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert payload["status"] == "success", payload
state = json.loads(payload["result"])
assert state["avatarId"] == "default", state
assert state["avatarPos"]["valid"] is True, state
assert state["displays"] >= 1, state
assert state["visible"] is True, state
assert state["lifecycle"] == "visible", state
assert state["bootError"] is None, state
print("PASS")
PY
