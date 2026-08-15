import fs from 'node:fs';
import path from 'node:path';

import { fail } from './errors.mjs';
import {
  assertPrivateDirectory,
  fsyncDirectory,
  inspectExclusiveRecordPublication,
  lstatOptional,
  publishExclusivePrivateRecord,
  readPrivateRecord,
  recoverExclusiveRecordPublication,
  writePrivateRecordAtomic,
} from './store-paths.mjs';

export const GUARDIAN_SCHEMA = 'aos.browser.worker-guardian.v1';
export const GUARDIAN_CONTROL_SCHEMA = 'aos.browser.worker-guardian-control.v1';
export const GUARDIAN_REQUEST_SCHEMA = 'aos.browser.worker-guardian-request.v1';
export const GUARDIAN_ACTIVATION_SCHEMA = 'aos.browser.worker-guardian-activation.v1';
export const MAX_GUARDIAN_REQUEST_BYTES = 256 * 1024;
export const MAX_GUARDIAN_CONTROL_BYTES = 4 * 1024;
export const MAX_GUARDIAN_CONTROL_TOTAL = 32 * 1024;
export const MAX_DESCRIPTOR_OUTPUT_BYTES = 64 * 1024;

const HASH32 = /^[a-f0-9]{32}$/u;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const OPERATIONS = new Set([
  'start', 'cleanup', 'liveness', 'navigate', 'type', 'key', 'scroll',
  'snapshot', 'screenshot', 'page_identity', 'evidence_query',
]);
const PHASES = new Set(['armed', 'request_accepted', 'group_armed', 'worker_spawned', 'complete']);
const TERMINALS = new Set([
  'no_spawn', 'spawn_failed', 'exited', 'worker_failed', 'timeout',
  'output_cap', 'parent_lost', 'protocol_error',
]);
const RECORD_KEYS = [
  'schema_version', 'store_id', 'lock_token', 'session_id', 'generation',
  'nonce', 'operation', 'guardian_pid', 'group_pid', 'phase', 'worker_spawned', 'terminal_kind',
];

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

export function guardianOperationLimits(operation, descriptorOutputBytes = MAX_DESCRIPTOR_OUTPUT_BYTES) {
  if (!OPERATIONS.has(operation)) fail('COMPANION_STORE_BLOCKED', 'guardian operation differs');
  if (!Number.isSafeInteger(descriptorOutputBytes) || descriptorOutputBytes <= 0
    || descriptorOutputBytes > MAX_DESCRIPTOR_OUTPUT_BYTES) {
    fail('COMPANION_STORE_BLOCKED', 'guardian output authority differs');
  }
  return Object.freeze({
    timeout_ms: ['start', 'cleanup'].includes(operation) ? 30_000 : 20_000,
    output_bytes: descriptorOutputBytes,
  });
}

export function validateGuardianBinding(value) {
  if (!value || !HASH32.test(value.store_id ?? '') || !HASH32.test(value.lock_token ?? '')
    || !SESSION_ID.test(value.session_id ?? '') || !HASH32.test(value.generation ?? '')
    || !HASH32.test(value.nonce ?? '') || !OPERATIONS.has(value.operation)) {
    fail('COMPANION_STORE_BLOCKED', 'guardian binding differs');
  }
  return Object.freeze({
    store_id: value.store_id, lock_token: value.lock_token,
    session_id: value.session_id, generation: value.generation,
    nonce: value.nonce, operation: value.operation,
  });
}

