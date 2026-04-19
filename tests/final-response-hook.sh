#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-final-response-hook"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

aos_test_start_daemon "$ROOT"

SESSION_ID="019d99f2-0001-7000-b000-000000000001"

TRANSCRIPT_PATH="$ROOT/rollout-2026-04-17T00-00-00-$SESSION_ID.jsonl"
cat >"$TRANSCRIPT_PATH" <<'EOF'
{"type":"response_item","payload":{"type":"message","role":"assistant","phase":"commentary","content":[{"type":"output_text","text":"Commentary text."}]}}
{"type":"response_item","payload":{"type":"message","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"Transcript fallback sentence."}]}}
{"type":"event_msg","payload":{"type":"task_complete","last_agent_message":"Task-complete fallback sentence."}}
EOF

FALLBACK_PAYLOAD="$(python3 - "$TRANSCRIPT_PATH" <<'PY'
import json, sys
print(json.dumps({
    "transcript_path": sys.argv[1]
}))
PY
)"

./aos tell --register --session-id "$SESSION_ID" --name "hook-voice" --role worker --harness codex >/dev/null
WHO_BEFORE="$(./aos tell --who)"

HOOK_STDOUT="$(printf '%s' "$FALLBACK_PAYLOAD" | AOS_SESSION_HARNESS=codex bash .agents/hooks/final-response.sh)"
python3 - "$HOOK_STDOUT" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
if payload.get("continue") is not True:
    raise SystemExit(f"FAIL: expected codex Stop hook success JSON, got {payload}")
PY

WHO_AFTER="$(./aos tell --who)"
python3 - "$WHO_BEFORE" "$WHO_AFTER" "$SESSION_ID" <<'PY'
import json, sys

before = json.loads(sys.argv[1]).get("data", {}).get("sessions", [])
after = json.loads(sys.argv[2]).get("data", {}).get("sessions", [])
session_id = sys.argv[3]

before_match = [s for s in before if s.get("session_id") == session_id]
after_match = [s for s in after if s.get("session_id") == session_id]
if before_match != after_match:
    raise SystemExit(f"FAIL: final-response relay should not mutate session presence: before={before_match} after={after_match}")
PY

python3 - "$PWD/.codex/hooks.json" <<'PY'
import json, sys

hooks = json.load(open(sys.argv[1])).get("hooks", {})
stop_hooks = [
    hook
    for matcher in hooks.get("Stop", [])
    for hook in matcher.get("hooks", [])
]
stop_commands = [hook.get("command", "") for hook in stop_hooks]
if not any("final-response.sh" in command for command in stop_commands):
    raise SystemExit(f"FAIL: expected codex Stop hook to relay through final-response.sh: {stop_commands}")
if not any("session-stop.sh" in command for command in stop_commands):
    raise SystemExit(f"FAIL: expected codex Stop hook to retain session-stop.sh: {stop_commands}")
final_idx = next((idx for idx, command in enumerate(stop_commands) if "final-response.sh" in command), None)
stop_idx = next((idx for idx, command in enumerate(stop_commands) if "session-stop.sh" in command), None)
if final_idx is None or stop_idx is None or final_idx > stop_idx:
    raise SystemExit(f"FAIL: expected codex final-response relay to run before unregistering: {stop_commands}")
if any(hook.get("async") for hook in stop_hooks if "final-response.sh" in hook.get("command", "")):
    raise SystemExit(f"FAIL: expected codex final-response relay to stay synchronous: {stop_hooks}")
PY

python3 - "$PWD/.claude/settings.json" <<'PY'
import json, sys

hooks = json.load(open(sys.argv[1])).get("hooks", {})
stop_hooks = [
    hook
    for matcher in hooks.get("Stop", [])
    for hook in matcher.get("hooks", [])
]
stop_commands = [hook.get("command", "") for hook in stop_hooks]
if not any("final-response.sh" in command for command in stop_commands):
    raise SystemExit(f"FAIL: expected claude Stop hook to relay through final-response.sh: {stop_commands}")
if not any("session-stop.sh" in command for command in stop_commands):
    raise SystemExit(f"FAIL: expected claude Stop hook to retain session-stop.sh: {stop_commands}")
final_idx = next((idx for idx, command in enumerate(stop_commands) if "final-response.sh" in command), None)
stop_idx = next((idx for idx, command in enumerate(stop_commands) if "session-stop.sh" in command), None)
if final_idx is None or stop_idx is None or final_idx > stop_idx:
    raise SystemExit(f"FAIL: expected claude Stop hook to speak before unregistering: {stop_commands}")
if any(hook.get("async") for hook in stop_hooks if "final-response.sh" in hook.get("command", "")):
    raise SystemExit(f"FAIL: expected claude final-response relay to stay synchronous: {stop_hooks}")
PY

echo "PASS"
