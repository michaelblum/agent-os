#!/usr/bin/env bash
# Integration test: wiki directory listing endpoint.
# Assumes `./aos serve` is running in repo mode.
# Port is discovered via the canonical readiness path.
set -euo pipefail

PORT=$(./aos content wait --root sigil --timeout 5s --json 2>/dev/null | python3 -c "import sys, json; print(json.load(sys.stdin).get('port', ''))" || true)
if [[ -z "$PORT" ]]; then
  echo "SKIP: aos daemon not running (content root not ready)"; exit 0
fi

# Seed two agent docs via PUT
curl -sf -X PUT -H 'Content-Type: text/markdown' \
  --data-binary $'---\ntype: agent\nid: alpha\nname: Alpha\ntags: [sigil]\n---\n\n```json\n{}\n```\n' \
  "http://127.0.0.1:$PORT/wiki/sigil/agents/alpha.md" > /dev/null
curl -sf -X PUT -H 'Content-Type: text/markdown' \
  --data-binary $'---\ntype: agent\nid: beta\nname: Beta\ntags: [sigil]\n---\n\n```json\n{}\n```\n' \
  "http://127.0.0.1:$PORT/wiki/sigil/agents/beta.md" > /dev/null

# Seed a hidden file — must NOT appear in listing
curl -sf -X PUT -H 'Content-Type: text/markdown' \
  --data-binary $'hidden\n' \
  "http://127.0.0.1:$PORT/wiki/sigil/agents/.hidden.md" > /dev/null

# List the directory
BODY=$(curl -sf "http://127.0.0.1:$PORT/wiki/sigil/agents/")
echo "$BODY" | grep -q '"name":"alpha.md"' || { echo "FAIL: alpha.md not listed"; echo "$BODY"; exit 1; }
echo "$BODY" | grep -q '"name":"beta.md"' || { echo "FAIL: beta.md not listed"; echo "$BODY"; exit 1; }

# Hidden files must be absent from the listing
echo "$BODY" | grep -q '"name":".hidden.md"' && { echo "FAIL: .hidden.md appeared in listing"; exit 1; } || true

# Path field must have no trailing slash (JSONEncoder may escape / as \/)
echo "$BODY" | grep -qE '"path":"sigil\\?/agents"' || { echo "FAIL: path has trailing slash or wrong value"; echo "$BODY"; exit 1; }

# HEAD on the directory returns 200 with no body
HEAD_RESP=$(curl -sI "http://127.0.0.1:$PORT/wiki/sigil/agents/")
echo "$HEAD_RESP" | grep -q "200" || { echo "FAIL: HEAD did not return 200"; echo "$HEAD_RESP"; exit 1; }
HEAD_BODY=$(curl -s --head "http://127.0.0.1:$PORT/wiki/sigil/agents/")
# Body from --head contains only headers — no JSON should appear
echo "$HEAD_BODY" | grep -q '"name"' && { echo "FAIL: HEAD response contained JSON body"; exit 1; } || true

# POST on the directory returns 405
POST_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$PORT/wiki/sigil/agents/")
[[ "$POST_STATUS" == "405" ]] || { echo "FAIL: POST on directory returned $POST_STATUS (expected 405)"; exit 1; }

# GET on a non-existent directory returns 404
MISSING_STATUS=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/wiki/sigil/nonexistent-dir/")
[[ "$MISSING_STATUS" == "404" ]] || { echo "FAIL: GET on missing dir returned $MISSING_STATUS (expected 404)"; exit 1; }

# Path traversal must be rejected.
# --path-as-is prevents curl from normalizing /../ before sending.
STATUS=$(curl -s --path-as-is -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/wiki/../etc/passwd/")
[[ "$STATUS" == "400" || "$STATUS" == "403" ]] || { echo "FAIL: traversal returned $STATUS"; exit 1; }

# Cleanup
curl -sf -X DELETE "http://127.0.0.1:$PORT/wiki/sigil/agents/alpha.md" > /dev/null
curl -sf -X DELETE "http://127.0.0.1:$PORT/wiki/sigil/agents/beta.md" > /dev/null
curl -sf -X DELETE "http://127.0.0.1:$PORT/wiki/sigil/agents/.hidden.md" > /dev/null

echo "OK: wiki directory listing works"
