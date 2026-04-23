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
# Mock provider rank=5 (Task 6) is below system (10) and elevenlabs (20):
# every mock voice must precede every non-mock voice in the snapshot order.
providers = [v['provider'] for v in voices]
last_mock = max(i for i,p in enumerate(providers) if p == 'mock')
first_non_mock_idx = next((i for i,p in enumerate(providers) if p != 'mock'), len(providers))
assert last_mock < first_non_mock_idx, \
    f'mock voices must precede non-mock by rank: last_mock={last_mock}, first_non_mock={first_non_mock_idx}'
# Within mock, premium tier sorts before standard.
assert mock_voices[0]['quality_tier'] == 'premium', \
    f'premium not first within mock provider, got {mock_voices[0]}'
print('ok')
"
