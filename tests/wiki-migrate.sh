#!/usr/bin/env bash
# tests/wiki-migrate.sh
set -euo pipefail

TMP=$(mktemp -d)
trap "rm -rf $TMP" EXIT

mkdir -p "$TMP/wiki/entities" "$TMP/wiki/concepts" "$TMP/wiki/plugins/self-check"
echo "---
type: entity
name: Daemon
---
body" > "$TMP/wiki/entities/daemon.md"
echo "---
type: plugin
name: self-check
---
body" > "$TMP/wiki/plugins/self-check/SKILL.md"

# Run migration (binary under test)
./aos wiki migrate-namespaces --wiki-root "$TMP/wiki"

# Assertions
test -d "$TMP/wiki.pre-namespace-bak" || { echo "FAIL: backup not created"; exit 1; }
test -f "$TMP/wiki/aos/entities/daemon.md" || { echo "FAIL: entities not moved"; exit 1; }
test -f "$TMP/wiki/aos/plugins/self-check/SKILL.md" || { echo "FAIL: plugins not moved"; exit 1; }
test ! -d "$TMP/wiki/entities" || { echo "FAIL: old entities dir still present"; exit 1; }

# Idempotency: second run no-op
./aos wiki migrate-namespaces --wiki-root "$TMP/wiki"
test -f "$TMP/wiki/aos/entities/daemon.md" || { echo "FAIL: second run broke state"; exit 1; }

# Partial-migration recovery: aos/entities/ already moved, but concepts/ still at top level.
TMP2=$(mktemp -d)
trap "rm -rf $TMP $TMP2" EXIT
mkdir -p "$TMP2/wiki/aos/entities" "$TMP2/wiki/concepts"
echo "---
type: entity
name: Daemon
---
body" > "$TMP2/wiki/aos/entities/daemon.md"
echo "---
type: concept
name: Coordinate
---
body" > "$TMP2/wiki/concepts/coordinate.md"

./aos wiki migrate-namespaces --wiki-root "$TMP2/wiki"

test -f "$TMP2/wiki/aos/concepts/coordinate.md" || { echo "FAIL: partial migration did not complete (concepts not moved)"; exit 1; }
test ! -d "$TMP2/wiki/concepts" || { echo "FAIL: top-level concepts/ still present after partial-migration recovery"; exit 1; }
test -f "$TMP2/wiki/aos/entities/daemon.md" || { echo "FAIL: existing aos/entities content lost"; exit 1; }

JSON_OUT="$(./aos wiki migrate-namespaces --wiki-root "$TMP2/wiki" --json)"
JSON_OUT="$JSON_OUT" python3 - <<'PY'
import json
import os

payload = json.loads(os.environ["JSON_OUT"])
assert payload["status"] == "ok", payload
assert payload["migrated"] is False, payload
assert payload["wiki_root"], payload
PY

if ./aos wiki migrate-namespaces --bogus 2>"$TMP/wiki-migrate-bogus.err"; then
  echo "FAIL: migrate-namespaces accepted unknown flag"
  exit 1
fi
grep -q '"code": "UNKNOWN_FLAG"' "$TMP/wiki-migrate-bogus.err" || {
  echo "FAIL: migrate-namespaces unknown flag did not use external script error contract"
  cat "$TMP/wiki-migrate-bogus.err"
  exit 1
}

if ./aos wiki migrate-namespaces extra 2>"$TMP/wiki-migrate-extra.err"; then
  echo "FAIL: migrate-namespaces accepted extra positional"
  exit 1
fi
grep -q '"code": "UNKNOWN_ARG"' "$TMP/wiki-migrate-extra.err" || {
  echo "FAIL: migrate-namespaces extra positional did not use UNKNOWN_ARG"
  cat "$TMP/wiki-migrate-extra.err"
  exit 1
}

if ./aos wiki migrate-namespaces --wiki-root 2>"$TMP/wiki-migrate-missing-value.err"; then
  echo "FAIL: migrate-namespaces accepted missing --wiki-root value"
  exit 1
fi
grep -q '"code": "MISSING_ARG"' "$TMP/wiki-migrate-missing-value.err" || {
  echo "FAIL: migrate-namespaces missing --wiki-root value did not use MISSING_ARG"
  cat "$TMP/wiki-migrate-missing-value.err"
  exit 1
}

echo "PASS"
