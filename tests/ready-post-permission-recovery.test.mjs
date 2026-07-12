import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  enforcePostPermissionLiveReadiness,
  nextReadyExecutionStep,
  postPermissionRecoveryAuthority,
} from '../scripts/lib/aos-ready-execution.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');

function grantedPermissions() {
  return {
    accessibility: true,
    screen_recording: true,
    listen_access: true,
    post_access: true,
    microphone: true,
  };
}

test('post-permission repair requires live daemon tap facts and schedules one managed restart', () => {
  const cliReady = {
    ready: true,
    status: 'ok',
    phase: 'ready',
    diagnosis: 'ready',
    mode: 'repo',
    ready_source: 'cli',
    runtime: {
      mode: 'repo',
      ownership_state: 'consistent',
      owner_launchd_managed: true,
      serving_pid: 51075,
      input_tap_status: 'unavailable',
      input_tap: {
        status: 'unavailable',
        attempts: 1,
        listen_access: false,
        post_access: false,
      },
    },
    runtime_verdict: {
      ready: true,
      status: 'ok',
      phase: 'ready',
      diagnosis: 'ready',
      blockers: [],
      blocked_capabilities: [],
      next_actions: [],
      notes: [],
    },
    permissions: grantedPermissions(),
    blockers: [],
    blocked_capabilities: [],
    next_actions: [],
    action_trace: [],
    notes: [],
  };
  const response = enforcePostPermissionLiveReadiness(cliReady, { prefix: './aos', mode: 'repo' });
  assert.equal(response.ready, false);
  assert.equal(response.runtime_verdict.ready, false);
  assert.equal(response.diagnosis, 'post_permission_live_readiness_unconfirmed');
  assert.deepEqual(response.next_actions.map((action) => action.command), [
    './aos service status --mode repo --json',
    './aos status --json',
  ]);

  const authority = postPermissionRecoveryAuthority(response.runtime, {
    status: 'ok',
    mode: 'repo',
    installed: true,
    loaded: true,
    running: true,
    pid: 51065,
    actual_binary_path: '/repo/aos',
    expected_binary_path: '/repo/aos',
    target_matches_expected: true,
  }, { mode: 'repo', expectedBinaryPath: '/repo/aos' });
  assert.equal(authority.allowed, true);
  assert.deepEqual(
    nextReadyExecutionStep(response, {
      repair: true,
      postPermission: true,
      postPermissionAuthority: authority,
    }),
    {
      type: 'restart',
      reason: 'refresh the launchd-managed daemon event tap after the explicit post-permission user signal',
    },
  );

  const afterRestart = {
    ...response,
    action_trace: [{ step: 'service_restart', result: 'degraded' }],
  };
  const exhausted = nextReadyExecutionStep(afterRestart, {
    repair: true,
    postPermission: true,
    postPermissionAuthority: authority,
  });
  assert.equal(exhausted.type, 'stop');
  assert.equal(exhausted.trace.result, 'exhausted');
});

test('post-permission repair skips restart when fresh live tap facts are already ready', () => {
  const response = {
    ready: true,
    mode: 'repo',
    ready_source: 'daemon',
    runtime: {
      input_tap_status: 'active',
      input_tap: { status: 'active', listen_access: true, post_access: true },
    },
    blockers: [],
    action_trace: [],
  };
  assert.equal(enforcePostPermissionLiveReadiness(response), response);
  const step = nextReadyExecutionStep(response, {
    repair: true,
    postPermission: true,
    postPermissionAuthority: { allowed: true },
  });
  assert.equal(step.type, 'stop');
  assert.equal(step.trace.result, 'ready');
});

