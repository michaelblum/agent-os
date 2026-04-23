#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-voice-policy-reload"
aos_test_cleanup_prefix "$PREFIX"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"

export AOS_STATE_ROOT="$ROOT"
export AOS_VOICE_TEST_PROVIDERS=mock

cleanup() { aos_test_kill_root "$ROOT"; rm -rf "$ROOT"; }
trap cleanup EXIT

V_ALPHA="voice://mock/mock-alpha"
V_BRAVO="voice://mock/mock-bravo"

# Pre-write policy with system + elevenlabs disabled so the allocatable pool
# is exactly the 5 mock voices. Daemon must not be running yet —
# VoicePolicyStore.load() caches on first read.
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

availability_enabled() {
    local voice_id="$1"
    ./aos voice list --json | python3 -c "
import json, sys
voices = json.loads(sys.stdin.read())['data']['voices']
target = next((v for v in voices if v['id'] == '$voice_id'), None)
print('missing' if target is None else str(target['availability']['enabled']))
"
}

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

assert_eq() {
    local got="$1"; local want="$2"; local label="$3"
    if [[ "$got" != "$want" ]]; then
        echo "FAIL [$label]: got=$got want=$want" >&2
        exit 1
    fi
}

# Poll voice availability up to 5s. Replaces a fixed `sleep 1` after a
# policy rewrite — under suite load, the dispatch chain
#   parent-dir NOTE_WRITE -> handler queue -> 50ms debounce -> store.reload()
#   -> coordination.handlePolicyReload -> registry state
# can exceed 1s while still being correct. 5s elastic deadline tolerates
# loaded machines without masking real watcher misbehavior (a true drop
# still surfaces as a timeout with the last observed value).
poll_assert_availability() {
    local voice_id="$1"; local want="$2"; local label="$3"
    local deadline=$(($(date +%s) + 5))
    local got=""
    while (( $(date +%s) < deadline )); do
        got="$(availability_enabled "$voice_id")"
        [[ "$got" == "$want" ]] && return 0
        sleep 0.1
    done
    echo "FAIL [$label]: timed out after 5s; last got=$got want=$want" >&2
    exit 1
}

# -------------------------------------------------------------------------
# Rewrite #1: disable mock-alpha. With reseed, the allocator deque drops
# alpha:
#   before: [alpha, bravo, charlie, delta, echo]
#   after:  [bravo, charlie, delta, echo]
#
# Use write-tmp + atomic rename — the parent-directory fd in Task 11 fires
# .write events for in-directory entry changes (create/remove/rename), NOT
# for in-place truncate+overwrite of an existing file. `cat > policy.json`
# would silently keep the old inode and miss the watcher entirely.
# -------------------------------------------------------------------------
cat > "$ROOT/repo/voice/policy.json.tmp" <<JSON
{
  "schema_version": 1,
  "providers": {
    "system":     { "enabled": false },
    "elevenlabs": { "enabled": false }
  },
  "voices":              { "disabled": ["$V_ALPHA"], "promote": [] },
  "session_preferences": {}
}
JSON
mv "$ROOT/repo/voice/policy.json.tmp" "$ROOT/repo/voice/policy.json"

poll_assert_availability "$V_ALPHA" "False" "rewrite-1: voice list shows alpha availability.enabled=False"
echo "first-reload reflected in voice list"

# -------------------------------------------------------------------------
# Allocator-reseed proof. Register a fresh session AFTER the disable.
# The post-reseed deque front is bravo, so a correctly reseeded allocator
# must hand bravo to S1.
#
# Bug-detection: if handlePolicyReload updated voice list state but did
# NOT call voiceAllocator.reseed(), the deque would still be the original
# [alpha, bravo, charlie, delta, echo] and S1 would receive alpha — the
# very voice the policy just disabled. The exact-equals assertion below
# distinguishes the two states; the != assertion above it makes the
# failure mode explicit in the diagnostic output.
# -------------------------------------------------------------------------
SID="cccccccc-cccc-cccc-cccc-cccccccccccc"
./aos tell --register --session-id "$SID" --name policy-reload-test >/dev/null
held="$(voice_for "$SID")"
[[ "$held" != "$V_ALPHA" ]] || { echo "FAIL [reseed]: fresh session received disabled voice $V_ALPHA — handlePolicyReload did not reseed allocator" >&2; exit 1; }
assert_eq "$held" "$V_BRAVO" "rewrite-1: fresh session picks bravo (front of post-reseed deque)"
echo "first-reload reflected in allocator (reseed observed)"

# -------------------------------------------------------------------------
# Rewrite #2: re-enable alpha. This is the watcher-continuity check —
# rewrite #1 was a write-tmp + atomic rename that retired the original
# policy.json inode; only the parent-directory fd in Task 11 stays
# attached across that. A file-fd watcher would have detached and the
# assertion below would fail with state2 still "False".
#
# Same write-tmp + mv pattern as rewrite #1 (see comment there for why).
# -------------------------------------------------------------------------
cat > "$ROOT/repo/voice/policy.json.tmp" <<JSON
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
mv "$ROOT/repo/voice/policy.json.tmp" "$ROOT/repo/voice/policy.json"

poll_assert_availability "$V_ALPHA" "True" "rewrite-2: voice list shows alpha availability.enabled=True (watcher survived atomic rename)"
echo "second-reload reflected (watcher survived atomic rename)"

# -------------------------------------------------------------------------
# Live session not auto-reassigned across either reload.
# -------------------------------------------------------------------------
after="$(voice_for "$SID")"
assert_eq "$after" "$held" "live session retains descriptor across both reloads"
echo "live session not auto-reassigned"

./aos tell --unregister --session-id "$SID" >/dev/null 2>&1 || true
echo "ok"
