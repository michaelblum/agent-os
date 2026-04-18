#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel 2>/dev/null || pwd)"
POLICY="$ROOT/.agents/hooks/aos-agent-policy.py"
STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-agent-policy.XXXXXX")"
STDOUT_FILE="$STATE_ROOT/stdout.txt"
STDERR_FILE="$STATE_ROOT/stderr.txt"

cleanup() {
  rm -rf "$STATE_ROOT"
}
trap cleanup EXIT

export AOS_STATE_ROOT="$STATE_ROOT"
export AOS_RUNTIME_MODE="repo"
export AOS_SESSION_ID="policy-session-$$"
export AOS_SESSION_HARNESS="codex"

mkdir -p "$STATE_ROOT/repo/agent-introspection/sessions"
cat > "$STATE_ROOT/repo/agent-introspection/aos-usage.jsonl" <<'EOF'
{"timestamp":"2000-01-01T00:00:00Z","session":"expired-session","harness":"codex","source":"post","command":"./aos old","command_path":["old"],"prefix":"./aos","outcome":"error","exit_code":1,"error_code":"UNKNOWN_COMMAND"}
EOF
cat > "$STATE_ROOT/repo/agent-introspection/sessions/expired-session.json" <<'EOF'
{"session":"expired-session","harness":"codex","consecutive_failures":7,"total_events":9,"last_updated":"2000-01-01T00:00:00Z"}
EOF

if printf '{"tool_input":{"command":"aos status"}}' | python3 "$POLICY" pre >"$STDOUT_FILE" 2>"$STDERR_FILE"; then
  echo "FAIL: bare aos invocation should have been blocked" >&2
  exit 1
else
  STATUS=$?
fi
[[ "$STATUS" -eq 2 ]] || {
  echo "FAIL: bare aos invocation should return exit code 2" >&2
  exit 1
}
grep -q 'use ./aos, not aos' "$STDERR_FILE" || {
  echo "FAIL: bare aos block message missing repo-mode guidance" >&2
  exit 1
}

[[ ! -f "$STATE_ROOT/repo/agent-introspection/sessions/expired-session.json" ]] || {
  echo "FAIL: expired session state was not pruned" >&2
  exit 1
}
if grep -q 'expired-session' "$STATE_ROOT/repo/agent-introspection/aos-usage.jsonl"; then
  echo "FAIL: expired usage log entry was not pruned" >&2
  exit 1
fi

python3 - "$STATE_ROOT/repo/agent-introspection" "$AOS_SESSION_ID" <<'PY'
import json, pathlib, sys

root = pathlib.Path(sys.argv[1])
session = sys.argv[2]
state = json.loads((root / "sessions" / f"{session}.json").read_text())
if state.get("consecutive_failures") != 1:
    raise SystemExit(f"FAIL: expected streak=1 after bare aos block, got {state}")
events = [json.loads(line) for line in (root / "aos-usage.jsonl").read_text().splitlines() if line.strip()]
latest = events[-1]
if latest.get("error_code") != "USE_REPO_AOS" or latest.get("outcome") != "blocked":
    raise SystemExit(f"FAIL: unexpected latest event after bare aos block: {latest}")
PY

printf '%s' '{"tool_input":{"command":"./aos status --json"},"tool_output":{"stdout":"{\"status\":\"ok\"}\n","stderr":"","exit_code":0,"duration_ms":12}}' \
  | python3 "$POLICY" post >/dev/null

python3 - "$STATE_ROOT/repo/agent-introspection" "$AOS_SESSION_ID" <<'PY'
import json, pathlib, sys

root = pathlib.Path(sys.argv[1])
session = sys.argv[2]
state = json.loads((root / "sessions" / f"{session}.json").read_text())
if state.get("consecutive_failures") != 0:
    raise SystemExit(f"FAIL: expected streak reset after successful ./aos call, got {state}")
PY

for _ in 1 2 3 4; do
  printf '%s' '{"tool_input":{"command":"./aos frob"},"tool_output":{"stdout":"","stderr":"{\"error\":\"unknown command\",\"code\":\"UNKNOWN_COMMAND\"}\n","exit_code":1,"duration_ms":5}}' \
    | python3 "$POLICY" post >/dev/null
done

python3 - "$STATE_ROOT/repo/agent-introspection" "$AOS_SESSION_ID" <<'PY'
import json, pathlib, sys

root = pathlib.Path(sys.argv[1])
session = sys.argv[2]
state = json.loads((root / "sessions" / f"{session}.json").read_text())
if state.get("consecutive_failures") != 4:
    raise SystemExit(f"FAIL: expected streak=4 after repeated errors, got {state}")
PY

if printf '{"tool_input":{"command":"./aos see cursor"}}' | python3 "$POLICY" pre >"$STDOUT_FILE" 2>"$STDERR_FILE"; then
  echo "FAIL: repeated failures should block more shell work" >&2
  exit 1
else
  STATUS=$?
fi
[[ "$STATUS" -eq 2 ]] || {
  echo "FAIL: repeated failure gate should return exit code 2" >&2
  exit 1
}
grep -q 'Run ./aos introspect review or ./aos help/status' "$STDERR_FILE" || {
  echo "FAIL: repeated failure gate message missing recovery guidance" >&2
  exit 1
}

printf '{"tool_input":{"command":"./aos introspect review"}}' | python3 "$POLICY" pre >/dev/null 2>"$STDERR_FILE" || {
  echo "FAIL: introspect review should be allowed as a recovery command" >&2
  cat "$STDERR_FILE" >&2
  exit 1
}

printf '{"tool_input":{"command":"./aos introspect"}}' | python3 "$POLICY" pre >/dev/null 2>"$STDERR_FILE" || {
  echo "FAIL: bare introspect should be allowed as a recovery command" >&2
  cat "$STDERR_FILE" >&2
  exit 1
}

echo "PASS"
