import fs from 'node:fs';
import path from 'node:path';

import { fail } from './errors.mjs';
import {
  assertPrivateDirectory,
  inspectExclusiveRecordPublication,
  lstatOptional,
  readPrivateRecord,
} from './store-paths.mjs';

export const LOCK_SCHEMA = 'aos.browser.companion.lock-owner.v1';
const LOCK_KEYS = ['schema_version', 'store_id', 'uid', 'pid', 'token'];

function currentUid() {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

export function deadPid(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === 'ESRCH';
  }
}

export function exactLockOwner(value, storeOwner) {
  if (!value || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...LOCK_KEYS].sort())) return false;
  return value.schema_version === LOCK_SCHEMA
    && value.store_id === storeOwner.store_id
    && value.uid === currentUid()
    && Number.isSafeInteger(value.pid)
    && value.pid > 0
    && /^[a-f0-9]{32}$/u.test(value.token ?? '');
}

export function inspectLockDirectory(store, directory, options = {}) {
  if (!lstatOptional(directory)) return null;
  const info = assertPrivateDirectory(directory, options.label ?? 'companion lock');
  const entries = fs.readdirSync(directory).sort();
  if (entries.length === 0 && options.allowEmpty) return Object.freeze({ info, owner: null, empty: true });
  if (entries.length !== 1 || entries[0] !== 'owner.json') {
    fail(options.code ?? 'COMPANION_STORE_BUSY', 'lock layout differs');
  }
  const owner = Object.hasOwn(options, 'ownerValue')
    ? options.ownerValue
    : readPrivateRecord(path.join(directory, 'owner.json'), {
      code: options.code ?? 'COMPANION_STORE_BUSY',
    });
  if (!exactLockOwner(owner, store.owner)) fail(options.code ?? 'COMPANION_STORE_BUSY', 'lock owner differs');
  if (options.expectedOwner && JSON.stringify(owner) !== JSON.stringify(options.expectedOwner)) {
    fail(options.code ?? 'COMPANION_STORE_BUSY', 'lock token differs');
  }
  if (options.requireDead && !deadPid(owner.pid)) fail('COMPANION_STORE_BUSY', 'lock owner is active');
  return Object.freeze({ info, owner, empty: false });
}

export function inspectStoreLockState(store, heldLock = null) {
  if (lstatOptional(store.paths.bootstrap)) fail('COMPANION_STORE_BLOCKED', 'companion owner bootstrap is incomplete');
  const publication = inspectExclusiveRecordPublication(path.join(store.paths.lock, 'owner.json'), {
    pendingDirectory: store.paths.pending,
    purpose: 'lock-owner',
    code: 'COMPANION_STORE_BLOCKED',
    validate: (owner) => {
      if (!exactLockOwner(owner, store.owner)) fail('COMPANION_STORE_BLOCKED', 'lock owner differs');
      return owner;
    },
  });
  const recovery = inspectLockDirectory(store, store.paths.lockRecovery, {
    allowEmpty: true,
    label: 'companion lock recovery',
  });
  const canonical = inspectLockDirectory(store, store.paths.lock, {
    allowEmpty: true,
    label: 'companion lock',
    ownerValue: publication.value,
  });
  if (publication.recovery_pending) return Object.freeze({ recovery_pending: true });
  if (canonical && !canonical.empty) {
    if (!heldLock) fail('COMPANION_STORE_BLOCKED', 'companion lifecycle mutation is in progress');
    if (JSON.stringify(canonical.owner) !== JSON.stringify(heldLock)) {
      fail('COMPANION_STORE_CORRUPT', 'held companion lock identity differs');
    }
  }
  return Object.freeze({ recovery_pending: Boolean(recovery || canonical?.empty) });
}
