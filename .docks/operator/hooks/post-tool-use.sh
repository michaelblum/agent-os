#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="${AOS_DOCK_REPO_ROOT:-/Users/Michael/Code/agent-os}"
exec "$REPO_ROOT/.docks/harness/post-tool-use-runner.sh" post-tool-use operator
