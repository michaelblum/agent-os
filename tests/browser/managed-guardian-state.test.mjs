import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { companionStatus } from '../../scripts/lib/browser-companion/lifecycle.mjs';
import {
  createManagedSession,
  listManagedSessions,
  validateManagedSessionOperation,
} from '../../scripts/lib/browser-companion/session-lifecycle.mjs';
import { acquireStoreLock } from '../../scripts/lib/browser-companion/store-lock.mjs';
import {
  guardianRecord,
  guardianRetirementState,
} from '../../scripts/lib/browser-companion/worker-guardian-state.mjs';
import {
  guardianOutcome,
  listGuardianOutcomes,
} from '../../scripts/lib/browser-companion/worker-guardian-outcome.mjs';
import { installManagedRuntime } from './managed-runtime-test-fixture.mjs';

const roots = new Set();
function isolated() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-managed-guardian-state-'));
  roots.add(root);
  return { root, env: { ...process.env, AOS_STATE_ROOT: root, AOS_RUNTIME_MODE: 'repo' } };
}
function fingerprint(directory) {
  return fs.readdirSync(directory).sort().map((name) => {
    const file = path.join(directory, name);
    const info = fs.lstatSync(file);
    const bytes = info.isFile() ? fs.readFileSync(file) : Buffer.alloc(0);
    return {
      name, dev: String(info.dev), ino: String(info.ino), mode: info.mode & 0o777,
      nlink: info.nlink, size: info.size,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
  });
}
after(() => { for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });

test('complete guardian retirement skips group probing while incomplete authority remains busy', () => {
  const binding = {
    store_id: '1'.repeat(32), lock_token: '2'.repeat(32), session_id: 'probe',
    generation: '3'.repeat(32), nonce: '4'.repeat(32), operation: 'start',
  };
  let probes = 0;
  const groupAbsent = () => { probes += 1; return false; };
  const complete = guardianRecord(binding, 42, 'complete', {
    kind: 'parent_lost', worker_spawned: true, group_pid: 43,
  });
  assert.equal(guardianRetirementState(complete, () => false, groupAbsent), 'busy');
  assert.equal(probes, 0);
  assert.equal(guardianRetirementState(complete, () => true, groupAbsent), 'clear');
  assert.equal(probes, 0);
  const incomplete = guardianRecord(binding, 42, 'worker_spawned', {
    group_pid: 43, worker_spawned: true,
  });
  assert.equal(guardianRetirementState(incomplete, () => true, groupAbsent), 'busy');
  assert.equal(probes, 1);
});

test('status, list, and dry-run inspection never repair guardian publication bytes', async () => {
  const state = isolated();
  const fixture = await installManagedRuntime(state.env);
  const lock = acquireStoreLock(state.env);
  const value = guardianRecord({
    store_id: lock.store.owner.store_id,
    lock_token: lock.owner.token,
    session_id: 'inspection',
    generation: '1'.repeat(32),
    nonce: '2'.repeat(32),
    operation: 'scroll',
  }, 2_147_483_647, 'complete', { kind: 'no_spawn', worker_spawned: false });
  const slot = path.join(lock.store.paths.pending, '.publish-guardian-record-slot-0.tmp');
  fs.writeFileSync(slot, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' });
  fs.linkSync(slot, path.join(lock.store.paths.lock, 'guardian.json'));
  const before = {
    lock: fingerprint(lock.store.paths.lock),
    pending: fingerprint(lock.store.paths.pending),
  };

  assert.equal(companionStatus({ env: state.env, current: fixture.current }).state, 'partial');
  await assert.rejects(
    listManagedSessions({ env: state.env, current: fixture.current }),
    (error) => error.code === 'COMPANION_STORE_BUSY',
  );
  await assert.rejects(
    validateManagedSessionOperation('missing', 'scroll', { delta_y: 1 }, { env: state.env, current: fixture.current }),
    (error) => error.code === 'COMPANION_STORE_BUSY',
  );
  assert.deepEqual({
    lock: fingerprint(lock.store.paths.lock),
    pending: fingerprint(lock.store.paths.pending),
  }, before);

  const expectedTransferred = guardianOutcome(lock.store, lock.owner, value);
  assert.equal(lock.release().recovery_pending, false);
  assert.equal(companionStatus({ env: state.env, current: fixture.current }).state, 'partial');
  assert.deepEqual(listGuardianOutcomes(lock.store), [expectedTransferred]);
  await assert.rejects(createManagedSession('blocked-by-inspection', {
    kind: 'launched', headless: true, persistent: false,
  }, { env: state.env, current: fixture.current }), (error) => (
    error.code === 'COMPANION_STORE_CORRUPT'
    && error.message === 'guardian outcome lacks its managed session'
  ));

  const recoveryState = isolated();
  const recoveryFixture = await installManagedRuntime(recoveryState.env);
  const recoveryLock = acquireStoreLock(recoveryState.env);
  const recoveryStore = recoveryLock.store;
  recoveryLock.release();
  const generation = '3'.repeat(32);
  const nonce = '4'.repeat(32);
  const outcome = {
    schema_version: 'aos.browser.worker-guardian-outcome.v1',
    store_id: recoveryStore.owner.store_id,
    lock_token: '5'.repeat(32),
    session_id: 'abandoned',
    generation,
    nonce,
    operation: 'start',
    guardian_pid: 2_147_483_647,
    group_pid: null,
    source_phase: 'complete',
    worker_spawned: false,
    terminal_kind: 'no_spawn',
    authority: 'no_authority',
  };
  const outcomeSlot = path.join(recoveryStore.paths.pending, '.publish-guardian-outcome-slot-0.tmp');
  const outcomeFile = path.join(recoveryStore.paths.pending, `guardian-outcome-abandoned-${generation}-${nonce}.json`);
  fs.writeFileSync(outcomeSlot, `${JSON.stringify(outcome)}\n`, { mode: 0o600, flag: 'wx' });
  fs.linkSync(outcomeSlot, outcomeFile);
  const outcomeBefore = fingerprint(recoveryStore.paths.pending);
  assert.equal(companionStatus({ env: recoveryState.env, current: recoveryFixture.current }).state, 'partial');
  await assert.rejects(
    listManagedSessions({ env: recoveryState.env, current: recoveryFixture.current }),
    (error) => error.code === 'COMPANION_STORE_BUSY',
  );
  assert.deepEqual(fingerprint(recoveryStore.paths.pending), outcomeBefore);
  const created = await createManagedSession('after-outcome', {
    kind: 'launched', headless: true, persistent: false,
  }, {
    env: recoveryState.env,
    current: recoveryFixture.current,
    run: async (request) => ({
      spawned: true,
      exitCode: 0,
      stdout: Buffer.from(`${JSON.stringify({
        session: request.argv[0].slice(3), pid: 41,
        result: { snapshot: { file: '<auto>' } },
      })}\n`),
    }),
  });
  assert.equal(created.status, 'active');
  assert.equal(fs.existsSync(outcomeFile), false);
  assert.equal(fs.existsSync(outcomeSlot), false);
});

test('guardian outcome scanner rejects more than its bounded durable capacity', async () => {
  const state = isolated();
  const fixture = await installManagedRuntime(state.env);
  const store = acquireStoreLock(state.env);
  store.release();
  for (let index = 0; index < 129; index += 1) {
    const sessionId = `capacity-${index}`;
    const generation = index.toString(16).padStart(32, '0');
    const nonce = (index + 129).toString(16).padStart(32, '0');
    fs.writeFileSync(path.join(
      store.store.paths.pending,
      `guardian-outcome-${sessionId}-${generation}-${nonce}.json`,
    ), `${JSON.stringify({
      schema_version: 'aos.browser.worker-guardian-outcome.v1',
      store_id: store.store.owner.store_id,
      lock_token: 'a'.repeat(32),
      session_id: sessionId,
      generation,
      nonce,
      operation: 'start',
      guardian_pid: 2_147_483_647,
      group_pid: null,
      source_phase: 'complete',
      worker_spawned: false,
      terminal_kind: 'no_spawn',
      authority: 'no_authority',
    })}\n`, { mode: 0o600 });
  }
  assert.equal(companionStatus({ env: state.env, current: fixture.current }).state, 'corrupt');
});
