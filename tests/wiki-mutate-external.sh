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

printf 'keep me\n' >"$ROOT/outside-delete.md"
if ./aos wiki rm ../../outside-delete.md --json 2>"$ROOT/wiki-rm-traversal.err"; then
  echo "FAIL: wiki rm accepted traversal path"
  exit 1
fi
grep -q '"code": "WIKI_INVALID_PATH"' "$ROOT/wiki-rm-traversal.err" || {
  echo "FAIL: wiki rm traversal did not use WIKI_INVALID_PATH"
  cat "$ROOT/wiki-rm-traversal.err"
  exit 1
}
grep -q 'keep me' "$ROOT/outside-delete.md" || {
  echo "FAIL: wiki rm deleted outside-root file"
  exit 1
}

if ./aos wiki add entity ../../../../outside-add --json 2>"$ROOT/wiki-add-traversal.err"; then
  echo "FAIL: wiki add accepted traversal name"
  exit 1
fi
grep -q '"code": "WIKI_INVALID_PATH"' "$ROOT/wiki-add-traversal.err" || {
  echo "FAIL: wiki add traversal did not use WIKI_INVALID_PATH"
  cat "$ROOT/wiki-add-traversal.err"
  exit 1
}
test ! -e "$ROOT/outside-add.md" || {
  echo "FAIL: wiki add wrote outside wiki root"
  exit 1
}

if ./aos wiki create-plugin ../../../../outside-plugin --json 2>"$ROOT/wiki-create-plugin-traversal.err"; then
  echo "FAIL: wiki create-plugin accepted traversal name"
  exit 1
fi
grep -q '"code": "WIKI_INVALID_PATH"' "$ROOT/wiki-create-plugin-traversal.err" || {
  echo "FAIL: wiki create-plugin traversal did not use WIKI_INVALID_PATH"
  cat "$ROOT/wiki-create-plugin-traversal.err"
  exit 1
}
test ! -e "$ROOT/outside-plugin" || {
  echo "FAIL: wiki create-plugin wrote outside wiki root"
  exit 1
}

if ./aos wiki add --bogus 2>"$ROOT/wiki-add-bogus.err"; then
  echo "FAIL: wiki add accepted unknown flag"
  exit 1
fi
grep -q '"code": "UNKNOWN_FLAG"' "$ROOT/wiki-add-bogus.err" || {
  echo "FAIL: wiki add unknown flag did not use external script error contract"
  cat "$ROOT/wiki-add-bogus.err"
  exit 1
}

if ./aos wiki create-plugin too many --json 2>"$ROOT/wiki-create-plugin-extra.err"; then
  echo "FAIL: wiki create-plugin accepted extra positional argument"
  exit 1
fi
grep -q '"code": "UNKNOWN_ARG"' "$ROOT/wiki-create-plugin-extra.err" || {
  echo "FAIL: wiki create-plugin extra positional did not use external script error contract"
  cat "$ROOT/wiki-create-plugin-extra.err"
  exit 1
}
grep -q 'Unknown argument: many' "$ROOT/wiki-create-plugin-extra.err" || {
  echo "FAIL: wiki create-plugin extra positional did not name offending argument"
  cat "$ROOT/wiki-create-plugin-extra.err"
  exit 1
}

if ./aos wiki add entity extra-page unexpected --json 2>"$ROOT/wiki-add-extra.err"; then
  echo "FAIL: wiki add accepted extra positional argument"
  exit 1
fi
grep -q '"code": "UNKNOWN_ARG"' "$ROOT/wiki-add-extra.err" || {
  echo "FAIL: wiki add extra positional did not use external script error contract"
  cat "$ROOT/wiki-add-extra.err"
  exit 1
}
grep -q 'Unknown argument: unexpected' "$ROOT/wiki-add-extra.err" || {
  echo "FAIL: wiki add extra positional did not name offending argument"
  cat "$ROOT/wiki-add-extra.err"
  exit 1
}

if ./aos wiki link gateway sigil unexpected --json 2>"$ROOT/wiki-link-extra.err"; then
  echo "FAIL: wiki link accepted extra positional argument"
  exit 1
fi
grep -q '"code": "UNKNOWN_ARG"' "$ROOT/wiki-link-extra.err" || {
  echo "FAIL: wiki link extra positional did not use external script error contract"
  cat "$ROOT/wiki-link-extra.err"
  exit 1
}
grep -q 'Unknown argument: unexpected' "$ROOT/wiki-link-extra.err" || {
  echo "FAIL: wiki link extra positional did not name offending argument"
  cat "$ROOT/wiki-link-extra.err"
  exit 1
}

if ./aos wiki rm gateway unexpected --json 2>"$ROOT/wiki-rm-extra.err"; then
  echo "FAIL: wiki rm accepted extra positional argument"
  exit 1
fi
grep -q '"code": "UNKNOWN_ARG"' "$ROOT/wiki-rm-extra.err" || {
  echo "FAIL: wiki rm extra positional did not use external script error contract"
  cat "$ROOT/wiki-rm-extra.err"
  exit 1
}
grep -q 'Unknown argument: unexpected' "$ROOT/wiki-rm-extra.err" || {
  echo "FAIL: wiki rm extra positional did not name offending argument"
  cat "$ROOT/wiki-rm-extra.err"
  exit 1
}

echo "PASS"
