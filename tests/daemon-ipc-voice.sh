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

# voice.list returns voices array
OUT="$(echo '{"v":1,"service":"voice","action":"list","data":{}}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") in ("ok","success"), f"unexpected: {d}"
voices = d.get("voices") or d.get("data",{}).get("voices") or []
assert isinstance(voices, list), f"voices not list: {d}"
'
echo "PASS: voice.list"

# voice.leases returns status ok
OUT="$(echo '{"v":1,"service":"voice","action":"leases","data":{}}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") in ("ok","success"), f"unexpected: {d}"
'
echo "PASS: voice.leases"

# voice.final_response with empty hook_payload and no session_id returns MISSING_SESSION_ID
OUT="$(echo '{"v":1,"service":"voice","action":"final_response","data":{"hook_payload":{}}}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("code") == "MISSING_SESSION_ID", f"expected MISSING_SESSION_ID: {d}"
'
echo "PASS: voice.final_response missing session rejected"

echo "PASS"
