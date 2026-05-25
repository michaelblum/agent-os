#!/usr/bin/env bash
set -euo pipefail

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-wiki-graph.XXXXXX")"
ROOT="$(cd "$ROOT" && pwd -P)"
export AOS_STATE_ROOT="$ROOT"
trap 'rm -rf "$ROOT"' EXIT

./aos wiki seed --json >/dev/null

OUT="$(./aos wiki graph --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

graph = json.loads(os.environ["OUT"])
assert graph["config"]["graphView"]["features"]["search"] is True, graph
assert any(node["path"] == "aos/entities/gateway.md" and node["type"] == "entity" for node in graph["nodes"]), graph
assert "raw" in graph and graph["raw"] == {}, graph
PY

mkdir -p "$ROOT/repo/wiki/aos/entities"
cat > "$ROOT/repo/wiki/aos/entities/agent-frontmatter-compat.md" <<'EOF'
---
type: agent
name: Taxonomy Alignment Test Agent
tags: [taxonomy, compatibility]
---

# Taxonomy Alignment Test Agent
EOF

./aos wiki reindex --json >/dev/null
OUT="$(./aos wiki graph --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

graph = json.loads(os.environ["OUT"])
node = next((item for item in graph["nodes"] if item["path"] == "aos/entities/agent-frontmatter-compat.md"), None)
assert node and node["type"] == "entity", graph
assert all(item["type"] != "agent" for item in graph["nodes"]), graph
PY

OUT="$(./aos wiki graph --raw --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

graph = json.loads(os.environ["OUT"])
assert graph["raw"]["aos/entities/gateway.md"].startswith("---"), graph["raw"].keys()
PY

if ./aos wiki graph --bogus 2>"$ROOT/wiki-graph-bogus.err"; then
  echo "FAIL: wiki graph accepted unknown flag"
  exit 1
fi
grep -q '"code": "UNKNOWN_FLAG"' "$ROOT/wiki-graph-bogus.err" || {
  echo "FAIL: wiki graph unknown flag did not use external script error contract"
  cat "$ROOT/wiki-graph-bogus.err"
  exit 1
}

echo "PASS"
