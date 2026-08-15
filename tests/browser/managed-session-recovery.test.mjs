import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import {
  createManagedSession,
  executeManagedSessionOperation,
  listManagedSessions,
  managedSessionIdentity,
  removeManagedSession,
} from '../../scripts/lib/browser-companion/session-lifecycle.mjs';
import { inspectStore } from '../../scripts/lib/browser-companion/store-paths.mjs';
import { publishSessionCreateIntent } from '../../scripts/lib/browser-companion/session-intent.mjs';
import { readSession, writeSession } from '../../scripts/lib/browser-companion/session-store.mjs';
import { updateCompanion } from '../../scripts/lib/browser-companion/lifecycle.mjs';
import { validateJsonSchema } from '../lib/json-schema-validation.mjs';
import { installManagedRuntime, managedRuntimeFixture, repoRoot } from './managed-runtime-test-fixture.mjs';

const roots = new Set();
function isolated() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-managed-session-recovery-'));
  roots.add(root);
  return { root, env: { ...process.env, AOS_STATE_ROOT: root, AOS_RUNTIME_MODE: 'repo' } };
}
function output(value) { return Buffer.from(`${JSON.stringify(value)}\n`); }
function assertReceipt(value) {
  assert.deepEqual(validateJsonSchema(path.join(repoRoot, 'shared/schemas/aos-browser-session-result-v1.schema.json'), value), []);
}
function upstream(request) { return request.argv[0].slice(3); }
function exactRun(calls = []) {
  return async (request) => {
    calls.push(request.operation);
    const session = upstream(request);
    if (request.operation === 'start') return { spawned: true, exitCode: 0, stdout: output({
      session, pid: 41, result: { snapshot: { file: '<auto>' } },
    }) };
    if (request.operation === 'cleanup') return { spawned: true, exitCode: 0, stdout: output({ session, status: 'closed' }) };
    if (request.operation === 'liveness') return { spawned: true, exitCode: 0, stdout: output({ result: JSON.stringify({ status: 'alive' }) }) };
    return { spawned: true, exitCode: 0, stdout: output({ snapshot: { file: '<auto>' } }) };
  };
}
function guardianOutcome(store, record, nonce, operation, authority = 'authority_possible') {
  const possible = authority === 'authority_possible';
  const value = {
    schema_version: 'aos.browser.worker-guardian-outcome.v1',
    store_id: store.owner.store_id, lock_token: 'a'.repeat(32),
    session_id: record.session_id, generation: record.generation, nonce, operation,
    guardian_pid: 2_147_483_647, group_pid: possible ? 2_147_483_646 : null,
    source_phase: 'complete', worker_spawned: possible,
    terminal_kind: possible ? 'exited' : 'no_spawn', authority,
  };
  fs.writeFileSync(path.join(store.paths.pending, `guardian-outcome-${record.session_id}-${record.generation}-${nonce}.json`), `${JSON.stringify(value)}\n`, { mode: 0o600 });
  return value;
}
function evidenceAck(store, record, nonce, phase, steps, lockToken = 'a'.repeat(32)) {
  const value = {
    schema_version: 'aos.browser.evidence-ack.v1',
    store_id: store.owner.store_id, lock_token: lockToken,
    session_id: record.session_id, generation: record.generation,
    operation_nonce: nonce, phase, steps,
  };
  fs.writeFileSync(
    path.join(store.paths.pending, `evidence-ack-${record.session_id}-${record.generation}-${nonce}.json`),
    `${JSON.stringify(value)}\n`,
    { mode: 0o600 },
  );
  return value;
}
after(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });

