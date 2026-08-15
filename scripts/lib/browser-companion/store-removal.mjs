import fs from 'node:fs';
import path from 'node:path';

import { fail } from './errors.mjs';
import {
  DIRECTORY_MODE,
  assertPrivateDirectory,
  fsyncDirectory,
  lstatOptional,
  readPrivateRecord,
  writePrivateRecordAtomic,
} from './store-paths.mjs';
import { removeQuarantined } from './store-retirement.mjs';
import {
  CLAIM_FILE,
  STALE_CLAIM_FILE,
  acquireRemovalClaim,
  inspectRemovalClaims,
  isRemovalClaimPublicationTemp,
  releaseRemovalClaim,
} from './store-removal-claim.mjs';

const JOURNAL_SCHEMA = 'aos.browser.companion-removal.v1';
const JOURNAL_KEYS = [
  'schema_version', 'store_id', 'before_state', 'previous_version',
  'descriptor_sha256', 'closure_sha256',
];
const CLEANUP_SCHEMA = 'aos.browser.companion-removal-cleanup.v1';
const LOCK_SCHEMA = 'aos.browser.companion.lock-owner.v1';
const LOCK_KEYS = ['schema_version', 'store_id', 'uid', 'pid', 'token'];
const ACTIVE_KEYS = ['schema_version', 'version_key', 'version', 'descriptor_sha256', 'closure_sha256'];
const CLEANUP_FILE = 'cleanup.json';

function currentUid() {
  return typeof process.getuid === 'function' ? process.getuid() : null;
}

function exactKeys(value, keys) {
  return value && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function exactLockOwner(value, storeId) {
  return exactKeys(value, LOCK_KEYS)
    && value.schema_version === LOCK_SCHEMA
    && value.store_id === storeId
    && value.uid === currentUid()
    && Number.isSafeInteger(value.pid)
    && value.pid > 0
    && /^[a-f0-9]{32}$/u.test(value.token ?? '');
}

function deadPid(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === 'ESRCH';
  }
}

function validateJournal(value, storeId) {
  if (
    !exactKeys(value, JOURNAL_KEYS)
    || value.schema_version !== JOURNAL_SCHEMA
    || !/^[a-f0-9]{32}$/u.test(value.store_id ?? '')
    || (storeId !== undefined && value.store_id !== storeId)
    || !['missing', 'current', 'update_available', 'partial'].includes(value.before_state)
  ) {
    fail('COMPANION_STORE_CORRUPT', 'removal journal shape differs');
  }
  const binding = [value.previous_version, value.descriptor_sha256, value.closure_sha256];
  const empty = binding.every((part) => part === null);
  const exact = typeof value.previous_version === 'string'
    && /^[0-9A-Za-z.-]+$/u.test(value.previous_version)
    && /^[a-f0-9]{64}$/u.test(value.descriptor_sha256 ?? '')
    && /^[a-f0-9]{64}$/u.test(value.closure_sha256 ?? '');
  if (!empty && !exact) fail('COMPANION_STORE_CORRUPT', 'removal journal binding differs');
  return Object.freeze(value);
}

function markerEntries(store) {
  assertPrivateDirectory(store.paths.removal, 'companion removal marker');
  const entries = fs.readdirSync(store.paths.removal).sort();
  const allowed = new Set([CLEANUP_FILE, CLAIM_FILE, STALE_CLAIM_FILE, 'journal.json', 'store']);
  if (entries.some((entry) => !allowed.has(entry) && !isRemovalClaimPublicationTemp(entry))) {
    fail('COMPANION_STORE_CORRUPT', 'companion removal marker contains an extra entry');
  }
  return entries;
}

function readJournal(store, entries) {
  if (!entries.includes('journal.json')) return null;
  return validateJournal(readPrivateRecord(store.paths.removalJournal, {
    accessCode: 'COMPANION_STORE_BLOCKED',
  }), store.owner?.store_id
    ?? readPrivateRecord(path.join(store.paths.removalStore, 'owner.json'))?.store_id);
}