test('post-permission restart authority fails closed on ownership, mode, and binary mismatch', () => {
  const managedRuntime = {
    mode: 'repo',
    ownership_state: 'consistent',
    owner_launchd_managed: true,
  };
  const service = {
    status: 'ok',
    mode: 'repo',
    installed: true,
    loaded: true,
    running: true,
    actual_binary_path: '/repo/aos',
    expected_binary_path: '/repo/aos',
    target_matches_expected: true,
  };

  assert.equal(postPermissionRecoveryAuthority(
    { ...managedRuntime, ownership_state: 'unmanaged', owner_launchd_managed: false },
    service,
    { mode: 'repo', expectedBinaryPath: '/repo/aos' },
  ).reason, 'daemon_not_launchd_managed');
  assert.equal(postPermissionRecoveryAuthority(
    { ...managedRuntime, mode: 'installed' },
    service,
    { mode: 'repo', expectedBinaryPath: '/repo/aos' },
  ).reason, 'runtime_mode_mismatch');
  assert.equal(postPermissionRecoveryAuthority(
    managedRuntime,
    { ...service, mode: 'installed' },
    { mode: 'repo', expectedBinaryPath: '/repo/aos' },
  ).reason, 'service_mode_mismatch');
  assert.equal(postPermissionRecoveryAuthority(
    managedRuntime,
    { ...service, actual_binary_path: '/tmp/other-aos', target_matches_expected: false },
    { mode: 'repo', expectedBinaryPath: '/repo/aos' },
  ).reason, 'binary_identity_mismatch');
});

const fakeAOSSource = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const actionLog = process.env.AOS_TEST_READY_SERVICE_ACTION_LOG;
const restarted = Boolean(actionLog && fs.existsSync(actionLog));
const active = restarted && process.env.AOS_FAKE_NEVER_READY !== '1';
const ownership = process.env.AOS_FAKE_OWNERSHIP || 'consistent';
const launchdManaged = ownership === 'consistent';
const tap = active
  ? { status: 'active', attempts: 1, listen_access: true, post_access: true }
  : { status: 'unavailable', attempts: 1, listen_access: false, post_access: false, last_error_at: '2026-07-12T01:16:34Z' };
