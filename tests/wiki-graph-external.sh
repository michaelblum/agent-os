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
cat > "$ROOT/repo/wiki/aos/entities/entity-frontmatter-canonical.md" <<'EOF'
---
type: entity
name: Taxonomy Alignment Test Entity
tags: [taxonomy]
---

# Taxonomy Alignment Test Entity
EOF

./aos wiki reindex --json >/dev/null
OUT="$(./aos wiki graph --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

graph = json.loads(os.environ["OUT"])
node = next((item for item in graph["nodes"] if item["path"] == "aos/entities/entity-frontmatter-canonical.md"), None)
assert node and node["type"] == "entity", graph
PY

python3 - <<'PY'
from pathlib import Path
import os

path = Path(os.environ["AOS_STATE_ROOT"]) / "repo/wiki/aos/entities/entity-frontmatter-canonical.md"
path.write_bytes(b"---\ntype: entity\nname: Taxonomy Alignment Test Entity\n---\nraw-invalid-byte \xff\n")
PY

OUT="$(./aos wiki graph --raw --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

graph = json.loads(os.environ["OUT"])
assert graph["raw"]["aos/entities/gateway.md"].startswith("---"), graph["raw"].keys()
assert "raw-invalid-byte" in graph["raw"]["aos/entities/entity-frontmatter-canonical.md"], graph["raw"]
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

if ./aos wiki graph extra 2>"$ROOT/wiki-graph-extra.err"; then
  echo "FAIL: wiki graph accepted extra positional"
  exit 1
fi
grep -q '"code": "UNKNOWN_ARG"' "$ROOT/wiki-graph-extra.err" || {
  echo "FAIL: wiki graph extra positional did not use UNKNOWN_ARG"
  cat "$ROOT/wiki-graph-extra.err"
  exit 1
}
grep -q '"error": "Unknown argument: extra"' "$ROOT/wiki-graph-extra.err" || {
  echo "FAIL: wiki graph extra positional message did not say Unknown argument"
  cat "$ROOT/wiki-graph-extra.err"
  exit 1
}

echo "PASS"
