import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import {
  createManagedSession,
  executeManagedSessionOperation,
  managedSessionIdentity,
  removeManagedSession,
} from '../../scripts/lib/browser-companion/session-lifecycle.mjs';
import { runManagedWorker } from '../../scripts/lib/browser-companion/session-runner.mjs';
import { isAcknowledgementUnknown } from '../../scripts/lib/browser-companion/session-worker-pending.mjs';
import { inspectStore } from '../../scripts/lib/browser-companion/store-paths.mjs';
import { readSession } from '../../scripts/lib/browser-companion/session-store.mjs';
import { validateJsonSchema } from '../lib/json-schema-validation.mjs';
import {
  installManagedRuntime,
  managedRuntimeFixture,
  repoRoot,
} from './managed-runtime-test-fixture.mjs';

const roots = new Set();

function isolated() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-managed-worker-ack-'));
  roots.add(root);
  return { root, env: { ...process.env, AOS_STATE_ROOT: root, AOS_RUNTIME_MODE: 'repo' } };
}

function calls(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line).argv[1]);
}

function pending(store, prefix) {
  return fs.readdirSync(store.paths.pending).filter((name) => name.startsWith(prefix));
}

function assertReceipt(value) {
  assert.deepEqual(validateJsonSchema(
    path.join(repoRoot, 'shared/schemas/aos-browser-session-result-v1.schema.json'),
    value,
  ), []);
}

function interruptRetirement() {
  return {
    beforeUnlink() { throw new Error('injected acknowledged guardian retirement interruption'); },
  };
}

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

test('start, ordinary, and liveness acknowledgements recover from live-release outcome without side-effect replay', { timeout: 45_000 }, async () => {
  const state = isolated();
  const workerLog = path.join(state.root, 'worker.jsonl');
  const fixture = managedRuntimeFixture('0.1.15', { workerLog });
  await installManagedRuntime(state.env, fixture);
  let liveReleaseTransfers = 0;

  const created = await createManagedSession('acked', {
    kind: 'launched', headless: true, persistent: false,
  }, {
    env: state.env, current: fixture.current,
    hooks: {
      guardianRetirementHooks: interruptRetirement(),
      afterGuardianOutcomePublication() { liveReleaseTransfers += 1; },
    },
  });
  assert.equal(created.status, 'recovery_pending');
  assertReceipt(created);
  let store = inspectStore(state.env);
  assert.equal(readSession(store, 'acked').state, 'starting');
  assert.equal(pending(store, 'guardian-outcome-acked-').length, 1);
  assert.equal(liveReleaseTransfers, 1);
  assert.equal(calls(workerLog).filter((verb) => verb === 'open').length, 1);

  await assert.rejects(managedSessionIdentity('acked', {
    env: state.env,
    current: fixture.current,
    hooks: { beforeGuardianOutcomeUnlink() { throw new Error('injected outcome consumption interruption'); } },
  }), (error) => error.code === 'BROWSER_SESSION_CLEANUP_REQUIRED');
  assert.equal(readSession(store, 'acked').state, 'active');
  assert.equal(pending(store, 'guardian-outcome-acked-').length, 1);
  await managedSessionIdentity('acked', { env: state.env, current: fixture.current });
  store = inspectStore(state.env);
  assert.equal(readSession(store, 'acked').state, 'active');
  assert.equal(pending(store, 'guardian-outcome-acked-').length, 0);
  assert.equal(calls(workerLog).filter((verb) => verb === 'open').length, 1);

  const operated = await executeManagedSessionOperation('acked', 'navigate', { url: 'about:blank' }, {
    env: state.env, current: fixture.current,
    hooks: { guardianRetirementHooks: interruptRetirement() },
  });
  assert.equal(operated.receipt.status, 'recovery_pending');
  assertReceipt(operated.receipt);
  assert.deepEqual(Object.keys(operated.worker), ['json']);
  assert.equal(readSession(store, 'acked').state, 'operation_committed');
  assert.equal(pending(store, 'guardian-outcome-acked-').length, 1);
  assert.equal(calls(workerLog).filter((verb) => verb === 'goto').length, 1);

  await managedSessionIdentity('acked', { env: state.env, current: fixture.current });
  assert.equal(readSession(store, 'acked').state, 'active');
  assert.equal(calls(workerLog).filter((verb) => verb === 'goto').length, 1);

  const liveness = await managedSessionIdentity('acked', {
    env: state.env, current: fixture.current,
    hooks: { guardianRetirementHooks: interruptRetirement() },
  });
  assert.equal(liveness.receipt.status, 'recovery_pending');
  assertReceipt(liveness.receipt);
  assert.equal(readSession(store, 'acked').state, 'operation_committed');
  assert.equal(pending(store, 'guardian-outcome-acked-').length, 1);
  await executeManagedSessionOperation('acked', 'snapshot', {}, {
    env: state.env, current: fixture.current,
  });
  assert.equal(readSession(store, 'acked').state, 'active');
  assert.equal(pending(store, 'guardian-outcome-acked-').length, 0);
});

