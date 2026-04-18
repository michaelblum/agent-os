#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT"
SOCK="$("$ROOT/aos" status --json | python3 -c 'import json,sys;print(json.load(sys.stdin)["identity"]["socket_path"])')"
[ -n "$SOCK" ] || { echo "FAIL: could not resolve daemon socket"; exit 1; }
SID="ipc-session-test-$$"

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

# session.register with session_id succeeds
OUT="$(echo "{\"v\":1,\"service\":\"session\",\"action\":\"register\",\"data\":{\"session_id\":\"$SID\",\"name\":\"ipc-test\",\"role\":\"worker\",\"harness\":\"codex\"}}" | send_envelope)"
echo "$OUT" | python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); assert d.get("status") in ("ok","success"), d'
echo "PASS: session.register"

# session.register with only name must fail (narrowing — v1 requires session_id)
OUT="$(echo '{"v":1,"service":"session","action":"register","data":{"name":"namedonly"}}' | send_envelope)"
echo "$OUT" | python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); assert d.get("code") == "MISSING_ARG", d'
echo "PASS: session.register rejects name-only"

# session.who includes the registered session
OUT="$(echo '{"v":1,"service":"session","action":"who","data":{}}' | send_envelope)"
echo "$OUT" | python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
sessions = d.get('sessions') or d.get('data',{}).get('sessions') or []
ids = [s.get('session_id') for s in sessions]
assert '$SID' in ids, f'session not visible: {ids}'
"
echo "PASS: session.who"

# session.unregister succeeds
OUT="$(echo "{\"v\":1,\"service\":\"session\",\"action\":\"unregister\",\"data\":{\"session_id\":\"$SID\"}}" | send_envelope)"
echo "$OUT" | python3 -c 'import json,sys; d=json.loads(sys.stdin.read()); assert d.get("status") in ("ok","success"), d'
echo "PASS: session.unregister"

echo "PASS"
