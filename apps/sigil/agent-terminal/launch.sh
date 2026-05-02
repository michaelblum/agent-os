#!/bin/bash
# Compatibility launcher for the canonical Sigil Agent Terminal path.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/../codex-terminal/launch.sh" "$@"
