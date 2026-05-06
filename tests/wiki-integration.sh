#!/bin/bash
set -euo pipefail

# wiki-integration.sh — end-to-end test of aos wiki commands
# Requires: ./aos built, no existing wiki (or will be reset)

AOS="./aos"
STATE_ROOT=${AOS_STATE_ROOT:-"$HOME/.config/aos"}
WIKI_DIR="$STATE_ROOT/repo/wiki"
PASS=0
FAIL=0

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

echo "=== aos wiki integration tests ==="
echo "Wiki dir: $WIKI_DIR"

# Clean slate
rm -rf "$WIKI_DIR"

# Test: reindex on empty wiki
echo ""
echo "--- reindex (empty) ---"
OUTPUT=$($AOS wiki reindex --json)
echo "$OUTPUT" | grep -q '"pages" : 0' && pass "reindex empty" || fail "reindex empty"

# Test: seed
echo ""
echo "--- seed ---"
OUTPUT=$($AOS wiki seed --json)
echo "$OUTPUT" | grep -q '"status" : "ok"' && pass "seed" || fail "seed"

# Test: reindex after seed
echo ""
echo "--- reindex (after seed) ---"
OUTPUT=$($AOS wiki reindex --json)
PAGES=$(echo "$OUTPUT" | grep -o '"pages" : [0-9]*' | grep -o '[0-9]*')
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
echo "$OUTPUT" | grep -q '"name" : "Gateway"' && pass "show gateway" || fail "show gateway"

# Test: show --raw
OUTPUT=$($AOS wiki show gateway --raw)
echo "$OUTPUT" | grep -q "^---" && pass "show --raw has frontmatter" || fail "show --raw"

# Test: search
echo ""
echo "--- search ---"
OUTPUT=$($AOS wiki search "MCP server" --json)
echo "$OUTPUT" | grep -q "gateway" && pass "search finds gateway" || fail "search"

# Test: graph
echo ""
echo "--- graph ---"
mkdir -p "$WIKI_DIR/aos/entities"
cat > "$WIKI_DIR/aos/entities/agent-frontmatter-compat.md" <<'EOF'
---
type: agent
name: Taxonomy Alignment Test Agent
tags: [taxonomy, compatibility]
---

# Taxonomy Alignment Test Agent
EOF
$AOS wiki reindex > /dev/null
OUTPUT=$($AOS wiki graph --json)
echo "$OUTPUT" | grep -q '"graphView"' && echo "$OUTPUT" | grep -q 'gateway.md' && pass "graph payload" || fail "graph payload"
echo "$OUTPUT" | python3 -c '
import json, sys
graph = json.load(sys.stdin)
node = next((n for n in graph.get("nodes", []) if n.get("path") == "aos/entities/agent-frontmatter-compat.md"), None)
if node and node.get("type") == "entity" and all(n.get("type") != "agent" for n in graph.get("nodes", [])):
    sys.exit(0)
sys.exit(1)
' && pass "graph normalizes agent frontmatter compatibility input" || fail "graph normalizes agent frontmatter compatibility input"

# Test: graph --raw
OUTPUT=$($AOS wiki graph --raw --json)
echo "$OUTPUT" | grep -q '"raw"' && echo "$OUTPUT" | grep -q 'gateway.md' && pass "graph --raw" || fail "graph --raw"

# Test: create-plugin
echo ""
echo "--- create-plugin ---"
OUTPUT=$($AOS wiki create-plugin test-workflow --json)
echo "$OUTPUT" | grep -q '"status" : "ok"' && pass "create-plugin" || fail "create-plugin"

# Test: add entity
OUTPUT=$($AOS wiki add entity test-entity --json)
echo "$OUTPUT" | grep -q '"status" : "ok"' && pass "add entity" || fail "add entity"

# Test: link
echo ""
echo "--- link ---"
OUTPUT=$($AOS wiki link test-entity gateway --json)
echo "$OUTPUT" | grep -q '"status" : "ok"' && pass "link" || fail "link"

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
echo "$OUTPUT" | grep -q '"status" : "ok"' && pass "rm" || fail "rm"

# Cleanup test plugin
rm -rf "$WIKI_DIR/aos/plugins/test-workflow"
$AOS wiki reindex > /dev/null 2>&1

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ $FAIL -eq 0 ] && exit 0 || exit 1