test('a real Guardian completion before acknowledgement retains ambiguous cleanup authority', { timeout: 30_000 }, async () => {
  const state = isolated();
  const workerLog = path.join(state.root, 'worker.jsonl');
  const fixture = managedRuntimeFixture('0.1.15', { workerLog, workerBehavior: 'invalid-envelope' });
  await installManagedRuntime(state.env, fixture);
  const receipt = await createManagedSession('pre-ack', {
    kind: 'launched', headless: true, persistent: false,
  }, { env: state.env, current: fixture.current });
  const store = inspectStore(state.env);
  assert.equal(receipt.status, 'cleanup_required');
  assert.equal(readSession(store, 'pre-ack').state, 'cleanup_required');
  assert.equal(pending(store, 'guardian-outcome-pre-ack-').length, 1);
  assert.equal(pending(store, 'session-create-pre-ack-').length, 0);
  assert.equal(calls(workerLog).filter((verb) => verb === 'open').length, 1);
});

test('accepted cleanup is committed before Guardian retirement and is never replayed', { timeout: 30_000 }, async () => {
  const state = isolated();
  const workerLog = path.join(state.root, 'worker.jsonl');
  const fixture = managedRuntimeFixture('0.1.15', { workerLog });
  await installManagedRuntime(state.env, fixture);
  await createManagedSession('closing', {
    kind: 'launched', headless: true, persistent: false,
  }, { env: state.env, current: fixture.current });

  const pendingReceipt = await removeManagedSession('closing', {
    env: state.env, current: fixture.current,
    hooks: { guardianRetirementHooks: interruptRetirement() },
  });
  const store = inspectStore(state.env);
  assert.equal(pendingReceipt.status, 'recovery_pending');
  assertReceipt(pendingReceipt);
  assert.equal(readSession(store, 'closing').state, 'cleanup_committed');
  assert.equal(pending(store, 'guardian-outcome-closing-').length, 1);
  assert.equal(calls(workerLog).filter((verb) => verb === 'close').length, 1);

  const removed = await removeManagedSession('closing', {
    env: state.env, current: fixture.current,
  });
  assert.equal(removed.status, 'removed');
  assert.equal(calls(workerLog).filter((verb) => verb === 'close').length, 1);
  assert.equal(pending(store, 'guardian-outcome-closing-').length, 0);
});

test('an acknowledgement callback exception stays an unknown typed failure', async () => {
  const state = isolated();
  const fixture = await installManagedRuntime(state.env);
  await createManagedSession('unknown-ack', {
    kind: 'launched', headless: true, persistent: false,
  }, { env: state.env, current: fixture.current, run: async (request) => ({
    spawned: true,
    exitCode: 0,
    stdout: Buffer.from(`${JSON.stringify({
      session: request.argv[0].slice(3), pid: 41, result: { snapshot: { file: '<auto>' } },
    })}\n`),
  }) });
  const store = inspectStore(state.env);
  const active = readSession(store, 'unknown-ack');
  const nonce = '7'.repeat(32);
  const operating = {
    ...active,
    state: 'operating',
    pending_operation: 'navigate',
    operation_nonce: nonce,
  };
  await assert.rejects(runManagedWorker(store, operating, 'navigate', { url: 'about:blank' }, {
    run: async () => ({
      spawned: true,
      exitCode: 0,
      stdout: Buffer.from(`${JSON.stringify({ snapshot: { file: '<auto>' } })}\n`),
    }),
    acknowledge() { throw new Error('injected acknowledgement callback failure'); },
  }), (error) => isAcknowledgementUnknown(error));
});

test('post-retirement final-state durability uncertainty does not create a Guardian outcome', { timeout: 30_000 }, async () => {
  const state = isolated();
  const fixture = await installManagedRuntime(state.env);
  await createManagedSession('post-retire', {
    kind: 'launched', headless: true, persistent: false,
  }, { env: state.env, current: fixture.current });
  let renames = 0;
  const operated = await executeManagedSessionOperation('post-retire', 'navigate', { url: 'about:blank' }, {
    env: state.env,
    current: fixture.current,
    hooks: {
      afterSessionRecordRename() {
        if (++renames === 3) throw new Error('injected active publication sync interruption');
      },
      beforeSessionRecordReconcile() { throw new Error('injected active reconciliation interruption'); },
    },
  });
  const store = inspectStore(state.env);
  assert.equal(operated.receipt.status, 'recovery_pending');
  assert.equal(readSession(store, 'post-retire').state, 'active');
  assert.equal(pending(store, 'guardian-outcome-post-retire-').length, 0);
});
