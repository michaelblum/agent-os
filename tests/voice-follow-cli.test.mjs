import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { voiceCLIErrorEnvelope } from '../scripts/lib/aos-voice-follow.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cleanups = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

async function fakeDaemon(onRequest) {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-voice-cli-'));
  const modeRoot = path.join(stateRoot, 'repo');
  await fs.mkdir(modeRoot, { recursive: true });
  const socketPath = path.join(modeRoot, 'sock');
  const server = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        onRequest(JSON.parse(line), socket);
      }
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  cleanups.push(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(stateRoot, { recursive: true, force: true });
  });
  return stateRoot;
}

function launch(script, args, stateRoot, extraEnv = {}) {
  const child = spawn(process.execPath, [path.join(repoRoot, script), ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AOS_STATE_ROOT: stateRoot,
      AOS_RUNTIME_MODE: 'repo',
      AOS_DISABLE_DAEMON_AUTOSTART: '1',
      ...extraEnv,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const completed = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr })));
  return { child, completed };
}

let externalDispatcherSequence = 0;

async function launchFromExternalDispatcher({
  stateRoot,
  script,
  args,
  extraEnv = {},
  stdinText = '',
  childInheritsDispatcherStdin = false,
  dispatcherStdin = 'ignore',
  moduleDelayMs = 0,
}) {
  externalDispatcherSequence += 1;
  const suffix = String(externalDispatcherSequence);
  const launcherPath = path.join(stateRoot, `external-dispatch-parent-${suffix}.cjs`);
  const childPIDPath = path.join(stateRoot, `external-child-${suffix}.pid`);
  await fs.writeFile(launcherPath, `
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const childArgs = JSON.parse(process.env.AOS_TEST_EXTERNAL_CHILD_ARGS);
const moduleDelayMs = Number(process.env.AOS_TEST_EXTERNAL_MODULE_DELAY_MS || 0);
const launchArgs = moduleDelayMs > 0
  ? ['-e', \`
      const { pathToFileURL } = require('node:url');
      const childArgs = JSON.parse(process.env.AOS_TEST_EXTERNAL_CHILD_ARGS);
      process.argv = [process.execPath, ...childArgs];
      setTimeout(() => import(pathToFileURL(childArgs[0]).href).catch(() => process.exit(1)), ${moduleDelayMs});
    \`]
  : childArgs;
const child = spawn(process.execPath, launchArgs, {
  cwd: process.env.AOS_TEST_REPO_ROOT,
  env: {
    ...process.env,
    AOS_EXTERNAL_DISPATCH_LIFECYCLE_PARENT_PID: String(process.pid),
  },
  stdio: [process.env.AOS_TEST_EXTERNAL_CHILD_INHERIT_STDIN === '1' ? 'inherit' : 'pipe', 'ignore', 'ignore'],
});
if (child.stdin) child.stdin.end(Buffer.from(process.env.AOS_TEST_EXTERNAL_CHILD_STDIN_BASE64 || '', 'base64'));
fs.writeFileSync(process.env.AOS_TEST_EXTERNAL_CHILD_PID_PATH, String(child.pid));
child.unref();
setInterval(() => {}, 1000);
`);
  const dispatcher = spawn(process.execPath, [launcherPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      AOS_STATE_ROOT: stateRoot,
      AOS_RUNTIME_MODE: 'repo',
      AOS_DISABLE_DAEMON_AUTOSTART: '1',
      AOS_TEST_EXTERNAL_CHILD_ARGS: JSON.stringify([path.join(repoRoot, script), ...args]),
      AOS_TEST_EXTERNAL_CHILD_PID_PATH: childPIDPath,
      AOS_TEST_EXTERNAL_CHILD_STDIN_BASE64: Buffer.from(stdinText).toString('base64'),
      AOS_TEST_EXTERNAL_CHILD_INHERIT_STDIN: childInheritsDispatcherStdin ? '1' : '0',
      AOS_TEST_EXTERNAL_MODULE_DELAY_MS: String(moduleDelayMs),
      AOS_TEST_REPO_ROOT: repoRoot,
      ...extraEnv,
    },
    stdio: [dispatcherStdin, 'ignore', 'ignore'],
  });
  await waitForFile(childPIDPath);
  return {
    dispatcher,
    childPID: Number(await fs.readFile(childPIDPath, 'utf8')),
  };
}

async function waitForProcessExit(pid, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (processAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !processAlive(pid);
}

test('say voice inventory completes without reading an open stdin pipe', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-say-inventory-'));
  const fakeAos = path.join(stateRoot, 'aos');
  await fs.writeFile(fakeAos, `#!/usr/bin/env node
if (process.argv.slice(2).join(' ') !== '__say --list-voices') process.exit(9);
process.stdout.write('[{"id":"voice.test","name":"Test","language":"en_US","provider":"system"}]\\n');
`);
  await fs.chmod(fakeAos, 0o700);
  cleanups.push(async () => { await fs.rm(stateRoot, { recursive: true, force: true }); });

  const run = launch('scripts/aos-say.mjs', ['--list-voices'], stateRoot, { AOS_PATH: fakeAos });
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      run.child.kill('SIGKILL');
      reject(new Error('say --list-voices waited for stdin'));
    }, 2_000);
  });
  const result = await Promise.race([run.completed, timeout]).finally(() => clearTimeout(timeoutId));

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), [{
    id: 'voice.test',
    name: 'Test',
    language: 'en_US',
    provider: 'system',
  }]);
});

