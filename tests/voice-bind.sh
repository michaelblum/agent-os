#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-voice-bind"
aos_test_cleanup_prefix "$PREFIX"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"

# Set env BEFORE starting daemon — daemon inherits it on fork.
# Mock provider is additive (alongside system + elevenlabs), see Task 7.
export AOS_STATE_ROOT="$ROOT"
export AOS_VOICE_TEST_PROVIDERS=mock

cleanup() { aos_test_kill_root "$ROOT"; rm -rf "$ROOT"; }
trap cleanup EXIT

mkdir -p "$ROOT/repo/voice"
aos_test_start_daemon "$ROOT"

SID="11111111-2222-3333-4444-555555555555"
./aos tell --register --session-id "$SID" --name bind-test >/dev/null

voice_for() {
    ./aos voice assignments --json | python3 -c "
import json, sys
sid = '$SID'
data = json.loads(sys.stdin.read())['data']['assignments']
match = next((e for e in data if e['session_id'] == sid and e.get('voice')), None)
print(match['voice']['id'] if match else '')
"
}

# Bind to non-existent URI -> VOICE_NOT_FOUND.
err=$(./aos voice bind --session-id "$SID" --voice "voice://mock/nope" 2>&1 || true)
echo "$err" | grep -q '"code":"VOICE_NOT_FOUND"' || { echo "FAIL: missing VOICE_NOT_FOUND in $err" >&2; exit 1; }

# Real allocatable mock voice -> success.
ok=$(./aos voice bind --session-id "$SID" --voice "voice://mock/mock-alpha" 2>&1)
# Success path: outer envelope is always "success"; success data contains
# "voice":{...} inline, while error data contains "error":{"code":...}.
# Use the inner "voice":{ marker as the success discriminator.
echo "$ok" | grep -q '"voice":{' || { echo "FAIL: bind ok: $ok" >&2; exit 1; }
[[ "$(voice_for)" == "voice://mock/mock-alpha" ]] || { echo "FAIL: exact bind did not stick" >&2; exit 1; }

# Filter bind: pick a random male mock voice. Mock fixture males are bravo/delta.
male_1=$(./aos voice bind --session-id "$SID" --provider mock --gender male --json | python3 -c "
import json, sys
print(json.loads(sys.stdin.read())['data']['voice']['id'])
")
[[ "$male_1" == "voice://mock/mock-bravo" || "$male_1" == "voice://mock/mock-delta" ]] || {
  echo "FAIL: male filter picked unexpected voice $male_1" >&2; exit 1;
}

# A second filter bind should choose the other male voice when there is more
# than one allocatable match.
male_2=$(./aos voice bind --session-id "$SID" --provider mock --gender male --json | python3 -c "
import json, sys
print(json.loads(sys.stdin.read())['data']['voice']['id'])
")
[[ "$male_2" == "voice://mock/mock-bravo" || "$male_2" == "voice://mock/mock-delta" ]] || {
  echo "FAIL: second male filter picked unexpected voice $male_2" >&2; exit 1;
}
[[ "$male_2" != "$male_1" ]] || { echo "FAIL: second male filter did not switch voice ($male_1)" >&2; exit 1; }

# Tag filter: only echo carries the novelty tag in the mock fixture.
novelty=$(./aos voice bind --session-id "$SID" --provider mock --tag novelty --json | python3 -c "
import json, sys
print(json.loads(sys.stdin.read())['data']['voice']['id'])
")
[[ "$novelty" == "voice://mock/mock-echo" ]] || { echo "FAIL: novelty tag should bind echo, got $novelty" >&2; exit 1; }

# Disable that voice via policy and re-bind -> VOICE_NOT_ALLOCATABLE.
cat > "$ROOT/repo/voice/policy.json" <<JSON
{"schema_version":1,"providers":{},"voices":{"disabled":["voice://mock/mock-alpha"]},"session_preferences":{}}
JSON
sleep 1  # let policy watcher fire
err=$(./aos voice bind --session-id "$SID" --voice "voice://mock/mock-alpha" 2>&1 || true)
echo "$err" | grep -q '"code":"VOICE_NOT_ALLOCATABLE"' || { echo "FAIL: missing VOICE_NOT_ALLOCATABLE in $err" >&2; exit 1; }

# ElevenLabs stub voices return VOICE_NOT_SPEAKABLE (provider always present
# alongside mock; no daemon restart needed).
err=$(./aos voice bind --session-id "$SID" --voice "voice://elevenlabs/21m00Tcm4TlvDq8ikWAM" 2>&1 || true)
echo "$err" | grep -q '"code":"VOICE_NOT_SPEAKABLE"' || { echo "FAIL: missing VOICE_NOT_SPEAKABLE in $err" >&2; exit 1; }

./aos tell --unregister --session-id "$SID" >/dev/null 2>&1 || true

echo "ok"
