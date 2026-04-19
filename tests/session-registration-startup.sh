#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-session-registration"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

THREAD_A="019d97cc-2f15-7951-b0bd-3a271d7fb97c"
THREAD_B="019d97d0-0ea8-72ff-b0bd-3a271d7fb980"
SESSIONS_PATH="$ROOT/repo/coordination/sessions.json"
SESSION_STATE_DIR="$ROOT/repo/coordination/session-state"

python3 - "$PWD/.codex/hooks.json" <<'PY'
import json, sys

hooks = json.load(open(sys.argv[1])).get("hooks", {})
stop_hooks = hooks.get("Stop", [])
commands = []
for matcher in stop_hooks:
    for hook in matcher.get("hooks", []):
        commands.append(hook.get("command", ""))
if not any("final-response.sh" in command for command in commands):
    raise SystemExit(f"FAIL: Codex Stop hook missing final-response relay: {commands}")
if not any("session-stop.sh" in command for command in commands):
    raise SystemExit(f"FAIL: Codex Stop hook missing session-stop cleanup: {commands}")
PY

CODEX_THREAD_ID="$THREAD_A" AOS_SESSION_HARNESS=codex bash .agents/hooks/session-start.sh >/dev/null

CURRENT_JSON="$(CODEX_THREAD_ID="$THREAD_A" AOS_SESSION_HARNESS=codex bash scripts/session-name --current)"
CURRENT_NAME="$(printf '%s' "$CURRENT_JSON" | python3 -c 'import json, sys; payload = json.load(sys.stdin); print(payload["name"]); assert payload["channel"] == payload["session_id"]')"

WHO_JSON=""
for _ in $(seq 1 20); do
  WHO_JSON="$(./aos tell --who)"
  if python3 - "$WHO_JSON" "$THREAD_A" <<'PY'
import json, sys
sessions = json.loads(sys.argv[1]).get("data", {}).get("sessions", [])
session_id = sys.argv[2]
raise SystemExit(0 if any(s.get("session_id") == session_id for s in sessions) else 1)
PY
  then
    break
  fi
  sleep 0.1
done
python3 - "$WHO_JSON" "$CURRENT_NAME" "$THREAD_A" "$SESSIONS_PATH" <<'PY'
import json, sys
from pathlib import Path

payload = json.loads(sys.argv[1])
name = sys.argv[2]
session_id = sys.argv[3]
sessions_path = Path(sys.argv[4])
sessions = payload.get("data", {}).get("sessions", [])
matches = [s for s in sessions if s.get("session_id") == session_id and s.get("name") == name and s.get("harness") == "codex"]
if len(matches) != 1:
    raise SystemExit(f"FAIL: expected one registered codex session {session_id} named {name}, got {sessions}")
registry = json.loads(sessions_path.read_text())
if [s for s in registry.get("sessions", []) if s.get("session_id") == session_id and s.get("name") == name] != matches:
    raise SystemExit(f"FAIL: expected runtime sessions file to mirror {session_id}, got {registry}")
PY

bash scripts/session-name --name wiki-trial --session-id "$THREAD_A" --harness codex >/dev/null

NAME_FILE="$SESSION_STATE_DIR/name-$THREAD_A"
[[ -f "$NAME_FILE" ]] || {
  echo "FAIL: expected name override at $NAME_FILE" >&2
  exit 1
}
[[ "$(tr -d '\n' < "$NAME_FILE")" == "wiki-trial" ]] || {
  echo "FAIL: expected persisted name override to be wiki-trial" >&2
  exit 1
}

WHO_JSON="$(./aos tell --who)"
python3 - "$WHO_JSON" "$CURRENT_NAME" "$THREAD_A" <<'PY'
import json, sys

payload = json.loads(sys.argv[1])
old_name = sys.argv[2]
session_id = sys.argv[3]
sessions = payload.get("data", {}).get("sessions", [])
names = [s.get("name") for s in sessions]
ids = [s.get("session_id") for s in sessions]
if names.count("wiki-trial") != 1:
    raise SystemExit(f"FAIL: expected wiki-trial to be registered once, got {sessions}")
if old_name in names:
    raise SystemExit(f"FAIL: old generated name still registered: {sessions}")
if ids.count(session_id) != 1:
    raise SystemExit(f"FAIL: expected canonical session id {session_id} to stay stable, got {sessions}")
PY

CODEX_THREAD_ID="$THREAD_B" AOS_SESSION_HARNESS=codex bash .agents/hooks/session-start.sh >/dev/null

WHO_JSON=""
for _ in $(seq 1 20); do
  WHO_JSON="$(./aos tell --who)"
  if python3 - "$WHO_JSON" "$THREAD_A" "$THREAD_B" <<'PY'
import json, sys
sessions = json.loads(sys.argv[1]).get("data", {}).get("sessions", [])
expected = {sys.argv[2], sys.argv[3]}
actual = {s.get("session_id") for s in sessions}
raise SystemExit(0 if actual == expected else 1)
PY
  then
    break
  fi
  sleep 0.1
done
python3 - "$WHO_JSON" "$THREAD_A" "$THREAD_B" <<'PY'
import json, sys

payload = json.loads(sys.argv[1])
expected = {sys.argv[2], sys.argv[3]}
actual = {s.get("session_id") for s in payload.get("data", {}).get("sessions", [])}
if actual != expected:
    raise SystemExit(f"FAIL: expected live session ids {expected}, got {payload.get('data', {}).get('sessions', [])}")
PY