function success(ref) {
  return `${JSON.stringify({ v: 1, status: 'success', data: {}, ref })}\n`;
}

const externalSpawnRecordID = 'spawn-record-test';
const externalSpawnOperationID = 'operation-test';
const externalSpawnOperationGeneration = 7;
const externalManifest = JSON.parse(await fs.readFile(
  path.join(repoRoot, 'manifests/commands/aos-external-commands.json'),
  'utf8',
));
const externalSpawnReviewedDependencySetDigest = externalManifest.commands
  .find((command) => command.spawn_registration)
  .spawn_registration.reviewed_dependency_set_digest;
const externalSpawnChildEnvironment = {
  AOS_EXTERNAL_DISPATCH_REVIEWED_DEPENDENCY_SET_DIGEST: externalSpawnReviewedDependencySetDigest,
};

function externalSpawnFinalized(request) {
  assert.equal(request.v, 1);
  assert.equal(request.service, 'operation');
  assert.equal(request.action, 'external_spawn_finalize');
  assert.equal(request.data.schema_version, 'aos.operation.external-spawn-finalize-request.v1');
  assert.equal(request.data.request_id, request.ref);
  assert.deepEqual(Object.keys(request.data).sort(), ['request_id', 'schema_version']);
  const receipt = {
    spawn_record_id: externalSpawnRecordID,
    operation_id: externalSpawnOperationID,
    operation_generation: externalSpawnOperationGeneration,
    adapter_registration_id: 'microphone-capture-adapter',
    adapter_registration_revision: 1,
    resolved_executable_path_digest: 'a'.repeat(64),
    executable_identity_digest: 'b'.repeat(64),
    executable_file_digest: 'c'.repeat(64),
    platform_code_directory_hash: '1'.repeat(40),
    platform_code_directory_hash_algorithm: 'sha256_truncated_cdhash_20_bytes',
    expected_script_identity_digest: 'd'.repeat(64),
    script_identity_digest: 'd'.repeat(64),
    script_digest: 'e'.repeat(64),
    canonical_argv_shape_digest: 'f'.repeat(64),
    reviewed_dependency_set_digest: externalSpawnReviewedDependencySetDigest,
    outcome: 'generation_bound_spawn_record_finalized',
  };
  return `${JSON.stringify({
    v: 1,
    status: 'success',
    ref: request.ref,
    data: {
      schema_version: 'aos.operation.external-spawn-finalize-response.v1',
      request_id: request.ref,
      spawn_record_id: externalSpawnRecordID,
      operation_id: externalSpawnOperationID,
      operation_generation: externalSpawnOperationGeneration,
      adapter_registration_id: 'microphone-capture-adapter',
      adapter_registration_revision: 1,
      outcome: 'generation_bound_spawn_record_finalized',
      receipt,
    },
  })}\n`;
}

function event(name, data, ref) {
  return `${JSON.stringify({ v: 1, service: 'voice', event: name, ts: 1, data, ref })}\n`;
}

test('microphone duration parsing rejects schema-incompatible bounds before daemon startup', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-voice-bounds-'));
  cleanups.push(async () => { await fs.rm(stateRoot, { recursive: true, force: true }); });
  const tooShortLease = launch('scripts/aos-tell-listen.mjs', [
    'listen',
    '--source',
    'microphone',
    '--output',
    path.join(stateRoot, 'capture.wav'),
    '--max-duration',
    '0.5ms',
    '--follow',
  ], stateRoot);
  const leaseResult = await tooShortLease.completed;
  assert.equal(leaseResult.code, 1);
  assert.match(leaseResult.stderr, /"code":"INVALID_ARG"/);

  const tooShortSegment = launch('scripts/aos-tell-listen.mjs', [
    'listen',
    '--source',
    'microphone',
    '--segments',
    path.join(stateRoot, 'segments'),
    '--segment-duration',
    '250ms',
    '--follow',
  ], stateRoot);
  const segmentResult = await tooShortSegment.completed;
  assert.equal(segmentResult.code, 1);
  assert.match(segmentResult.stderr, /"code":"INVALID_ARG"/);

  const invalidCue = launch('scripts/aos-tell-listen.mjs', [
    'listen',
    '--source',
    'microphone',
    '--segments',
    path.join(stateRoot, 'cue-segments'),
    '--ready-cue',
    'voice',
    '--follow',
  ], stateRoot);
  const invalidCueResult = await invalidCue.completed;
  assert.equal(invalidCueResult.code, 1);
  assert.match(invalidCueResult.stderr, /"code":"INVALID_ARG"/);

  const misplacedCue = launch('scripts/aos-tell-listen.mjs', [
    'listen',
    '--source',
    'microphone',
    '--output',
    path.join(stateRoot, 'capture.wav'),
    '--ready-cue',
    'chime',
    '--follow',
  ], stateRoot);
  const misplacedCueResult = await misplacedCue.completed;
  assert.equal(misplacedCueResult.code, 1);
  assert.match(misplacedCueResult.stderr, /"code":"INVALID_ARG"/);
});

