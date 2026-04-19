#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-voice-session-leases"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"
export AOS_TEST_VOICE_BANK_IDS="com.apple.voice.premium.en-US.Zoe,com.apple.voice.premium.en-US.Ava,com.apple.ttsbundle.gryphon-neuralAX_Damon_en-US_premium"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

aos_test_start_daemon "$ROOT"

VOICE_IDS="$(python3 - <<'PY'
import json, sys
voices = [
    "com.apple.voice.premium.en-US.Zoe",
    "com.apple.voice.premium.en-US.Ava",
    "com.apple.ttsbundle.gryphon-neuralAX_Damon_en-US_premium",
]
print("\n".join(voices))
PY
)"

VOICE_IDS_ARRAY=()
while IFS= read -r line; do
  [[ -n "$line" ]] || continue
  VOICE_IDS_ARRAY+=("$line")
done <<<"$VOICE_IDS"
VOICE_COUNT="${#VOICE_IDS_ARRAY[@]}"
SESSION_COUNT=$((VOICE_COUNT + 2))

SESSIONS=()
for idx in $(seq 1 "$SESSION_COUNT"); do
  SESSIONS+=("019d99f0-0001-7000-b000-$(printf '%012d' "$idx")")
done

for idx in "${!SESSIONS[@]}"; do
  id="${SESSIONS[$idx]}"
  ./aos tell --register --session-id "$id" --name "voice-$((idx + 1))" --role worker --harness codex >/dev/null
done

WHO_JSON="$(./aos tell --who)"
VOICE_JSON_AFTER="$(./aos voice list)"
python3 - "$WHO_JSON" "$VOICE_JSON_AFTER" <<'PY'
import json, sys

who = json.loads(sys.argv[1])
voices = json.loads(sys.argv[2])

sessions = who.get("data", {}).get("sessions", [])
voice_rows = voices.get("data", {}).get("voices", [])
voice_ids = [voice["id"] for voice in voice_rows]
expected_sessions = len(voice_rows) + 2

if len(sessions) != expected_sessions:
    raise SystemExit(f"FAIL: expected {expected_sessions} registered sessions, got {sessions}")

ordered_sessions = sorted(sessions, key=lambda session: (session.get("registered_at", 0), session.get("session_id", "")))
assigned = [s["voice"]["id"] for s in ordered_sessions if isinstance(s.get("voice"), dict)]
expected = [voice_ids[idx % len(voice_ids)] for idx in range(len(ordered_sessions))]
if assigned != expected:
    raise SystemExit(f"FAIL: expected round-robin voice assignment {expected}, got {assigned}")

for voice in voice_rows:
    expected_owners = sorted(
        ordered_sessions[idx]["session_id"]
        for idx in range(len(ordered_sessions))
        if assigned[idx] == voice["id"]
    )
    actual_assigned = sorted(voice.get("assigned_session_ids", []))
    actual_leased = sorted(voice.get("lease_session_ids", []))
    if actual_assigned != expected_owners:
        raise SystemExit(f"FAIL: expected durable assignment owners {expected_owners} for {voice['id']}, got {voice}")
    if actual_leased != expected_owners:
        raise SystemExit(f"FAIL: expected active lease owners {expected_owners} for {voice['id']}, got {voice}")
PY

FIRST_SESSION="${SESSIONS[0]}"
ORIGINAL_VOICE="$(python3 - "$WHO_JSON" "$FIRST_SESSION" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
session_id = sys.argv[2]
for session in payload.get("data", {}).get("sessions", []):
    if session.get("session_id") == session_id:
        print(session.get("voice", {}).get("id", ""))
        break
PY
)"

aos_test_kill_root "$ROOT"
aos_test_start_daemon "$ROOT"

./aos tell --unregister --session-id "$FIRST_SESSION" >/dev/null
./aos tell --register --session-id "$FIRST_SESSION" --name "voice-reregistered" --role worker --harness codex >/dev/null

NEW_SESSION_ID="019d99f0-0001-7000-b000-999999999999"
./aos tell --register --session-id "$NEW_SESSION_ID" --name "voice-new" --role worker --harness codex >/dev/null

WHO_JSON="$(./aos tell --who)"
python3 - "$WHO_JSON" "$VOICE_JSON_AFTER" "$NEW_SESSION_ID" "$FIRST_SESSION" "$ORIGINAL_VOICE" <<'PY'
import json, sys

payload = json.loads(sys.argv[1])
voice_rows = json.loads(sys.argv[2]).get("data", {}).get("voices", [])
new_session_id = sys.argv[3]
first_session_id = sys.argv[4]
original_voice = sys.argv[5]
voice_ids = [voice["id"] for voice in voice_rows]
expected_voice = voice_ids[(len(voice_ids) + 2) % len(voice_ids)]
reregistered_ok = False
wrapped_ok = False

for session in payload.get("data", {}).get("sessions", []):
    if session.get("session_id") == first_session_id:
        actual = session.get("voice", {}).get("id")
        if actual != original_voice:
            raise SystemExit(f"FAIL: expected re-registered session to keep voice {original_voice}, got {session}")
        reregistered_ok = True
    if session.get("session_id") == new_session_id:
        actual = session.get("voice", {}).get("id")
        if actual != expected_voice:
            raise SystemExit(f"FAIL: expected wrapped assignment {expected_voice} for new session, got {session}")
        wrapped_ok = True
if not reregistered_ok:
    raise SystemExit(f"FAIL: expected re-registered session {first_session_id} to be present")
if not wrapped_ok:
    raise SystemExit(f"FAIL: expected new session {new_session_id} to be present")
PY

echo "PASS"
