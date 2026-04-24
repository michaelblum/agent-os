#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
out=$(AOS_VOICE_TEST_PROVIDERS=mock ./aos voice _internal-registry-snapshot)
echo "$out" | python3 -c "
import json, sys
voices = json.loads(sys.stdin.read())
assert len(voices) > 0, 'snapshot empty'
mock_voices = [v for v in voices if v['provider'] == 'mock']
assert len(mock_voices) >= 3, f'expected >=3 mock voices, got {len(mock_voices)}'
mock_names = [v['name'] for v in mock_voices]
assert mock_names == sorted(mock_names), f'mock voices should be name-sorted, got {mock_names}'
echo_voice = next(v for v in mock_voices if v['id'] == 'voice://mock/mock-echo')
assert 'novelty' in echo_voice['tags'], f'expected novelty tag on mock echo, got {echo_voice}'
print('ok')
"