const startingDaemonSource = `#!/usr/bin/env node
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const root = process.env.AOS_STATE_ROOT;
const mode = process.env.AOS_RUNTIME_MODE || 'repo';
const modeRoot = path.join(root, mode);
const socketPath = path.join(modeRoot, 'sock');
const lockPath = path.join(modeRoot, 'daemon.lock');
const tokenObservationPath = process.env.AOS_FAKE_TOKEN_OBSERVATION_PATH;
fs.mkdirSync(modeRoot, { recursive: true });
if (tokenObservationPath) {
  fs.writeFileSync(
    tokenObservationPath,
    Object.prototype.hasOwnProperty.call(process.env, 'AOS_EXTERNAL_DISPATCH_BINDING_TOKEN') ? 'present' : 'absent',
  );
}
fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, mode, socket_path: socketPath }));
let server = null;
let closing = false;
const startupTimer = setTimeout(() => {
  try { fs.rmSync(socketPath, { force: true }); } catch {}
  server = net.createServer((socket) => socket.on('data', () => {}));
  server.listen(socketPath);
}, Number(process.env.AOS_FAKE_START_DELAY_MS || 2000));
const keepalive = setInterval(() => {}, 1000);
function finish() {
  clearInterval(keepalive);
  try { fs.rmSync(socketPath, { force: true }); } catch {}
  if (process.env.AOS_FAKE_PRESERVE_LOCK_ON_SHUTDOWN !== '1') {
    try { fs.rmSync(lockPath, { force: true }); } catch {}
  }
  process.exit(0);
}
function shutdown() {
  if (process.env.AOS_FAKE_IGNORE_SIGTERM === '1') return;
  if (closing) return;
  closing = true;
  clearTimeout(startupTimer);
  if (server) server.close(finish);
  else finish();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
`;

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(filePath, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fs.access(filePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`timed out waiting for ${filePath}`);
}

