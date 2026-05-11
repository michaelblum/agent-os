#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${AOS_DOCK_REPO_ROOT:-/Users/Michael/Code/agent-os}"
exec "$REPO_ROOT/.docks/harness/dock-hook-runner.sh" session-start gdi
