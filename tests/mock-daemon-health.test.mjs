import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const helper = path.join(root, 'tests/lib/mock-daemon.py');

const probe = String.raw`
import importlib.util
import json
from types import SimpleNamespace
import sys
import threading

spec = importlib.util.spec_from_file_location("mock_daemon", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def payload(state="authorized", legacy=False):
    args = SimpleNamespace(
        ready_after_pings=0,
        tap_status="active",
        ping_lock=threading.Lock(),
        ping_count=0,
        attempts=1,
        mode="repo",
        socket="/tmp/mock.sock",
        listen_access="true",
        post_access="true",
        accessibility="true",
        microphone_state=state,
        legacy=legacy,
    )
    return module.build_ping_payload(args)

print(json.dumps({
    "states": {state: payload(state) for state in (
        "not_determined", "restricted", "denied", "authorized", "unknown"
    )},
    "legacy": payload(legacy=True),
}))
`;

test('mock daemon exposes explicit microphone states and preserves legacy absence', () => {
  const result = spawnSync('python3', ['-c', probe, helper], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout);

  for (const state of ['not_determined', 'restricted', 'denied', 'authorized', 'unknown']) {
    assert.equal(response.states[state].permissions.microphone_state, state);
    assert.equal(response.states[state].permissions.microphone, state === 'authorized');
  }
  assert.equal('permissions' in response.legacy, false);
});
