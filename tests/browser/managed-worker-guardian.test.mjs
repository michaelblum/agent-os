import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import test, { after } from 'node:test';

import {
  createManagedSession,
  managedSessionIdentity,
  removeManagedSession,
} from '../../scripts/lib/browser-companion/session-lifecycle.mjs';
import { inspectStore, readPrivateRecord } from '../../scripts/lib/browser-companion/store-paths.mjs';
import { acquireStoreLock } from '../../scripts/lib/browser-companion/store-lock.mjs';
import { readSession } from '../../scripts/lib/browser-companion/session-store.mjs';
import { runWorkerProcessGroup } from '../../scripts/lib/browser-companion/worker-process-group.mjs';
import { installManagedRuntime, managedRuntimeFixture, repoRoot } from './managed-runtime-test-fixture.mjs';

const roots = new Set();
const trackedPids = new Set();
function isolated(prefix = 'aos-managed-guardian-') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.add(root);
  return { root, env: { ...process.env, AOS_STATE_ROOT: root, AOS_RUNTIME_MODE: 'repo' } };
}
function output(value) { return Buffer.from(`${JSON.stringify(value)}\n`); }
function upstream(request) { return request.argv[0].slice(3); }
function exactRun() {
  return async (request) => {
    const session = upstream(request);
    if (request.operation === 'start') return { spawned: true, exitCode: 0, stdout: output({
      session, pid: 41, result: { snapshot: { file: '<auto>' } },
    }) };
    if (request.operation === 'cleanup') return { spawned: true, exitCode: 0, stdout: output({ session, status: request.argv[1] === 'detach' ? 'detached' : 'closed' }) };
    if (request.operation === 'liveness') return { spawned: true, exitCode: 0, stdout: output({ result: JSON.stringify({ status: 'alive' }) }) };
    return { spawned: true, exitCode: 0, stdout: output({ snapshot: { file: '<auto>' } }) };
  };
}
function waitFor(check, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      try { const value = check(); if (value) { resolve(value); return; } } catch {}
      if (Date.now() - started >= timeoutMs) { reject(new Error('guardian test deadline expired')); return; }
      setTimeout(poll, 25);
    };
    poll();
  });
}
function processIsDead(pid) {
  try { process.kill(pid, 0); return false; } catch (error) { return error?.code === 'ESRCH'; }
}
function workerPids(file) {
  if (!fs.existsSync(file)) return null;
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Number.isInteger(value.worker_pid) && Number.isInteger(value.nested_pid) ? value : null;
}
function childProgram({ descriptorFile, sessionId, readyFile = null, hookName = 'beforeGuardianRequest' }) {
  return `
    import fs from 'node:fs';
    import { createManagedSession } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, 'scripts/lib/browser-companion/session-lifecycle.mjs')).href)};
    import { validateDescriptor } from ${JSON.stringify(pathToFileURL(path.join(repoRoot, 'scripts/lib/browser-companion/descriptor.mjs')).href)};
    const current = validateDescriptor(JSON.parse(fs.readFileSync(${JSON.stringify(descriptorFile)}, 'utf8')));
    await createManagedSession(${JSON.stringify(sessionId)}, { kind:'launched', headless:true, persistent:false }, {
      env: process.env, current,
      ${readyFile ? `hooks:{${hookName}(){fs.writeFileSync(${JSON.stringify(readyFile)}, 'ready', {mode:0o600});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}},` : ''}
    });
  `;
}
function launchOwner(state, fixture, sessionId, readyFile = null, hookName = 'beforeGuardianRequest') {
  const descriptorFile = path.join(state.root, `${sessionId}-descriptor.json`);
  fs.writeFileSync(descriptorFile, `${JSON.stringify(fixture.current.descriptor)}\n`, { mode: 0o600 });
  return spawn(process.execPath, ['--input-type=module', '-e', childProgram({ descriptorFile, sessionId, readyFile, hookName })], {
    env: state.env, cwd: state.root, stdio: ['ignore', 'ignore', 'ignore'],
  });
}
function waitChild(child) {
  return new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
}
function heartbeatValue(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}
async function assertHeartbeatStops(file, pids) {
  await waitFor(() => [pids.worker_pid, pids.nested_pid].every(processIsDead));
  const before = heartbeatValue(file);
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(heartbeatValue(file), before);
}
function fakeRetirementSentinel(mode) {
  const program = `
    const fs = require('node:fs');
    const { spawn } = require('node:child_process');
    const mode = ${JSON.stringify(mode)};
    const schema = 'aos.browser.worker-group-control.v1';
    const activationSchema = 'aos.browser.worker-group-activation.v1';
    const send = (event, fields = {}) => fs.writeSync(3, Buffer.from(JSON.stringify({schema_version:schema,event,sentinel_pid:process.pid,...fields})+'\\n'));
    let buffer = '';
    let ordinary = false;
    const activation = fs.createReadStream(null,{fd:4,autoClose:false});
    activation.on('data', chunk => {
      buffer += chunk.toString('utf8');
      while (buffer.includes('\\n')) {
        const index = buffer.indexOf('\\n');
        const value = JSON.parse(buffer.slice(0,index));
        buffer = buffer.slice(index+1);
        if (value.schema_version !== activationSchema) process.exit(2);
        if (value.event === 'execute') {
          send('spawned');
          if (mode === 'ordinary') {
            ordinary = true;
            send('terminal',{kind:'exited',worker_spawned:true,exit_code:0,stdout_bytes:0,stderr_bytes:0});
          }
          if (mode === 'emit') { process.stdout.write('out'); setImmediate(()=>process.stderr.write('err')); }
          if (mode === 'transport_request') {
            send('retirement_required',{reason:'transport_lost'});
            send('retirement_required',{reason:'transport_lost'});
          }
        }
        else if (value.event === 'retire') send('term_armed',{nonce:value.nonce});
        else if (value.event === 'kill_group') {
          if (mode === 'normal_exit') { send('pre_kill',{nonce:value.nonce}); process.exit(0); }
          const holder = mode === 'hold_control' ? ['ignore','ignore','ignore',3]
            : mode === 'hold_stdout' ? ['ignore',1,'ignore']
              : mode === 'hold_stderr' ? ['ignore','ignore',2] : null;
          if (holder) spawn(process.execPath,['-e','setTimeout(()=>{},3000)'],{detached:true,stdio:holder}).unref();
          if (mode === 'valid') send('pre_kill',{nonce:value.nonce});
          if (mode === 'emit' || mode === 'transport_request' || holder || mode === 'truncated_control') send('pre_kill',{nonce:value.nonce});
          if (mode === 'truncated_control') fs.writeSync(3,Buffer.from('{'));
          process.kill(0,'SIGKILL');
        }
      }
    }).on('end',()=>{ if (ordinary) process.exit(0); try { process.kill(0,'SIGKILL'); } catch { process.exit(2); } }).resume();
    process.on('SIGTERM',()=>{});
    send('ready');
    setInterval(()=>{},1000);
  `;
  return () => spawn(process.execPath, ['-e', program], {
    detached: true, stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
  });
}
function forcedSentinelResult(mode, hooks = {}, options = {}) {
  let loseParent;
  const parentLost = new Promise((resolve) => { loseParent = resolve; });
  const stdout = options.stdout ?? new PassThrough();
  const stderr = options.stderr ?? new PassThrough();
  stdout.resume();
  stderr.resume();
  return runWorkerProcessGroup({
    entrypoint: process.execPath, argv: [], cwd: os.tmpdir(), env: {},
  }, { output_bytes: 65_536, timeout_ms: 10_000 }, {
    stdout, stderr, parentLost, controlLost: new Promise(() => {}),
    spawnSentinel: fakeRetirementSentinel(mode),
    onGroupReady() {},
    onSpawned() { if (options.loseParent !== false) loseParent(); },
    ...hooks,
  });
}
async function rejectForcedSentinel(mode, pattern) {
  await assert.rejects(forcedSentinelResult(mode), pattern);
}