function validateCleanupRecord(store, journal, directory = store.paths.removal) {
  const cleanup = readPrivateRecord(path.join(directory, CLEANUP_FILE));
  if (
    !cleanup
    || JSON.stringify(Object.keys(cleanup).sort()) !== JSON.stringify(['schema_version', 'store_id'])
    || cleanup.schema_version !== CLEANUP_SCHEMA
    || cleanup.store_id !== journal.store_id
  ) fail('COMPANION_STORE_CORRUPT', 'removal cleanup record differs');
}

function validateActiveBinding(root, journal) {
  const active = readPrivateRecord(path.join(root, 'active.json'));
  if (journal.previous_version === null) {
    if (active) fail('COMPANION_STORE_CORRUPT', 'null removal binding has an active pointer');
    return;
  }
  if (
    !exactKeys(active, ACTIVE_KEYS)
    || active.version !== journal.previous_version
    || active.descriptor_sha256 !== journal.descriptor_sha256
    || active.closure_sha256 !== journal.closure_sha256
  ) fail('COMPANION_STORE_CORRUPT', 'removal journal does not bind the active pointer');
}

function validateIntactRoot(root, storeOwner, lockOwner, journal, allowLiveLock) {
  assertPrivateDirectory(root, 'retired companion store');
  const entries = fs.readdirSync(root).sort();
  const expected = ['.lock', '.pending', '.retired', '.session-retired', '.staging', 'leases', 'owner.json', 'versions', 'workspaces'];
  if (lstatOptional(path.join(root, 'active.json'))) expected.push('active.json');
  if (JSON.stringify(entries) !== JSON.stringify(expected.sort())) {
    fail('COMPANION_STORE_CORRUPT', 'retired companion store layout differs');
  }
  for (const name of ['.lock', '.pending', '.retired', '.session-retired', '.staging', 'leases', 'versions', 'workspaces']) {
    assertPrivateDirectory(path.join(root, name), `retired ${name}`);
  }
  const owner = readPrivateRecord(path.join(root, 'owner.json'));
  if (!owner || owner.store_id !== journal.store_id || (storeOwner && JSON.stringify(owner) !== JSON.stringify(storeOwner))) {
    fail('COMPANION_STORE_BLOCKED', 'retired companion owner differs');
  }
  if (fs.readdirSync(path.join(root, 'leases')).length !== 0) {
    fail('COMPANION_LEASES_ACTIVE', 'managed leases block uninstall');
  }
  if (fs.readdirSync(path.join(root, 'workspaces')).length !== 0 || fs.readdirSync(path.join(root, '.session-retired')).length !== 0) {
    fail('COMPANION_STORE_CORRUPT', 'managed session cleanup is incomplete');
  }
  const lock = readPrivateRecord(path.join(root, '.lock/owner.json'));
  if (!exactLockOwner(lock, journal.store_id) || (lockOwner && JSON.stringify(lock) !== JSON.stringify(lockOwner))) {
    fail('COMPANION_STORE_BLOCKED', 'retired companion lock differs');
  }
  if (!allowLiveLock && !deadPid(lock.pid)) fail('COMPANION_STORE_BUSY', 'retired companion lock owner is active');
  validateActiveBinding(root, journal);
}

function completedMarker(store) {
  return `${store.paths.removal}-complete`;
}

function cleanupCompletedMarker(store, options = {}) {
  const target = completedMarker(store);
  if (!lstatOptional(target)) return;
  assertPrivateDirectory(target, 'completed companion removal');
  const allowed = new Set([CLEANUP_FILE, CLAIM_FILE, STALE_CLAIM_FILE, 'journal.json']);
  if (fs.readdirSync(target).some((entry) => !allowed.has(entry) && !isRemovalClaimPublicationTemp(entry))) {
    fail('COMPANION_STORE_CORRUPT', 'completed removal layout differs');
  }
  const journal = validateJournal(readPrivateRecord(path.join(target, 'journal.json')));
  validateCleanupRecord(store, journal, target);
  inspectRemovalClaims(target, journal.store_id, { nonAuthoritative: true });
  try {
    removeQuarantined(target, { beforeRemove: options.hooks?.beforeCompletedRemovalCleanup });
  } catch {}
  if (lstatOptional(target)) fail('COMPANION_STORE_BUSY', 'completed removal cleanup is pending');
}

