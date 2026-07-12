import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runCheck({ microphone = false, microphoneState } = {}) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'aos-permissions-microphone-'));
  const fakeAOS = path.join(tempRoot, 'aos');
  const healthPermissions = { accessibility: true, microphone };
  if (microphoneState !== undefined) healthPermissions.microphone_state = microphoneState;
  writeFileSync(fakeAOS, `#!/usr/bin/env node
const args = process.argv.slice(2).join(' ');
const responses = {
  '__permissions facts --json': ${JSON.stringify({
    status: 'ok',
    permissions: {
      accessibility: true,
      screen_recording: true,
      listen_access: true,
      post_access: true,
      microphone: true,
    },
    identity: { executable_path: '/tmp/fake-aos', bundle_path: '/tmp/fake-aos' },
  })},
  '__permissions setup-marker get --json': ${JSON.stringify({
    marker_exists: true,
    bundle_matches_current: true,
    setup_completed: true,
  })},
  '__daemon health --json': ${JSON.stringify({
    reachable: true,
    input_tap: {
      status: 'active',
      attempts: 1,
      listen_access: true,
      post_access: true,
    },
    permissions: healthPermissions,
  })},
};
if (!(args in responses)) {
  process.stderr.write(JSON.stringify({ code: 'UNEXPECTED_AOS', args }) + '\\n');
  process.exit(1);
}
process.stdout.write(JSON.stringify(responses[args]) + '\\n');
`);
  chmodSync(fakeAOS, 0o755);
  try {
    const result = spawnSync(process.execPath, ['scripts/aos-permissions.mjs', 'check', '--json'], {
      cwd: root,
      env: {
        ...process.env,
        AOS_PATH: fakeAOS,
        AOS_RUNTIME_MODE: 'repo',
        AOS_STATE_ROOT: tempRoot,
      },
      encoding: 'utf8',
    });
    return { ...result, response: JSON.parse(result.stdout) };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

test('foreground microphone true cannot override daemon denied', () => {
  const result = runCheck({ microphone: false, microphoneState: 'denied' });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.response.status, 'degraded');
  assert.equal(result.response.cli_view.microphone, true);
  assert.equal(result.response.daemon_view.microphone, false);
  assert.equal(result.response.daemon_view.microphone_state, 'denied');
  assert.equal(result.response.permissions.microphone, false);
  assert.equal(result.response.ready_for_testing, false);
  assert.deepEqual(result.response.missing_permissions, ['microphone']);
  assert.deepEqual(result.response.disagreement.microphone, {
    cli: true,
    daemon: false,
    daemon_state: 'denied',
  });
  assert.equal(result.response.notes.some((note) => note.includes('denied')), true);
  assert.equal(result.response.notes.some((note) => note.includes('reset-runtime')), false);
});

test('legacy daemon without microphone state fails closed', () => {
  const result = runCheck({ microphone: false });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.response.cli_view.microphone, true);
  assert.equal(result.response.permissions.microphone, false);
  assert.equal(result.response.ready_for_testing, false);
  assert.deepEqual(result.response.missing_permissions, ['microphone']);
  assert.equal(result.response.notes.some((note) => note.includes('unknown')), true);
});