after(() => {
  for (const pid of trackedPids) {
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

test('detached guardian carries raw worker streams and releases only after terminal control', async () => {
  const state = isolated();
  const fixture = await installManagedRuntime(state.env);
  const created = await createManagedSession('guarded', { kind: 'launched', headless: true, persistent: false }, {
    env: state.env, current: fixture.current,
  });
  assert.equal(created.status, 'active');
  const store = inspectStore(state.env);
  assert.equal(fs.existsSync(store.paths.lock), false);
  const removed = await removeManagedSession('guarded', { env: state.env, current: fixture.current });
  assert.equal(removed.status, 'removed');
});

test('guardian enforces the ordinary stdout cap through a real worker process', async () => {
  const state = isolated('aos-managed-guardian-cap-');
  const fixture = managedRuntimeFixture('0.1.15', { workerBehavior: 'overflow' });
  await installManagedRuntime(state.env, fixture);
  const receipt = await createManagedSession('overflow', { kind: 'launched', headless: true, persistent: false }, {
    env: state.env, current: fixture.current,
  });
  assert.equal(receipt.status, 'cleanup_required');
  assert.equal(readSession(inspectStore(state.env), 'overflow').state, 'cleanup_required');
});

test('guardian enforces the descriptor cap across stdout and stderr together', async () => {
  const state = isolated('aos-managed-guardian-aggregate-');
  const fixture = managedRuntimeFixture('0.1.15', { workerBehavior: 'split-overflow' });
  await installManagedRuntime(state.env, fixture);
  const receipt = await createManagedSession('aggregate', { kind: 'launched', headless: true, persistent: false }, {
    env: state.env, current: fixture.current,
  });
  assert.equal(receipt.status, 'cleanup_required');
  assert.equal(readSession(inspectStore(state.env), 'aggregate').state, 'cleanup_required');
});

test('malformed durable guardian authority blocks lock retirement', async () => {
  const state = isolated('aos-managed-guardian-malformed-');
  await installManagedRuntime(state.env);
  const lock = acquireStoreLock(state.env);
  fs.writeFileSync(path.join(lock.store.paths.lock, 'guardian.json'), '{}\n', { mode: 0o600 });
  assert.throws(() => lock.release(), (error) => error.code === 'COMPANION_STORE_BLOCKED');
});

test('parent SIGKILL leaves no continuing supervised user-code authority before lock recovery', async () => {
  const state = isolated('aos-managed-guardian-parent-loss-');
  const workerLog = path.join(state.root, 'worker-pids.json');
  const fixture = managedRuntimeFixture('0.1.15', { workerBehavior: 'hang', workerLog });
  await installManagedRuntime(state.env, fixture);
  const owner = launchOwner(state, fixture, 'orphaned');
  const pids = await waitFor(() => workerPids(workerLog));
  process.kill(owner.pid, 'SIGKILL');
  assert.equal((await waitChild(owner)).signal, 'SIGKILL');
  const store = inspectStore(state.env);
  const guardian = await waitFor(() => {
    const value = readPrivateRecord(path.join(store.paths.lock, 'guardian.json'));
    return value?.phase === 'complete' ? value : null;
  });
  assert.equal(guardian.terminal_kind, 'parent_lost');
  assert.equal(Number.isInteger(guardian.group_pid), true);
  assert.notEqual(guardian.group_pid, pids.worker_pid);
  await assertHeartbeatStops(`${workerLog}.heartbeat`, pids);
  await waitFor(() => processIsDead(guardian.guardian_pid));
  await assert.rejects(managedSessionIdentity('orphaned', {
    env: state.env, current: fixture.current, run: exactRun(),
  }), (error) => error.code === 'BROWSER_SESSION_NOT_ACTIVE');
  assert.equal(readSession(inspectStore(state.env), 'orphaned').state, 'cleanup_required');
});

test('leader close after TERM cannot preserve supervised descendant authority', async () => {
  const state = isolated('aos-managed-guardian-descendant-');
  const workerLog = path.join(state.root, 'descendant-pids.json');
  const fixture = managedRuntimeFixture('0.1.15', { workerBehavior: 'leader-closes-nested-hangs', workerLog });
  await installManagedRuntime(state.env, fixture);
  const owner = launchOwner(state, fixture, 'descendant');
  const pids = await waitFor(() => workerPids(workerLog));
  process.kill(owner.pid, 'SIGKILL');
  await waitChild(owner);
  const store = inspectStore(state.env);
  const guardian = await waitFor(() => {
    const value = readPrivateRecord(path.join(store.paths.lock, 'guardian.json'));
    return value?.phase === 'complete' ? value : null;
  });
  assert.equal(guardian.terminal_kind, 'parent_lost');
  assert.equal(Number.isInteger(guardian.group_pid), true);
  assert.notEqual(pids.worker_pid, pids.nested_pid);
  await assertHeartbeatStops(`${workerLog}.heartbeat`, pids);
});

test('guardian loss while an emitting TERM-ignoring descendant runs drains transport and retires authority', async () => {
  const state = isolated('aos-managed-guardian-transport-loss-');
  const workerLog = path.join(state.root, 'transport-pids.json');
  const fixture = managedRuntimeFixture('0.1.15', { workerBehavior: 'emit-hang', workerLog });
  await installManagedRuntime(state.env, fixture);
  const owner = launchOwner(state, fixture, 'transport-loss');
  const pids = await waitFor(() => workerPids(workerLog));
  const store = inspectStore(state.env);
  const guardian = await waitFor(() => {
    const value = readPrivateRecord(path.join(store.paths.lock, 'guardian.json'));
    return value?.phase === 'worker_spawned' ? value : null;
  });
  const ownerDone = waitChild(owner);
  process.kill(guardian.guardian_pid, 'SIGKILL');
  await ownerDone;
  await assertHeartbeatStops(`${workerLog}.heartbeat`, pids);
});

test('forced completion rejects a pre-kill ACK followed by normal sentinel exit', async () => {
  await rejectForcedSentinel('normal_exit', /sentinel forced exit differs/);
});

test('forced completion rejects SIGKILL sentinel exit without the nonce-bound pre-kill ACK', async () => {
  await rejectForcedSentinel('missing_ack', /pre-kill witness is absent|command channel closed/);
});

test('request and command pipes are authoritative only through their exact terminal witnesses', async () => {
  const beforeReady = await forcedSentinelResult('valid', {
    beforeRequestWrite(stream) {
      stream.destroy(Object.assign(new Error('injected pre-ready EPIPE'), { code: 'EPIPE' }));
    },
  });
  assert.equal(beforeReady.kind, 'protocol_error');
  await waitFor(() => processIsDead(beforeReady.group_pid));
  const afterReady = await forcedSentinelResult('valid', {
    afterRequestReady(stream) {
      stream.destroy(Object.assign(new Error('injected post-ready EPIPE'), { code: 'EPIPE' }));
    },
  });
  assert.equal(afterReady.kind, 'parent_lost');
  let rejectLateWrite;
  const delayedCallback = await forcedSentinelResult('valid', {
    writeRequest(stream, bytes) {
      stream.write(bytes);
      return new Promise((resolve, reject) => { rejectLateWrite = reject; });
    },
    afterRequestReady() {
      rejectLateWrite(Object.assign(new Error('injected post-ready callback EPIPE'), { code: 'EPIPE' }));
    },
  });
  assert.equal(delayedCallback.kind, 'parent_lost');
  const ordinary = await forcedSentinelResult('ordinary', {}, { loseParent: false });
  assert.equal(ordinary.kind, 'exited');
  assert.equal(ordinary.exit_code, 0);
});

test('inner retirement EPIPE before pre-kill ACK remains fatal', async () => {
  await assert.rejects(forcedSentinelResult('valid', {
    afterTermArmed(stream) {
      stream.destroy(Object.assign(new Error('injected pre-ack EPIPE'), { code: 'EPIPE' }));
    },
  }), /injected pre-ack EPIPE/);
});

test('exact pre-kill ACK retires the inner command pipe and permits forced completion', async () => {
  const result = await forcedSentinelResult('valid');
  assert.equal(result.kind, 'parent_lost');
  assert.equal(result.worker_spawned, true);
});

test('inner retirement EPIPE after exact pre-kill ACK cannot defeat forced completion', async () => {
  const result = await forcedSentinelResult('valid', {
    afterPreKill(stream) {
      stream.destroy(Object.assign(new Error('injected post-ack EPIPE'), { code: 'EPIPE' }));
    },
  });
  assert.equal(result.kind, 'parent_lost');
  assert.equal(result.worker_spawned, true);
});

test('guardian never sends or probes a numeric process group after sentinel self-kill', () => {
  const guardianSource = fs.readFileSync(path.join(repoRoot, 'scripts/lib/browser-companion/worker-process-group.mjs'), 'utf8');
  const sentinelSource = fs.readFileSync(path.join(repoRoot, 'scripts/lib/browser-companion/worker-group-sentinel.mjs'), 'utf8');
  assert.doesNotMatch(guardianSource, /process\.kill|groupExists|signalGroup/);
  const start = sentinelSource.indexOf("const killGroup = (nonce) => {");
  const end = sentinelSource.indexOf("\n  };", start);
  const killBlock = sentinelSource.slice(start, end);
  assert.match(killBlock, /writeControl\('pre_kill', \{ nonce \}\);[\s\S]*process\.kill\(0, 'SIGKILL'\)/);
  assert.equal((killBlock.match(/process\.kill/g) ?? []).length, 1);
  assert.doesNotMatch(killBlock.slice(killBlock.indexOf("process.kill(0, 'SIGKILL')")), /writeControl|groupExists/);
  assert.match(sentinelSource, /stdio: \['ignore', 'pipe', 'pipe', 'ignore', 'ignore'\]/);
});

test('forced completion requires each raw and control EOF and rejects truncation', async () => {
  for (const mode of ['hold_control', 'hold_stdout', 'hold_stderr', 'truncated_control']) {
    await assert.rejects(forcedSentinelResult(mode), /closure is unproven|control is truncated/);
  }
});

test('outer raw sink throw, async EPIPE, and false-backpressure loss drain to completion', async () => {
  const sinks = ['throw', 'epipe', 'backpressure'];
  for (const behavior of sinks) {
    const stdout = new PassThrough();
    const original = stdout.write.bind(stdout);
    stdout.write = (chunk, callback) => {
      if (behavior === 'throw') throw Object.assign(new Error('sink throw'), { code: 'EPIPE' });
      if (behavior === 'epipe') queueMicrotask(() => stdout.emit('error', Object.assign(new Error('sink EPIPE'), { code: 'EPIPE' })));
      if (behavior === 'backpressure') queueMicrotask(() => stdout.emit('close'));
      if (behavior === 'backpressure') return false;
      return original(chunk, callback);
    };
    const result = await forcedSentinelResult('emit', {}, { stdout, loseParent: false });
    assert.equal(result.kind, 'parent_lost');
  }
});

test('sentinel transport retirement request is exact and idempotent after retirement begins', async () => {
  const result = await forcedSentinelResult('transport_request', {}, { loseParent: false });
  assert.equal(result.kind, 'parent_lost');
  assert.equal(result.worker_spawned, true);
});

test('parent death before PID-bound reservation leaves no guardian authority or worker', async () => {
  const state = isolated('aos-managed-guardian-pre-arm-');
  const workerLog = path.join(state.root, 'pre-arm-worker.json');
  const fixture = managedRuntimeFixture('0.1.15', { workerBehavior: 'hang', workerLog });
  await installManagedRuntime(state.env, fixture);
  const readyFile = path.join(state.root, 'spawned-inert');
  const owner = launchOwner(state, fixture, 'pre-arm', readyFile, 'afterGuardianSpawn');
  await waitFor(() => fs.existsSync(readyFile));
  process.kill(owner.pid, 'SIGKILL');
  await waitChild(owner);
  await waitFor(() => !fs.existsSync(path.join(inspectStore(state.env).paths.lock, 'guardian.json')));
  assert.equal(fs.existsSync(workerLog), false);
  const fixtureResult = await createManagedSession('after-pre-arm', { kind: 'launched', headless: true, persistent: false }, {
    env: state.env, current: fixture.current, run: exactRun(),
  });
  assert.equal(fixtureResult.status, 'active');
});

test('parent death after reservation but before activation converges through live guardian no-spawn', async () => {
  const state = isolated('aos-managed-guardian-reserved-');
  const fixture = await installManagedRuntime(state.env);
  const readyFile = path.join(state.root, 'reserved');
  const owner = launchOwner(state, fixture, 'reserved', readyFile, 'afterGuardianReservation');
  await waitFor(() => fs.existsSync(readyFile));
  const store = inspectStore(state.env);
  const armed = readPrivateRecord(path.join(store.paths.lock, 'guardian.json'));
  assert.equal(armed.phase, 'armed');
  assert.equal(processIsDead(armed.guardian_pid), false);
  process.kill(owner.pid, 'SIGKILL');
  await waitChild(owner);
  const terminal = await waitFor(() => {
    const value = readPrivateRecord(path.join(store.paths.lock, 'guardian.json'));
    return value?.phase === 'complete' ? value : null;
  });
  assert.equal(terminal.terminal_kind, 'no_spawn');
  assert.equal(terminal.worker_spawned, false);
});

test('parent loss after armed ACK but before request completes with no worker spawn', async () => {
  const state = isolated('aos-managed-guardian-no-request-');
  const fixture = await installManagedRuntime(state.env);
  const readyFile = path.join(state.root, 'armed');
  const owner = launchOwner(state, fixture, 'no-request', readyFile);
  await waitFor(() => fs.existsSync(readyFile));
  process.kill(owner.pid, 'SIGKILL');
  await waitChild(owner);
  const store = inspectStore(state.env);
  const guardian = await waitFor(() => {
    const value = readPrivateRecord(path.join(store.paths.lock, 'guardian.json'));
    return value?.phase === 'complete' ? value : null;
  });
  assert.equal(guardian.terminal_kind, 'no_spawn');
  assert.equal(guardian.worker_spawned, false);
  await assert.rejects(createManagedSession('after-no-request-interrupted', {
    kind: 'launched', headless: true, persistent: false,
  }, {
    env: state.env, current: fixture.current, run: exactRun(),
    hooks: { afterGuardianOutcomePublication() { throw new Error('outcome transfer interrupted'); } },
  }), (error) => error.code === 'COMPANION_STORE_BUSY');
  const outcomeName = fs.readdirSync(store.paths.pending)
    .find((name) => name.startsWith('guardian-outcome-no-request-'));
  assert.ok(outcomeName);
  const outcome = readPrivateRecord(path.join(store.paths.pending, outcomeName));
  assert.deepEqual({
    store_id: outcome.store_id,
    lock_token: outcome.lock_token,
    session_id: outcome.session_id,
    generation: outcome.generation,
    nonce: outcome.nonce,
    operation: outcome.operation,
    authority: outcome.authority,
  }, {
    store_id: store.owner.store_id,
    lock_token: guardian.lock_token,
    session_id: 'no-request',
    generation: guardian.generation,
    nonce: guardian.nonce,
    operation: 'start',
    authority: 'no_authority',
  });
  await assert.rejects(createManagedSession('after-no-request-consume-fault', {
    kind: 'launched', headless: true, persistent: false,
  }, {
    env: state.env, current: fixture.current, run: exactRun(),
    hooks: { beforeGuardianOutcomeUnlink() { throw new Error('consume last interrupted'); } },
  }), (error) => error.code === 'BROWSER_SESSION_CLEANUP_REQUIRED');
  assert.equal(readSession(inspectStore(state.env), 'no-request'), null);
  assert.equal(fs.existsSync(path.join(store.paths.pending, outcomeName)), true);
  const recovered = await createManagedSession('after-no-request', {
    kind: 'launched', headless: true, persistent: false,
  }, { env: state.env, current: fixture.current, run: exactRun() });
  assert.equal(recovered.status, 'active');
  assert.equal(readSession(inspectStore(state.env), 'no-request'), null);
  assert.equal(fs.readdirSync(store.paths.pending).some((name) => name.startsWith('guardian-outcome-')), false);
});

test('request-accepted control loss converges to no-spawn rollback', async () => {
  const state = isolated('aos-managed-guardian-ack-loss-');
  const fixture = await installManagedRuntime(state.env);
  await assert.rejects(createManagedSession('ack-loss', { kind: 'launched', headless: true, persistent: false }, {
    env: state.env, current: fixture.current,
    hooks: { beforeGuardianExecute() { throw new Error('drop execute control'); } },
  }), (error) => error.code === 'BROWSER_SESSION_WORKER_FAILED');
  const store = inspectStore(state.env);
  assert.equal(readSession(store, 'ack-loss'), null);
  assert.equal(fs.readdirSync(store.paths.workspaces).length, 0);
});

test('request stdin EPIPE is projected as typed no-authority worker failure', async () => {
  const state = isolated('aos-managed-guardian-epipe-');
  const fixture = await installManagedRuntime(state.env);
  await assert.rejects(createManagedSession('epipe', { kind: 'launched', headless: true, persistent: false }, {
    env: state.env, current: fixture.current,
    hooks: {
      beforeGuardianRequest(guardian) {
        const error = Object.assign(new Error('injected stdin break'), { code: 'EPIPE' });
        guardian.stdin.destroy(error);
      },
    },
  }), (error) => error.code === 'BROWSER_SESSION_WORKER_FAILED');
  assert.equal(readSession(inspectStore(state.env), 'epipe'), null);
});

test('outer request authority ignores delayed post-accept callback failure but rejects duplicate pre-accept failure once', async () => {
  const acceptedState = isolated('aos-managed-guardian-request-accepted-');
  const acceptedFixture = await installManagedRuntime(acceptedState.env);
  let delayedCallback;
  const accepted = await createManagedSession('accepted', { kind: 'launched', headless: true, persistent: false }, {
    env: acceptedState.env, current: acceptedFixture.current,
    hooks: {
      beforeGuardianRequest(guardian) {
        const end = guardian.stdin.end.bind(guardian.stdin);
        guardian.stdin.end = (bytes, callback) => {
          delayedCallback = callback;
          return end(bytes, () => {});
        };
      },
      beforeGuardianExecute() {
        delayedCallback(Object.assign(new Error('delayed accepted EPIPE'), { code: 'EPIPE' }));
      },
    },
  });
  assert.equal(accepted.status, 'active');

  const failedState = isolated('aos-managed-guardian-request-failed-');
  const failedFixture = await installManagedRuntime(failedState.env);
  let guardianPid = null;
  await assert.rejects(createManagedSession('failed', { kind: 'launched', headless: true, persistent: false }, {
    env: failedState.env, current: failedFixture.current,
    hooks: {
      afterGuardianSpawn(pid) { guardianPid = pid; },
      beforeGuardianRequest(guardian) {
        guardian.stdin.end = (_bytes, callback) => {
          const error = Object.assign(new Error('duplicate pre-accept EPIPE'), { code: 'EPIPE' });
          callback(error);
          guardian.stdin.emit('error', error);
          return guardian.stdin;
        };
      },
    },
  }), (error) => error.code === 'BROWSER_SESSION_WORKER_FAILED');
  assert.equal(readSession(inspectStore(failedState.env), 'failed'), null);
  await waitFor(() => guardianPid !== null && processIsDead(guardianPid));
});

test('intended detached daemon outlives the command group and exact cleanup retires it', async () => {
  const state = isolated('aos-managed-guardian-detached-daemon-');
  const daemonLog = path.join(state.root, 'detached-daemon.json');
  const fixture = managedRuntimeFixture('0.1.15', { workerBehavior: 'detached-daemon', workerLog: daemonLog });
  await installManagedRuntime(state.env, fixture);
  const created = await createManagedSession('daemon-owned', { kind: 'launched', headless: true, persistent: false }, {
    env: state.env, current: fixture.current,
  });
  assert.equal(created.status, 'active');
  const daemonPid = JSON.parse(fs.readFileSync(daemonLog, 'utf8')).daemon_pid;
  trackedPids.add(daemonPid);
  assert.equal(processIsDead(daemonPid), false);
  const removed = await removeManagedSession('daemon-owned', { env: state.env, current: fixture.current });
  assert.equal(removed.status, 'removed');
  await waitFor(() => processIsDead(daemonPid));
  trackedPids.delete(daemonPid);
});