let payload;
if (args.join(' ') === '__permissions facts --json') {
  payload = {
    permissions: { accessibility: true, screen_recording: true, listen_access: true, post_access: true, microphone: true },
    identity: { executable_path: process.argv[1] },
  };
} else if (args.join(' ') === '__permissions setup-marker get --json') {
  payload = { marker_exists: true, setup_completed: true, bundle_matches_current: true };
} else if (args.join(' ') === '__daemon health --json') {
  payload = active
    ? { reachable: true, input_tap: tap, permissions: { accessibility: true } }
    : { reachable: true };
} else if (args.join(' ') === '__runtime status-facts --json') {
  payload = {
    mode: 'repo',
    daemon_pid: active ? 72167 : 51075,
    serving_pid: active ? 72167 : 51075,
    daemon_running: true,
    socket_reachable: true,
    ownership_state: ownership,
    ownership_kind: launchdManaged ? 'launchd_managed' : 'unmanaged',
    owner_launchd_managed: launchdManaged,
    owner_pid: active ? 72167 : 51075,
    lock_owner_pid: active ? 72167 : 51075,
    service_pid: 51065,
    input_tap_status: tap.status,
    input_tap_attempts: tap.attempts,
    input_tap: tap,
    state_dir: process.env.AOS_STATE_ROOT + '/repo',
    socket_path: process.env.AOS_STATE_ROOT + '/repo/sock',
  };
} else if (args.join(' ') === 'clean --dry-run --json') {
  payload = { status: 'clean', foreground_dev_owners: [], stale_daemons: [], stale_locks: [], canvases: [], notes: [] };
} else {
  process.stderr.write(JSON.stringify({ code: 'UNEXPECTED_AOS', args }) + '\\n');
  process.exit(1);
}
process.stdout.write(JSON.stringify(payload) + '\\n');
`;

async function runCase({ neverReady = false, ownership = 'consistent', service = {} } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aos-ready-post-permission-'));
  const fakeAOS = path.join(root, 'aos');
  const actionLog = path.join(root, 'actions.jsonl');
  await writeFile(fakeAOS, fakeAOSSource);
  await chmod(fakeAOS, 0o755);
  const serviceStatus = {
    status: 'ok',
    mode: 'repo',
    installed: true,
    loaded: true,
    running: true,
    pid: 51065,
    actual_binary_path: fakeAOS,
    expected_binary_path: fakeAOS,
    target_matches_expected: true,
    ...service,
  };
  const child = spawn(process.execPath, [
    'scripts/aos-ready.mjs', '--repair', '--post-permission', '--json',
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AOS_PATH: fakeAOS,
      AOS_SERVICE_BINARY: fakeAOS,
      AOS_STATE_ROOT: root,
      AOS_RUNTIME_MODE: 'repo',
      AOS_FAKE_NEVER_READY: neverReady ? '1' : '0',
      AOS_FAKE_OWNERSHIP: ownership,
      AOS_TEST_READY_MOCK_SERVICE_ACTIONS: '1',
      AOS_TEST_READY_SERVICE_ACTION_LOG: actionLog,
      AOS_TEST_READY_SERVICE_STATUS_JSON: JSON.stringify(serviceStatus),
      AOS_TEST_READY_WAIT_BUDGET_MS: '120',
      AOS_TEST_READY_WAIT_POLL_MS: '10',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolve) => child.once('exit', resolve));
  let actions = [];
  try {
    actions = (await readFile(actionLog, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  } catch {
    actions = [];
  }
  const result = { exitCode, response: JSON.parse(stdout), stderr, actions };
  await rm(root, { recursive: true, force: true });
  return result;
}

test('post-permission repair performs one managed restart and requires fresh live tap facts', async () => {
  const result = await runCase();
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.actions, [{ action: 'restart', mode: 'repo' }]);
  assert.equal(result.response.ready, true);
  assert.equal(result.response.ready_source, 'daemon');
  assert.equal(result.response.runtime.daemon_pid, 72167);
  assert.equal(result.response.runtime.input_tap.status, 'active');
  assert.equal(result.response.runtime.input_tap.listen_access, true);
  assert.equal(result.response.runtime.input_tap.post_access, true);
  assert.equal(result.response.action_trace.some((entry) => entry.step === 'wait_for_recovery' && entry.result === 'ready'), true);
});

test('post-permission repair never performs a second restart when live facts stay stale', async () => {
  const result = await runCase({ neverReady: true });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.actions, [{ action: 'restart', mode: 'repo' }]);
  assert.equal(result.response.ready, false);
  assert.equal(result.response.action_trace.some((entry) => entry.step === 'wait_for_recovery' && entry.result === 'timed_out'), true);
  assert.equal(result.response.action_trace.some((entry) => entry.step === 'post_permission_recovery' && entry.result === 'exhausted'), true);
});

test('post-permission repair fails closed before restart for unmanaged ownership', async () => {
  const result = await runCase({ ownership: 'unmanaged' });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.actions, []);
  assert.equal(result.response.action_trace.some((entry) => (
    entry.step === 'post_permission_recovery'
      && entry.result === 'blocked'
      && entry.detail.includes('daemon_not_launchd_managed')
  )), true);
});

test('post-permission repair fails closed before restart for service mode mismatch', async () => {
  const result = await runCase({ service: { mode: 'installed' } });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.actions, []);
  assert.equal(result.response.action_trace.some((entry) => (
    entry.step === 'post_permission_recovery'
      && entry.result === 'blocked'
      && entry.detail.includes('service_mode_mismatch')
  )), true);
});

test('post-permission repair fails closed before restart for binary target mismatch', async () => {
  const result = await runCase({
    service: { actual_binary_path: '/tmp/other-aos', target_matches_expected: false },
  });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.actions, []);
  assert.equal(result.response.action_trace.some((entry) => (
    entry.step === 'post_permission_recovery'
      && entry.result === 'blocked'
      && entry.detail.includes('binary_identity_mismatch')
  )), true);
});
