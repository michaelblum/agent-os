#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"

SOCK="$("$ROOT/aos" status --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["identity"]["socket_path"])')"
[ -n "$SOCK" ] || { echo "FAIL: could not resolve daemon socket"; exit 1; }

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

# 1. system.ping returns ok and has uptime field.
OUT="$(echo '{"v":1,"service":"system","action":"ping","data":{}}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") in ("ok", "success"), f"unexpected status: {d}"
assert "uptime" in d or ("data" in d and "uptime" in d["data"]), f"uptime missing: {d}"
'
echo "PASS: system.ping"

echo "PASS"
