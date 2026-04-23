#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

source "$(dirname "$0")/lib/isolated-daemon.sh"

PREFIX="aos-voice-providers"
aos_test_cleanup_prefix "$PREFIX"
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/${PREFIX}.XXXXXX")"

export AOS_STATE_ROOT="$ROOT"
# No AOS_VOICE_TEST_PROVIDERS — assert canonical [system, elevenlabs] set.

cleanup() { aos_test_kill_root "$ROOT"; rm -rf "$ROOT"; }
trap cleanup EXIT

aos_test_start_daemon "$ROOT"

out=$(./aos voice providers --json 2>&1)
echo "$out" | python3 -c "
import json, sys
resp = json.loads(sys.stdin.read())
provs = resp['data']['providers']
names = sorted(p['name'] for p in provs)
assert 'system' in names and 'elevenlabs' in names, f'missing provider in {names}'
el = next(p for p in provs if p['name']=='elevenlabs')
assert el['voice_count'] >= 3, f'elevenlabs stub catalog too small: {el}'
assert el['enabled'] == True, 'elevenlabs should default-enabled'
assert el['availability']['reachable'] == True
print('ok')
"
