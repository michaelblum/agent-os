#!/usr/bin/env bash
# cli-error-log.sh — verify failed CLI attempts are appended to local telemetry

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-cli-errors.XXXXXX")"
trap 'rm -rf "$STATE_ROOT"' EXIT

export AOS_STATE_ROOT="$STATE_ROOT"

LOG_PATH="$AOS_STATE_ROOT/repo/cli-errors.jsonl"

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; exit 1; }

if ./aos definitely-not-a-command >/dev/null 2>/tmp/aos-cli-error.stderr; then
    fail "unknown command unexpectedly succeeded"
fi
pass "unknown command exits non-zero"

[ -f "$LOG_PATH" ] || fail "cli error log was not created at $LOG_PATH"
pass "cli error log file created"

python3 - <<'PY' "$LOG_PATH"
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
lines = [line for line in path.read_text().splitlines() if line.strip()]
if not lines:
    raise SystemExit("FAIL: cli error log is empty")
record = json.loads(lines[-1])
if record.get("code") != "UNKNOWN_COMMAND":
    raise SystemExit(f"FAIL: expected UNKNOWN_COMMAND, got {record!r}")
argv = record.get("argv") or []
if argv[-1:] != ["definitely-not-a-command"]:
    raise SystemExit(f"FAIL: argv not preserved in log: {record!r}")
if record.get("mode") != "repo":
    raise SystemExit(f"FAIL: mode missing from log: {record!r}")
print("PASS: cli error log records argv/code/mode")
PY

echo "cli-error-log: all checks passed"
