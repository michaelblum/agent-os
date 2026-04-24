#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-voice-cursor-rotation"
aos_test_cleanup_prefix "$PREFIX"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"

export AOS_STATE_ROOT="$ROOT"
export AOS_VOICE_TEST_PROVIDERS=mock

cleanup() { aos_test_kill_root "$ROOT"; rm -rf "$ROOT"; }
trap cleanup EXIT

POLICY="$ROOT/repo/voice/policy.json"
CONFIG="$ROOT/repo/config.json"

mkdir -p "$ROOT/repo/voice"
cat > "$POLICY" <<JSON
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

# Widen the filter to include the standard tier so all five mock voices
# (alpha..echo, all en/standard except alpha=premium) participate in rotation.
cat > "$CONFIG" <<JSON
{
  "voice": {
    "enabled": false,
    "announce_actions": true,
    "filter": { "language": "en", "tiers": ["premium", "enhanced", "standard"] }
  },
  "perception": { "default_depth": 1, "settle_threshold_ms": 200 },
  "feedback":   { "visual": true, "sound": false }
}
JSON

aos_test_start_daemon "$ROOT"

V_ALPHA="voice://mock/mock-alpha"
V_BRAVO="voice://mock/mock-bravo"
V_CHARLIE="voice://mock/mock-charlie"
V_DELTA="voice://mock/mock-delta"
V_ECHO="voice://mock/mock-echo"

S1="a1111111-1111-1111-1111-111111111111"
S2="a2222222-2222-2222-2222-222222222222"
S3="a3333333-3333-3333-3333-333333333333"
S4="a4444444-4444-4444-4444-444444444444"
S5="a5555555-5555-5555-5555-555555555555"
S6="a6666666-6666-6666-6666-666666666666"

voice_for() {
    local sid="$1"
    ./aos voice assignments --json | python3 -c "
import json, sys
sid = '$sid'
data = json.loads(sys.stdin.read())['data']['assignments']
match = next((e for e in data if e['session_id'] == sid and e.get('voice')), None)
print(match['voice']['id'] if match else '')
"
}

cursor_value() {
    python3 -c "
import json, sys
try:
    with open('$POLICY') as f:
        print(json.load(f).get('voice_cursor', 0))
except Exception:
    print(0)
"
}

assert_eq() {
    local got="$1"; local want="$2"; local label="$3"
    if [[ "$got" != "$want" ]]; then
        echo "FAIL [$label]: got=$got want=$want" >&2
        exit 1
    fi
}

# ---- 1. deterministic rotation across registration ----
./aos tell --register --session-id "$S1" --name "sess-1" >/dev/null
./aos tell --register --session-id "$S2" --name "sess-2" >/dev/null
./aos tell --register --session-id "$S3" --name "sess-3" >/dev/null
./aos tell --register --session-id "$S4" --name "sess-4" >/dev/null
./aos tell --register --session-id "$S5" --name "sess-5" >/dev/null

assert_eq "$(voice_for "$S1")" "$V_ALPHA"   "S1 rotation -> alpha"
assert_eq "$(voice_for "$S2")" "$V_BRAVO"   "S2 rotation -> bravo"
assert_eq "$(voice_for "$S3")" "$V_CHARLIE" "S3 rotation -> charlie"
assert_eq "$(voice_for "$S4")" "$V_DELTA"   "S4 rotation -> delta"
assert_eq "$(voice_for "$S5")" "$V_ECHO"    "S5 rotation -> echo"
echo "rotation ordering ok"

# Wraparound on a sixth session.
./aos tell --register --session-id "$S6" --name "sess-6" >/dev/null
assert_eq "$(voice_for "$S6")" "$V_ALPHA" "S6 wraps -> alpha"
echo "wraparound ok"

assert_eq "$(cursor_value)" "6" "cursor advanced per session assignment"

# ---- 2. aos voice next cycles session voice without moving the global cursor ----
CURSOR_BEFORE="$(cursor_value)"
./aos voice next --session-id "$S1" >/dev/null
assert_eq "$(voice_for "$S1")" "$V_BRAVO" "voice next cycles S1 alpha -> bravo"
./aos voice next --session-id "$S1" >/dev/null
assert_eq "$(voice_for "$S1")" "$V_CHARLIE" "voice next cycles S1 bravo -> charlie"
assert_eq "$(cursor_value)" "$CURSOR_BEFORE" "voice next does not advance global cursor"
echo "voice next session rotation ok"

# ---- 3. cursor persists across daemon restart ----
aos_test_kill_root "$ROOT"
aos_test_start_daemon "$ROOT"

assert_eq "$(cursor_value)" "$CURSOR_BEFORE" "cursor survives restart"

S7="a7777777-7777-7777-7777-777777777777"
./aos tell --register --session-id "$S7" --name "sess-7" >/dev/null
# Cursor was 6 -> pool index = 6 % 5 = 1 -> bravo. S7 is fresh, so assignment
# uses cursor 6 and then advances to 7.
assert_eq "$(voice_for "$S7")" "$V_BRAVO" "S7 picks up rotation after restart"
assert_eq "$(cursor_value)" "7" "cursor advanced after restart-era assignment"
echo "cursor persistence ok"

# ---- 4. filter change narrows pool ----
# Constrain to premium only: only alpha matches.
./aos config set voice.filter.tiers premium >/dev/null
sleep 0.3   # config watcher

S8="a8888888-8888-8888-8888-888888888888"
./aos tell --register --session-id "$S8" --name "sess-8" >/dev/null
assert_eq "$(voice_for "$S8")" "$V_ALPHA" "S8 filtered-pool of 1 -> alpha"
echo "filter narrowing ok"

# ---- 5. voice next when current voice outside new pool advances global cursor ----
# S1 is currently on charlie (standard). With filter=premium, charlie is not in
# the pool, so voice next falls back to cursor advancement.
CURSOR_BEFORE2="$(cursor_value)"
./aos voice next --session-id "$S1" >/dev/null
assert_eq "$(voice_for "$S1")" "$V_ALPHA" "voice next on out-of-pool voice picks alpha via cursor"
NEW_CURSOR="$(cursor_value)"
if [[ "$NEW_CURSOR" -le "$CURSOR_BEFORE2" ]]; then
    echo "FAIL: out-of-pool voice next did not advance cursor (before=$CURSOR_BEFORE2 after=$NEW_CURSOR)" >&2
    exit 1
fi
echo "out-of-pool voice next ok"

# ---- 6. zero-match filter falls back to allocatable random ----
./aos config set voice.filter.language xx >/dev/null
sleep 0.3

S9="a9999999-9999-9999-9999-999999999999"
./aos tell --register --session-id "$S9" --name "sess-9" >/dev/null
GOT="$(voice_for "$S9")"
case "$GOT" in
    "$V_ALPHA"|"$V_BRAVO"|"$V_CHARLIE"|"$V_DELTA"|"$V_ECHO")
        ;;
    *)
        echo "FAIL: zero-match fallback produced unexpected voice $GOT" >&2
        exit 1
        ;;
esac
echo "zero-match fallback ok"

for sid in "$S1" "$S2" "$S3" "$S4" "$S5" "$S6" "$S7" "$S8" "$S9"; do
    ./aos tell --unregister --session-id "$sid" >/dev/null 2>&1 || true
done

echo "ok"
