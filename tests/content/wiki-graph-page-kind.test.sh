#!/usr/bin/env bash
# Integration test: wiki graph page-kind normalization through the content server.
set -euo pipefail

CONTENT_WAIT_JSON=$(./aos content wait --root sigil --timeout 5s --json 2>/dev/null || true)
PORT=$(printf '%s' "$CONTENT_WAIT_JSON" | python3 -c "import sys, json
try:
    print(json.load(sys.stdin).get('port', ''))
except Exception:
    print('')
" || true)
if [[ -z "$PORT" ]]; then
  echo "SKIP: aos daemon not running (content root not ready)"; exit 0
fi

TEST_ID="taxonomy-alignment-test-$$"
ENTITY_PATH="aos/entities/$TEST_ID.md"
REFERENCE_PATH="aos/plugins/$TEST_ID/references/ref.md"

cleanup() {
  curl -sf -X DELETE "http://127.0.0.1:$PORT/wiki/$ENTITY_PATH" > /dev/null || true
  curl -sf -X DELETE "http://127.0.0.1:$PORT/wiki/$REFERENCE_PATH" > /dev/null || true
}
trap cleanup EXIT

curl -sf -X PUT -H 'Content-Type: text/markdown' \
  --data-binary "---
type: entity
id: $TEST_ID
name: Taxonomy Alignment Test Entity
tags: [taxonomy]
---

# Taxonomy Alignment Test Entity
" \
  "http://127.0.0.1:$PORT/wiki/$ENTITY_PATH" > /dev/null

curl -sf -X PUT -H 'Content-Type: text/markdown' \
  --data-binary "---
type: concept
name: Taxonomy Alignment Reference
tags: [taxonomy]
---

# Taxonomy Alignment Reference
" \
  "http://127.0.0.1:$PORT/wiki/$REFERENCE_PATH" > /dev/null

assert_graph() {
  local label="$1"
  ENTITY_PATH="$ENTITY_PATH" REFERENCE_PATH="$REFERENCE_PATH" python3 -c '
import json, os, sys
graph = json.load(sys.stdin)
nodes = graph.get("nodes", [])
entity_path = os.environ["ENTITY_PATH"]
reference_path = os.environ["REFERENCE_PATH"]
entity = next((n for n in nodes if n.get("path") == entity_path), None)
reference = next((n for n in nodes if n.get("path") == reference_path), None)
if not entity or entity.get("type") != "entity":
    print(f"FAIL: {entity_path} expected entity, got {entity}", file=sys.stderr)
    sys.exit(1)
if not reference or reference.get("type") != "reference":
    print(f"FAIL: {reference_path} expected reference, got {reference}", file=sys.stderr)
    sys.exit(1)
' && echo "OK: $label"
}

curl -sf "http://127.0.0.1:$PORT/wiki/.graph" | assert_graph "/wiki/.graph page kinds"
./aos wiki graph --json | assert_graph "aos wiki graph page kinds"