test('create intent and starting lease publication faults remain visible and retryable', async () => {
  const state = isolated();
  const fixture = await installManagedRuntime(state.env);
  const first = await createManagedSession('prepared', { kind: 'launched', headless: true, persistent: false }, {
    env: state.env, current: fixture.current, run: exactRun(),
    hooks: {
      afterSessionIntentRename() { throw new Error('intent directory sync interrupted'); },
      beforeSessionIntentReconcile() { throw new Error('intent reconciliation interrupted'); },
    },
  });
  assert.equal(first.status, 'recovery_pending');
  assertReceipt(first);
  assert.equal(first.session.state, 'starting');
  assert.equal((await listManagedSessions({ env: state.env, current: fixture.current })).sessions[0].state, 'starting');
  await assert.rejects(createManagedSession('workspace-only', { kind: 'launched', headless: true, persistent: false }, {
    env: state.env, current: fixture.current, run: exactRun(),
    hooks: { afterSessionWorkspace() { throw new Error('crash after workspace'); } },
  }), /crash after workspace/u);
  assert.deepEqual((await listManagedSessions({ env: state.env, current: fixture.current })).sessions.map((session) => session.id), ['workspace-only']);
  const created = await createManagedSession('after-recovery', { kind: 'launched', headless: true, persistent: false }, {
    env: state.env, current: fixture.current, run: exactRun(),
  });
  assert.equal(created.status, 'active');
  assert.equal(readSession(inspectStore(state.env), 'prepared'), null);
  assert.equal(readSession(inspectStore(state.env), 'workspace-only'), null);

  let recordRenames = 0;
  const starting = await createManagedSession('starting', { kind: 'launched', headless: true, persistent: false }, {
    env: state.env, current: fixture.current, run: exactRun(),
    hooks: {
      afterSessionRecordRename() { if (++recordRenames === 1) throw new Error('lease sync interrupted'); },
      beforeSessionRecordReconcile() { throw new Error('lease reconciliation interrupted'); },
    },
  });
  assert.equal(starting.status, 'recovery_pending');
  assertReceipt(starting);
  assert.equal(readSession(inspectStore(state.env), 'starting').state, 'starting');
});

test('spawn event latches authority even when the child reports a later error', async () => {
  const state = isolated();
  const fixture = await installManagedRuntime(state.env);
  const receipt = await createManagedSession('spawned', { kind: 'launched', headless: true, persistent: false }, {
    env: state.env, current: fixture.current,
    run: async () => ({ spawned: true, error: new Error('exec handoff failed after spawn'), exitCode: null, stdout: Buffer.alloc(0) }),
  });
  assert.equal(receipt.status, 'cleanup_required');
  assertReceipt(receipt);
  assert.equal(readSession(inspectStore(state.env), 'spawned').state, 'cleanup_required');
});

test('pre-spawn rollback retires workspace and lease before clearing the durable intent', async () => {
  const state = isolated();
  const fixture = await installManagedRuntime(state.env);
  const order = [];
  const receipt = await createManagedSession('rollback', {
    kind: 'launched', headless: true, persistent: false,
  }, {
    env: state.env, current: fixture.current,
    run: async () => ({ spawned: false, exitCode: null, stdout: Buffer.alloc(0) }),
    hooks: {
      afterSessionIntentUnlink() { order.push('intent-unlinked'); },
      syncSessionIntentDirectory() { throw new Error('intent fsync interrupted'); },
      beforeRemove() { order.push('workspace-retired'); },
      beforeRecordUnlink() { order.push('lease-unlinked'); },
    },
  });
  assert.equal(receipt.status, 'recovery_pending');
  const store = inspectStore(state.env);
  assert.equal(readSession(store, 'rollback'), null);
  assert.equal(fs.readdirSync(store.paths.workspaces).length, 0);
  assert.deepEqual(order, ['workspace-retired', 'lease-unlinked', 'intent-unlinked']);
});

