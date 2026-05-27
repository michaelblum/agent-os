#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-sigil-experience-wiki-seed"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

./aos experience activate sigil --json >"$ROOT/activate.json"

test -f "$ROOT/repo/wiki/sigil/agents/default.md" || {
  echo "FAIL: Sigil namespace seed missing after experience activation"
  exit 1
}

test -d "$ROOT/repo/wiki/aos/plugins" || {
  echo "FAIL: base wiki plugin seed missing after experience activation"
  exit 1
}

python3 - "$ROOT/activate.json" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
steps = payload.get("steps") or []
hook = [step for step in steps if step.get("id") == "hook:before_activate:apps/sigil/sigilctl-seed.sh"]
if not hook:
    raise SystemExit(f"FAIL: Sigil activation did not report seed hook: {steps}")
PY

GRAPH_PATH="$ROOT/graph.json"
./aos wiki graph --json >"$GRAPH_PATH"

python3 - "$GRAPH_PATH" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text())
nodes = payload.get("nodes") or []
types = {node.get("type") for node in nodes}
if len(nodes) <= 1:
    raise SystemExit(f"FAIL: expected multiple graph nodes after activation seed, got {len(nodes)}")
if types <= {"entity"}:
    raise SystemExit(f"FAIL: expected typed base wiki nodes after activation seed, got types {sorted(types)}")
if not {"concept", "entity", "reference", "workflow"}.issubset(types):
    raise SystemExit(f"FAIL: expected base wiki node types, got {sorted(types)}")
PY

echo "PASS"
