import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { readyBlockers } from '../scripts/lib/aos-readiness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runCheck({ microphone = false, microphoneState, daemonHealth } = {}) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'aos-permissions-microphone-'));
  const fakeAOS = path.join(tempRoot, 'aos');
  const healthPermissions = { accessibility: true, microphone };
  if (microphoneState !== undefined) healthPermissions.microphone_state = microphoneState;
  healthPermissions.screen_capture_direct = {
    capability: 'screen_capture_direct',
    status: 'ready',
    capture_persisted: false,
    error_code: null,
  };
  const health = daemonHealth ?? {
    reachable: true,
    input_tap: {
      status: 'active',
      attempts: 1,
      listen_access: true,
      post_access: true,
    },
    permissions: healthPermissions,
  };
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
  '__daemon health --json': ${JSON.stringify(health)},
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

function runDirectCapturePrime({
  status = 'ready',
  errorCode = null,
  primitiveCode = null,
  malformedReady = false,
} = {}) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'aos-permissions-direct-capture-'));
  const fakeAOS = path.join(tempRoot, 'aos');
  const callLog = path.join(tempRoot, 'calls.ndjson');
  writeFileSync(fakeAOS, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callLog)}, JSON.stringify(args) + '\\n');
if (args.join(' ') !== '__permissions direct-screen-capture prime --json') {
  process.stderr.write(JSON.stringify({ code: 'UNEXPECTED_AOS', args }) + '\\n');
  process.exit(1);
}
if (${JSON.stringify(primitiveCode)} !== null) {
  process.stderr.write(JSON.stringify({
    code: ${JSON.stringify(primitiveCode)},
    error: 'content-free primitive failure',
  }) + '\\n');
  process.exit(1);
}
if (${JSON.stringify(malformedReady)}) {
  process.stdout.write(JSON.stringify({ status: 'ready' }) + '\\n');
  process.exit(0);
}
process.stdout.write(JSON.stringify({
  capability: 'screen_capture_direct',
  status: ${JSON.stringify(status)},
  capture_persisted: false,
  error_code: ${JSON.stringify(errorCode)},
}) + '\\n');
process.exit(${status === 'ready' ? 0 : 1});
`);
  chmodSync(fakeAOS, 0o755);
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/aos-permissions.mjs', 'prime', 'screen-capture', '--json'],
      {
        cwd: root,
        env: {
          ...process.env,
          AOS_PATH: fakeAOS,
          AOS_RUNTIME_MODE: 'repo',
          AOS_STATE_ROOT: tempRoot,
        },
        encoding: 'utf8',
      },
    );
    return {
      ...result,
      response: JSON.parse(result.stdout),
      calls: readFileSync(callLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line)),
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runSetupWithMissingDaemonMicrophone() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'aos-permissions-setup-microphone-'));
  const fakeAOS = path.join(tempRoot, 'aos');
  const callLog = path.join(tempRoot, 'calls.ndjson');
  const daemonStarted = path.join(tempRoot, 'daemon-started');
  writeFileSync(fakeAOS, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const key = args.join(' ');
const callLog = ${JSON.stringify(callLog)};
const daemonStarted = ${JSON.stringify(daemonStarted)};
fs.appendFileSync(callLog, JSON.stringify(args) + '\\n');
function reply(value) {
  process.stdout.write(JSON.stringify(value) + '\\n');
}
if (key === '__permissions facts --json') {
  reply({
    permissions: {
      accessibility: true,
      screen_recording: true,
      listen_access: true,
      post_access: true,
      microphone: true,
    },
    identity: { executable_path: '/tmp/fake-aos', bundle_path: '/tmp/fake-aos' },
  });
} else if (key === '__permissions setup-marker get --json') {
  reply({
    marker_exists: false,
    marker_path: '/tmp/setup.json',
    current_bundle_path: '/tmp/fake-aos',
    bundle_matches_current: true,
    setup_completed: false,
  });
} else if (key === '__permissions setup-marker write --json') {
  reply({ marker: {
    marker_exists: true,
    marker_path: '/tmp/setup.json',
    bundle_path: '/tmp/fake-aos',
    current_bundle_path: '/tmp/fake-aos',
    bundle_matches_current: true,
    setup_completed: true,
  } });
} else if (key === '__daemon health --json') {
  if (!fs.existsSync(daemonStarted)) process.exit(1);
  reply({
    reachable: true,
    input_tap: { status: 'active', attempts: 1, listen_access: true, post_access: true },
    permissions: { accessibility: true, microphone: true, microphone_state: 'authorized' },
  });
} else if (key === 'service start --mode repo --json') {
  fs.writeFileSync(daemonStarted, 'started');
  reply({ status: 'ok', loaded: true, running: true });
} else if (key === '__permissions prompt microphone --json') {
  reply({ granted: true, authorization_state: 'authorized' });
} else if (key === 'service status --mode repo --json') {
  reply({ status: 'ok', loaded: false, running: false });
} else {
  process.stderr.write(JSON.stringify({ code: 'UNEXPECTED_AOS', args }) + '\\n');
  process.exit(1);
}
`);
  chmodSync(fakeAOS, 0o755);
  try {
    const result = spawnSync(process.execPath, ['scripts/aos-permissions.mjs', 'setup', '--once', '--json'], {
      cwd: root,
      env: {
        ...process.env,
        AOS_PATH: fakeAOS,
        AOS_RUNTIME_MODE: 'repo',
        AOS_STATE_ROOT: tempRoot,
      },
      encoding: 'utf8',
    });
    return {
      ...result,
      response: JSON.parse(result.stdout),
      calls: readFileSync(callLog, 'utf8').trim().split('\n').map((line) => JSON.parse(line)),
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runSetupWithUnavailableDaemon() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'aos-permissions-setup-unavailable-'));
  const fakeAOS = path.join(tempRoot, 'aos');
  writeFileSync(fakeAOS, `#!/usr/bin/env node
const key = process.argv.slice(2).join(' ');
function reply(value) {
  process.stdout.write(JSON.stringify(value) + '\\n');
}
function fail(code, error) {
  process.stderr.write(JSON.stringify({ code, error }) + '\\n');
  process.exit(1);
}
if (key === '__permissions facts --json') {
  reply({
    permissions: {
      accessibility: true,
      screen_recording: true,
      listen_access: true,
      post_access: true,
      microphone: true,
    },
    identity: { executable_path: '/tmp/fake-aos', bundle_path: '/tmp/fake-aos' },
  });
} else if (key === '__permissions setup-marker get --json') {
  reply({
    marker_exists: true,
    marker_path: '/tmp/setup.json',
    current_bundle_path: '/tmp/fake-aos',
    bundle_matches_current: true,
    setup_completed: true,
  });
} else if (key === '__daemon health --json') {
  fail('DAEMON_UNREACHABLE', 'managed daemon is unreachable');
} else if (key === 'service start --mode repo --json') {
  fail('SERVICE_START_FAILED', 'managed daemon did not start');
} else if (key === '__permissions prompt microphone --json') {
  fail('DAEMON_UNREACHABLE', 'managed daemon is unreachable');
} else {
  fail('UNEXPECTED_AOS', key);
}
`);
  chmodSync(fakeAOS, 0o755);
  try {
    const result = spawnSync(process.execPath, ['scripts/aos-permissions.mjs', 'setup', '--once', '--json'], {
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
  assert.deepEqual(result.response.screen_capture_direct, {
    capability: 'screen_capture_direct',
    status: 'ready',
    capture_persisted: false,
  });
});

test('direct screen-capture prime invokes only the daemon-owned primitive', () => {
  const result = runDirectCapturePrime();

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls, [[
    '__permissions',
    'direct-screen-capture',
    'prime',
    '--json',
  ]]);
  assert.deepEqual(result.response, {
    capability: 'screen_capture_direct',
    status: 'ready',
    capture_persisted: false,
    error_code: null,
  });
});

