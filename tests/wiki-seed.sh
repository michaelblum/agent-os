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

if ./aos wiki seed --namespace ../outside-seed \
  --file "agents/default.md:$(pwd)/tests/fixtures/default-agent.md" \
  2>"$ROOT/wiki-seed-namespace-traversal.err"; then
  echo "FAIL: wiki seed accepted traversal namespace"
  exit 1
fi
grep -q '"code": "WIKI_INVALID_PATH"' "$ROOT/wiki-seed-namespace-traversal.err" || {
  echo "FAIL: wiki seed namespace traversal did not use WIKI_INVALID_PATH"
  cat "$ROOT/wiki-seed-namespace-traversal.err"
  exit 1
}
test ! -e "$ROOT/repo/outside-seed" || { echo "FAIL: seed wrote outside namespace root"; exit 1; }

if ./aos wiki seed --namespace seed-test \
  --file "../../outside-seed.md:$(pwd)/tests/fixtures/default-agent.md" \
  2>"$ROOT/wiki-seed-file-traversal.err"; then
  echo "FAIL: wiki seed accepted traversal file mapping"
  exit 1
fi
grep -q '"code": "WIKI_INVALID_PATH"' "$ROOT/wiki-seed-file-traversal.err" || {
  echo "FAIL: wiki seed file traversal did not use WIKI_INVALID_PATH"
  cat "$ROOT/wiki-seed-file-traversal.err"
  exit 1
}
test ! -e "$ROOT/repo/outside-seed.md" || { echo "FAIL: seed wrote outside file mapping"; exit 1; }

if ./aos wiki seed --bogus 2>"$ROOT/wiki-seed-bogus.err"; then
  echo "FAIL: wiki seed accepted unknown flag"
  exit 1
fi
grep -q '"code": "UNKNOWN_FLAG"' "$ROOT/wiki-seed-bogus.err" || {
  echo "FAIL: wiki seed unknown flag did not use external script error contract"
  cat "$ROOT/wiki-seed-bogus.err"
  exit 1
}

if ./aos wiki seed extra 2>"$ROOT/wiki-seed-extra.err"; then
  echo "FAIL: wiki seed accepted extra positional"
  exit 1
fi
grep -q '"code": "UNKNOWN_ARG"' "$ROOT/wiki-seed-extra.err" || {
  echo "FAIL: wiki seed extra positional did not use UNKNOWN_ARG"
  cat "$ROOT/wiki-seed-extra.err"
  exit 1
}

if ./aos wiki seed --namespace --json 2>"$ROOT/wiki-seed-missing-value.err"; then
  echo "FAIL: wiki seed accepted missing --namespace value"
  exit 1
fi
grep -q '"code": "MISSING_ARG"' "$ROOT/wiki-seed-missing-value.err" || {
  echo "FAIL: wiki seed missing --namespace value did not use MISSING_ARG"
  cat "$ROOT/wiki-seed-missing-value.err"
  exit 1
}

rm -rf "$TESTDIR"
echo "PASS"
