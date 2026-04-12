#!/usr/bin/env bash
# wiki-write-emits-event.sh — integration: PUT/DELETE via content server
# emit wiki_page_changed events through the daemon pub/sub bus.
#
# Requires: ./aos built and daemon running (launchd or manual 'aos serve')
set -euo pipefail

AOS_BIN="${AOS_BIN:-$(dirname "$0")/../aos}"
SOCKET="${HOME}/.config/aos/repo/sock"
REL_PATH="test/api-emit.md"
TEST_FILE="${HOME}/.config/aos/repo/wiki/${REL_PATH}"
PIPE=$(mktemp -u)
mkfifo "$PIPE"

cleanup() {
    kill "$LISTENER_PID" 2>/dev/null || true
    rm -f "$PIPE"
    rm -f "$TEST_FILE"
}
trap cleanup EXIT

# Resolve the content server's actual port (config default is 0 = OS-assigned).
PORT=$("$AOS_BIN" content status --json | python3 -c "import sys, json; print(json.load(sys.stdin)['port'])")
URL="http://127.0.0.1:${PORT}/wiki/${REL_PATH}"

# Subscribe to wiki_page_changed via daemon socket.
python3 - "$SOCKET" "$PIPE" <<'PYEOF' &
import socket, sys, json

sock_path = sys.argv[1]
fifo_path = sys.argv[2]

s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect(sock_path)
s.sendall((json.dumps({"action": "subscribe"}) + "\n").encode())

fifo = open(fifo_path, "w", buffering=1)

buf = b""
while True:
    try:
        chunk = s.recv(4096)
        if not chunk:
            break
        buf += chunk
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            try:
                obj = json.loads(line)
                if obj.get("event") == "wiki_page_changed":
                    fifo.write(line.decode() + "\n")
                    fifo.flush()
            except Exception:
                pass
    except Exception:
        break
PYEOF
LISTENER_PID=$!

sleep 0.4

# Ensure the file doesn't exist to start (so PUT is unambiguously a 'created').
rm -f "$TEST_FILE"

# PUT creates the file.
curl -sf -X PUT "$URL" \
    -H 'Content-Type: text/markdown' \
    --data-binary '---
type: test
---
x' >/dev/null

# Read events. API-initiated writes may fire one event (API-sourced emit) plus
# another from FSEvents — both are acceptable per spec §Failure modes. We just
# need at least one event mentioning the PUT path with a non-deleted op.
saw_put_event=0
for _ in 1 2; do
    if read -t 2 LINE < "$PIPE"; then
        if echo "$LINE" | python3 -c "import sys, json; d=json.load(sys.stdin); data=d.get('data',{}); assert data.get('path')=='${REL_PATH}' and data.get('op') in ('created','updated')" 2>/dev/null; then
            saw_put_event=1
            break
        fi
    else
        break
    fi
done

if [ "$saw_put_event" -ne 1 ]; then
    echo "FAIL: no created/updated event for ${REL_PATH}"
    exit 1
fi

# DELETE removes the file and should emit op=deleted.
curl -sf -X DELETE "$URL" >/dev/null

saw_delete_event=0
for _ in 1 2 3; do
    if read -t 2 LINE < "$PIPE"; then
        if echo "$LINE" | python3 -c "import sys, json; d=json.load(sys.stdin); data=d.get('data',{}); assert data.get('path')=='${REL_PATH}' and data.get('op')=='deleted'" 2>/dev/null; then
            saw_delete_event=1
            break
        fi
    else
        break
    fi
done

if [ "$saw_delete_event" -ne 1 ]; then
    echo "FAIL: no deleted event for ${REL_PATH}"
    exit 1
fi

echo "PASS"
