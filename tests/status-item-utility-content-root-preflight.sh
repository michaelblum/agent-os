#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-status-item-utility-content-root"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

BAD_ROOT="$ROOT/removed-worktree/packages/toolkit"

./aos set content.roots.toolkit "$BAD_ROOT" >/dev/null
./aos set status_item.enabled true >/dev/null
./aos set status_item.toggle_id sigil-status-demo >/dev/null
./aos set status_item.toggle_url 'aos://sigil/renderer/index.html' >/dev/null
./aos set status_item.toggle_track union >/dev/null

mkdir -p "$ROOT/repo"
cat >"$ROOT/repo/status-item-utility-panels.json" <<'JSON'
{
  "canvas-inspector": true
}
JSON

aos_test_start_daemon "$ROOT" \
  || { echo "FAIL: isolated daemon did not become reachable"; exit 1; }

python3 - "$BAD_ROOT" <<'PY'
import json
import pathlib
import subprocess
import sys
import time

bad_root = pathlib.Path(sys.argv[1])
deadline = time.time() + 5
state = None
while time.time() < deadline:
    payload = json.loads(subprocess.check_output(["./aos", "show", "list", "--json"], text=True))
    for canvas in payload.get("canvases", []):
        if canvas.get("id") == "canvas-inspector":
            state = canvas
            break
    if state:
        break
    time.sleep(0.1)

assert state, "FAIL: status item did not restore canvas-inspector utility panel"
assert state.get("suspended") is False, state

text = ""
deadline = time.time() + 5
while time.time() < deadline:
    payload = json.loads(subprocess.check_output([
        "./aos", "show", "eval",
        "--id", "canvas-inspector",
        "--js", "document.body.innerText",
    ], text=True))
    assert payload["status"] == "success", payload
    text = payload["result"]
    if "AOS Content Root Unavailable" in text:
        break
    time.sleep(0.1)
assert "AOS Content Root Unavailable" in text, text
assert "Not Found" not in text, text
assert "/removed-worktree/packages/toolkit" in text, text
print("PASS")
PY