test('rollback-no-authority intent recovers present or already-absent lease and workspace before clearing last', async () => {
  const state = isolated();
  const fixture = await installManagedRuntime(state.env);
  await assert.rejects(createManagedSession('rollback-phase', {
    kind: 'launched', headless: true, persistent: false,
  }, {
    env: state.env, current: fixture.current,
    run: async () => ({ spawned: false, authorityPossible: false, exitCode: null, stdout: Buffer.alloc(0) }),
    hooks: { afterRollbackIntent() { throw new Error('stop after durable rollback phase'); } },
  }), /durable rollback phase/u);
  let store = inspectStore(state.env);
  const intentName = fs.readdirSync(store.paths.pending).find((name) => name.startsWith('session-create-rollback-phase-'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(store.paths.pending, intentName), 'utf8')).phase, 'rollback_no_authority');
  assert.equal(readSession(store, 'rollback-phase').state, 'starting');

  const recovered = await createManagedSession('after-rollback-phase', {
    kind: 'launched', headless: true, persistent: false,
  }, { env: state.env, current: fixture.current, run: exactRun() });
  assert.equal(recovered.status, 'active');
  store = inspectStore(state.env);
  assert.equal(readSession(store, 'rollback-phase'), null);
  assert.equal(fs.readdirSync(store.paths.workspaces).some((name) => name.startsWith('rollback-phase-')), false);
  assert.equal(fs.readdirSync(store.paths.pending).some((name) => name.startsWith('session-create-rollback-phase-')), false);
});

test('prepared intent recovers a bounded partially-created workspace before clearing authority', async () => {
  const state = isolated();
  const fixture = await installManagedRuntime(state.env);
  await assert.rejects(createManagedSession('partial-workspace', {
    kind: 'launched', headless: true, persistent: false,
  }, {
    env: state.env, current: fixture.current, run: exactRun(),
    hooks: { afterSessionWorkspaceDirectory() { throw new Error('workspace scaffold interrupted'); } },
  }), /workspace scaffold interrupted/u);
  const store = inspectStore(state.env);
  const workspace = fs.readdirSync(store.paths.workspaces);
  assert.equal(workspace.length, 1);
  assert.match(workspace[0], /^partial-workspace-[a-f0-9]{32}$/u);
  const created = await createManagedSession('after-partial', {
    kind: 'launched', headless: true, persistent: false,
  }, { env: state.env, current: fixture.current, run: exactRun() });
  assert.equal(created.status, 'active');
  assert.equal(readSession(store, 'partial-workspace'), null);
  assert.equal(fs.readdirSync(store.paths.workspaces).some((name) => name.startsWith('partial-workspace-')), false);
});

test('lock cleanup ambiguity is merged into actual session mutation and operation receipts', async () => {
  const state = isolated();
  const fixture = await installManagedRuntime(state.env);
  const created = await createManagedSession('lock-recovery', { kind: 'launched', headless: true, persistent: false }, {
    env: state.env, current: fixture.current, run: exactRun(),
    hooks: { afterLockOwnerCleanup() { throw new Error('lock cleanup interrupted'); } },
  });
  assert.equal(created.status, 'recovery_pending');
  assert.equal(created.session.state, 'active');
  assert.equal(created.cleanup_required, false);
  assertReceipt(created);
  const operated = await executeManagedSessionOperation('lock-recovery', 'navigate', { url: 'about:blank' }, {
    env: state.env, current: fixture.current, run: exactRun(),
    hooks: { afterLockOwnerCleanup() { throw new Error('lock cleanup interrupted'); } },
  });
  assert.equal(operated.receipt.status, 'recovery_pending');
  assertReceipt(operated.receipt);
});

