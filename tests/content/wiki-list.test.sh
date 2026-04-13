#!/usr/bin/env bash
# Integration test: wiki directory listing endpoint.
# Assumes `./aos serve` is running in repo mode.
# Port is read from ~/.config/aos/repo/content.port (if present) or
# discovered via `./aos content status --json`.
set -euo pipefail

# Try the port file first; fall back to aos content status
PORT=$(cat "$HOME/.config/aos/repo/content.port" 2>/dev/null || true)
if [[ -z "$PORT" ]]; then
  PORT=$(./aos content status --json 2>/dev/null | grep '"port"' | grep -o '[0-9]*' || true)
fi
if [[ -z "$PORT" ]]; then
  echo "SKIP: aos daemon not running (no content.port)"; exit 0
fi

# Seed two agent docs via PUT
curl -sf -X PUT -H 'Content-Type: text/markdown' \
  --data-binary $'---\ntype: agent\nid: alpha\nname: Alpha\ntags: [sigil]\n---\n\n```json\n{}\n```\n' \
  "http://127.0.0.1:$PORT/wiki/sigil/agents/alpha.md" > /dev/null
curl -sf -X PUT -H 'Content-Type: text/markdown' \
  --data-binary $'---\ntype: agent\nid: beta\nname: Beta\ntags: [sigil]\n---\n\n```json\n{}\n```\n' \
  "http://127.0.0.1:$PORT/wiki/sigil/agents/beta.md" > /dev/null

# List the directory
BODY=$(curl -sf "http://127.0.0.1:$PORT/wiki/sigil/agents/")
echo "$BODY" | grep -q '"name":"alpha.md"' || { echo "FAIL: alpha.md not listed"; echo "$BODY"; exit 1; }
echo "$BODY" | grep -q '"name":"beta.md"' || { echo "FAIL: beta.md not listed"; echo "$BODY"; exit 1; }

# Path traversal must be rejected.
# --path-as-is prevents curl from normalizing /../ before sending.
STATUS=$(curl -s --path-as-is -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/wiki/../etc/passwd/")
[[ "$STATUS" == "400" || "$STATUS" == "403" ]] || { echo "FAIL: traversal returned $STATUS"; exit 1; }

# Cleanup
curl -sf -X DELETE "http://127.0.0.1:$PORT/wiki/sigil/agents/alpha.md" > /dev/null
curl -sf -X DELETE "http://127.0.0.1:$PORT/wiki/sigil/agents/beta.md" > /dev/null

echo "OK: wiki directory listing works"
