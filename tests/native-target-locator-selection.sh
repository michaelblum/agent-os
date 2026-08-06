#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

swiftc \
  "$ROOT/src/act/targeting-selection.swift" \
  "$ROOT/tests/fixtures/targeting-selection-harness.swift" \
  -o "$TMP/targeting-selection-harness"
"$TMP/targeting-selection-harness"

swiftc \
  "$ROOT/src/perceive/models.swift" \
  "$ROOT/tests/fixtures/native-target-handle-emission-harness.swift" \
  -o "$TMP/native-target-handle-emission-harness"
"$TMP/native-target-handle-emission-harness" >"$TMP/native-target-handle-emission.json"

python3 - "$ROOT" "$TMP/native-target-handle-emission.json" <<'PY'
import json, pathlib, sys
from jsonschema import Draft202012Validator

root = pathlib.Path(sys.argv[1])
payload = json.loads(pathlib.Path(sys.argv[2]).read_text())
schema = json.loads((root / 'shared/schemas/aos-target-handle-v1.schema.json').read_text())
assert 'missing_role' not in payload
handle = payload['normalized_handle']
assert handle['query'] == {'pid': 42, 'window_id': 7, 'role': 'AXButton'}
Draft202012Validator(schema).validate(handle)
PY

python3 - "$ROOT" <<'PY'
import pathlib, sys

root = pathlib.Path(sys.argv[1])
cli = (root / 'src/act/act-cli.swift').read_text()
actions = (root / 'src/act/actions.swift').read_text()
targeting = (root / 'src/act/targeting.swift').read_text()
session = (root / 'src/act/session.swift').read_text()
state_guard = 'if let code = sessionTargetStateErrorCode(req.state_id)'
assert state_guard in session
assert session.index(state_guard) < session.index('refreshChannelBinding(state: state)')
assert 'switch findAXActionTarget(query: query, action: action)' in cli
for action in ('press', 'set-value', 'focus'):
    assert f'switch findAXActionTarget(query: query, action: "{action}")' in actions
assert 'let maxNativeLocatorDepth = 128' in targeting
assert 'let maxNativeLocatorTimeoutMs = 30_000' in targeting
assert 'func axCallBeforeDeadline<Value>' in targeting
assert 'guard AXUIElementSetMessagingTimeout(element, Float(remaining)) == .success else {' in targeting
for bounded_call in (
    'axAttributeValueBeforeDeadline',
    'axStringBeforeDeadline',
    'axChildrenBeforeDeadline',
    'axBoundsBeforeDeadline',
    'axWindowIDBeforeDeadline',
):
    assert bounded_call in targeting
assert 'resolveActionCompatibility(current, deadline)' in targeting
assert targeting.index('resolveActionCompatibility(current, deadline)') < targeting.index('matches.append((current, b))')
assert 'resolveAXTargetCompatibility(element, action: action, deadline: deadline)' in actions
assert actions.count('axCallBeforeDeadline(element, deadline: deadline') >= 4
PY