async function socketReachable(socketPath) {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 100);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.end();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function runStartupCancellation({ command, signal = null, ignoreSigterm = false }) {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), `aos-voice-startup-${command}-`));
  const fakeAOS = path.join(stateRoot, 'fake-aos.cjs');
  const lockPath = path.join(stateRoot, 'repo', 'daemon.lock');
  const socketPath = path.join(stateRoot, 'repo', 'sock');
  await fs.writeFile(fakeAOS, startingDaemonSource);
  await fs.chmod(fakeAOS, 0o755);
  const args = command === 'listen'
    ? ['listen', '--source', 'hotkey', '--shortcut', 'Control+Option+Space', '--follow']
    : ['--follow'];
  const script = command === 'listen' ? 'scripts/aos-tell-listen.mjs' : 'scripts/aos-say.mjs';
  const run = launch(script, args, stateRoot, {
    AOS_PATH: fakeAOS,
    AOS_ALLOW_DAEMON_AUTOSTART: '1',
    AOS_DISABLE_DAEMON_AUTOSTART: '0',
    AOS_FAKE_START_DELAY_MS: '5000',
    AOS_FAKE_IGNORE_SIGTERM: ignoreSigterm ? '1' : '0',
  });
  if (command === 'say') run.child.stdin.end('startup cancellation speech');

  let daemonPID;
  try {
    await waitForFile(lockPath);
    daemonPID = JSON.parse(await fs.readFile(lockPath, 'utf8')).pid;
    if (signal) run.child.kill(signal);
    const timeoutMs = ignoreSigterm ? 5000 : 3000;
    let timer;
    const result = await Promise.race([
      run.completed,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${command} wrapper did not exit during managed startup cancellation`)), timeoutMs);
      }),
    ]).finally(() => clearTimeout(timer));
    assert.equal(result.code, 0, result.stderr);
    assert.equal(processAlive(daemonPID), false, `managed daemon ${daemonPID} survived ${command} startup cancellation`);
    assert.equal(await socketReachable(socketPath), false, `${command} startup socket remained reachable`);
  } finally {
    if (daemonPID && processAlive(daemonPID)) {
      try { process.kill(daemonPID, 'SIGKILL'); } catch {}
    }
    if (processAlive(run.child.pid)) {
      try { run.child.kill('SIGKILL'); } catch {}
    }
    await fs.rm(stateRoot, { recursive: true, force: true });
  }
}

test('listen and say repeatedly cancel managed daemon startup on SIGINT and SIGTERM', async () => {
  for (let cycle = 0; cycle < 3; cycle += 1) {
    for (const command of ['listen', 'say']) {
      for (const signal of ['SIGINT', 'SIGTERM']) {
        await runStartupCancellation({ command, signal });
      }
    }
  }
});

test('managed startup cancellation escalates to SIGKILL and still awaits daemon exit', async () => {
  await runStartupCancellation({ command: 'listen', signal: 'SIGTERM', ignoreSigterm: true });
});

test('tokenless child launch material is consumed before managed daemon autostart', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-voice-token-scrub-'));
  const fakeAOS = path.join(stateRoot, 'fake-aos.cjs');
  const lockPath = path.join(stateRoot, 'repo', 'daemon.lock');
  const tokenObservationPath = path.join(stateRoot, 'token-observation');
  await fs.writeFile(fakeAOS, startingDaemonSource);
  await fs.chmod(fakeAOS, 0o755);
  const run = launch('scripts/aos-tell-listen.mjs', [
    'listen',
    '--source',
    'microphone',
    '--output',
    path.join(stateRoot, 'capture.wav'),
    '--follow',
  ], stateRoot, {
    AOS_PATH: fakeAOS,
    AOS_ALLOW_DAEMON_AUTOSTART: '1',
    AOS_DISABLE_DAEMON_AUTOSTART: '0',
    AOS_FAKE_START_DELAY_MS: '5000',
    AOS_FAKE_TOKEN_OBSERVATION_PATH: tokenObservationPath,
    ...externalSpawnChildEnvironment,
    AOS_EXTERNAL_DISPATCH_LIFECYCLE_PARENT_PID: String(process.pid),
  });
  let daemonPID;
  try {
    await waitForFile(lockPath);
    daemonPID = JSON.parse(await fs.readFile(lockPath, 'utf8')).pid;
    await waitForFile(tokenObservationPath);
    assert.equal(await fs.readFile(tokenObservationPath, 'utf8'), 'absent');
    run.child.kill('SIGTERM');
    const result = await run.completed;
    assert.equal(result.code, 0, result.stderr);
  } finally {
    if (daemonPID && processAlive(daemonPID)) {
      try { process.kill(daemonPID, 'SIGKILL'); } catch {}
    }
    if (processAlive(run.child.pid)) {
      try { run.child.kill('SIGKILL'); } catch {}
    }
    await fs.rm(stateRoot, { recursive: true, force: true });
  }
});

test('hotkey follow emits only canonical dictation events and ignores fragmentation', async () => {
  let firstRequest;
  const stateRoot = await fakeDaemon((request, socket) => {
    firstRequest = request;
    socket.write(success(request.ref));
    const opened = event('dictation_opened', { source: 'hotkey' }, request.ref);
    socket.write(opened.slice(0, 7));
    socket.write(opened.slice(7));
    socket.write(event('dictation_closed_send', { reason: 'key_release' }, request.ref));
  });
  const run = launch('scripts/aos-tell-listen.mjs', ['listen', '--source', 'hotkey', '--shortcut', 'Control+Option+Space', '--follow'], stateRoot);
  await new Promise((resolve) => setTimeout(resolve, 100));
  run.child.kill('SIGTERM');
  const result = await run.completed;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(firstRequest.service, 'listen');
  assert.equal(firstRequest.action, 'hotkey');
  assert.deepEqual(firstRequest.data, { shortcut: 'Control+Option+Space' });
  const events = result.stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.deepEqual(events.map((item) => item.event), ['dictation_opened', 'dictation_closed_send']);
  assert.ok(events.every((item) => !JSON.stringify(item).includes('keyCode')));
});

test('legacy external-dispatch parent PID is ignored as an authority signal', async () => {
  let requestSeen = false;
  const stateRoot = await fakeDaemon((request, socket) => {
    requestSeen = true;
    socket.write(success(request.ref));
    socket.write(event('dictation_opened', { source: 'hotkey' }, request.ref));
  });
  const run = launch(
    'scripts/aos-tell-listen.mjs',
    ['listen', '--source', 'hotkey', '--shortcut', 'Control+Option+Space', '--follow'],
    stateRoot,
    { AOS_EXTERNAL_DISPATCH_PARENT_PID: '2147483647' },
  );
  const deadline = Date.now() + 3000;
  while (!requestSeen && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(requestSeen, true);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(run.child.exitCode, null, 'legacy parent PID unexpectedly controlled the voice client');
  run.child.kill('SIGTERM');
  const result = await run.completed;

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /"event":"dictation_opened"/);
});

test('admitted microphone lease cancels when its mechanically observed dispatcher parent exits', async () => {
  const requests = [];
  const stateRoot = await fakeDaemon((request, socket) => {
    requests.push(request);
    if (request.action === 'external_spawn_finalize') {
      socket.write(externalSpawnFinalized(request));
    } else if (request.action === 'microphone') {
      socket.write(success(request.ref));
      socket.write(event('capture_started', {
        sample_rate: 16000,
        channels: 1,
        max_duration_ms: 120000,
      }, request.ref));
    } else if (request.action === 'cancel') {
      socket.write(success(request.ref));
      socket.write(event('capture_canceled', { reason: 'owner_disconnected' }, request.ref));
    }
  });
  const { dispatcher, childPID } = await launchFromExternalDispatcher({
    stateRoot,
    script: 'scripts/aos-tell-listen.mjs',
    args: [
      'listen',
      '--source',
      'microphone',
      '--output',
      path.join(stateRoot, 'capture.wav'),
      '--follow',
    ],
    extraEnv: {
      ...externalSpawnChildEnvironment,
    },
  });
  try {
    const requestDeadline = Date.now() + 3000;
    while (!requests.some((request) => request.action === 'microphone') && Date.now() < requestDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(requests.some((request) => request.action === 'microphone'), true);
    const dispatcherClosed = new Promise((resolve) => dispatcher.once('close', resolve));
    dispatcher.kill('SIGKILL');
    await dispatcherClosed;
    assert.equal(await waitForProcessExit(childPID), true, `external microphone child ${childPID} survived its dispatcher`);
    assert.deepEqual(
      requests.map((request) => request.action),
      ['external_spawn_finalize', 'microphone', 'cancel'],
    );
  } finally {
    if (processAlive(dispatcher.pid)) {
      try { dispatcher.kill('SIGKILL'); } catch {}
    }
    if (processAlive(childPID)) {
      try { process.kill(childPID, 'SIGKILL'); } catch {}
    }
  }
});

test('dispatcher loss during spawn finalization cannot start microphone authority afterward', async () => {
  const requests = [];
  const stateRoot = await fakeDaemon((request, socket) => {
    requests.push(request);
    if (request.action === 'external_spawn_finalize') {
      setTimeout(() => {
        if (!socket.destroyed) socket.write(externalSpawnFinalized(request));
      }, 700);
    }
  });
  const { dispatcher, childPID } = await launchFromExternalDispatcher({
    stateRoot,
    script: 'scripts/aos-tell-listen.mjs',
    args: [
      'listen',
      '--source',
      'microphone',
      '--output',
      path.join(stateRoot, 'capture.wav'),
      '--follow',
    ],
    extraEnv: {
      ...externalSpawnChildEnvironment,
    },
  });
  try {
    const finalizeDeadline = Date.now() + 3000;
    while (!requests.some((request) => request.action === 'external_spawn_finalize') && Date.now() < finalizeDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(requests.some((request) => request.action === 'external_spawn_finalize'), true);
    const dispatcherClosed = new Promise((resolve) => dispatcher.once('close', resolve));
    dispatcher.kill('SIGKILL');
    await dispatcherClosed;
    assert.equal(await waitForProcessExit(childPID), true, `external microphone child ${childPID} survived finalization owner loss`);
    await new Promise((resolve) => setTimeout(resolve, 750));
    assert.deepEqual(requests.map((request) => request.action), ['external_spawn_finalize']);
  } finally {
    if (processAlive(dispatcher.pid)) {
      try { dispatcher.kill('SIGKILL'); } catch {}
    }
    if (processAlive(childPID)) {
      try { process.kill(childPID, 'SIGKILL'); } catch {}
    }
  }
});

test('all dispatcher-owned follow streams close when their mechanically observed parent exits', async () => {
  const cases = [
    {
      name: 'channel',
      script: 'scripts/aos-tell-listen.mjs',
      args: ['listen', 'test-channel', '--follow'],
      initialAction: 'observe',
      initialEvent: 'message',
      terminalEvent: null,
      expectedActions: ['observe'],
    },
    {
      name: 'hotkey',
      script: 'scripts/aos-tell-listen.mjs',
      args: ['listen', '--source', 'hotkey', '--shortcut', 'Control+Option+Space', '--follow'],
      initialAction: 'hotkey',
      initialEvent: 'dictation_opened',
      terminalEvent: null,
      expectedActions: ['hotkey'],
    },
    {
      name: 'say',
      script: 'scripts/aos-say.mjs',
      args: ['--follow'],
      stdinText: 'owner disconnect speech',
      initialAction: 'speak',
      initialEvent: 'speech_started',
      terminalEvent: 'speech_canceled',
      expectedActions: ['speak', 'cancel'],
    },
    {
      name: 'playback',
      script: 'scripts/aos-play.mjs',
      args: (stateRoot) => ['--audio', path.join(stateRoot, 'private.wav'), '--follow'],
      initialAction: 'playback',
      initialEvent: 'playback_started',
      terminalEvent: 'playback_canceled',
      expectedActions: ['playback', 'cancel'],
    },
  ];

  for (const scenario of cases) {
    const requests = [];
    const stateRoot = await fakeDaemon((request, socket) => {
      requests.push(request);
      if (request.action === scenario.initialAction) {
        socket.write(success(request.ref));
        socket.write(event(scenario.initialEvent, {}, request.ref));
      } else if (request.action === 'cancel' && scenario.terminalEvent) {
        socket.write(success(request.ref));
        socket.write(event(scenario.terminalEvent, { reason: 'owner_disconnected' }, request.ref));
      }
    });
    const { dispatcher, childPID } = await launchFromExternalDispatcher({
      stateRoot,
      script: scenario.script,
      args: typeof scenario.args === 'function' ? scenario.args(stateRoot) : scenario.args,
      stdinText: scenario.stdinText,
    });
    try {
      const requestDeadline = Date.now() + 3000;
      while (!requests.some((request) => request.action === scenario.initialAction) && Date.now() < requestDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(
        requests.some((request) => request.action === scenario.initialAction),
        true,
        `${scenario.name} child did not establish its follow lease`,
      );
      const dispatcherClosed = new Promise((resolve) => dispatcher.once('close', resolve));
      dispatcher.kill('SIGKILL');
      await dispatcherClosed;
      assert.equal(
        await waitForProcessExit(childPID),
        true,
        `${scenario.name} child ${childPID} survived its dispatcher`,
      );
      assert.deepEqual(requests.map((request) => request.action), scenario.expectedActions);
    } finally {
      if (processAlive(dispatcher.pid)) {
        try { dispatcher.kill('SIGKILL'); } catch {}
      }
      if (processAlive(childPID)) {
        try { process.kill(childPID, 'SIGKILL'); } catch {}
      }
    }
  }
});

test('say owner-loss handling stays live while inherited stdin has not reached EOF', async () => {
  const requests = [];
  const stateRoot = await fakeDaemon((request) => { requests.push(request); });
  const stdinHolder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const { dispatcher, childPID } = await launchFromExternalDispatcher({
    stateRoot,
    script: 'scripts/aos-say.mjs',
    args: ['--follow'],
    childInheritsDispatcherStdin: true,
    dispatcherStdin: stdinHolder.stdout,
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(processAlive(childPID), true, 'say child exited before inherited stdin owner loss');
    const dispatcherClosed = new Promise((resolve) => dispatcher.once('close', resolve));
    dispatcher.kill('SIGKILL');
    await dispatcherClosed;
    assert.equal(await waitForProcessExit(childPID), true, `say child ${childPID} remained blocked on inherited stdin`);
    assert.deepEqual(requests, []);
  } finally {
    if (processAlive(dispatcher.pid)) {
      try { dispatcher.kill('SIGKILL'); } catch {}
    }
    if (processAlive(childPID)) {
      try { process.kill(childPID, 'SIGKILL'); } catch {}
    }
    if (processAlive(stdinHolder.pid)) {
      try { stdinHolder.kill('SIGKILL'); } catch {}
    }
  }
});

test('lifecycle-only parent assertion rejects delayed module startup after dispatcher loss', async () => {
  const requests = [];
  const stateRoot = await fakeDaemon((request) => { requests.push(request); });
  const { dispatcher, childPID } = await launchFromExternalDispatcher({
    stateRoot,
    script: 'scripts/aos-tell-listen.mjs',
    args: ['listen', 'test-channel', '--follow'],
    moduleDelayMs: 700,
  });
  try {
    const dispatcherClosed = new Promise((resolve) => dispatcher.once('close', resolve));
    dispatcher.kill('SIGKILL');
    await dispatcherClosed;
    assert.equal(
      await waitForProcessExit(childPID),
      true,
      `delayed module child ${childPID} survived its lifecycle-only dispatcher`,
    );
    assert.deepEqual(requests, []);
  } finally {
    if (processAlive(dispatcher.pid)) {
      try { dispatcher.kill('SIGKILL'); } catch {}
    }
    if (processAlive(childPID)) {
      try { process.kill(childPID, 'SIGKILL'); } catch {}
    }
  }
});

test('microphone authority is unavailable without native-supplied reviewed dependency evidence', async () => {
  const requests = [];
  const stateRoot = await fakeDaemon((request) => { requests.push(request); });
  const run = launch('scripts/aos-tell-listen.mjs', [
    'listen',
    '--source',
    'microphone',
    '--output',
    path.join(stateRoot, 'capture.wav'),
    '--follow',
  ], stateRoot);
  const result = await run.completed;

  assert.equal(result.code, 1);
  assert.match(result.stderr, /"code":"EXTERNAL_SPAWN_FINALIZE_INVALID"/);
  assert.deepEqual(requests, []);
});

test('microphone authority is unavailable when external-spawn finalization is rejected', async () => {
  const requests = [];
  const stateRoot = await fakeDaemon((request, socket) => {
    requests.push(request);
    assert.equal(request.action, 'external_spawn_finalize');
    socket.write(`${JSON.stringify({
      v: 1,
      status: 'error',
      code: 'EXTERNAL_SPAWN_FINALIZE_REJECTED',
      error: 'rejected',
      ref: request.ref,
    })}\n`);
  });
  const run = launch('scripts/aos-tell-listen.mjs', [
    'listen',
    '--source',
    'microphone',
    '--output',
    path.join(stateRoot, 'capture.wav'),
    '--follow',
  ], stateRoot, externalSpawnChildEnvironment);
  const result = await run.completed;

  assert.equal(result.code, 1);
  assert.match(result.stderr, /"code":"EXTERNAL_SPAWN_FINALIZE_FAILED"/);
  assert.deepEqual(requests.map((item) => item.action), ['external_spawn_finalize']);
});

test('SIGINT finalizes microphone capture and output events never reveal its path', async () => {
  const requests = [];
  let captureSocket;
  const stateRoot = await fakeDaemon((request, socket) => {
    requests.push(request);
    if (request.action === 'external_spawn_finalize') {
      socket.write(externalSpawnFinalized(request));
    } else if (request.action === 'microphone') {
      captureSocket = socket;
      socket.write(success(request.ref));
      socket.write(event('capture_started', { sample_rate: 16000, channels: 1, max_duration_ms: 120000 }, request.ref));
      socket.write(event('audio_frame', { stream: 'capture', rms: 0.1, peak: 0.2, sequence: 1 }, request.ref));
    } else if (request.action === 'stop') {
      socket.write(success(request.ref));
      socket.write(event('capture_completed', { reason: 'explicit_stop', duration_ms: 500, bytes: 16044 }, request.ref));
    }
  });
  const outputPath = path.join(stateRoot, 'private.wav');
  const run = launch(
    'scripts/aos-tell-listen.mjs',
    ['listen', '--source', 'microphone', '--output', outputPath, '--follow'],
    stateRoot,
    externalSpawnChildEnvironment,
  );
  while (!captureSocket) await new Promise((resolve) => setTimeout(resolve, 10));
  run.child.kill('SIGINT');
  const result = await run.completed;
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(requests.map((item) => item.action), ['external_spawn_finalize', 'microphone', 'stop']);
  assert.equal(Object.hasOwn(requests[1].data, 'one_time_binding_token'), false);
  assert.ok(!result.stdout.includes(outputPath));
  assert.ok(!result.stderr.includes(outputPath));
  assert.match(result.stdout, /"event":"capture_completed"/);
});

test('segmented microphone follow publishes path-free checkpoints and finalizes on SIGINT', async () => {
  const requests = [];
  let captureSocket;
  const stateRoot = await fakeDaemon((request, socket) => {
    requests.push(request);
    if (request.action === 'external_spawn_finalize') {
      socket.write(externalSpawnFinalized(request));
    } else if (request.action === 'microphone_segmented') {
      captureSocket = socket;
      socket.write(success(request.ref));
      socket.write(event('capture_segmented_started', {
        sample_rate: 16000,
        channels: 1,
        max_duration_ms: 120000,
        segment_duration_ms: 3000,
      }, request.ref));
      socket.write(event('capture_segment_ready', {
        index: 1,
        duration_ms: 3000,
        bytes: 96044,
      }, request.ref));
    } else if (request.action === 'stop') {
      socket.write(success(request.ref));
      socket.write(event('capture_segmented_completed', {
        reason: 'explicit_stop',
        duration_ms: 3000,
        bytes: 96044,
        segments: 1,
      }, request.ref));
    }
  });
  const segmentsDirectory = path.join(stateRoot, 'private-segments');
  const run = launch('scripts/aos-tell-listen.mjs', [
    'listen',
    '--source',
    'microphone',
    '--segments',
    segmentsDirectory,
    '--segment-duration',
    '3s',
    '--ready-cue',
    'chime',
    '--follow',
  ], stateRoot, externalSpawnChildEnvironment);
  while (!captureSocket) await new Promise((resolve) => setTimeout(resolve, 10));
  run.child.kill('SIGINT');
  const result = await run.completed;
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(requests.map((item) => item.action), ['external_spawn_finalize', 'microphone_segmented', 'stop']);
  assert.equal(requests[1].data.segments_directory, segmentsDirectory);
  assert.equal(requests[1].data.segment_duration_seconds, 3);
  assert.equal(requests[1].data.ready_cue, 'chime');
  assert.equal(Object.hasOwn(requests[1].data, 'one_time_binding_token'), false);
  assert.ok(!result.stdout.includes(segmentsDirectory));
  assert.ok(!result.stderr.includes(segmentsDirectory));
  assert.deepEqual(result.stdout.trim().split('\n').map(JSON.parse).map((item) => item.event), [
    'capture_segmented_started',
    'capture_segment_ready',
    'capture_segmented_completed',
  ]);
});

test('audio playback follow keeps its input path private while streaming exact meters', async () => {
  let requestSeen;
  const stateRoot = await fakeDaemon((request, socket) => {
    requestSeen = request;
    socket.write(success(request.ref));
    socket.write(event('playback_started', {
      duration_ms: 1000,
      bytes: 32044,
      sample_rate: 16000,
      channels: 1,
    }, request.ref));
    socket.write(event('audio_frame', {
      stream: 'playback',
      rms: 0.1,
      peak: 0.2,
      sequence: 1,
    }, request.ref));
    socket.write(event('playback_finished', { reason: 'completed' }, request.ref));
  });
  const privatePath = path.join(stateRoot, 'private.wav');
  const run = launch('scripts/aos-play.mjs', ['--audio', privatePath, '--follow'], stateRoot);
  const result = await run.completed;

  assert.equal(result.code, 0, result.stderr);
  assert.equal(requestSeen.service, 'voice');
  assert.equal(requestSeen.action, 'playback');
  assert.deepEqual(requestSeen.data, { audio_path: privatePath });
  assert.ok(!result.stdout.includes(privatePath));
  assert.ok(!result.stderr.includes(privatePath));
  assert.deepEqual(result.stdout.trim().split('\n').map(JSON.parse).map((item) => item.event), [
    'playback_started',
    'audio_frame',
    'playback_finished',
  ]);
});

test('audio playback rejects a relative path before daemon startup', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-playback-relative-'));
  cleanups.push(async () => { await fs.rm(stateRoot, { recursive: true, force: true }); });
  const run = launch('scripts/aos-play.mjs', ['--audio', 'private.wav', '--follow'], stateRoot);
  const result = await run.completed;
  assert.equal(result.code, 1);
  assert.match(result.stderr, /"code":"INVALID_AUDIO_PATH"/);
  assert.ok(!result.stderr.includes('private.wav'));
});

test('audio playback help is passive', async () => {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'aos-playback-help-'));
  cleanups.push(async () => { await fs.rm(stateRoot, { recursive: true, force: true }); });
  const run = launch('scripts/aos-play.mjs', ['--help'], stateRoot);
  const result = await run.completed;
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Usage: aos play/);
});

test('say follow keeps stdin text out of output while streaming same-run meters', async () => {
  const secret = 'private spoken response';
  let receivedText;
  const stateRoot = await fakeDaemon((request, socket) => {
    receivedText = request.data.text;
    socket.write(success(request.ref));
    socket.write(event('speech_started', { rate_wpm: 180 }, request.ref));
    socket.write(event('audio_frame', { stream: 'speech', rms: 0.2, peak: 0.4, sequence: 1 }, request.ref));
    socket.write(event('speech_finished', { reason: 'completed' }, request.ref));
  });
  const run = launch('scripts/aos-say.mjs', ['--follow', '--rate', '180'], stateRoot);
  run.child.stdin.end(secret);
  const result = await run.completed;
  assert.equal(result.code, 0, result.stderr);
  assert.equal(receivedText, secret);
  assert.ok(!result.stdout.includes(secret));
  assert.ok(!result.stderr.includes(secret));
  assert.deepEqual(result.stdout.trim().split('\n').map(JSON.parse).map((item) => item.event), [
    'speech_started',
    'audio_frame',
    'speech_finished',
  ]);
});

test('daemon errors are code-projected without echoing request text or paths', async () => {
  const secret = 'never echo this sentence';
  const leakedPath = '/private/tmp/never-echo.wav';
  const stateRoot = await fakeDaemon((request, socket) => {
    socket.write(`${JSON.stringify({
      v: 1,
      status: 'error',
      code: 'VOICE_TRANSPORT_FAILED',
      error: `failed for ${request.data.text} at ${leakedPath}`,
      ref: request.ref,
    })}\n`);
  });
  const run = launch('scripts/aos-say.mjs', ['--follow'], stateRoot);
  run.child.stdin.end(secret);
  const result = await run.completed;
  assert.equal(result.code, 1);
  assert.ok(!result.stderr.includes(secret));
  assert.ok(!result.stderr.includes(leakedPath));
  assert.match(result.stderr, /"code":"VOICE_TRANSPORT_FAILED"/);
});

test('unexpected voice CLI exceptions are projected without raw messages or codes', () => {
  const secret = '/private/tmp/voice-secret.wav';
  const envelope = voiceCLIErrorEnvelope(Object.assign(new Error(`failed at ${secret}`), {
    code: `LEAK_${secret}`,
  }));
  assert.deepEqual(envelope, {
    code: 'VOICE_TRANSPORT_FAILED',
    error: 'voice transport failed',
  });
  assert.ok(!JSON.stringify(envelope).includes(secret));
});

test('terminal native failure events produce a nonzero process exit', async () => {
  const stateRoot = await fakeDaemon((request, socket) => {
    if (request.action === 'external_spawn_finalize') {
      socket.write(externalSpawnFinalized(request));
    } else if (request.action === 'microphone') {
      socket.write(success(request.ref));
      socket.write(event('capture_failed', { code: 'MICROPHONE_PERMISSION_LOST' }, request.ref));
    }
  });
  const run = launch('scripts/aos-tell-listen.mjs', [
    'listen',
    '--source',
    'microphone',
    '--output',
    path.join(stateRoot, 'capture.wav'),
    '--follow',
  ], stateRoot, externalSpawnChildEnvironment);
  const result = await run.completed;
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stdout, /"event":"capture_failed"/);
});
