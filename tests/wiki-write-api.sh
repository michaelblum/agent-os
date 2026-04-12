#!/usr/bin/env bash
set -euo pipefail

# Get the actual live content server port (config.json has port=0 for dynamic assignment)
AOS_BIN="${AOS_BIN:-$(dirname "$0")/../aos}"
PORT=$("$AOS_BIN" content status --json 2>/dev/null | grep '"port"' | grep -oE '[0-9]+' | head -1)
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
test -f "$HOME/.config/aos/repo/wiki/test/hello.md"
# DELETE removes
curl -sf -X DELETE "$URL" >/dev/null
test ! -f "$HOME/.config/aos/repo/wiki/test/hello.md"

echo "PASS"
