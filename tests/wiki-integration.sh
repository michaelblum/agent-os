#!/bin/bash
set -euo pipefail

# wiki-integration.sh — end-to-end test of aos wiki commands
# Requires: ./aos built. Runs in an isolated AOS_STATE_ROOT by default.

AOS="${AOS:-./aos}"
TEMP_STATE_ROOT=""

canonicalize_path() {
  python3 - "$1" <<'PY'
import pathlib
import sys

print(pathlib.Path(sys.argv[1]).expanduser().resolve(strict=False))
PY
}

CANONICAL_WIKI_DIR="$(canonicalize_path "$HOME/.config/aos/repo/wiki")"

if [[ -z "${AOS_STATE_ROOT:-}" ]]; then
  TEMP_STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-wiki-integration.XXXXXX")"
  export AOS_STATE_ROOT="$TEMP_STATE_ROOT"
else
  export AOS_STATE_ROOT
fi

cleanup_state_root() {
  if [[ -n "$TEMP_STATE_ROOT" ]]; then
    rm -rf "$TEMP_STATE_ROOT"
  fi
}
trap cleanup_state_root EXIT

STATE_ROOT="$(canonicalize_path "$AOS_STATE_ROOT")"
WIKI_DIR="$(canonicalize_path "$STATE_ROOT/repo/wiki")"
PASS=0
FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

json_field() {
  python3 -c 'import json, sys; print(json.load(sys.stdin).get(sys.argv[1], ""))' "$1"
}

json_stream_has_status_ok() {
  python3 -c '
import json
import sys

decoder = json.JSONDecoder()
text = sys.stdin.read()
idx = 0
while idx < len(text):
    while idx < len(text) and text[idx].isspace():
        idx += 1
    if idx >= len(text):
        break
    obj, idx = decoder.raw_decode(text, idx)
    if isinstance(obj, dict) and obj.get("status") == "ok":
        sys.exit(0)
sys.exit(1)
'
}

if [[ "$WIKI_DIR" == "$CANONICAL_WIKI_DIR" || "$WIKI_DIR" == "$CANONICAL_WIKI_DIR/"* ]]; then
  echo "ERROR: refusing to run destructive wiki integration test against live repo wiki: $WIKI_DIR" >&2
  echo "Set AOS_STATE_ROOT to a temporary directory outside ~/.config/aos, or omit it and let this test allocate one." >&2
  exit 1
fi

echo "=== aos wiki integration tests ==="
echo "State root: $STATE_ROOT"
echo "Wiki dir: $WIKI_DIR"

# Clean slate
rm -rf "$WIKI_DIR"

# Test: reindex on empty wiki
echo ""
echo "--- reindex (empty) ---"
OUTPUT=$($AOS wiki reindex --json)
[[ "$(echo "$OUTPUT" | json_field pages)" == "0" ]] && pass "reindex empty" || fail "reindex empty"

# Test: seed
echo ""
echo "--- seed ---"
OUTPUT=$($AOS wiki seed --json)
echo "$OUTPUT" | json_stream_has_status_ok && pass "seed" || fail "seed"

# Test: reindex after seed
echo ""
echo "--- reindex (after seed) ---"
OUTPUT=$($AOS wiki reindex --json)
PAGES=$(echo "$OUTPUT" | json_field pages)
[ "$PAGES" -gt 0 ] && pass "reindex found $PAGES pages" || fail "reindex found 0 pages"

# Test: list
echo ""
echo "--- list ---"
OUTPUT=$($AOS wiki list --json)
echo "$OUTPUT" | grep -q "gateway" && pass "list contains gateway" || fail "list missing gateway"

# Test: list --type
OUTPUT=$($AOS wiki list --type workflow --json)
echo "$OUTPUT" | grep -q "self-check" && pass "list --type workflow" || fail "list --type workflow"

