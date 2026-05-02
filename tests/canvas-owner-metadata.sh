#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-canvas-owner-metadata"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"
unset AOS_REPO_ROOT

cleanup() {
  ./aos show remove-all >/dev/null 2>&1 || true
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

aos_test_start_daemon "$ROOT" \
  || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

ID="owner-metadata-$$"
SESSION_ID="owner-session-$$"
HARNESS="owner-harness"

AOS_SESSION_ID="$SESSION_ID" \
AOS_SESSION_HARNESS="$HARNESS" \
./aos show create \
  --id "$ID" \
  --at 20,20,80,60 \
  --html '<!doctype html><html><body>owner</body></html>' >/dev/null

python3 - "$ID" "$SESSION_ID" "$HARNESS" "$PWD" "$ROOT" <<'PY'
import json
import pathlib
import socket
import subprocess
import sys
import time

canvas_id, session_id, harness, cwd, state_root = sys.argv[1:]
child_id = f"{canvas_id}-child"
sock_path = pathlib.Path(state_root) / "repo" / "sock"

def send_envelope(action, data):
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(3)
    sock.connect(str(sock_path))
    sock.sendall(json.dumps({
        "v": 1,
        "service": "show",
        "action": action,
        "data": data,
    }).encode() + b"\n")
    buffer = b""
    while b"\n" not in buffer:
        chunk = sock.recv(65536)
        if not chunk:
            break
        buffer += chunk
    sock.close()
    if not buffer:
        raise SystemExit(f"FAIL: no response for show.{action}")
    return json.loads(buffer.split(b"\n", 1)[0])

def canvas_from_list():
    payload = json.loads(subprocess.check_output(["./aos", "show", "list", "--json"], text=True))
    for canvas in payload.get("canvases", []):
        if canvas.get("id") == canvas_id:
            return canvas
    return None

deadline = time.time() + 5
canvas = None
while time.time() < deadline:
    canvas = canvas_from_list()
    if canvas:
        break
    time.sleep(0.1)
if not canvas:
    raise SystemExit(f"FAIL: canvas {canvas_id!r} missing from show list")

owner = canvas.get("owner")
if not isinstance(owner, dict):
    raise SystemExit(f"FAIL: owner metadata missing from show list: {canvas}")

assert owner.get("consumer_id") == session_id, owner
assert owner.get("harness") == harness, owner
assert owner.get("cwd") == cwd, owner
assert owner.get("worktree_root") == cwd, owner
assert owner.get("runtime_mode") == "repo", owner
assert isinstance(owner.get("pid"), int) and owner["pid"] > 0, owner

response = send_envelope("create", {
    "id": child_id,
    "parent": canvas_id,
    "at": [120, 20, 80, 60],
    "html": "<!doctype html><html><body>child</body></html>",
})
assert response.get("status") in ("ok", "success"), response

payload = json.loads(subprocess.check_output(["./aos", "show", "list", "--json"], text=True))
child = next((canvas for canvas in payload.get("canvases", []) if canvas.get("id") == child_id), None)
if not child:
    raise SystemExit(f"FAIL: child canvas {child_id!r} missing from show list")
assert child.get("parent") == canvas_id, child
assert child.get("owner") == owner, child

sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
sock.settimeout(3)
sock.connect(str(sock_path))
sock.sendall(json.dumps({
    "action": "subscribe",
    "events": ["canvas_lifecycle"],
    "snapshot": True,
}).encode() + b"\n")

buffer = b""
deadline = time.time() + 5
lifecycle = None
while time.time() < deadline:
    if b"\n" not in buffer:
        chunk = sock.recv(65536)
        if not chunk:
            break
        buffer += chunk
    while b"\n" in buffer:
        line, buffer = buffer.split(b"\n", 1)
        if not line:
            continue
        message = json.loads(line)
        data = message.get("data") if message.get("event") == "canvas_lifecycle" else None
        if data and data.get("canvas_id") == canvas_id:
            lifecycle = data
            break
    if lifecycle:
        break

if lifecycle is None:
    raise SystemExit("FAIL: canvas_lifecycle snapshot did not include the created canvas")

assert lifecycle.get("owner") == owner, lifecycle
assert lifecycle.get("canvas", {}).get("owner") == owner, lifecycle
PY

./aos show remove --id "$ID" >/dev/null

echo "PASS"
