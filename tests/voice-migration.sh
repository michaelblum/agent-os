#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# In-process CLI helper — no daemon, so AOS_STATE_ROOT alone is sufficient.
TMP=$(mktemp -d)
trap "rm -rf $TMP" EXIT
export AOS_STATE_ROOT="$TMP"
mkdir -p "$TMP/repo/coordination" "$TMP/repo/voice"

# Seed a legacy voice-assignments.json with bare-id voices.
cat > "$TMP/repo/coordination/voice-assignments.json" <<JSON
{"assignments":{"sid-1":"com.apple.voice.premium.en-US.Ava","sid-2":"com.apple.voice.premium.en-US.Zoe"}}
JSON

# First migration run.
out=$(./aos voice _internal-migrate-policy)
echo "$out" | grep -q '"migrated":true' || { echo "FAIL: expected migrated=true got=$out" >&2; exit 1; }

# voice/policy.json should exist with URI-form session_preferences.
[[ -f "$TMP/repo/voice/policy.json" ]] || { echo "FAIL: policy.json missing" >&2; exit 1; }
grep -q 'voice://system/com.apple.voice.premium.en-US.Ava' "$TMP/repo/voice/policy.json"
grep -q 'voice://system/com.apple.voice.premium.en-US.Zoe' "$TMP/repo/voice/policy.json"

# Legacy file renamed.
[[ -f "$TMP/repo/coordination/voice-assignments.json.migrated" ]]
[[ ! -f "$TMP/repo/coordination/voice-assignments.json" ]]

# Re-running is a no-op.
out=$(./aos voice _internal-migrate-policy)
echo "$out" | grep -q '"migrated":false'

echo "ok"
