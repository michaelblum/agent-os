#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-voice-telemetry"
aos_test_cleanup_prefix "$PREFIX"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"

export AOS_STATE_ROOT="$ROOT"
export AOS_VOICE_TEST_PROVIDERS=mock

cleanup() { aos_test_kill_root "$ROOT"; rm -rf "$ROOT"; }
trap cleanup EXIT

mkdir -p "$ROOT/repo/voice"

# Seed a non-allocatable preference for a session BEFORE daemon start so the
# daemon sees the disabled-voice preference on first registration.
SID="dddddddd-dddd-dddd-dddd-dddddddddddd"
cat > "$ROOT/repo/voice/policy.json" <<JSON
{"schema_version":1,"providers":{},"voices":{"disabled":["voice://mock/mock-bravo"]},"session_preferences":{"$SID":"voice://mock/mock-bravo"}}
JSON

aos_test_start_daemon "$ROOT"

./aos tell --register --session-id "$SID" --name telem-test >/dev/null

events="$ROOT/repo/voice-events.jsonl"
[[ -f "$events" ]] || { echo "FAIL: voice-events.jsonl missing" >&2; exit 1; }

grep -q '"kind":"preference_skipped"' "$events" || { echo "FAIL: missing preference_skipped event" >&2; exit 1; }
grep -q '"reason":"voice_not_allocatable"' "$events"

./aos tell --unregister --session-id "$SID" >/dev/null 2>&1 || true
echo "ok"
