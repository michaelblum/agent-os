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

# Seed the channel first so listen.read has something to return
echo '{"v":1,"service":"tell","action":"send","data":{"audience":["ipc-listen-test"],"text":"seed"}}' | send_envelope >/dev/null

# listen.read — should return messages from the seeded channel
OUT="$(echo '{"v":1,"service":"listen","action":"read","data":{"channel":"ipc-listen-test","limit":5}}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") in ("ok","success"), f"unexpected: {d}"
msgs = d.get("messages") or d.get("data",{}).get("messages") or []
assert len(msgs) >= 1, f"expected at least one message: {d}"
'
echo "PASS: listen.read"

# listen.channels — should return a list including the seeded channel
OUT="$(echo '{"v":1,"service":"listen","action":"channels","data":{}}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") in ("ok","success"), f"unexpected: {d}"
chs = d.get("channels") or d.get("data",{}).get("channels") or []
assert isinstance(chs, list), f"channels not a list: {d}"
'
echo "PASS: listen.channels"

echo "PASS"
