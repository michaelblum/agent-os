#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
POLICY="$ROOT/.agents/hooks/aos-agent-policy.py"
STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-status-introspect.XXXXXX")"

cleanup() {
  rm -rf "$STATE_ROOT"
}
trap cleanup EXIT

export AOS_STATE_ROOT="$STATE_ROOT"
export AOS_RUNTIME_MODE="repo"
export AOS_SESSION_ID="status-introspect-$$"
export AOS_SESSION_HARNESS="codex"

cd "$ROOT"

HELP_TEXT="$(./aos --help)"
FIRST_COMMAND="$(printf '%s\n' "$HELP_TEXT" | awk '/^  [a-z0-9-]+/{print $1; exit}')"
[[ "$HELP_TEXT" == *"Usage: ./aos <command> [options]"* ]] || {
  echo "FAIL: ./aos --help should render repo-mode invocation prefix" >&2
  exit 1
}
[[ "$FIRST_COMMAND" == "status" ]] || {
  echo "FAIL: status should be the first top-level help entry, got '$FIRST_COMMAND'" >&2
  exit 1
}

STATUS_JSON="$(./aos status --json)"
python3 - "$STATUS_JSON" <<'PY'
import json, sys

payload = json.loads(sys.argv[1])
required = {"status", "identity", "runtime", "permissions", "stale_resources", "recommended_entrypoints"}
missing = sorted(required - payload.keys())
if missing:
    raise SystemExit(f"FAIL: status payload missing keys: {missing}")
entrypoints = payload.get("recommended_entrypoints", [])
expected = ["./aos help <command> [--json]", "./aos introspect review", "./aos clean"]
if entrypoints != expected:
    raise SystemExit(f"FAIL: unexpected recommended_entrypoints: {entrypoints}")
PY

printf '{"tool_input":{"command":"aos status"}}' | python3 "$POLICY" pre >/dev/null 2>/dev/null || true
printf '%s' '{"tool_input":{"command":"./aos status --json"},"tool_output":{"stdout":"{\"status\":\"ok\"}\n","stderr":"","exit_code":0,"duration_ms":11}}' \
  | python3 "$POLICY" post >/dev/null

INTROSPECT_JSON="$(./aos introspect review --json)"
python3 - "$INTROSPECT_JSON" "$STATE_ROOT" <<'PY'
import json, os, sys

payload = json.loads(sys.argv[1])
state_root = sys.argv[2]
if payload.get("successes") != 1 or payload.get("failures") != 1:
    raise SystemExit(f"FAIL: unexpected introspect counters: {payload}")
if "status" not in payload.get("mastered_commands", []):
    raise SystemExit(f"FAIL: status should be counted as a mastered command: {payload}")
learnings = payload.get("learnings", [])
if not any("invoke the binary as `./aos`, not `aos`" in line for line in learnings):
    raise SystemExit(f"FAIL: missing repo-mode invocation learning: {payload}")
log_path = payload.get("log_path", "")
expected_prefix = os.path.realpath(os.path.join(state_root, "repo", "agent-introspection"))
if not os.path.realpath(log_path).startswith(expected_prefix):
    raise SystemExit(f"FAIL: introspect log path should live under temp repo-mode state root: {log_path}")
PY

echo "PASS"
