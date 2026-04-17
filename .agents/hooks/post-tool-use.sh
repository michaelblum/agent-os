#!/bin/bash
# Shared post-tool telemetry hook for agent-os providers.

set -euo pipefail
ROOT="$(git -C "$(dirname "$0")/../.." rev-parse --show-toplevel 2>/dev/null || pwd)"
python3 "$ROOT/.agents/hooks/aos-agent-policy.py" post
