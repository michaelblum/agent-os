#!/usr/bin/env bash
set -euo pipefail

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-wiki-query.XXXXXX")"
ROOT="$(cd "$ROOT" && pwd -P)"
export AOS_STATE_ROOT="$ROOT"
trap 'rm -rf "$ROOT"' EXIT

./aos wiki seed --json >/dev/null

OUT="$(./aos wiki list --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

pages = json.loads(os.environ["OUT"])
assert any(page["path"] == "aos/entities/gateway.md" for page in pages), pages
assert any(page["path"] == "aos/plugins/self-check/SKILL.md" for page in pages), pages
PY

OUT="$(./aos wiki list --type workflow --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

pages = json.loads(os.environ["OUT"])
assert pages, pages
assert all(page["type"] == "workflow" for page in pages), pages
assert any(page["name"] == "self-check" for page in pages), pages
PY

./aos wiki add entity query-test --json >/dev/null
./aos wiki link query-test gateway --json >/dev/null

OUT="$(./aos wiki list --links-to aos/entities/gateway.md --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

links = json.loads(os.environ["OUT"])
assert any(link["source_path"] == "aos/entities/query-test.md" for link in links), links
PY

OUT="$(./aos wiki list --links-from aos/entities/query-test.md --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

links = json.loads(os.environ["OUT"])
assert links == [{"source_path": "aos/entities/query-test.md", "target_path": "aos/entities/gateway.md"}], links
PY

OUT="$(./aos wiki search 'IPC Protocol' --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

pages = json.loads(os.environ["OUT"])
assert any(page["path"] == "aos/concepts/ipc-protocol.md" for page in pages), pages
PY

OUT="$(./aos wiki list --orphans --json)"
OUT="$OUT" python3 - <<'PY'
import json
import os

pages = json.loads(os.environ["OUT"])
assert isinstance(pages, list), pages
PY

if ./aos wiki list --bogus 2>"$ROOT/wiki-list-bogus.err"; then
  echo "FAIL: wiki list accepted unknown flag"
  exit 1
fi
grep -q '"code": "UNKNOWN_FLAG"' "$ROOT/wiki-list-bogus.err" || {
  echo "FAIL: wiki list unknown flag did not use external script error contract"
  cat "$ROOT/wiki-list-bogus.err"
  exit 1
}

if ./aos wiki list --type --json 2>"$ROOT/wiki-list-type-missing.err"; then
  echo "FAIL: wiki list accepted missing --type value"
  exit 1
fi
grep -q '"code": "MISSING_ARG"' "$ROOT/wiki-list-type-missing.err" || {
  echo "FAIL: wiki list missing --type value did not use external script error contract"
  cat "$ROOT/wiki-list-type-missing.err"
  exit 1
}

if ./aos wiki search --bogus 2>"$ROOT/wiki-search-bogus.err"; then
  echo "FAIL: wiki search accepted unknown flag"
  exit 1
fi
grep -q '"code": "UNKNOWN_FLAG"' "$ROOT/wiki-search-bogus.err" || {
  echo "FAIL: wiki search unknown flag did not use external script error contract"
  cat "$ROOT/wiki-search-bogus.err"
  exit 1
}

if ./aos wiki search gateway --type --json 2>"$ROOT/wiki-search-type-missing.err"; then
  echo "FAIL: wiki search accepted missing --type value"
  exit 1
fi
grep -q '"code": "MISSING_ARG"' "$ROOT/wiki-search-type-missing.err" || {
  echo "FAIL: wiki search missing --type value did not use external script error contract"
  cat "$ROOT/wiki-search-type-missing.err"
  exit 1
}

echo "PASS"