test('durable operation commit recovers without replay and pre-commit ambiguity requires cleanup', async () => {
  const state = isolated();
  const fixture = await installManagedRuntime(state.env);
  const calls = [];
  await createManagedSession('ops', { kind: 'launched', headless: true, persistent: false }, {
    env: state.env, current: fixture.current, run: exactRun(calls),
  });
  let renames = 0;
  const committed = await executeManagedSessionOperation('ops', 'navigate', { url: 'about:blank' }, {
    env: state.env, current: fixture.current, run: exactRun(calls),
    hooks: {
      afterSessionRecordRename() { if (++renames === 2) throw new Error('commit sync interrupted'); },
      beforeSessionRecordReconcile() { throw new Error('commit reconciliation interrupted'); },
    },
  });
  assert.equal(committed.receipt.status, 'recovery_pending');
  assertReceipt(committed.receipt);
  assert.equal(readSession(inspectStore(state.env), 'ops').state, 'operation_committed');
  const beforeIdentity = calls.filter((operation) => operation === 'navigate').length;
  await managedSessionIdentity('ops', { env: state.env, current: fixture.current, run: exactRun(calls) });
  assert.equal(calls.filter((operation) => operation === 'navigate').length, beforeIdentity);
  assert.equal(readSession(inspectStore(state.env), 'ops').state, 'active');

  renames = 0;
  await assert.rejects(executeManagedSessionOperation('ops', 'navigate', { url: 'about:blank' }, {
    env: state.env, current: fixture.current, run: exactRun(calls),
    hooks: {
      afterSessionRecordRename() { if (++renames === 1) throw new Error('intent sync interrupted'); },
      beforeSessionRecordReconcile() { throw new Error('intent reconciliation interrupted'); },
    },
  }), (error) => error.code === 'BROWSER_SESSION_CLEANUP_REQUIRED');
  assert.equal(readSession(inspectStore(state.env), 'ops').state, 'operating');
  assert.equal(calls.filter((operation) => operation === 'navigate').length, beforeIdentity);
});

test('durable cleanup commit recovers without issuing close twice', async () => {
  const state = isolated();
  const fixture = await installManagedRuntime(state.env);
  const calls = [];
  await createManagedSession('closing', { kind: 'launched', headless: true, persistent: false }, {
    env: state.env, current: fixture.current, run: exactRun(calls),
  });
  let renames = 0;
  const pending = await removeManagedSession('closing', {
    env: state.env, current: fixture.current, run: exactRun(calls),
    hooks: {
      afterSessionRecordRename() { if (++renames === 2) throw new Error('cleanup commit sync interrupted'); },
      beforeSessionRecordReconcile() { throw new Error('cleanup commit reconciliation interrupted'); },
    },
  });
  assert.equal(pending.status, 'recovery_pending');
  assertReceipt(pending);
  assert.equal(readSession(inspectStore(state.env), 'closing').state, 'cleanup_committed');
  assert.equal(calls.filter((operation) => operation === 'cleanup').length, 1);
  const removed = await removeManagedSession('closing', {
    env: state.env, current: fixture.current, run: exactRun(calls),
  });
  assert.equal(removed.status, 'removed');
  assertReceipt(removed);
  assert.equal(calls.filter((operation) => operation === 'cleanup').length, 1);
});

test('guardian outcome recovery is idempotent after creation and operation transitions commit', async () => {
  const state = isolated();
  const fixture = await installManagedRuntime(state.env);
  await createManagedSession('creation-outcome', { kind: 'launched', headless: true, persistent: false }, {
    env: state.env, current: fixture.current, run: exactRun(),
  });
  const store = inspectStore(state.env);
  let record = readSession(store, 'creation-outcome');
  record = { ...record, state: 'starting', pending_operation: null, operation_nonce: null };
  writeSession(store, record);
  const startNonce = 'b'.repeat(32);
  publishSessionCreateIntent(store, record, 'authority_possible', { guardian: { operation: 'start', nonce: startNonce } });
  guardianOutcome(store, record, startNonce, 'start');
  await assert.rejects(createManagedSession('after-creation-outcome', { kind: 'launched', headless: true, persistent: false }, {
    env: state.env, current: fixture.current, run: exactRun(),
    hooks: { afterGuardianCleanupRequired() { throw new Error('stop after creation recovery'); } },
  }), /stop after creation recovery/u);
  assert.equal(readSession(store, 'creation-outcome').state, 'cleanup_required');
  const afterCreation = await createManagedSession('after-creation-outcome', { kind: 'launched', headless: true, persistent: false }, {
    env: state.env, current: fixture.current, run: exactRun(),
  });
  assert.equal(afterCreation.status, 'active');

  await createManagedSession('operation-outcome', { kind: 'launched', headless: true, persistent: false }, {
    env: state.env, current: fixture.current, run: exactRun(),
  });
  record = readSession(store, 'operation-outcome');
  const operationNonce = 'c'.repeat(32);
  writeSession(store, { ...record, state: 'operating', pending_operation: 'navigate', operation_nonce: operationNonce });
  guardianOutcome(store, record, operationNonce, 'navigate');
  await assert.rejects(managedSessionIdentity('operation-outcome', {
    env: state.env, current: fixture.current, run: exactRun(),
    hooks: { afterGuardianOperationRecovery() { throw new Error('stop after operation recovery'); } },
  }), /stop after operation recovery/u);
  assert.equal(readSession(store, 'operation-outcome').state, 'cleanup_required');
  await assert.rejects(managedSessionIdentity('operation-outcome', {
    env: state.env, current: fixture.current, run: exactRun(),
  }), (error) => error.code === 'BROWSER_SESSION_NOT_ACTIVE');
  assert.equal(fs.readdirSync(store.paths.pending).some((name) => name.startsWith('guardian-outcome-')), false);
});

