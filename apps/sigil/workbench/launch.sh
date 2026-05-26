#!/bin/bash
# Compatibility wrapper for the generic AOS app launcher.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
exec "$REPO_ROOT/aos" launch sigil workbench "$@"
