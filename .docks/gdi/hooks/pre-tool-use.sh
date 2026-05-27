#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${AOS_DOCK_REPO_ROOT:-/Users/Michael/Code/agent-os}"
exec "$REPO_ROOT/.docks/harness/pre-tool-use-runner.sh" pre-tool-use gdi
