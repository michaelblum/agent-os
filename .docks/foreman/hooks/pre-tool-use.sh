#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${AOS_DOCK_REPO_ROOT:-$(cd "$SCRIPT_DIR/../../.." && pwd)}"
exec "$REPO_ROOT/.docks/harness/dock-hook-runner.sh" pre-tool-use foreman