export function ensureRemovalJournal(store, view, options = {}) {
  cleanupCompletedMarker(store, options);
  const existing = lstatOptional(store.paths.removal);
  if (!existing) {
    fs.mkdirSync(store.paths.removal, { mode: DIRECTORY_MODE });
    fsyncDirectory(store.paths.browser);
    options.hooks?.afterRemovalMarkerCreate?.();
  }
  const entries = markerEntries(store);
  if (entries.length > 0) {
    if (JSON.stringify(entries) !== JSON.stringify(['journal.json'])) {
      fail('COMPANION_STORE_CORRUPT', 'live removal marker layout differs');
    }
    return readJournal(store, entries);
  }
  const binding = view.validated ?? null;
  const journal = {
    schema_version: JOURNAL_SCHEMA,
    store_id: store.owner.store_id,
    before_state: view.state,
    previous_version: binding?.version ?? null,
    descriptor_sha256: binding?.descriptor_sha256 ?? null,
    closure_sha256: binding?.closure_sha256 ?? null,
  };
  writePrivateRecordAtomic(store.paths.removalJournal, journal, { pendingDirectory: store.paths.removal });
  fsyncDirectory(store.paths.browser);
  return validateJournal(journal, store.owner.store_id);
}

export function inspectRemovalState(store) {
  if (!store.removal) return null;
  const entries = markerEntries(store);
  const hasStore = entries.includes('store');
  const hasCleanup = entries.includes(CLEANUP_FILE);
  if (hasStore) assertPrivateDirectory(store.paths.removalStore, 'retired companion store');
  const journal = readJournal(store, entries);
  if (journal) inspectRemovalClaims(store.paths.removal, journal.store_id);
  else if (entries.includes(CLAIM_FILE) || entries.includes(STALE_CLAIM_FILE)) {
    fail('COMPANION_STORE_CORRUPT', 'removal claim lacks provenance');
  }
  if (store.exists) {
    if (hasStore || hasCleanup) fail('COMPANION_STORE_CORRUPT', 'live removal intent layout differs');
    return Object.freeze({ phase: journal ? 'intent' : 'pre_intent', journal });
  }
  if (!journal) fail('COMPANION_STORE_CORRUPT', 'retired removal state lacks provenance');
  if (hasCleanup) {
    if (!journal) fail('COMPANION_STORE_CORRUPT', 'removal cleanup lacks provenance');
    validateCleanupRecord(store, journal);
  }
  if (!hasStore && entries.some((entry) => !['journal.json', CLEANUP_FILE, CLAIM_FILE, STALE_CLAIM_FILE].includes(entry)
    && !isRemovalClaimPublicationTemp(entry))) {
    fail('COMPANION_STORE_CORRUPT', 'completed removal marker layout differs');
  }
  return Object.freeze({ phase: hasStore ? 'retired' : 'cleanup', journal });
}

function completeMarker(store, options = {}) {
  const target = completedMarker(store);
  if (lstatOptional(target)) cleanupCompletedMarker(store, options);
  const before = fs.lstatSync(store.paths.removal);
  try {
    options.hooks?.beforeRemovalMarkerRetirement?.();
    fs.renameSync(store.paths.removal, target);
    const moved = fs.lstatSync(target);
    if (moved.dev !== before.dev || moved.ino !== before.ino) fail('COMPANION_STORE_CORRUPT', 'completed removal identity differs');
    options.hooks?.afterRemovalMarkerRetirement?.();
    fsyncDirectory(store.paths.browser);
  } catch (error) {
    const canonical = lstatOptional(store.paths.removal);
    const completed = lstatOptional(target);
    if (canonical || completed?.dev !== before.dev || completed?.ino !== before.ino) return true;
  }
  try { cleanupCompletedMarker(store, options); } catch {}
  return false;
}

