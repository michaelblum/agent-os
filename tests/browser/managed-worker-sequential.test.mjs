import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import {
  captureManagedBrowserEvidence,
  createManagedSession,
  managedSessionIdentity,
} from '../../scripts/lib/browser-companion/session-lifecycle.mjs';
import { inspectStore } from '../../scripts/lib/browser-companion/store-paths.mjs';
import { readSession } from '../../scripts/lib/browser-companion/session-store.mjs';
import { validateJsonSchema } from '../lib/json-schema-validation.mjs';
import {
  installManagedRuntime,
  managedRuntimeFixture,
  repoRoot,
} from './managed-runtime-test-fixture.mjs';

const roots = new Set();

function isolated(prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.add(root);
  return { root, env: { ...process.env, AOS_STATE_ROOT: root, AOS_RUNTIME_MODE: 'repo' } };
}

function workerOperations(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n')
    .map((line) => JSON.parse(line).argv[1]);
}

function assertReceipt(value) {
  assert.deepEqual(validateJsonSchema(
    path.join(repoRoot, 'shared/schemas/aos-browser-session-result-v1.schema.json'),
    value,
  ), []);
}

after(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

test('real guardian retires each evidence worker before reserving its successor', { timeout: 30_000 }, async () => {
  const state = isolated('aos-managed-worker-sequential-');
  const workerLog = path.join(state.root, 'worker.jsonl');
  const fixture = managedRuntimeFixture('0.1.15', { workerLog });
  await installManagedRuntime(state.env, fixture);
  await createManagedSession('evidence', {
    kind: 'launched', headless: true, persistent: false,
  }, { env: state.env, current: fixture.current });

  const store = inspectStore(state.env);
  const events = [];
  const receipt = await captureManagedBrowserEvidence('evidence', {
    url: 'data:text/html,<main id="hero">Evidence</main>',
    candidates: [{ kind: 'css', value: '#hero' }],
  }, {
    env: state.env,
    current: fixture.current,
    hooks: {
      afterGuardianReservation(record) {
        const prior = events.at(-1);
        if (prior) assert.equal(prior.kind, 'retired');
        assert.ok(fs.lstatSync(store.paths.guardian).isFile());
        events.push({
          kind: 'reserved', operation: record.operation,
          nonce: record.nonce, guardian_pid: record.guardian_pid,
        });
      },
      guardianRetirementHooks: {
        afterDirectorySync(record) {
          assert.equal(fs.existsSync(store.paths.guardian), false);
          events.push({ kind: 'retired', operation: record.operation, nonce: record.nonce });
        },
      },
    },
  });

  assert.equal(receipt.result.status, 'captured');
  assert.deepEqual(receipt.screenshot, Buffer.from('png'));
  assert.deepEqual(events.map(({ kind, operation }) => [kind, operation]), [
    ['reserved', 'navigate'], ['retired', 'navigate'],
    ['reserved', 'evidence_query'], ['retired', 'evidence_query'],
    ['reserved', 'screenshot'], ['retired', 'screenshot'],
  ]);
  const reservations = events.filter(({ kind }) => kind === 'reserved');
  assert.equal(new Set(reservations.map(({ guardian_pid }) => guardian_pid)).size, 3);
  assert.equal(new Set(reservations.map(({ nonce }) => nonce)).size, 1);
  assert.deepEqual(workerOperations(workerLog).slice(-3), ['goto', 'eval', 'screenshot']);
});

test('interrupted guardian retirement fails closed before an evidence successor starts', { timeout: 30_000 }, async () => {
  const state = isolated('aos-managed-worker-retirement-');
  const workerLog = path.join(state.root, 'worker.jsonl');
  const fixture = managedRuntimeFixture('0.1.15', { workerLog });
  await installManagedRuntime(state.env, fixture);
  await createManagedSession('interrupted', {
    kind: 'launched', headless: true, persistent: false,
  }, { env: state.env, current: fixture.current });

  const reservations = [];
  await assert.rejects(captureManagedBrowserEvidence('interrupted', {
    url: 'data:text/html,<main id="hero">Evidence</main>',
    candidates: [{ kind: 'css', value: '#hero' }],
  }, {
    env: state.env,
    current: fixture.current,
    hooks: {
      afterGuardianReservation(record) { reservations.push(record.operation); },
      guardianRetirementHooks: {
        beforeUnlink() { throw new Error('injected guardian retirement interruption'); },
      },
    },
  }), (error) => error.code === 'BROWSER_SESSION_CLEANUP_REQUIRED');

  assert.deepEqual(reservations, ['navigate']);
  assert.deepEqual(workerOperations(workerLog).slice(-1), ['goto']);
  assert.equal(readSession(inspectStore(state.env), 'interrupted').state, 'cleanup_required');
  await assert.rejects(managedSessionIdentity('interrupted', {
    env: state.env, current: fixture.current,
  }), (error) => error.code === 'BROWSER_SESSION_NOT_ACTIVE');
  assert.equal(readSession(inspectStore(state.env), 'interrupted').state, 'cleanup_required');
});

test('every evidence acknowledgement boundary blocks successors and recovers progress as cleanup-required', { timeout: 60_000 }, async () => {
  for (const boundary of [1, 2, 3]) {
    const state = isolated(`aos-managed-evidence-boundary-${boundary}-`);
    const workerLog = path.join(state.root, 'worker.jsonl');
    const fixture = managedRuntimeFixture('0.1.15', { workerLog });
    await installManagedRuntime(state.env, fixture);
    await createManagedSession(`boundary-${boundary}`, {
      kind: 'launched', headless: true, persistent: false,
    }, { env: state.env, current: fixture.current });
    let publications = 0;
    await assert.rejects(captureManagedBrowserEvidence(`boundary-${boundary}`, {
      url: 'data:text/html,<main id="hero">Evidence</main>',
      candidates: [{ kind: 'css', value: '#hero' }],
    }, {
      env: state.env,
      current: fixture.current,
      hooks: {
        afterEvidenceAckRename() {
          if (++publications === boundary) throw new Error('injected evidence acknowledgement interruption');
        },
        beforeEvidenceAckReconcile() { throw new Error('injected evidence acknowledgement reconciliation interruption'); },
      },
    }), (error) => error.code === 'BROWSER_SESSION_CLEANUP_REQUIRED');
    const store = inspectStore(state.env);
    const executed = workerOperations(workerLog).slice(1);
    assert.deepEqual(executed, ['goto', 'eval', 'screenshot'].slice(0, boundary));
    assert.equal(readSession(store, `boundary-${boundary}`).state, 'cleanup_required');
    assert.equal(fs.readdirSync(store.paths.pending).filter((name) => name.startsWith('evidence-ack-')).length, 1);
    assert.equal(fs.readdirSync(store.paths.pending).filter((name) => name.startsWith('guardian-outcome-')).length, 1);
    await assert.rejects(managedSessionIdentity(`boundary-${boundary}`, {
      env: state.env,
      current: fixture.current,
    }), (error) => error.code === 'BROWSER_SESSION_NOT_ACTIVE');
    assert.equal(readSession(store, `boundary-${boundary}`).state, 'cleanup_required');
    assert.equal(fs.readdirSync(store.paths.pending).filter((name) => name.startsWith('evidence-ack-')).length, 0);
    assert.equal(fs.readdirSync(store.paths.pending).filter((name) => name.startsWith('guardian-outcome-')).length, 0);
  }
});

test('final evidence acknowledgement becomes active before journal consumption and recovery never replays workers', { timeout: 30_000 }, async () => {
  const state = isolated('aos-managed-evidence-consume-');
  const workerLog = path.join(state.root, 'worker.jsonl');
  const fixture = managedRuntimeFixture('0.1.15', { workerLog });
  await installManagedRuntime(state.env, fixture);
  await createManagedSession('consume', {
    kind: 'launched', headless: true, persistent: false,
  }, { env: state.env, current: fixture.current });
  const receipt = await captureManagedBrowserEvidence('consume', {
    candidates: [{ kind: 'css', value: '#hero' }],
  }, {
    env: state.env,
    current: fixture.current,
    hooks: { beforeEvidenceAckUnlink() { throw new Error('injected evidence journal consumption interruption'); } },
  });
  const store = inspectStore(state.env);
  assert.equal(receipt.receipt.status, 'recovery_pending');
  assert.equal(readSession(store, 'consume').state, 'active');
  assert.equal(fs.readdirSync(store.paths.pending).filter((name) => name.startsWith('evidence-ack-')).length, 1);
  const before = workerOperations(workerLog);
  await managedSessionIdentity('consume', { env: state.env, current: fixture.current });
  const after = workerOperations(workerLog);
  assert.equal(after.length, before.length + 1);
  assert.equal(after.filter((verb) => verb === 'screenshot').length, before.filter((verb) => verb === 'screenshot').length);
  assert.equal(fs.readdirSync(store.paths.pending).filter((name) => name.startsWith('evidence-ack-')).length, 0);
});

test('final evidence result survives acknowledged Guardian-retirement uncertainty without internal leakage', { timeout: 30_000 }, async () => {
  const state = isolated('aos-managed-evidence-final-pending-');
  const workerLog = path.join(state.root, 'worker.jsonl');
  const fixture = managedRuntimeFixture('0.1.15', { workerLog });
  await installManagedRuntime(state.env, fixture);
  await createManagedSession('final-pending', {
    kind: 'launched', headless: true, persistent: false,
  }, { env: state.env, current: fixture.current });
  const receipt = await captureManagedBrowserEvidence('final-pending', {
    candidates: [{ kind: 'css', value: '#hero' }],
  }, {
    env: state.env,
    current: fixture.current,
    hooks: {
      guardianRetirementHooks: {
        beforeUnlink(record) {
          if (record.operation === 'screenshot') throw new Error('injected final Guardian retirement interruption');
        },
      },
    },
  });
  const store = inspectStore(state.env);
  assert.equal(receipt.receipt.status, 'recovery_pending');
  assertReceipt(receipt.receipt);
  assert.equal(receipt.result.status, 'captured');
  assert.deepEqual(receipt.screenshot, Buffer.from('png'));
  assert.deepEqual(Object.keys(receipt).sort(), ['receipt', 'result', 'screenshot']);
  assert.equal(readSession(store, 'final-pending').state, 'operation_committed');
  assert.equal(fs.readdirSync(store.paths.pending).filter((name) => name.startsWith('guardian-outcome-')).length, 1);
  assert.equal(fs.readdirSync(store.paths.pending).filter((name) => name.startsWith('evidence-ack-')).length, 1);
  const before = workerOperations(workerLog).length;
  await managedSessionIdentity('final-pending', { env: state.env, current: fixture.current });
  assert.equal(readSession(store, 'final-pending').state, 'active');
  assert.equal(workerOperations(workerLog).length, before + 1);
});
