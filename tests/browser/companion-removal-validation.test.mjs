import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  companionStatus, installCompanion, updateCompanion,
} from '../../scripts/lib/browser-companion/lifecycle.mjs';
import { acquireStoreLock } from '../../scripts/lib/browser-companion/store-lock.mjs';
import { inspectRemovalClaims } from '../../scripts/lib/browser-companion/store-removal-claim.mjs';
import { ensureStore, writePrivateRecordAtomic } from '../../scripts/lib/browser-companion/store-paths.mjs';
import { ensureRemovalJournal } from '../../scripts/lib/browser-companion/store-removal.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const temporaryRoots = new Set();

function isolated() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-browser-companion-removal-'));
  temporaryRoots.add(root);
  return { root, env: { ...process.env, AOS_STATE_ROOT: root, AOS_RUNTIME_MODE: 'repo' } };
}

after(() => {
  for (const root of temporaryRoots) fs.rmSync(root, { recursive: true, force: true });
});

function journal(store, overrides = {}) {
  fs.mkdirSync(store.paths.removal, { mode: 0o700 });
  writePrivateRecordAtomic(store.paths.removalJournal, {
    schema_version: 'aos.browser.companion-removal.v1',
    store_id: store.owner.store_id,
    before_state: 'missing',
    previous_version: null,
    descriptor_sha256: null,
    closure_sha256: null,
    ...overrides,
  }, { pendingDirectory: store.paths.removal });
}

function state(env) {
  return companionStatus({ env, repoRoot }).state;
}

test('removal marker, journal, layout, and retired-root identity fail closed', async () => {
  const linked = isolated();
  const linkedStore = ensureStore(linked.env);
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-browser-companion-removal-target-'));
  temporaryRoots.add(external);
  fs.symlinkSync(external, linkedStore.paths.removal);
  assert.equal(state(linked.env), 'blocked');

  const mode = isolated();
  const modeStore = ensureStore(mode.env);
  fs.mkdirSync(modeStore.paths.removal, { mode: 0o755 });
  assert.equal(state(mode.env), 'blocked');

  const wrongStore = isolated();
  const wrongStoreState = ensureStore(wrongStore.env);
  journal(wrongStoreState, { store_id: '0'.repeat(32) });
  assert.equal(state(wrongStore.env), 'corrupt');

  const cleanupOnly = isolated();
  const cleanupOnlyStore = ensureStore(cleanupOnly.env);
  const malformedStoreId = 'A'.repeat(32);
  journal(cleanupOnlyStore, { store_id: malformedStoreId });
  writePrivateRecordAtomic(path.join(cleanupOnlyStore.paths.removal, 'cleanup.json'), {
    schema_version: 'aos.browser.companion-removal-cleanup.v1',
    store_id: malformedStoreId,
  }, { pendingDirectory: cleanupOnlyStore.paths.removal });
  fs.renameSync(cleanupOnlyStore.paths.root, path.join(cleanupOnlyStore.paths.browser, 'detached-companion'));
  assert.equal(state(cleanupOnly.env), 'corrupt');

  const intrinsicClaim = isolated();
  const intrinsicClaimStore = ensureStore(intrinsicClaim.env);
  journal(intrinsicClaimStore);
  writePrivateRecordAtomic(path.join(intrinsicClaimStore.paths.removal, 'cleanup.json'), {
    schema_version: 'aos.browser.companion-removal-cleanup.v1',
    store_id: intrinsicClaimStore.owner.store_id,
  }, { pendingDirectory: intrinsicClaimStore.paths.removal });
  writePrivateRecordAtomic(path.join(intrinsicClaimStore.paths.removal, 'recovery.json'), {
    schema_version: 'aos.browser.companion-removal-claim.v1',
    store_id: malformedStoreId,
    uid: typeof process.getuid === 'function' ? process.getuid() : null,
    pid: process.pid,
    token: 'f'.repeat(32),
  }, { pendingDirectory: intrinsicClaimStore.paths.removal });
  fs.renameSync(intrinsicClaimStore.paths.root, path.join(intrinsicClaimStore.paths.browser, 'detached-companion'));
  assert.throws(() => inspectRemovalClaims(intrinsicClaimStore.paths.removal, malformedStoreId), {
    code: 'COMPANION_STORE_BLOCKED',
  });
  assert.equal(state(intrinsicClaim.env), 'blocked');

  const extra = isolated();
  const extraStore = ensureStore(extra.env);
  journal(extraStore);
  fs.writeFileSync(path.join(extraStore.paths.removal, 'journal-copy.json'), '{}\n', { mode: 0o600 });
  assert.equal(state(extra.env), 'corrupt');

  const linkedJournal = isolated();
  const linkedJournalStore = ensureStore(linkedJournal.env);
  fs.mkdirSync(linkedJournalStore.paths.removal, { mode: 0o700 });
  fs.symlinkSync(path.join(external, 'journal.json'), linkedJournalStore.paths.removalJournal);
  assert.equal(state(linkedJournal.env), 'blocked');

  const linkedRetiredRoot = isolated();
  const retiredStore = ensureStore(linkedRetiredRoot.env);
  journal(retiredStore);
  const heldRoot = path.join(retiredStore.paths.browser, 'held-companion');
  fs.renameSync(retiredStore.paths.root, heldRoot);
  fs.symlinkSync(heldRoot, retiredStore.paths.removalStore);
  assert.equal(state(linkedRetiredRoot.env), 'blocked');

  const linkedClaim = isolated();
  const linkedClaimStore = ensureStore(linkedClaim.env);
  journal(linkedClaimStore);
  fs.symlinkSync(path.join(external, 'recovery.json'), path.join(linkedClaimStore.paths.removal, 'recovery.json'));
  assert.equal(state(linkedClaim.env), 'blocked');

  const multipleClaims = isolated();
  const multipleStore = ensureStore(multipleClaims.env);
  journal(multipleStore);
  for (const name of ['recovery.json', 'recovery-stale.json']) {
    writePrivateRecordAtomic(path.join(multipleStore.paths.removal, name), {
      schema_version: 'aos.browser.companion-removal-claim.v1',
      store_id: multipleStore.owner.store_id,
      uid: typeof process.getuid === 'function' ? process.getuid() : null,
      pid: 2147483647,
      token: name === 'recovery.json' ? 'd'.repeat(32) : 'e'.repeat(32),
    }, { pendingDirectory: multipleStore.paths.removal });
  }
  assert.equal(state(multipleClaims.env), 'corrupt');

  const ambiguousCommit = isolated();
  const held = acquireStoreLock(ambiguousCommit.env, {
    allowStoreRemovalRecovery: true,
    hooks: { afterStoreRetirement: () => { throw new Error('browser fsync ambiguity'); } },
  });
  const removal = held.removeStore(ensureRemovalJournal(held.store, { state: 'missing', validated: null }));
  assert.equal(removal.recovery_pending, true);
  assert.equal(fs.existsSync(held.store.paths.root), false);
  assert.equal(fs.statSync(held.store.paths.removalStore).isDirectory(), true);
  assert.equal(state(ambiguousCommit.env), 'partial');
  for (const operation of [installCompanion, updateCompanion]) {
    await assert.rejects(operation({ env: ambiguousCommit.env, repoRoot }), { code: 'COMPANION_STORE_BLOCKED' });
  }
});