export function validateGuardianRecord(value, storeOwner, lockOwner) {
  if (!exactKeys(value, RECORD_KEYS) || value.schema_version !== GUARDIAN_SCHEMA
    || value.store_id !== storeOwner.store_id || value.lock_token !== lockOwner.token
    || !SESSION_ID.test(value.session_id ?? '') || !HASH32.test(value.generation ?? '')
    || !HASH32.test(value.nonce ?? '') || !OPERATIONS.has(value.operation)
    || !Number.isSafeInteger(value.guardian_pid) || value.guardian_pid <= 0
    || !(value.group_pid === null || (Number.isSafeInteger(value.group_pid) && value.group_pid > 0))
    || !PHASES.has(value.phase) || typeof value.worker_spawned !== 'boolean'
    || !(value.terminal_kind === null || TERMINALS.has(value.terminal_kind))) {
    fail('COMPANION_STORE_BLOCKED', 'guardian record differs');
  }
  if (!['worker_spawned', 'complete'].includes(value.phase) && value.worker_spawned) {
    fail('COMPANION_STORE_BLOCKED', 'nonterminal guardian record differs');
  }
  if (value.phase !== 'complete' && value.terminal_kind !== null) {
    fail('COMPANION_STORE_BLOCKED', 'nonterminal guardian result differs');
  }
  if (['armed', 'request_accepted'].includes(value.phase) && value.group_pid !== null) {
    fail('COMPANION_STORE_BLOCKED', 'prespawn guardian group differs');
  }
  if (['group_armed', 'worker_spawned'].includes(value.phase) && value.group_pid === null) {
    fail('COMPANION_STORE_BLOCKED', 'guardian group binding is absent');
  }
  if (value.phase === 'complete' && value.terminal_kind === null) {
    fail('COMPANION_STORE_BLOCKED', 'terminal guardian record differs');
  }
  if (!value.worker_spawned && !['no_spawn', 'spawn_failed', 'protocol_error', null].includes(value.terminal_kind)) {
    fail('COMPANION_STORE_BLOCKED', 'guardian authority result differs');
  }
  return Object.freeze(value);
}

export function guardianRecord(binding, guardianPid, phase, terminal = null) {
  const exact = validateGuardianBinding(binding);
  return Object.freeze({
    schema_version: GUARDIAN_SCHEMA,
    ...exact,
    guardian_pid: guardianPid,
    group_pid: terminal?.group_pid ?? null,
    phase,
    worker_spawned: terminal?.worker_spawned === true,
    terminal_kind: terminal?.kind ?? null,
  });
}

export function guardianRecordPath(store, directory = store.paths.lock) {
  return path.join(directory, 'guardian.json');
}

function publicationOptions(store, lockOwner, directory, code) {
  return {
    pendingDirectory: store.paths.pending,
    purpose: 'guardian-record',
    code,
    accessCode: code,
    validate: (value) => validateGuardianRecord(value, store.owner, lockOwner),
  };
}

export function recoverGuardianRecordPublication(store, lockOwner, options = {}) {
  return recoverExclusiveRecordPublication(
    guardianRecordPath(store, options.directory),
    publicationOptions(store, lockOwner, options.directory ?? store.paths.lock, options.code ?? 'COMPANION_STORE_BLOCKED'),
  );
}

export function inspectGuardianRecordPublication(store, lockOwner, options = {}) {
  return inspectExclusiveRecordPublication(
    guardianRecordPath(store, options.directory),
    publicationOptions(store, lockOwner, options.directory ?? store.paths.lock, options.code ?? 'COMPANION_STORE_BLOCKED'),
  );
}

export function guardianLockIdentity(store, lockOwner) {
  const info = assertPrivateDirectory(store.paths.lock, 'companion guardian lock');
  const observed = readPrivateRecord(path.join(store.paths.lock, 'owner.json'));
  if (JSON.stringify(observed) !== JSON.stringify(lockOwner)
    || observed?.store_id !== store.owner.store_id || observed?.token !== lockOwner.token) {
    fail('COMPANION_STORE_BLOCKED', 'guardian lock binding differs');
  }
  return Object.freeze({ dev: info.dev, ino: info.ino });
}

export function assertGuardianLockIdentity(store, lockOwner, identity) {
  const observed = guardianLockIdentity(store, lockOwner);
  if (observed.dev !== identity.dev || observed.ino !== identity.ino) {
    fail('COMPANION_STORE_BLOCKED', 'guardian lock identity changed');
  }
  return observed;
}