test('guardian null-nonce recovery rejects mismatched already-applied states', async () => {
  for (const [stateName, operation, authority] of [
    ['cleanup_required', 'navigate', 'no_authority'],
    ['active', 'start', 'no_authority'],
    ['active', 'cleanup', 'authority_possible'],
    ['closed', 'navigate', 'authority_possible'],
  ]) {
    const state = isolated();
    const fixture = await installManagedRuntime(state.env);
    await createManagedSession('mismatch', { kind: 'launched', headless: true, persistent: false }, {
      env: state.env, current: fixture.current, run: exactRun(),
    });
    const store = inspectStore(state.env);
    const record = readSession(store, 'mismatch');
    writeSession(store, { ...record, state: stateName, pending_operation: null, operation_nonce: null });
    guardianOutcome(store, record, 'd'.repeat(32), operation, authority);
    await assert.rejects(managedSessionIdentity('mismatch', {
      env: state.env, current: fixture.current, run: exactRun(),
    }), (error) => error.code === 'COMPANION_STORE_CORRUPT');
  }
});

test('evidence progress requires cleanup while final acknowledgement converges active and consumes evidence last', async () => {
  for (const kind of ['progress', 'acknowledged']) {
    const state = isolated();
    const fixture = await installManagedRuntime(state.env);
    await createManagedSession(kind, { kind: 'launched', headless: true, persistent: false }, {
      env: state.env, current: fixture.current, run: exactRun(),
    });
    const store = inspectStore(state.env);
    const record = readSession(store, kind);
    const nonce = kind === 'progress' ? 'e'.repeat(32) : 'f'.repeat(32);
    writeSession(store, {
      ...record,
      state: kind === 'progress' ? 'operating' : 'operation_committed',
      pending_operation: 'evidence_capture',
      operation_nonce: nonce,
    });
    evidenceAck(
      store,
      record,
      nonce,
      kind,
      kind === 'progress' ? ['navigate'] : ['evidence_query', 'screenshot'],
    );
    guardianOutcome(store, record, nonce, kind === 'progress' ? 'navigate' : 'screenshot');
    if (kind === 'progress') {
      await assert.rejects(managedSessionIdentity(kind, {
        env: state.env, current: fixture.current, run: exactRun(),
      }), (error) => error.code === 'BROWSER_SESSION_NOT_ACTIVE');
      assert.equal(readSession(store, kind).state, 'cleanup_required');
    } else {
      const identity = await managedSessionIdentity(kind, {
        env: state.env, current: fixture.current, run: exactRun(),
      });
      assert.equal(identity.session.state, 'active');
      assert.equal(readSession(store, kind).state, 'active');
    }
    assert.equal(fs.readdirSync(store.paths.pending).some((name) => name.startsWith('guardian-outcome-')), false);
    assert.equal(fs.readdirSync(store.paths.pending).some((name) => name.startsWith('evidence-ack-')), false);
  }
});