function cleanupRetiredStore(store, journal, options = {}, intact = null) {
  const entries = markerEntries(store);
  if (!entries.includes('store')) {
    return completeMarker(store, options);
  }
  if (!entries.includes(CLEANUP_FILE)) {
    validateIntactRoot(store.paths.removalStore, intact?.storeOwner, intact?.lockOwner, journal, intact?.allowLiveLock === true);
    writePrivateRecordAtomic(path.join(store.paths.removal, CLEANUP_FILE), {
      schema_version: CLEANUP_SCHEMA,
      store_id: journal.store_id,
    }, { pendingDirectory: store.paths.removal });
  } else {
    validateCleanupRecord(store, journal);
  }
  try {
    removeQuarantined(store.paths.removalStore, { beforeRemove: options.hooks?.beforeStoreRemovalCleanup });
  } catch {
    return true;
  }
  return completeMarker(store, options);
}

export function recoverRemovalState(store, options = {}) {
  const state = inspectRemovalState(store);
  if (!state || ['intent', 'pre_intent'].includes(state.phase)) fail('COMPANION_STORE_BLOCKED', 'live removal intent requires uninstall');
  if (state.phase === 'retired' && !lstatOptional(path.join(store.paths.removal, CLEANUP_FILE))) {
    validateIntactRoot(store.paths.removalStore, null, null, state.journal, true);
  }
  const claim = acquireRemovalClaim(store.paths.removal, state.journal.store_id, { hooks: options.hooks });
  try {
    options.hooks?.afterRemovalClaim?.(claim);
  } catch (error) {
    try { releaseRemovalClaim(store.paths.removal, state.journal.store_id, claim); } catch {}
    throw error;
  }
  const recoveryPending = cleanupRetiredStore(store, state.journal, options);
  if (recoveryPending && lstatOptional(store.paths.removal)) {
    try { releaseRemovalClaim(store.paths.removal, state.journal.store_id, claim); } catch {}
  }
  return Object.freeze({ journal: state.journal, recovery_pending: recoveryPending });
}

export function commitStoreRemoval(store, lockOwner, journal, options = {}) {
  validateIntactRoot(store.paths.root, store.owner, lockOwner, journal, true);
  options.hooks?.afterRemovalJournal?.();
  const claim = acquireRemovalClaim(store.paths.removal, journal.store_id, { hooks: options.hooks });
  try {
    options.hooks?.afterRemovalClaim?.(claim);
  } catch (error) {
    try { releaseRemovalClaim(store.paths.removal, journal.store_id, claim); } catch {}
    throw error;
  }
  const before = fs.lstatSync(store.paths.root);
  let committed = false;
  try {
    fs.renameSync(store.paths.root, store.paths.removalStore);
    committed = true;
    const moved = fs.lstatSync(store.paths.removalStore);
    if (moved.dev !== before.dev || moved.ino !== before.ino) {
      fail('COMPANION_STORE_CORRUPT', 'retired companion store identity differs');
    }
    fsyncDirectory(store.paths.removal);
    options.hooks?.afterStoreRetirement?.();
    fsyncDirectory(store.paths.browser);
  } catch (error) {
    const canonical = lstatOptional(store.paths.root);
    const retired = lstatOptional(store.paths.removalStore);
    if (committed && !canonical && retired?.dev === before.dev && retired?.ino === before.ino) {
      options.onCommitted?.();
      try { releaseRemovalClaim(store.paths.removal, journal.store_id, claim); } catch {}
      return Object.freeze({ recovery_pending: true });
    }
    try { releaseRemovalClaim(store.paths.removal, journal.store_id, claim); } catch {}
    if (error?.code?.startsWith?.('COMPANION_')) throw error;
    fail('COMPANION_STORE_CORRUPT', 'companion store retirement failed', { cause: error });
  }
  options.onCommitted?.();
  try {
    const recoveryPending = cleanupRetiredStore(store, journal, options, {
      storeOwner: store.owner,
      lockOwner,
      allowLiveLock: true,
    });
    if (recoveryPending && lstatOptional(store.paths.removal)) {
      try { releaseRemovalClaim(store.paths.removal, journal.store_id, claim); } catch {}
    }
    return Object.freeze({ recovery_pending: recoveryPending });
  } catch {
    try { releaseRemovalClaim(store.paths.removal, journal.store_id, claim); } catch {}
    return Object.freeze({ recovery_pending: true });
  }
}
