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

# Legacy flat fields preserved
assert payload.get("input_tap_status") in ("active", "retrying", "unavailable"), f"input_tap_status missing: {d}"
assert isinstance(payload.get("input_tap_attempts"), int), f"input_tap_attempts missing: {d}"

# New nested input_tap block
tap = payload.get("input_tap")
assert isinstance(tap, dict), f"input_tap block missing: {d}"
assert tap.get("status") in ("active", "retrying", "unavailable"), f"input_tap.status missing: {d}"
assert tap["status"] == payload["input_tap_status"], f"flat/nested mismatch: {d}"
assert isinstance(tap.get("attempts"), int), f"input_tap.attempts missing: {d}"
assert tap["attempts"] == payload["input_tap_attempts"], f"flat/nested mismatch: {d}"
assert isinstance(tap.get("listen_access"), bool), f"input_tap.listen_access missing: {d}"
assert isinstance(tap.get("post_access"), bool), f"input_tap.post_access missing: {d}"
assert tap.get("last_error_at") is None or isinstance(tap.get("last_error_at"), str), f"input_tap.last_error_at must be string-or-null: {d}"

# New nested permissions block
perms = payload.get("permissions")
assert isinstance(perms, dict), f"permissions block missing: {d}"
assert isinstance(perms.get("accessibility"), bool), f"permissions.accessibility missing: {d}"
'
echo "PASS: system.ping"

echo "PASS"
