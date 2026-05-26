#!/usr/bin/env bash
set -euo pipefail

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-wiki-read.XXXXXX")"
ROOT="$(cd "$ROOT" && pwd -P)"
export AOS_STATE_ROOT="$ROOT"
trap 'rm -rf "$ROOT"' EXIT

./aos wiki seed --json >/dev/null

OUT="$(./aos wiki show gateway --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["path"] == "aos/entities/gateway.md", data
assert data["frontmatter"]["name"] == "Gateway", data
assert "MCP" in data["raw"], data
PY

./aos wiki show gateway --raw | grep -q '^---$'

OUT="$(./aos wiki invoke self-check --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

data = json.loads(os.environ["OUT"])
assert data["plugin"] == "self-check", data
assert "Self-Check" in data["bundle"], data
PY

if ./aos wiki show --bogus 2>"$ROOT/wiki-show-bogus.err"; then
  echo "FAIL: wiki show accepted unknown flag"
  exit 1
fi
grep -q '"code": "UNKNOWN_FLAG"' "$ROOT/wiki-show-bogus.err" || {
  echo "FAIL: wiki show unknown flag did not use external script error contract"
  cat "$ROOT/wiki-show-bogus.err"
  exit 1
}

if ./aos wiki show gateway unexpected --json 2>"$ROOT/wiki-show-extra.err"; then
  echo "FAIL: wiki show accepted extra positional argument"
  exit 1
fi
grep -q '"code": "UNKNOWN_ARG"' "$ROOT/wiki-show-extra.err" || {
  echo "FAIL: wiki show extra positional did not use external script error contract"
  cat "$ROOT/wiki-show-extra.err"
  exit 1
}
grep -q 'Unknown argument: unexpected' "$ROOT/wiki-show-extra.err" || {
  echo "FAIL: wiki show extra positional did not name offending argument"
  cat "$ROOT/wiki-show-extra.err"
  exit 1
}

if ./aos wiki invoke self-check unexpected --json 2>"$ROOT/wiki-invoke-extra.err"; then
  echo "FAIL: wiki invoke accepted extra positional argument"
  exit 1
fi
grep -q '"code": "UNKNOWN_ARG"' "$ROOT/wiki-invoke-extra.err" || {
  echo "FAIL: wiki invoke extra positional did not use external script error contract"
  cat "$ROOT/wiki-invoke-extra.err"
  exit 1
}
grep -q 'Unknown argument: unexpected' "$ROOT/wiki-invoke-extra.err" || {
  echo "FAIL: wiki invoke extra positional did not name offending argument"
  cat "$ROOT/wiki-invoke-extra.err"
  exit 1
}

echo "PASS"
