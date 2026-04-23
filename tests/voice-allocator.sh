#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

out=$(./aos voice _internal-allocator-test seed:A,B,C next next next next)
echo "$out" | python3 -c "
import json, sys
ops = json.loads(sys.stdin.read())
nexts = [o['value'] for o in ops if o['op']=='next']
assert nexts == ['A','B','C','A'], f'bad rotation: {nexts}'
print('rotation ok')
"

out=$(./aos voice _internal-allocator-test seed:A,B,C used:B next)
echo "$out" | python3 -c "
import json, sys
ops = json.loads(sys.stdin.read())
deque_after_used = ops[1]['deque']
assert deque_after_used == ['A','C','B'], f'bad cooldown: {deque_after_used}'
nxt = ops[2]['value']
assert nxt == 'A', f'expected A next, got {nxt}'
print('cooldown ok')
"

out=$(./aos voice _internal-allocator-test seed:A,B,C reseed:B,C,D)
echo "$out" | python3 -c "
import json, sys
ops = json.loads(sys.stdin.read())
final = ops[1]['deque']
assert final == ['B','C','D'], f'reseed survivors+new wrong: {final}'
print('reseed ok')
"

out=$(./aos voice _internal-allocator-test next)
echo "$out" | python3 -c "
import json, sys
ops = json.loads(sys.stdin.read())
assert ops[0]['value'] == '', 'empty next should be empty string'
print('empty ok')
"

echo "all ok"
