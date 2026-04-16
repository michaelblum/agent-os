#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-session-registration"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
SESSION_STATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}-names.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"
export AOS_SESSION_STATE_DIR="$SESSION_STATE_DIR"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT" "$SESSION_STATE_DIR"
}
trap cleanup EXIT

THREAD_ID="019d97cc-2f15-7951-b0bd-3a271d7fb97c"

CODEX_THREAD_ID="$THREAD_ID" AOS_SESSION_HARNESS=codex bash .agents/hooks/session-start.sh >/dev/null

CURRENT_JSON="$(CODEX_THREAD_ID="$THREAD_ID" AOS_SESSION_HARNESS=codex bash scripts/session-name --current)"
CURRENT_NAME="$(printf '%s' "$CURRENT_JSON" | python3 -c 'import json, sys; print(json.load(sys.stdin)["name"])')"

WHO_JSON="$(./aos tell --who)"
python3 - "$WHO_JSON" "$CURRENT_NAME" <<'PY'
import json, sys

payload = json.loads(sys.argv[1])
name = sys.argv[2]
sessions = payload.get("sessions", [])
matches = [s for s in sessions if s.get("name") == name and s.get("harness") == "codex"]
if len(matches) != 1:
    raise SystemExit(f"FAIL: expected one registered codex session named {name}, got {sessions}")
PY

bash scripts/session-name --name wiki-trial --session-id "$THREAD_ID" --harness codex >/dev/null

WHO_JSON="$(./aos tell --who)"
python3 - "$WHO_JSON" "$CURRENT_NAME" <<'PY'
import json, sys

payload = json.loads(sys.argv[1])
old_name = sys.argv[2]
sessions = payload.get("sessions", [])
names = [s.get("name") for s in sessions]
if names.count("wiki-trial") != 1:
    raise SystemExit(f"FAIL: expected wiki-trial to be registered once, got {sessions}")
if old_name in names:
    raise SystemExit(f"FAIL: old generated name still registered: {sessions}")
PY

./aos tell wiki-trial "status update" --from peer-session >/dev/null

MESSAGE_OUTPUT="$(printf '{"session_id":"%s"}' "$THREAD_ID" | AOS_SESSION_HARNESS=codex bash .agents/hooks/check-messages.sh)"
printf '%s' "$MESSAGE_OUTPUT" | grep -q "wiki-trial" || {
  echo "FAIL: check-messages did not resolve the renamed session" >&2
  exit 1
}
printf '%s' "$MESSAGE_OUTPUT" | grep -q "peer-session" || {
  echo "FAIL: check-messages did not report the sender" >&2
  exit 1
}

printf '{"session_id":"%s"}' "$THREAD_ID" | AOS_SESSION_HARNESS=codex bash .agents/hooks/session-stop.sh

WHO_JSON="$(./aos tell --who)"
python3 - "$WHO_JSON" <<'PY'
import json, sys

payload = json.loads(sys.argv[1])
if payload.get("sessions"):
    raise SystemExit(f"FAIL: expected no sessions after stop hook, got {payload['sessions']}")
PY

./aos tell --register wiki-trial --role worker --harness codex >/dev/null
./aos tell --unregister wiki-trial >/dev/null

WHO_JSON="$(./aos tell --who)"
python3 - "$WHO_JSON" <<'PY'
import json, sys

payload = json.loads(sys.argv[1])
if payload.get("sessions"):
    raise SystemExit(f"FAIL: expected no sessions after unregister, got {payload['sessions']}")
PY

echo "PASS"