export function reserveGuardianRecord(store, lockOwner, record, options = {}) {
  const identity = guardianLockIdentity(store, lockOwner);
  const value = validateGuardianRecord(record, store.owner, lockOwner);
  if (value.phase !== 'armed') fail('COMPANION_STORE_BLOCKED', 'guardian reservation phase differs');
  const publication = publishExclusivePrivateRecord(guardianRecordPath(store), value, {
    ...publicationOptions(store, lockOwner, store.paths.lock, 'COMPANION_STORE_BLOCKED'),
    hooks: options.hooks,
  });
  assertGuardianLockIdentity(store, lockOwner, identity);
  if (!publication.published || JSON.stringify(publication.value) !== JSON.stringify(value)) {
    fail('COMPANION_STORE_BLOCKED', 'guardian reservation publication differs');
  }
  return Object.freeze({ record: publication.value, lock_identity: identity });
}

export function transitionGuardianRecord(store, lockOwner, expected, next, lockIdentity) {
  assertGuardianLockIdentity(store, lockOwner, lockIdentity);
  const previous = recoverGuardianRecordPublication(store, lockOwner).value;
  if (JSON.stringify(previous) !== JSON.stringify(validateGuardianRecord(expected, store.owner, lockOwner))) {
    fail('COMPANION_STORE_BLOCKED', 'guardian record transition source differs');
  }
  const value = validateGuardianRecord(next, store.owner, lockOwner);
  writePrivateRecordAtomic(guardianRecordPath(store), value, {
    pendingDirectory: store.paths.pending,
  });
  fsyncDirectory(store.paths.lock);
  assertGuardianLockIdentity(store, lockOwner, lockIdentity);
  const observed = recoverGuardianRecordPublication(store, lockOwner).value;
  if (JSON.stringify(observed) !== JSON.stringify(value)) {
    fail('COMPANION_STORE_BLOCKED', 'guardian record transition differs');
  }
  return observed;
}

export function retireCompleteGuardianRecord(store, lockOwner, expected, options = {}) {
  const binding = validateGuardianBinding(expected?.binding);
  if (!Number.isSafeInteger(expected?.guardian_pid) || expected.guardian_pid <= 0
    || !TERMINALS.has(expected?.terminal_kind) || typeof expected?.worker_spawned !== 'boolean') {
    fail('COMPANION_STORE_BLOCKED', 'guardian retirement witness differs');
  }
  const lockIdentity = guardianLockIdentity(store, lockOwner);
  const file = guardianRecordPath(store);
  const publication = recoverGuardianRecordPublication(store, lockOwner);
  const record = publication.value;
  if (publication.recovery_pending || !record || record.phase !== 'complete'
    || JSON.stringify(validateGuardianBinding(record)) !== JSON.stringify(binding)
    || record.guardian_pid !== expected.guardian_pid
    || record.terminal_kind !== expected.terminal_kind
    || record.worker_spawned !== expected.worker_spawned) {
    fail('COMPANION_STORE_BLOCKED', 'guardian completed retirement binding differs');
  }
  const before = lstatOptional(file);
  if (!before) fail('COMPANION_STORE_BLOCKED', 'guardian completed record is absent');
  try {
    options.beforeUnlink?.(record);
    const after = fs.lstatSync(file);
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino || after.nlink !== 1) {
      fail('COMPANION_STORE_BLOCKED', 'guardian completed record identity changed');
    }
    assertGuardianLockIdentity(store, lockOwner, lockIdentity);
    fs.unlinkSync(file);
    options.afterUnlink?.(record);
    fsyncDirectory(store.paths.lock);
    assertGuardianLockIdentity(store, lockOwner, lockIdentity);
    if (lstatOptional(file)) fail('COMPANION_STORE_BLOCKED', 'guardian completed record remains');
    options.afterDirectorySync?.(record);
    return record;
  } catch (error) {
    if (error?.code?.startsWith?.('COMPANION_')) throw error;
    fail('COMPANION_STORE_BLOCKED', 'guardian completed retirement did not finish', { cause: error });
  }
}

export function guardianRetirementState(record, dead, groupAbsent) {
  if (!record) return 'clear';
  if (!dead(record.guardian_pid)) return 'busy';
  if (record.phase === 'complete') return 'clear';
  if (record.group_pid !== null && !groupAbsent(record.group_pid)) return 'busy';
  return 'clear';
}