test('evidence acknowledgement and Guardian outcome lock-token mismatch fails closed', async () => {
  const state = isolated();
  const fixture = await installManagedRuntime(state.env);
  await createManagedSession('evidence-mismatch', { kind: 'launched', headless: true, persistent: false }, {
    env: state.env, current: fixture.current, run: exactRun(),
  });
  const store = inspectStore(state.env);
  const record = readSession(store, 'evidence-mismatch');
  const nonce = '9'.repeat(32);
  writeSession(store, {
    ...record, state: 'operating', pending_operation: 'evidence_capture', operation_nonce: nonce,
  });
  evidenceAck(store, record, nonce, 'progress', ['evidence_query'], 'b'.repeat(32));
  guardianOutcome(store, record, nonce, 'evidence_query');
  await assert.rejects(managedSessionIdentity('evidence-mismatch', {
    env: state.env, current: fixture.current, run: exactRun(),
  }), (error) => error.code === 'COMPANION_STORE_CORRUPT');
});

test('proven pre-spawn liveness and cleanup failures restore active and propagate worker failure', async () => {
  const state = isolated();
  const fixture = await installManagedRuntime(state.env);
  await createManagedSession('no-authority', { kind: 'launched', headless: true, persistent: false }, {
    env: state.env, current: fixture.current, run: exactRun(),
  });
  let attemptedCleanup = 0;
  const noAuthority = async (request) => {
    if (request.operation === 'cleanup') attemptedCleanup += 1;
    return { spawned: false, authorityPossible: false, error: new Error('pre-spawn failure'), exitCode: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  };
  await assert.rejects(managedSessionIdentity('no-authority', {
    env: state.env, current: fixture.current, run: noAuthority,
  }), (error) => error.code === 'BROWSER_SESSION_WORKER_FAILED');
  assert.equal(readSession(inspectStore(state.env), 'no-authority').state, 'active');
  await assert.rejects(removeManagedSession('no-authority', {
    env: state.env, current: fixture.current, run: noAuthority,
  }), (error) => error.code === 'BROWSER_SESSION_WORKER_FAILED');
  assert.equal(readSession(inspectStore(state.env), 'no-authority').state, 'active');
  assert.equal(attemptedCleanup, 1);
  const removed = await removeManagedSession('no-authority', {
    env: state.env, current: fixture.current, run: exactRun(),
  });
  assert.equal(removed.status, 'removed');
});

test('final lease removal retires its superseded immutable version and list is whole-snapshot stable', async () => {
  const state = isolated();
  const first = await installManagedRuntime(state.env, managedRuntimeFixture('0.1.15'));
  await createManagedSession('old', { kind: 'launched', headless: true, persistent: false }, {
    env: state.env, current: first.current, run: exactRun(),
  });
  const oldKey = readSession(inspectStore(state.env), 'old').version_key;
  const next = managedRuntimeFixture('0.1.16');
  await updateCompanion({ env: state.env, current: next.current, download: next.download });
  const store = inspectStore(state.env);
  assert.equal(fs.existsSync(path.join(store.paths.versions, oldKey)), true);
  await removeManagedSession('old', { env: state.env, current: next.current, run: exactRun() });
  assert.equal(fs.existsSync(path.join(store.paths.versions, oldKey)), false);

  await createManagedSession('stable', { kind: 'launched', headless: true, persistent: false }, {
    env: state.env, current: next.current, run: exactRun(),
  });
  let revision = 0;
  await assert.rejects(listManagedSessions({
    env: state.env, current: next.current,
    afterListSnapshot() {
      const record = readSession(store, 'stable');
      writeSession(store, { ...record, updated_at: `2026-08-14T00:00:0${++revision}.000Z` });
    },
  }), (error) => error.code === 'COMPANION_STORE_BUSY');
  assert.equal((await listManagedSessions({ env: state.env, current: next.current })).sessions.length, 1);
});
