#!/usr/bin/env bash
# Integration test: wiki directory listing endpoint.
set -euo pipefail

source "$(dirname "$0")/../lib/isolated-daemon.sh"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-wiki-list.XXXXXX")"
CONTENT_ROOT="$ROOT/content"
export AOS_STATE_ROOT="$ROOT"
mkdir -p "$CONTENT_ROOT/entities"

TEST_ID="wiki-list-test-$$"
ALPHA_PATH="entities/${TEST_ID}-alpha.md"
BETA_PATH="entities/${TEST_ID}-beta.md"
HIDDEN_PATH="entities/.${TEST_ID}-hidden.md"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

aos_test_start_daemon "$ROOT" fixture "$CONTENT_ROOT"
PORT=$(./aos content wait --root fixture --timeout 5s --json | python3 -c "import sys, json; print(json.load(sys.stdin).get('port', ''))")

# Seed two agent docs via PUT
curl -sf -X PUT -H 'Content-Type: text/markdown' \
  --data-binary "---
type: entity
id: ${TEST_ID}-alpha
name: ${TEST_ID} Alpha
tags: [fixture]
---

\`\`\`json
{}
\`\`\`
" \
  "http://127.0.0.1:$PORT/wiki/$ALPHA_PATH" > /dev/null
curl -sf -X PUT -H 'Content-Type: text/markdown' \
  --data-binary "---
type: entity
id: ${TEST_ID}-beta
name: ${TEST_ID} Beta
tags: [fixture]
---

\`\`\`json
{}
\`\`\`
" \
  "http://127.0.0.1:$PORT/wiki/$BETA_PATH" > /dev/null

# Seed a hidden file — must NOT appear in listing
curl -sf -X PUT -H 'Content-Type: text/markdown' \
  --data-binary $'hidden\n' \
  "http://127.0.0.1:$PORT/wiki/$HIDDEN_PATH" > /dev/null

# List the directory
BODY=$(curl -sf "http://127.0.0.1:$PORT/wiki/entities/")
ALPHA_NAME="${TEST_ID}-alpha.md"
BETA_NAME="${TEST_ID}-beta.md"
HIDDEN_NAME=".${TEST_ID}-hidden.md"
echo "$BODY" | grep -q "\"name\":\"$ALPHA_NAME\"" || { echo "FAIL: $ALPHA_NAME not listed"; echo "$BODY"; exit 1; }
echo "$BODY" | grep -q "\"name\":\"$BETA_NAME\"" || { echo "FAIL: $BETA_NAME not listed"; echo "$BODY"; exit 1; }

# Hidden files must be absent from the listing
echo "$BODY" | grep -q "\"name\":\"$HIDDEN_NAME\"" && { echo "FAIL: $HIDDEN_NAME appeared in listing"; exit 1; } || true

# Path field must have no trailing slash (JSONEncoder may escape / as \/)
echo "$BODY" | grep -qE '"path":"entities"' || { echo "FAIL: path has trailing slash or wrong value"; echo "$BODY"; exit 1; }

# HEAD on the directory returns 200 with no body
HEAD_RESP=$(curl -sI "http://127.0.0.1:$PORT/wiki/entities/")
echo "$HEAD_RESP" | grep -q "200" || { echo "FAIL: HEAD did not return 200"; echo "$HEAD_RESP"; exit 1; }
HEAD_BODY=$(curl -s --head "http://127.0.0.1:$PORT/wiki/entities/")
# Body from --head contains only headers — no JSON should appear
echo "$HEAD_BODY" | grep -q '"name"' && { echo "FAIL: HEAD response contained JSON body"; exit 1; } || true

# POST on the directory returns 405
POST_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/wiki/entities/")
[[ "$POST_STATUS" == "405" ]] || { echo "FAIL: POST on directory returned $POST_STATUS (expected 405)"; exit 1; }

# GET on a non-existent directory returns 404
MISSING_STATUS=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/wiki/nonexistent-dir/")
[[ "$MISSING_STATUS" == "404" ]] || { echo "FAIL: GET on missing dir returned $MISSING_STATUS (expected 404)"; exit 1; }

# Path traversal must be rejected.
# --path-as-is prevents curl from normalizing /../ before sending.
STATUS=$(curl -s --path-as-is -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/wiki/../etc/passwd/")
[[ "$STATUS" == "400" || "$STATUS" == "403" ]] || { echo "FAIL: traversal returned $STATUS"; exit 1; }

echo "OK: wiki directory listing works"
