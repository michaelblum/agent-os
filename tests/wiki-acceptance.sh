#!/usr/bin/env bash
# wiki-acceptance.sh — aggregate runner for the AOS wiki writes/namespaces arc.
# Exits on first failure.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

echo "=== wiki-migrate ==="
"$HERE/wiki-migrate.sh"
echo "=== wiki-write-api ==="
"$HERE/wiki-write-api.sh"
echo "=== wiki-change-events ==="
"$HERE/wiki-change-events.sh"
echo "=== wiki-write-emits-event ==="
"$HERE/wiki-write-emits-event.sh"
echo "=== wiki-seed ==="
"$HERE/wiki-seed.sh"
echo "ALL WIKI ACCEPTANCE TESTS PASSED"
