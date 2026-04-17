#!/usr/bin/env bash
# voice-bind.sh — verify voice lease rebinding for a live session

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

TARGET_VOICE="$(
  ./aos voice list | python3 -c 'import json, sys
voices = json.load(sys.stdin)["voices"]
for voice in voices:
    if voice.get("lease_session_id") is None:
        print(voice["id"])
        raise SystemExit(0)
raise SystemExit(1)
')"

[ -n "$TARGET_VOICE" ] || fail "expected an unleased voice to bind"
pass "found unleased target voice"

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

echo "voice-bind: all checks passed"
