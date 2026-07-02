#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

tests=(
    tests/agent-workspace-storage.sh
    tests/agent-workspace-browser-refs.sh
    tests/agent-workspace-canvas-refs.sh
    tests/agent-workspace-native-refs.sh
    tests/agent-workspace-cleanup.sh
    tests/agent-workspace-contract-drift.sh
)

for test_script in "${tests[@]}"; do
    bash "$ROOT/$test_script"
done

echo "PASS saved-ref suite"
