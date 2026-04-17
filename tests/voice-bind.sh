#!/usr/bin/env bash
# voice-bind.sh — verify voice rebinding for a live session updates the durable mapping

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STATE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/aos-voice-bind.XXXXXX")"
trap 'rm -rf "$STATE_ROOT"' EXIT

export AOS_STATE_ROOT="$STATE_ROOT"

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; exit 1; }

./aos clean >/dev/null 2>&1 || true
./aos serve >/tmp/aos-voice-bind.daemon.log 2>&1 &
DAEMON_PID=$!
trap 'kill "$DAEMON_PID" >/dev/null 2>&1 || true; rm -rf "$STATE_ROOT"' EXIT
sleep 1

SESSION_A="voice-bind-a"
SESSION_B="voice-bind-b"

./aos tell --register --session-id "$SESSION_A" --name alpha --role worker --harness codex >/dev/null
./aos tell --register --session-id "$SESSION_B" --name beta --role worker --harness codex >/dev/null

CURRENT_VOICE="$(
  ./aos tell --who | python3 -c 'import json, sys
sessions = json.load(sys.stdin)["sessions"]
for session in sessions:
    if session["session_id"] == "'"$SESSION_A"'":
        print(session.get("voice", {}).get("id", ""))
        raise SystemExit(0)
raise SystemExit(1)
')"
[ -n "$CURRENT_VOICE" ] || fail "expected session A to have an assigned voice"
pass "session A has an initial voice"

TARGET_VOICE="$(
  ./aos voice list | python3 -c 'import json, sys
voices = json.load(sys.stdin)["voices"]
current = "'"$CURRENT_VOICE"'"
for voice in voices:
    if voice["id"] != current:
        print(voice["id"])
        raise SystemExit(0)
raise SystemExit(1)
')"
[ -n "$TARGET_VOICE" ] || fail "expected a different target voice to bind"
pass "found alternate target voice"

OUT="$(./aos voice bind --session-id "$SESSION_A" --voice "$TARGET_VOICE")"
python3 - "$OUT" <<'PY' || fail "voice bind did not succeed: $OUT"
import json, sys
payload = json.loads(sys.argv[1])
if payload.get("status") != "ok":
    raise SystemExit(1)
PY
pass "voice bind succeeded"

BOUND_ID="$(./aos tell --who | python3 -c 'import json, sys
sessions = json.load(sys.stdin)["sessions"]
for session in sessions:
    if session["session_id"] == "'"$SESSION_A"'":
        print(session.get("voice", {}).get("id", ""))
        break
')"
[ "$BOUND_ID" = "$TARGET_VOICE" ] || fail "session did not retain bound voice: expected $TARGET_VOICE got $BOUND_ID"
pass "session reflects bound voice"

./aos tell --unregister --session-id "$SESSION_A" >/dev/null
./aos tell --register --session-id "$SESSION_A" --name alpha --role worker --harness codex >/dev/null

REREGISTERED_ID="$(./aos tell --who | python3 -c 'import json, sys
sessions = json.load(sys.stdin)["sessions"]
for session in sessions:
    if session["session_id"] == "'"$SESSION_A"'":
        print(session.get("voice", {}).get("id", ""))
        break
')"
[ "$REREGISTERED_ID" = "$TARGET_VOICE" ] || fail "re-registered session did not keep bound voice: expected $TARGET_VOICE got $REREGISTERED_ID"
pass "re-registered session keeps bound voice"

ASSIGNED_JSON="$(./aos voice list)"
python3 - "$ASSIGNED_JSON" "$SESSION_A" "$TARGET_VOICE" <<'PY' || fail "voice list did not expose durable assignment"
import json, sys
payload = json.loads(sys.argv[1])
session_id = sys.argv[2]
voice_id = sys.argv[3]
for voice in payload.get("voices", []):
    if voice.get("id") == voice_id:
        assigned = voice.get("assigned_session_ids", [])
        if session_id not in assigned:
            raise SystemExit(1)
        break
else:
    raise SystemExit(1)
PY
pass "voice list shows durable assignment owner"

echo "voice-bind: all checks passed"