test('direct screen-capture denial remains content-free and retryable', () => {
  const result = runDirectCapturePrime({
    status: 'permission_required',
    errorCode: 'DESKTOP_FRAME_PERMISSION_DENIED',
  });

  assert.equal(result.status, 1);
  assert.deepEqual(result.response, {
    capability: 'screen_capture_direct',
    status: 'permission_required',
    capture_persisted: false,
    error_code: 'DESKTOP_FRAME_PERMISSION_DENIED',
  });
  assert.equal(Object.hasOwn(result.response, 'path'), false);
  assert.equal(Object.hasOwn(result.response, 'frame'), false);
  assert.equal(Object.hasOwn(result.response, 'content'), false);
});

test('direct screen-capture prime preserves a structured primitive error code', () => {
  const result = runDirectCapturePrime({ primitiveCode: 'DAEMON_UNREACHABLE' });

  assert.equal(result.status, 1);
  assert.deepEqual(result.response, {
    capability: 'screen_capture_direct',
    status: 'failed',
    capture_persisted: false,
    error_code: 'DAEMON_UNREACHABLE',
  });
});

test('direct screen-capture prime rejects a malformed ready response', () => {
  const result = runDirectCapturePrime({ malformedReady: true });

  assert.equal(result.status, 1);
  assert.deepEqual(result.response, {
    capability: 'screen_capture_direct',
    status: 'failed',
    capture_persisted: false,
    error_code: 'DESKTOP_FRAME_PERMISSION_RESPONSE_INVALID',
  });
});

test('incomplete daemon health without microphone state fails closed', () => {
  const result = runCheck({ microphone: false });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.response.cli_view.microphone, true);
  assert.equal(result.response.permissions.microphone, false);
  assert.equal(result.response.ready_for_testing, false);
  assert.deepEqual(result.response.missing_permissions, ['microphone']);
  assert.equal(result.response.notes.some((note) => note.includes('unknown')), true);
});

