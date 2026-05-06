#!/usr/bin/env bash
# wiki-change-events.sh — verify wiki_page_changed events via FSEvents watcher
# Requires: ./aos built. Starts an isolated daemon.
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-wiki-change-events"
SCRATCH_PARENT="${AOS_TEST_STATE_PARENT:-$(pwd -P)/.aos-test-tmp}"
mkdir -p "$SCRATCH_PARENT"
while IFS= read -r stale_root; do
    [[ -n "$stale_root" ]] || continue
    aos_test_kill_root "$stale_root"
    rm -rf "$stale_root"
done < <(find "$SCRATCH_PARENT" -maxdepth 1 -type d -name "${PREFIX}.*" -print 2>/dev/null)

ROOT="$(mktemp -d "$SCRATCH_PARENT/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

AOS_BIN="${AOS_BIN:-$(dirname "$0")/../aos}"
SOCKET="$ROOT/repo/sock"
TEST_FILE="$ROOT/repo/wiki/test/fs-edit.md"
PIPE=$(mktemp -u)
mkfifo "$PIPE"
LISTENER_PID=""

cleanup() {
    if [[ -n "$LISTENER_PID" ]]; then
        kill "$LISTENER_PID" 2>/dev/null || true
        wait "$LISTENER_PID" 2>/dev/null || true
    fi
    rm -f "$PIPE"
    aos_test_kill_root "$ROOT"
    rm -rf "$ROOT"
}
trap cleanup EXIT

mkdir -p "$(dirname "$TEST_FILE")"

aos_test_start_daemon "$ROOT" toolkit packages/toolkit \
    || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

# Subscribe to daemon event stream via Python (reads NDJSON, filters wiki events)
python3 - "$SOCKET" "$PIPE" <<'PYEOF' &
import socket, sys, json, os, signal

sock_path = sys.argv[1]
fifo_path = sys.argv[2]

s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect(sock_path)

# Send subscribe request
req = json.dumps({"action": "subscribe"}) + "\n"
s.sendall(req.encode())

# Open fifo in write mode (blocks until reader opens it)
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

# Give the subscription time to register
sleep 0.4

# Create the test file
printf -- '---\ntype: test\n---\nx\n' > "$TEST_FILE"

# Read one event from the pipe (timeout 3s)
if ! read -t 3 LINE < "$PIPE"; then
    echo "FAIL: timed out waiting for wiki_page_changed event"
    exit 1
fi

echo "Event: $LINE"

# Validate path field
if ! echo "$LINE" | python3 -c "import sys, json; d=json.load(sys.stdin); assert 'test/fs-edit.md' in d.get('data',{}).get('path',''), f'bad path: {d}'" 2>/dev/null; then
    echo "FAIL: event missing expected path 'test/fs-edit.md'. Got: $LINE"
    exit 1
fi

# Validate op field is created or updated (FSEvents may coalesce)
if ! echo "$LINE" | python3 -c "import sys, json; d=json.load(sys.stdin); op=d.get('data',{}).get('op',''); assert op in ('created','updated'), f'bad op: {op}'" 2>/dev/null; then
    echo "FAIL: event op not created/updated. Got: $LINE"
    exit 1
fi

echo "PASS"