aos_test_kill_root "$ROOT"

WHO_JSON="$(./aos tell --who)"
python3 - "$WHO_JSON" "$THREAD_A" "$THREAD_B" <<'PY'
import json, sys

payload = json.loads(sys.argv[1])
expected = {sys.argv[2], sys.argv[3]}
actual = {s.get("session_id") for s in payload.get("data", {}).get("sessions", [])}
if actual != expected:
    raise SystemExit(f"FAIL: expected daemon restart to restore live session ids {expected}, got {payload.get('data', {}).get('sessions', [])}")
PY

./aos tell --unregister --session-id "$THREAD_A" >/dev/null
./aos tell --unregister --session-id "$THREAD_B" >/dev/null

WHO_JSON="$(./aos tell --who)"
python3 - "$WHO_JSON" <<'PY'
import json, sys

payload = json.loads(sys.argv[1])
if payload.get("data", {}).get("sessions"):
    raise SystemExit(f"FAIL: expected empty live registry after forced unregister, got {payload.get('data', {}).get('sessions', [])}")
PY

printf '{"session_id":"%s"}' "$THREAD_A" | AOS_SESSION_HARNESS=codex bash .agents/hooks/check-messages.sh >/dev/null
printf '{"session_id":"%s"}' "$THREAD_B" | AOS_SESSION_HARNESS=codex bash .agents/hooks/check-messages.sh >/dev/null

WHO_JSON="$(./aos tell --who)"
python3 - "$WHO_JSON" "$THREAD_A" "$THREAD_B" <<'PY'
import json, sys

payload = json.loads(sys.argv[1])
expected = {sys.argv[2], sys.argv[3]}
actual = {s.get("session_id") for s in payload.get("data", {}).get("sessions", [])}
if actual != expected:
    raise SystemExit(f"FAIL: expected post-tool hook to restore live session ids {expected}, got {payload.get('data', {}).get('sessions', [])}")
PY

./aos tell --session-id "$THREAD_A" "status update" --from "$THREAD_B" >/dev/null
./aos tell --session-id "$THREAD_B" "reply update" --from "$THREAD_A" >/dev/null

MESSAGE_OUTPUT_A="$(printf '{"session_id":"%s"}' "$THREAD_A" | AOS_SESSION_HARNESS=codex bash .agents/hooks/check-messages.sh)"
printf '%s' "$MESSAGE_OUTPUT_A" | grep -q "wiki-trial" || {
  echo "FAIL: check-messages did not report the renamed session label" >&2
  exit 1
}
printf '%s' "$MESSAGE_OUTPUT_A" | grep -q "$THREAD_B" || {
  echo "FAIL: check-messages did not report the canonical sender id" >&2
  exit 1
}
printf '%s' "$MESSAGE_OUTPUT_A" | grep -q "listen --session-id $THREAD_A" || {
  echo "FAIL: check-messages did not point to the canonical listen command" >&2
  exit 1
}

MESSAGE_OUTPUT_B="$(printf '{"session_id":"%s"}' "$THREAD_B" | AOS_SESSION_HARNESS=codex bash .agents/hooks/check-messages.sh)"
printf '%s' "$MESSAGE_OUTPUT_B" | grep -q "$THREAD_A" || {
  echo "FAIL: second session did not receive the reply on its canonical channel" >&2
  exit 1
}

READ_JSON="$(./aos listen --session-id "$THREAD_A")"
python3 - "$READ_JSON" "$THREAD_A" "$THREAD_B" <<'PY'
import json, sys

payload = json.loads(sys.argv[1])
session_id = sys.argv[2]
sender = sys.argv[3]
messages = payload.get("data", {}).get("messages", [])
if not messages:
    raise SystemExit("FAIL: expected at least one direct message for session A")
latest = messages[-1]
if latest.get("channel") != session_id or latest.get("from") != sender or latest.get("payload") != "status update":
    raise SystemExit(f"FAIL: expected canonical direct message on {session_id}, got {latest}")
PY

./aos tell --register --session-id "$THREAD_A" --name wiki-trial --role worker --harness codex >/dev/null
WHO_JSON="$(./aos tell --who)"
python3 - "$WHO_JSON" "$THREAD_A" <<'PY'
import json, sys

payload = json.loads(sys.argv[1])
session_id = sys.argv[2]
matches = [s for s in payload.get("data", {}).get("sessions", []) if s.get("session_id") == session_id]
if len(matches) != 1:
    raise SystemExit(f"FAIL: expected session-id register path to refresh {session_id} without duplicating ids, got {payload.get('data', {}).get('sessions', [])}")
PY

printf '{"session_id":"%s"}' "$THREAD_A" | AOS_SESSION_HARNESS=codex bash .agents/hooks/session-stop.sh
printf '{"session_id":"%s"}' "$THREAD_B" | AOS_SESSION_HARNESS=codex bash .agents/hooks/session-stop.sh

WHO_JSON="$(./aos tell --who)"
python3 - "$WHO_JSON" <<'PY'
import json, sys

payload = json.loads(sys.argv[1])
if payload.get("data", {}).get("sessions"):
    raise SystemExit(f"FAIL: expected no sessions after unregister, got {payload.get('data', {}).get('sessions', [])}")
PY

python3 - "$SESSIONS_PATH" <<'PY'
import json, sys
payload = json.load(open(sys.argv[1]))
if payload.get("sessions"):
    raise SystemExit(f"FAIL: expected empty persisted runtime session file, got {payload}")
PY

echo "PASS"
