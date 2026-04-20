#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-claude-wrapper.XXXXXX")"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

OUTPUT="$(CLAUDE_CONFIG_DIR= CLAUDE_CODE_DISABLE_AUTO_MEMORY= AOS_CLAUDE_CLI_BIN=python3 "$ROOT/scripts/claude-agent-os" -c '
import json, os
print(json.dumps({
    "claude_config_dir": os.environ.get("CLAUDE_CONFIG_DIR"),
    "claude_auto_memory": os.environ.get("CLAUDE_CODE_DISABLE_AUTO_MEMORY"),
}))
' )"

python3 - "$OUTPUT" "$ROOT" <<'PY'
import json, os, sys

payload = json.loads(sys.argv[1])
root = sys.argv[2]
expected_dir = os.path.join(root, ".runtime", "claude")

if payload.get("claude_config_dir") != expected_dir:
    raise SystemExit(f"FAIL: wrong CLAUDE_CONFIG_DIR: {payload}")
if payload.get("claude_auto_memory") != "1":
    raise SystemExit(f"FAIL: wrong CLAUDE_CODE_DISABLE_AUTO_MEMORY: {payload}")
if not os.path.isdir(expected_dir):
    raise SystemExit(f"FAIL: wrapper did not create config dir {expected_dir}")
PY

echo "PASS"
