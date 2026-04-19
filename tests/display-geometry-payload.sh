#!/usr/bin/env bash
set -euo pipefail

PAYLOAD=$(node scripts/display-geometry-snapshot.mjs)
PAYLOAD="$PAYLOAD" python3 - <<'PY'
import json, os
payload = json.loads(os.environ['PAYLOAD'])
displays = payload.get('displays', [])
assert displays, 'expected at least one display'
for display in displays:
    for key in ('native_bounds', 'native_visible_bounds', 'desktop_world_bounds', 'visible_desktop_world_bounds'):
        assert key in display, f'display missing {key}: {display}'
assert 'desktop_world_bounds' in payload, 'expected top-level desktop_world_bounds'
assert 'visible_desktop_world_bounds' in payload, 'expected top-level visible_desktop_world_bounds'
assert payload['desktop_world_bounds']['x'] == 0, payload['desktop_world_bounds']
assert payload['desktop_world_bounds']['y'] == 0, payload['desktop_world_bounds']
# Channel payload deliberately has no cursor.
assert 'cursor' not in payload, 'display_geometry must not carry cursor fields'
print('PASS')
PY