test('reachable daemon without structured health remains reachable and fails microphone closed', () => {
  const result = runCheck({ daemonHealth: { reachable: true } });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.response.daemon_view, { reachable: true });
  assert.equal(result.response.cli_view.microphone, true);
  assert.equal(result.response.permissions.microphone, false);
  assert.equal(result.response.ready_for_testing, false);
  assert.deepEqual(result.response.missing_permissions, ['microphone']);
  assert.equal(
    result.response.notes.some((note) => note.includes('structured daemon health is unavailable')),
    true,
  );
  assert.equal(result.response.notes.some((note) => /daemon.*unreachable/i.test(note)), false);
});

test('absent daemon socket alone reports unreachable and fails microphone closed', () => {
  const result = runCheck({ daemonHealth: { reachable: false } });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.response.daemon_view, { reachable: false });
  assert.equal(result.response.cli_view.microphone, true);
  assert.equal(result.response.permissions.microphone, false);
  assert.equal(result.response.ready_for_testing, false);
  assert.deepEqual(result.response.missing_permissions, ['microphone']);
  assert.equal(result.response.notes.some((note) => /daemon.*unreachable/i.test(note)), true);
});

test('general readiness microphone blocker distinguishes unavailable health from an unreachable daemon', () => {
  const common = {
    ownership_state: 'managed',
    daemon_running: true,
  };
  const input = {
    daemon: null,
    permissions: {
      accessibility: true,
      screen_recording: true,
      listen_access: true,
      post_access: true,
      microphone: true,
    },
    setup: { setup_completed: true },
    cleanReport: { stale_daemons: [] },
  };

  const reachable = readyBlockers({
    ...input,
    runtime: { ...common, socket_reachable: true },
  }, 'repo').find((blocker) => blocker.id === 'microphone');
  assert.ok(reachable);
  assert.match(reachable.message, /structured daemon health is unavailable/i);
  assert.doesNotMatch(reachable.message, /daemon.*unreachable/i);

  const unreachable = readyBlockers({
    ...input,
    runtime: { ...common, socket_reachable: false },
  }, 'repo').find((blocker) => blocker.id === 'microphone');
  assert.ok(unreachable);
  assert.match(unreachable.message, /daemon.*unreachable/i);
});

test('daemon microphone readiness requires an exact authorized state and granted boolean', () => {
  const cases = [
    { name: 'missing state', microphone: true, state: undefined, expectedState: 'unknown' },
    { name: 'invalid state', microphone: true, state: 'granted', expectedState: 'unknown' },
    { name: 'denied state with true boolean', microphone: true, state: 'denied', expectedState: 'denied' },
    { name: 'authorized state with false boolean', microphone: false, state: 'authorized', expectedState: 'authorized' },
  ];

  for (const entry of cases) {
    const result = runCheck({ microphone: entry.microphone, microphoneState: entry.state });
    assert.equal(result.status, 0, `${entry.name}: ${result.stderr}`);
    assert.equal(result.response.daemon_view.microphone_state, entry.state, entry.name);
    assert.equal(result.response.permissions.microphone, false, entry.name);
    assert.equal(result.response.ready_for_testing, false, entry.name);
    assert.deepEqual(result.response.missing_permissions, ['microphone'], entry.name);
    assert.equal(
      result.response.notes.some((note) => note.includes(entry.expectedState)
        || note.includes('fields disagree')),
      true,
      entry.name,
    );
  }

  const authorized = runCheck({ microphone: true, microphoneState: 'authorized' });
  assert.equal(authorized.status, 0, authorized.stderr);
  assert.equal(authorized.response.permissions.microphone, true);
  assert.equal(authorized.response.ready_for_testing, true);
  assert.deepEqual(authorized.response.missing_permissions, []);
});

test('permissions setup starts the managed daemon for daemon-owned microphone authorization', () => {
  const result = runSetupWithMissingDaemonMicrophone();

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.response.completed, true);
  assert.equal(result.response.permissions.microphone, true);
  assert.equal(
    result.calls.filter((args) => args.join(' ') === 'service start --mode repo --json').length,
    1,
  );
  assert.equal(
    result.calls.filter((args) => args.join(' ') === '__permissions prompt microphone --json').length,
    1,
  );
});

test('permissions setup preserves structured daemon errors without parser relabeling', () => {
  const result = runSetupWithUnavailableDaemon();

  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(result.response.status, 'degraded');
  assert.equal(result.response.completed, false);
  assert.deepEqual(result.response.missing_permissions, ['microphone']);
  assert.equal(result.response.notes.some((note) => note.includes('cancelled')), true);
  assert.equal(JSON.stringify(result.response).includes('PERMISSIONS_PRIMITIVE_JSON_INVALID'), false);
});
