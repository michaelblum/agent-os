#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-voice-session-leases"
aos_test_cleanup_prefix "$PREFIX"

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"
export AOS_STATE_ROOT="$ROOT"

cleanup() {
  aos_test_kill_root "$ROOT"
  rm -rf "$ROOT"
}
trap cleanup EXIT

aos_test_start_daemon "$ROOT"

VOICE_JSON="$(./aos voice list)"
python3 - "$VOICE_JSON" <<'PY'
import json, sys

payload = json.loads(sys.argv[1])
voices = payload.get("voices", [])
if not voices:
    raise SystemExit("FAIL: expected at least one curated session voice")
for voice in voices:
    if voice.get("quality_tier") not in {"premium", "enhanced"}:
        raise SystemExit(f"FAIL: curated bank should exclude low-quality voices: {voice}")
PY

SESSIONS=(
  "019d99f0-0001-7000-b000-000000000001"
  "019d99f0-0001-7000-b000-000000000002"
  "019d99f0-0001-7000-b000-000000000003"
  "019d99f0-0001-7000-b000-000000000004"
)

for idx in "${!SESSIONS[@]}"; do
  id="${SESSIONS[$idx]}"
  ./aos tell --register --session-id "$id" --name "voice-$((idx + 1))" --role worker --harness codex >/dev/null
done

WHO_JSON="$(./aos tell --who)"
LEASES_JSON="$(./aos voice leases)"
VOICE_JSON_AFTER="$(./aos voice list)"
python3 - "$WHO_JSON" "$LEASES_JSON" "$VOICE_JSON_AFTER" <<'PY'
import json, sys

who = json.loads(sys.argv[1])
leases = json.loads(sys.argv[2])
voices = json.loads(sys.argv[3])

sessions = who.get("sessions", [])
lease_rows = leases.get("leases", [])
voice_rows = voices.get("voices", [])

if len(sessions) != 4:
    raise SystemExit(f"FAIL: expected four registered sessions, got {sessions}")

assigned = [s["voice"]["id"] for s in sessions if isinstance(s.get("voice"), dict)]
if len(assigned) != len(set(assigned)):
    raise SystemExit(f"FAIL: session voices should be unique, got {assigned}")

if leases.get("lease_count") != len(lease_rows):
    raise SystemExit(f"FAIL: lease_count mismatch: {leases}")
if len(lease_rows) != len(assigned):
    raise SystemExit(f"FAIL: lease rows should match assigned sessions: leases={lease_rows} assigned={assigned}")

occupied = [v["id"] for v in voice_rows if v.get("lease_session_id")]
if set(occupied) != set(assigned):
    raise SystemExit(f"FAIL: voice list occupancy should match session assignments: occupied={occupied} assigned={assigned}")
PY

FIRST_LEASED_SESSION="$(python3 - "$WHO_JSON" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
for session in payload.get("sessions", []):
    if isinstance(session.get("voice"), dict):
        print(session["session_id"])
        break
PY
)"

if [[ -n "$FIRST_LEASED_SESSION" ]]; then
  ./aos tell --unregister --session-id "$FIRST_LEASED_SESSION" >/dev/null
  ./aos tell --register --session-id "019d99f0-0001-7000-b000-000000000005" --name "voice-5" --role worker --harness codex >/dev/null

  WHO_JSON="$(./aos tell --who)"
  python3 - "$WHO_JSON" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
assigned = [s["voice"]["id"] for s in payload.get("sessions", []) if isinstance(s.get("voice"), dict)]
if len(assigned) != len(set(assigned)):
    raise SystemExit(f"FAIL: released voices should be reusable without duplication, got {assigned}")
PY
fi

echo "PASS"
