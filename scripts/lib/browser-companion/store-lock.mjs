import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { fail } from './errors.mjs';
import {
  DIRECTORY_MODE,
  assertPrivateDirectory,
  ensureStore,
  fsyncDirectory,
  inspectStore,
  lstatOptional,
  publishExclusivePrivateRecord,
  recoverExclusiveRecordPublication,
} from './store-paths.mjs';
import { commitStoreRemoval, recoverRemovalState } from './store-removal.mjs';
import {
  LOCK_SCHEMA,
  exactLockOwner,
  inspectLockDirectory,
} from './store-lock-state.mjs';

function currentUid() {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

function lockPublicationOptions(store, hooks = {}) {
  return {
    pendingDirectory: store.paths.pending,
    purpose: 'lock-owner',
    code: 'COMPANION_STORE_BUSY',
    accessCode: 'COMPANION_STORE_BLOCKED',
    validate: (owner) => {
      if (!exactLockOwner(owner, store.owner)) fail('COMPANION_STORE_BLOCKED', 'lock owner differs');
      return owner;
    },
    hooks: {
      beforeWrite: hooks.beforeLockOwnerWrite,
      beforeLink: hooks.beforeLockOwnerLink,
      afterLink: hooks.afterLockOwnerLink,
      afterTempUnlink: hooks.afterLockOwnerTempUnlink,
    },
  };
}

function cleanupLockRecovery(store, options = {}) {
  const inspected = inspectLockDirectory(store, store.paths.lockRecovery, {
    allowEmpty: true,
    expectedOwner: options.expectedOwner,
    requireDead: !options.allowLiveOwner,
    label: 'companion lock recovery',
  });
  if (!inspected) return Object.freeze({ recovery_pending: false });
  try {
    if (inspected.owner) {
      fs.unlinkSync(path.join(store.paths.lockRecovery, 'owner.json'));
      fsyncDirectory(store.paths.lockRecovery);
      options.hooks?.afterLockOwnerCleanup?.();
    }
    fs.rmdirSync(store.paths.lockRecovery);
    options.hooks?.afterLockRecoveryRemoval?.();
    fsyncDirectory(store.paths.root);
  } catch {}
  return Object.freeze({ recovery_pending: Boolean(lstatOptional(store.paths.lockRecovery)) });
}

function retireExactLock(store, expectedOwner, options = {}) {
  if (lstatOptional(store.paths.lockRecovery)) {
    const cleanup = cleanupLockRecovery(store);
    if (cleanup.recovery_pending) fail('COMPANION_STORE_BUSY', 'lock recovery cleanup is incomplete');
  }
  const inspected = inspectLockDirectory(store, store.paths.lock, {
    allowEmpty: expectedOwner === null,
    expectedOwner,
    requireDead: !options.allowLiveOwner && expectedOwner === null,
  });
  if (!inspected) fail('COMPANION_STORE_BUSY', 'existing lock disappeared');
  try {
    fs.renameSync(store.paths.lock, store.paths.lockRecovery);
    const moved = fs.lstatSync(store.paths.lockRecovery);
    if (moved.dev !== inspected.info.dev || moved.ino !== inspected.info.ino) fail('COMPANION_STORE_BUSY', 'retired lock identity differs');
    fsyncDirectory(store.paths.root);
    options.hooks?.afterRecoveryClaim?.();
  } catch (error) {
    const recovery = lstatOptional(store.paths.lockRecovery);
    if (!lstatOptional(store.paths.lock) && recovery?.dev === inspected.info.dev && recovery?.ino === inspected.info.ino) {
      return Object.freeze({ recovery_pending: true });
    }
    if (error?.code?.startsWith?.('COMPANION_')) throw error;
    fail('COMPANION_STORE_BUSY', 'lock retirement did not complete', { cause: error });
  }
  return cleanupLockRecovery(store, {
    expectedOwner: inspected.owner,
    allowLiveOwner: options.allowLiveOwner,
    hooks: options.hooks,
  });
}

function abandonCreatedLock(store, lockInfo) {
  try {
    const current = inspectLockDirectory(store, store.paths.lock, { allowEmpty: true });
    if (!current?.empty || current.info.dev !== lockInfo.dev || current.info.ino !== lockInfo.ino) return;
    if (lstatOptional(store.paths.lockRecovery)) return;
    retireExactLock(store, null, { allowLiveOwner: true });
  } catch {}
}

function prepareStore(env, options) {
  const inspected = inspectStore(env);
  let recoveredRemoval = null;
  if (inspected.removal) {
    if (!options.allowStoreRemovalRecovery) {
      fail('COMPANION_STORE_BLOCKED', 'companion removal may only be resumed by uninstall');
    }
    if (!inspected.exists) recoveredRemoval = recoverRemovalState(inspected, options);
  }
  if (recoveredRemoval) return Object.freeze({ store: null, recoveredRemoval });
  return Object.freeze({
    store: ensureStore(env, { allowRemovalIntent: options.allowStoreRemovalRecovery }),
    recoveredRemoval,
  });
}

export function acquireStoreLock(env = process.env, options = {}) {
  const prepared = prepareStore(env, options);
  if (!prepared.store) {
    return Object.freeze({
      store: null,
      owner: null,
      recoveredRemoval: prepared.recoveredRemoval,
      removeStore() { fail('COMPANION_STORE_CORRUPT', 'recovered removal has no live store'); },
      release() { return Object.freeze({ recovery_pending: false }); },
    });
  }
  const { store } = prepared;
  recoverExclusiveRecordPublication(
    path.join(store.paths.lock, 'owner.json'),
    lockPublicationOptions(store),
  );
  if (lstatOptional(store.paths.lockRecovery)) {
    const cleanup = cleanupLockRecovery(store);
    if (cleanup.recovery_pending) fail('COMPANION_STORE_BUSY', 'lock recovery cleanup is incomplete');
  }
  let created = false;
  try {
    fs.mkdirSync(store.paths.lock, { mode: DIRECTORY_MODE });
    created = true;
  } catch (error) {
    if (error?.code !== 'EEXIST') fail('COMPANION_STORE_BUSY', 'store lock cannot be created', { cause: error });
    const retired = retireExactLock(store, null, { hooks: options.hooks });
    if (retired.recovery_pending) fail('COMPANION_STORE_BUSY', 'stale lock cleanup is incomplete');
    options.hooks?.beforeRetryAcquire?.();
    try {
      fs.mkdirSync(store.paths.lock, { mode: DIRECTORY_MODE });
      created = true;
    } catch (retryError) {
      fail('COMPANION_STORE_BUSY', 'store lock was acquired concurrently', { cause: retryError });
    }
  }
  if (!created) fail('COMPANION_STORE_BUSY', 'store lock is unavailable');
  const lockInfo = assertPrivateDirectory(store.paths.lock, 'companion lock');
  try {
    options.hooks?.afterLockDirectoryCreate?.();
    if (lstatOptional(store.paths.lockRecovery)) fail('COMPANION_STORE_BUSY', 'lock recovery reappeared before owner publication');
    const currentLock = fs.lstatSync(store.paths.lock);
    if (currentLock.dev !== lockInfo.dev || currentLock.ino !== lockInfo.ino || fs.readdirSync(store.paths.lock).length !== 0) {
      fail('COMPANION_STORE_BUSY', 'new lock identity changed before owner publication');
    }
  } catch (error) {
    abandonCreatedLock(store, lockInfo);
    throw error;
  }
  const owner = {
    schema_version: LOCK_SCHEMA,
    store_id: store.owner.store_id,
    uid: currentUid(),
    pid: process.pid,
    token: crypto.randomBytes(16).toString('hex'),
  };
  try {
    publishExclusivePrivateRecord(
      path.join(store.paths.lock, 'owner.json'),
      owner,
      lockPublicationOptions(store, options.hooks),
    );
  } catch (error) {
    try {
      const published = inspectLockDirectory(store, store.paths.lock, { allowEmpty: true });
      if (published?.owner && JSON.stringify(published.owner) === JSON.stringify(owner)) {
        retireExactLock(store, owner, { allowLiveOwner: true });
      } else if (published?.empty) {
        abandonCreatedLock(store, lockInfo);
      }
    } catch {}
    throw error;
  }
  let released = false;
  return Object.freeze({
    store,
    owner,
    recoveredRemoval: prepared.recoveredRemoval,
    removeStore(journal) {
      const result = commitStoreRemoval(store, owner, journal, {
        hooks: options.hooks,
        onCommitted: () => { released = true; },
      });
      return result;
    },
    release() {
      if (released) return Object.freeze({ recovery_pending: false });
      const result = retireExactLock(store, owner, { allowLiveOwner: true, hooks: options.hooks });
      released = true;
      return result;
    },
  });
}

export async function withStoreLock(env, callback, options = {}) {
  const lock = acquireStoreLock(env, options);
  let result;
  let failure;
  try {
    result = await callback(lock.store, lock.owner, {
      recoveredRemoval: lock.recoveredRemoval,
      removeStore: (journal) => lock.removeStore(journal),
    });
  } catch (error) {
    failure = error;
  }
  const release = lock.release();
  if (failure) throw failure;
  if (release.recovery_pending && result?.schema_version === 'aos.browser.companion.mutation.v1') {
    return Object.freeze({ ...result, after_state: 'partial', recovery_pending: true });
  }
  return result;
}
