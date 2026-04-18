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

# 1. Happy path: system.ping returns ok.
OUT="$(echo '{"v":1,"service":"system","action":"ping","data":{}}' | send_envelope)"
echo "$OUT" | python3 -c 'import json,sys;d=json.loads(sys.stdin.read()); assert d.get("status") in ("ok","success"), f"unexpected: {d}"'
echo "PASS: system.ping happy path"

# 2. Unknown (service, action) returns UNKNOWN_ACTION.
OUT="$(echo '{"v":1,"service":"system","action":"bogus","data":{}}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("code") == "UNKNOWN_ACTION", f"expected UNKNOWN_ACTION, got: {d}"
'
echo "PASS: unknown action returns UNKNOWN_ACTION"

# 3. Ref is echoed back.
OUT="$(echo '{"v":1,"service":"system","action":"ping","data":{},"ref":"abc-123"}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
# ref may or may not be echoed yet (wraps in Task 12). Accept either, but if present must match.
if "ref" in d: assert d["ref"] == "abc-123", f"ref mismatch: {d}"
'
echo "PASS: ref echo (or absent during transition)"

echo "PASS"
