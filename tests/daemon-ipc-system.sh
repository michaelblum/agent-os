#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

PREFIX="aos-daemon-ipc-system"
aos_test_cleanup_prefix "$PREFIX"

STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$STATE_ROOT"

cleanup() {
  aos_test_kill_root "$STATE_ROOT"
  rm -rf "$STATE_ROOT"
}
trap cleanup EXIT

./aos serve --idle-timeout none >"$STATE_ROOT/daemon.stdout" 2>"$STATE_ROOT/daemon.stderr" &
aos_test_wait_for_socket "$STATE_ROOT" || { echo "FAIL: isolated daemon did not start"; exit 1; }

SOCK="$(aos_test_socket_path "$STATE_ROOT")"

send_envelope() {
  python3 -c "import json, socket, sys
sock_path = '$SOCK'
line = sys.stdin.read()
s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.settimeout(3)
s.connect(sock_path)
s.sendall(line.encode() + b'\n')
buf = b''
while b'\n' not in buf:
    chunk = s.recv(4096)
    if not chunk: break
    buf += chunk
sys.stdout.write(buf.decode().splitlines()[0])"
}

# 1. system.ping returns identity + health fields.
OUT="$(echo '{"v":1,"service":"system","action":"ping","data":{}}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") in ("ok", "success"), f"unexpected status: {d}"
payload = d.get("data", d)
assert "uptime" in payload, f"uptime missing: {d}"
assert isinstance(payload.get("pid"), int), f"pid missing: {d}"
assert payload.get("mode") in ("repo", "installed"), f"mode missing: {d}"
assert isinstance(payload.get("socket_path"), str) and payload["socket_path"], f"socket_path missing: {d}"
assert payload.get("input_tap_status") in ("active", "retrying", "unavailable"), f"input_tap_status missing: {d}"
'
echo "PASS: system.ping"

echo "PASS"
