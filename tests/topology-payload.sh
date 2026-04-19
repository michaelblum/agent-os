#!/usr/bin/env bash
set -euo pipefail

PAYLOAD=$(./aos see list --json 2>/dev/null)
PAYLOAD="$PAYLOAD" python3 - <<'PY'
import json, os
payload = json.loads(os.environ['PAYLOAD'])
displays = payload.get('displays', [])
assert displays, 'expected at least one display'
for display in displays:
    for key in ('native_bounds', 'native_visible_bounds', 'desktop_world_bounds', 'visible_desktop_world_bounds'):
        assert key in display, f'display missing {key}: {display}'
# Top-level aggregates.
assert 'desktop_world_bounds' in payload, 'expected top-level desktop_world_bounds'
assert 'visible_desktop_world_bounds' in payload, 'expected top-level visible_desktop_world_bounds'
assert payload['desktop_world_bounds']['x'] == 0, payload['desktop_world_bounds']
assert payload['desktop_world_bounds']['y'] == 0, payload['desktop_world_bounds']
# Cursor DesktopWorld siblings belong on topology.
cursor = payload.get('cursor', {})
assert 'desktop_world_x' in cursor, cursor
assert 'desktop_world_y' in cursor, cursor
print('PASS')
PY
