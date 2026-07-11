#!/usr/bin/env bash
# Integration test: wiki graph page-kind normalization through the content server.
set -euo pipefail

source "$(dirname "$0")/../lib/isolated-daemon.sh"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-wiki-page-kind.XXXXXX")"
CONTENT_ROOT="$ROOT/content"
export AOS_STATE_ROOT="$ROOT"
mkdir -p "$CONTENT_ROOT/aos/entities" "$CONTENT_ROOT/aos/plugins"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

aos_test_start_daemon "$ROOT" fixture "$CONTENT_ROOT"
PORT=$(./aos content wait --root fixture --timeout 5s --json | python3 -c "import sys, json; print(json.load(sys.stdin).get('port', ''))")

TEST_ID="taxonomy-alignment-test-$$"
ENTITY_PATH="aos/entities/$TEST_ID.md"
REFERENCE_PATH="aos/plugins/$TEST_ID/references/ref.md"

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
