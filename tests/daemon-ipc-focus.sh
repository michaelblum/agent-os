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

# 1. focus.list returns ok and a channels array (possibly empty).
OUT="$(echo '{"v":1,"service":"focus","action":"list","data":{}}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") in ("ok","success"), f"unexpected status: {d}"
chs = d.get("channels") or d.get("data",{}).get("channels") or []
assert isinstance(chs, list), f"channels not a list: {d}"
'
echo "PASS: focus.list"

# 2. focus.create / focus.remove round-trip on a real window id.
#    Get a window id from graph.windows first; skip create/remove if none.
WINDOWS_OUT="$(echo '{"v":1,"service":"graph","action":"windows","data":{}}' | send_envelope)"
WIN_ID="$(echo "$WINDOWS_OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
wins = d.get("windows") or d.get("data",{}).get("windows") or []
# Prefer a window with a non-zero id
for w in wins:
    wid = w.get("id") or w.get("windowID") or w.get("window_id")
    if wid and int(wid) > 0:
        print(int(wid))
        break
' 2>/dev/null || true)"

if [ -n "$WIN_ID" ]; then
  CID="ipc-focus-test-$$"
  OUT="$(echo "{\"v\":1,\"service\":\"focus\",\"action\":\"create\",\"data\":{\"id\":\"$CID\",\"window_id\":$WIN_ID}}" | send_envelope)"
  echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") in ("ok","success"), f"create failed: {d}"
'
  echo "PASS: focus.create"

  OUT="$(echo "{\"v\":1,\"service\":\"focus\",\"action\":\"remove\",\"data\":{\"id\":\"$CID\"}}" | send_envelope)"
  echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("status") in ("ok","success"), f"remove failed: {d}"
'
  echo "PASS: focus.remove"
else
  echo "SKIP: focus.create/remove (no windows available)"
fi

# 3. focus.create missing id returns MISSING_ARG.
OUT="$(echo '{"v":1,"service":"focus","action":"create","data":{"window_id":1}}' | send_envelope)"
echo "$OUT" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
assert d.get("code") == "MISSING_ARG", f"expected MISSING_ARG: {d}"
'
echo "PASS: focus.create missing id returns MISSING_ARG"

echo "PASS"
