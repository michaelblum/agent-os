#!/usr/bin/env bash
set -euo pipefail

PREFIX="aos-wiki-seed"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
ROOT="$(cd "$ROOT" && pwd -P)"
export AOS_STATE_ROOT="$ROOT"
trap 'rm -rf "$ROOT"' EXIT

WIKI="$ROOT/repo/wiki"
TESTDIR="$WIKI/seed-test"
rm -rf "$TESTDIR"

./aos wiki seed --namespace seed-test \
  --file "agents/default.md:$(pwd)/tests/fixtures/default-agent.md"

test -f "$TESTDIR/agents/default.md" || { echo "FAIL: seed not written"; exit 1; }
ORIG_MTIME=$(stat -f %m "$TESTDIR/agents/default.md")

# Idempotent — second call no-op
sleep 1
./aos wiki seed --namespace seed-test \
  --file "agents/default.md:$(pwd)/tests/fixtures/default-agent.md"
NEW_MTIME=$(stat -f %m "$TESTDIR/agents/default.md")
test "$ORIG_MTIME" = "$NEW_MTIME" || { echo "FAIL: seed overwrote existing"; exit 1; }

if ./aos wiki seed --bogus 2>"$ROOT/wiki-seed-bogus.err"; then
  echo "FAIL: wiki seed accepted unknown flag"
  exit 1
fi
grep -q '"code": "UNKNOWN_FLAG"' "$ROOT/wiki-seed-bogus.err" || {
  echo "FAIL: wiki seed unknown flag did not use external script error contract"
  cat "$ROOT/wiki-seed-bogus.err"
  exit 1
}

rm -rf "$TESTDIR"
echo "PASS"
