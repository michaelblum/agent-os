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

# Pre-write policy.json that disables system + elevenlabs so the allocatable
# pool is exactly the 5 mock voices (alpha..echo) in known order. Daemon
# must not be running yet — VoicePolicyStore.load() is read on first use
# and cached, so this file must exist before the daemon comes up.
mkdir -p "$ROOT/repo/voice"
cat > "$ROOT/repo/voice/policy.json" <<JSON
{
  "schema_version": 1,
  "providers": {
    "system":     { "enabled": false },
    "elevenlabs": { "enabled": false }
  },
  "voices":              { "disabled": [], "promote": [] },
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

# -------------------------------------------------------------------------
# 1. distinct-while-supply
# Initial deque: [alpha, bravo, charlie, delta, echo]
# After S1.next() = alpha   ->  [bravo, charlie, delta, echo, alpha]
# After S2.next() = bravo   ->  [charlie, delta, echo, alpha, bravo]
# After S3.next() = charlie ->  [delta, echo, alpha, bravo, charlie]
# -------------------------------------------------------------------------
./aos tell --register --session-id "$S1" --name "sess-1" >/dev/null
./aos tell --register --session-id "$S2" --name "sess-2" >/dev/null
./aos tell --register --session-id "$S3" --name "sess-3" >/dev/null

assert_eq "$(voice_for $S1)" "$V_ALPHA"   "S1 picks alpha"
assert_eq "$(voice_for $S2)" "$V_BRAVO"   "S2 picks bravo"
assert_eq "$(voice_for $S3)" "$V_CHARLIE" "S3 picks charlie"
echo "distinct-while-supply ok"

# -------------------------------------------------------------------------
# 2. bias-away: bind S2 onto delta (an unused voice).
# bindVoice calls voiceAllocator.markUsed(delta), so delta moves to back.
# Deque before bind: [delta, echo, alpha, bravo, charlie]
# After markUsed(delta):  [echo, alpha, bravo, charlie, delta]
# Next fresh registration must NOT pick delta and MUST pick echo (LRU).
# -------------------------------------------------------------------------
./aos voice bind --session-id "$S2" --voice "$V_DELTA" >/dev/null
assert_eq "$(voice_for $S2)" "$V_DELTA" "S2 bind reflected"

./aos tell --register --session-id "$S4" --name "sess-4" >/dev/null
S4_VOICE="$(voice_for $S4)"
[[ "$S4_VOICE" != "$V_DELTA" ]] || { echo "FAIL [bias-away]: S4 picked just-bound voice $V_DELTA" >&2; exit 1; }
assert_eq "$S4_VOICE" "$V_ECHO" "S4 picks echo (LRU after bind moved delta to back)"
echo "bias-away ok"

# -------------------------------------------------------------------------
# 3. over-capacity reuse
# Deque after S4: [alpha, bravo, charlie, delta, echo]
# S5.next() = alpha   (REUSE: S1 also has alpha)
# S6.next() = bravo
# S7.next() = charlie (REUSE: S3 also has charlie)
# -------------------------------------------------------------------------
./aos tell --register --session-id "$S5" --name "sess-5" >/dev/null
./aos tell --register --session-id "$S6" --name "sess-6" >/dev/null
./aos tell --register --session-id "$S7" --name "sess-7" >/dev/null

assert_eq "$(voice_for $S5)" "$V_ALPHA"   "S5 wraps to alpha (over-cap)"
assert_eq "$(voice_for $S6)" "$V_BRAVO"   "S6 picks bravo"
assert_eq "$(voice_for $S7)" "$V_CHARLIE" "S7 wraps to charlie (over-cap)"

assignments_json | python3 -c "
import json, sys
data = json.loads(sys.stdin.read())['data']['assignments']
ids = [e['voice']['id'] for e in data if e.get('voice')]
assert len(ids) == 7, f'expected 7 assigned voices, got {ids}'
held = set(ids)
assert held <= {'$V_ALPHA','$V_BRAVO','$V_CHARLIE','$V_DELTA','$V_ECHO'}, f'unexpected voices in pool: {held}'
print('over-capacity reuse ok')
"

# -------------------------------------------------------------------------
# 4. restart reseed marks restored sessions before serving new
# Pre-restart per-session voices:
#   S1=alpha  S2=delta(bound)  S3=charlie  S4=echo
#   S5=alpha  S6=bravo  S7=charlie
# Reseed walks restored in (registeredAt ASC, sessionID ASC) order:
#   S1..S7 lexicographic on uuid -> S1, S2, S3, S4, S5, S6, S7.
#
# Trace the markUsed sequence on a fresh deque [alpha, bravo, charlie, delta, echo]:
#   markUsed(alpha)   -> [bravo, charlie, delta, echo, alpha]
#   markUsed(delta)   -> [bravo, charlie, echo, alpha, delta]
#   markUsed(charlie) -> [bravo, echo, alpha, delta, charlie]
#   markUsed(echo)    -> [bravo, alpha, delta, charlie, echo]
#   markUsed(alpha)   -> [bravo, delta, charlie, echo, alpha]
#   markUsed(bravo)   -> [delta, charlie, echo, alpha, bravo]
#   markUsed(charlie) -> [delta, echo, alpha, bravo, charlie]
#
# Final deque front = delta. So S8.next() = delta.
#
# Bug-detection: if reseed FORGOT to call markUsed for restored sessions,
# the deque after reseed would still be [alpha, bravo, charlie, delta, echo]
# and S8.next() would be alpha. The exact-equals assertion below distinguishes
# the two states.
# -------------------------------------------------------------------------
aos_test_kill_root "$ROOT"
aos_test_start_daemon "$ROOT"

./aos tell --register --session-id "$S8" --name "sess-8" >/dev/null
S8_VOICE="$(voice_for $S8)"
[[ "$S8_VOICE" != "$V_ALPHA" ]] || { echo "FAIL [restart-reseed]: S8 got front-of-unmarked-deque ($V_ALPHA); reseed did not mark restored" >&2; exit 1; }
assert_eq "$S8_VOICE" "$V_DELTA" "S8 picks delta (deterministic post-reseed LRU)"
echo "restart-reseed ok"

# -------------------------------------------------------------------------
# Post-restart bind survives + watcher coherence
# -------------------------------------------------------------------------
./aos voice bind --session-id "$S8" --voice "$V_CHARLIE" >/dev/null
assert_eq "$(voice_for $S8)" "$V_CHARLIE" "post-restart bind persists"
echo "post-restart bind ok"

for sid in "$S1" "$S2" "$S3" "$S4" "$S5" "$S6" "$S7" "$S8"; do
    ./aos tell --unregister --session-id "$sid" >/dev/null 2>&1 || true
done

echo "ok"
