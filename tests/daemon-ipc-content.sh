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

# content.status returns ok with port and roots fields.
# When the content server is not configured, the daemon still returns
# status ok with port=0 and an empty roots dict.
OUT="$(echo '{"v":1,"service":"content","action":"status","data":{}}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") in ("ok","success"), f"unexpected status: {d}"
# port and roots may live at top level or inside data
port = d.get("port") if "port" in d else d.get("data",{}).get("port")
roots = d.get("roots") if "roots" in d else d.get("data",{}).get("roots")
assert port is not None, f"port field missing: {d}"
assert isinstance(port, int), f"port not an int: {d}"
assert roots is not None, f"roots field missing: {d}"
assert isinstance(roots, dict), f"roots not a dict: {d}"
'
echo "PASS: content.status"

echo "PASS"
