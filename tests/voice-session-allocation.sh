#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-voice-session-allocation"
aos_test_cleanup_prefix "$PREFIX"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"

export AOS_STATE_ROOT="$ROOT"
export AOS_VOICE_TEST_PROVIDERS=mock

cleanup() { aos_test_kill_root "$ROOT"; rm -rf "$ROOT"; }
trap cleanup EXIT

mkdir -p "$ROOT/repo/voice"
cat > "$ROOT/repo/voice/policy.json" <<JSON
{
  "schema_version": 1,
  "providers": {
    "system":     { "enabled": false },
    "elevenlabs": { "enabled": false }
  },
  "voices":              { "disabled": [] },
  "session_preferences": {}
}
JSON

aos_test_start_daemon "$ROOT"

S1="11111111-1111-1111-1111-111111111111"
S2="22222222-2222-2222-2222-222222222222"
S3="33333333-3333-3333-3333-333333333333"
S4="44444444-4444-4444-4444-444444444444"
S5="55555555-5555-5555-5555-555555555555"
S6="66666666-6666-6666-6666-666666666666"
S7="77777777-7777-7777-7777-777777777777"
S8="88888888-8888-8888-8888-888888888888"

V_ALPHA="voice://mock/mock-alpha"
V_BRAVO="voice://mock/mock-bravo"
V_CHARLIE="voice://mock/mock-charlie"
V_DELTA="voice://mock/mock-delta"
V_ECHO="voice://mock/mock-echo"

assignments_json() { ./aos voice assignments --json; }

voice_for() {
    local sid="$1"
    assignments_json | python3 -c "
import json, sys
sid = '$sid'
data = json.loads(sys.stdin.read())['data']['assignments']
match = next((e for e in data if e['session_id'] == sid and e.get('voice')), None)
print(match['voice']['id'] if match else '')
"
}

assert_eq() {
    local got="$1"; local want="$2"; local label="$3"
    if [[ "$got" != "$want" ]]; then
        echo "FAIL [$label]: got=$got want=$want" >&2
        exit 1
    fi
}

assert_in_pool() {
    local got="$1"; local label="$2"
    case "$got" in
        "$V_ALPHA"|"$V_BRAVO"|"$V_CHARLIE"|"$V_DELTA"|"$V_ECHO") ;;
        *)
            echo "FAIL [$label]: unexpected pool voice $got" >&2
            exit 1
            ;;
    esac
}

# Fresh sessions get random enabled+speakable voices from the pool.
for sid in "$S1" "$S2" "$S3" "$S4" "$S5" "$S6" "$S7"; do
    ./aos tell --register --session-id "$sid" --name "sess-${sid:0:1}" >/dev/null
    assert_in_pool "$(voice_for "$sid")" "$sid gets pool voice"
done

assignments_json | python3 -c "
import json, sys
allowed = {'$V_ALPHA','$V_BRAVO','$V_CHARLIE','$V_DELTA','$V_ECHO'}
data = json.loads(sys.stdin.read())['data']['assignments']
ids = [e['voice']['id'] for e in data if e.get('voice')]
assert len(ids) == 7, f'expected 7 assigned voices, got {ids}'
assert set(ids) <= allowed, f'unexpected voice outside pool: {set(ids) - allowed}'
assert len(set(ids)) < len(ids), f'expected duplicates once sessions exceed pool size: {ids}'
print('random fallback ok')
"

# Exact bind pins a concrete voice.
./aos voice bind --session-id "$S2" --voice "$V_DELTA" >/dev/null
assert_eq "$(voice_for "$S2")" "$V_DELTA" "S2 exact bind reflected"
echo "exact bind ok"

# Restart should preserve stored concrete session voices.
aos_test_kill_root "$ROOT"
aos_test_start_daemon "$ROOT"

assert_eq "$(voice_for "$S2")" "$V_DELTA" "S2 retains bound voice after restart"
assert_in_pool "$(voice_for "$S1")" "S1 restored from snapshot"
echo "restart persistence ok"

# New sessions after restart still pick from the same pool.
./aos tell --register --session-id "$S8" --name "sess-8" >/dev/null
assert_in_pool "$(voice_for "$S8")" "S8 gets pool voice after restart"
echo "post-restart random fallback ok"

# Rebinding still works after restart.
./aos voice bind --session-id "$S8" --voice "$V_CHARLIE" >/dev/null
assert_eq "$(voice_for "$S8")" "$V_CHARLIE" "post-restart bind persists"
echo "post-restart bind ok"

for sid in "$S1" "$S2" "$S3" "$S4" "$S5" "$S6" "$S7" "$S8"; do
    ./aos tell --unregister --session-id "$sid" >/dev/null 2>&1 || true
done

echo "ok"
