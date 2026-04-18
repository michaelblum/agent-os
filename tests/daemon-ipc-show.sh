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

ID="ipc-test-$$"

# create
OUT="$(echo "{\"v\":1,\"service\":\"show\",\"action\":\"create\",\"data\":{\"id\":\"$ID\",\"at\":[100,100,200,100],\"html\":\"<div>hi</div>\"}}" | send_envelope)"
echo "$OUT" | python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); assert d.get("status") in ("ok","success"), d'
echo "PASS: show.create"

# list
OUT="$(echo '{"v":1,"service":"show","action":"list","data":{}}' | send_envelope)"
echo "$OUT" | python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
canvases = d.get('canvases') or d.get('data',{}).get('canvases') or []
ids = [c.get('id') for c in canvases]
assert '$ID' in ids, f'created canvas missing from list: {ids}'
"
echo "PASS: show.list"

# remove
OUT="$(echo "{\"v\":1,\"service\":\"show\",\"action\":\"remove\",\"data\":{\"id\":\"$ID\"}}" | send_envelope)"
echo "$OUT" | python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); assert d.get("status") in ("ok","success"), d'
echo "PASS: show.remove"

echo "PASS"
