#!/bin/bash
# Historical compatibility launcher for the canonical Sigil Agent Terminal path.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$SCRIPT_DIR/../agent-terminal/launch.sh" "$@"
