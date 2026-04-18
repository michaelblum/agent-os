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

# Happy path: see.observe returns ok + channel_id.
OUT="$(echo '{"v":1,"service":"see","action":"observe","data":{"depth":1,"scope":"cursor"}}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") in ("ok","success"), f"unexpected: {d}"
chan = d.get("channel_id") or d.get("data",{}).get("channel_id")
assert chan, f"channel_id missing: {d}"
'
echo "PASS: see.observe"

echo "PASS"
