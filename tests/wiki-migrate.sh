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

echo "PASS"
