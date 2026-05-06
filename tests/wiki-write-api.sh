#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-wiki-write-api"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
ROOT="$(cd "$ROOT" && pwd -P)"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
    aos_test_kill_root "$ROOT"
    rm -rf "$ROOT"
}
trap cleanup EXIT

aos_test_start_daemon "$ROOT" toolkit packages/toolkit \
    || { echo "FAIL: isolated daemon did not become ready"; exit 1; }

# Get the isolated content server port via the canonical readiness path.
AOS_BIN="${AOS_BIN:-$(dirname "$0")/../aos}"
PORT=$("$AOS_BIN" content wait --root toolkit --timeout 5s --json 2>/dev/null | python3 -c "import sys, json; print(json.load(sys.stdin).get('port', ''))" || true)
if [ -z "$PORT" ] || [ "$PORT" = "0" ]; then
    echo "SKIP: content server not running (port unknown)" >&2
    exit 0
fi
URL="http://127.0.0.1:$PORT/wiki/test/hello.md"
BODY='---
type: test
name: Hello
---
Hello world'

# PUT creates
curl -sf -X PUT "$URL" -H 'Content-Type: text/markdown' --data-binary "$BODY" >/dev/null
# GET readable
curl -sf "$URL" | grep -q "Hello world"
# File on disk
test -f "$ROOT/repo/wiki/test/hello.md"
# DELETE removes
curl -sf -X DELETE "$URL" >/dev/null
test ! -f "$ROOT/repo/wiki/test/hello.md"

# Empty-body PUT: zero-byte stub file should succeed
EMPTY_URL="http://127.0.0.1:$PORT/wiki/test/empty.md"
curl -sf -X PUT "$EMPTY_URL" -H 'Content-Type: text/markdown' --data-binary '' >/dev/null
# GET returns empty body (200 OK, zero bytes)
RESP=$(curl -sf "$EMPTY_URL")
test -z "$RESP"
# File on disk, zero bytes
EMPTY_PATH="$ROOT/repo/wiki/test/empty.md"
test -f "$EMPTY_PATH"
test ! -s "$EMPTY_PATH"
# Clean up
curl -sf -X DELETE "$EMPTY_URL" >/dev/null
test ! -f "$EMPTY_PATH"

echo "PASS"