# Test: show
echo ""
echo "--- show ---"
OUTPUT=$($AOS wiki show gateway --json)
[[ "$(echo "$OUTPUT" | python3 -c 'import json, sys; print(json.load(sys.stdin)["frontmatter"].get("name", ""))')" == "Gateway" ]] && pass "show gateway" || fail "show gateway"

# Test: show --raw
OUTPUT=$($AOS wiki show gateway --raw)
echo "$OUTPUT" | grep -q "^---" && pass "show --raw has frontmatter" || fail "show --raw"

# Test: search
echo ""
echo "--- search ---"
OUTPUT=$($AOS wiki search "gateway" --json)
echo "$OUTPUT" | grep -q "gateway" && pass "search finds gateway" || fail "search"

# Test: graph
echo ""
echo "--- graph ---"
mkdir -p "$WIKI_DIR/aos/entities"
cat > "$WIKI_DIR/aos/entities/entity-frontmatter-canonical.md" <<'EOF'
---
type: entity
name: Taxonomy Alignment Test Entity
tags: [taxonomy]
---

# Taxonomy Alignment Test Entity
EOF
$AOS wiki reindex > /dev/null
OUTPUT=$($AOS wiki graph --json)
echo "$OUTPUT" | grep -q '"graphView"' && echo "$OUTPUT" | grep -q 'gateway.md' && pass "graph payload" || fail "graph payload"
echo "$OUTPUT" | python3 -c '
import json, sys
graph = json.load(sys.stdin)
node = next((n for n in graph.get("nodes", []) if n.get("path") == "aos/entities/entity-frontmatter-canonical.md"), None)
if node and node.get("type") == "entity":
    sys.exit(0)
sys.exit(1)
' && pass "graph preserves canonical entity frontmatter" || fail "graph preserves canonical entity frontmatter"

# Test: graph --raw
OUTPUT=$($AOS wiki graph --raw --json)
echo "$OUTPUT" | grep -q '"raw"' && echo "$OUTPUT" | grep -q 'gateway.md' && pass "graph --raw" || fail "graph --raw"

# Test: create-plugin
echo ""
echo "--- create-plugin ---"
OUTPUT=$($AOS wiki create-plugin test-workflow --json)
[[ "$(echo "$OUTPUT" | json_field status)" == "ok" ]] && pass "create-plugin" || fail "create-plugin"

# Test: add entity
OUTPUT=$($AOS wiki add entity test-entity --json)
[[ "$(echo "$OUTPUT" | json_field status)" == "ok" ]] && pass "add entity" || fail "add entity"

# Test: link
echo ""
echo "--- link ---"
OUTPUT=$($AOS wiki link test-entity gateway --json)
[[ "$(echo "$OUTPUT" | json_field status)" == "ok" ]] && pass "link" || fail "link"

# Test: list --links-to
OUTPUT=$($AOS wiki list --links-to aos/entities/gateway.md --json)
echo "$OUTPUT" | grep -q "test-entity" && pass "list --links-to" || fail "list --links-to"

# Test: invoke
echo ""
echo "--- invoke ---"
OUTPUT=$($AOS wiki invoke self-check)
echo "$OUTPUT" | grep -q "Self-Check" && pass "invoke self-check" || fail "invoke self-check"

# Test: lint
echo ""
echo "--- lint ---"
OUTPUT=$($AOS wiki lint --json)
# Should run without error
[ $? -eq 0 ] && pass "lint runs" || fail "lint runs"

# Test: rm
echo ""
echo "--- rm ---"
OUTPUT=$($AOS wiki rm test-entity --json)
[[ "$(echo "$OUTPUT" | json_field status)" == "ok" ]] && pass "rm" || fail "rm"

# Cleanup test plugin
rm -rf "$WIKI_DIR/aos/plugins/test-workflow"
$AOS wiki reindex > /dev/null 2>&1

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ $FAIL -eq 0 ] && exit 0 || exit 1
