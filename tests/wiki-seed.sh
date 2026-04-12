#!/usr/bin/env bash
set -euo pipefail

WIKI="$HOME/.config/aos/repo/wiki"
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

rm -rf "$TESTDIR"
echo "PASS"
