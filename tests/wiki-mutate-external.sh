#!/usr/bin/env bash
set -euo pipefail

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-wiki-mutate.XXXXXX")"
ROOT="$(cd "$ROOT" && pwd -P)"
export AOS_STATE_ROOT="$ROOT"
trap 'rm -rf "$ROOT"' EXIT

./aos wiki seed --json >/dev/null

OUT="$(./aos wiki create-plugin test-workflow --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "ok", data
assert data["plugin"] == "test-workflow", data
PY
test -f "$ROOT/repo/wiki/aos/plugins/test-workflow/SKILL.md"

OUT="$(./aos wiki add entity test-entity --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "ok", data
assert data["type"] == "entity", data
assert data["name"] == "test-entity", data
PY
test -f "$ROOT/repo/wiki/aos/entities/test-entity.md"

OUT="$(./aos wiki link test-entity gateway --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "ok", data
assert data["from"] == "aos/entities/test-entity.md", data
assert data["to"] == "aos/entities/gateway.md", data
PY

OUT="$(./aos wiki list --links-to aos/entities/gateway.md --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

links = json.loads(os.environ["OUT"])
assert any(link["source_path"] == "aos/entities/test-entity.md" for link in links), links
PY

OUT="$(./aos wiki rm test-entity --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["status"] == "ok", data
assert data["removed"] == "aos/entities/test-entity.md", data
PY
test ! -f "$ROOT/repo/wiki/aos/entities/test-entity.md"

if ./aos wiki add --bogus 2>"$ROOT/wiki-add-bogus.err"; then
  echo "FAIL: wiki add accepted unknown flag"
  exit 1
fi
grep -q '"code": "UNKNOWN_FLAG"' "$ROOT/wiki-add-bogus.err" || {
  echo "FAIL: wiki add unknown flag did not use external script error contract"
  cat "$ROOT/wiki-add-bogus.err"
  exit 1
}

echo "PASS"
