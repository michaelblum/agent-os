#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

"$ROOT/tests/swift-runtime-typecheck.sh"

echo "PASS desktop pixel native baseline integration typecheck"
