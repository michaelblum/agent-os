import fs from 'node:fs';
import path from 'node:path';

import { fail } from './errors.mjs';
import {
  fsyncDirectory,
  inspectExclusiveRecordPublication,
  lstatOptional,
  publishExclusivePrivateRecord,
  recoverExclusiveRecordPublication,
} from './store-paths.mjs';
import { validateGuardianRecord } from './worker-guardian-state.mjs';

const OUTCOME_SCHEMA = 'aos.browser.worker-guardian-outcome.v1';
const MAX_OUTCOMES = 128;
const MAX_OUTCOME_BYTES = 4 * 1024;
const HASH32 = /^[a-f0-9]{32}$/u;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const OPERATIONS = new Set([
  'start', 'cleanup', 'liveness', 'navigate', 'type', 'key', 'scroll',
  'snapshot', 'screenshot', 'page_identity', 'evidence_query',
]);
const TERMINALS = new Set([
  'no_spawn', 'spawn_failed', 'exited', 'worker_failed', 'timeout',
  'output_cap', 'parent_lost', 'protocol_error',
]);
const OUTCOME_NAME = /^guardian-outcome-([A-Za-z0-9][A-Za-z0-9_-]{0,63})-([a-f0-9]{32})-([a-f0-9]{32})\.json$/u;
const KEYS = [
  'schema_version', 'store_id', 'lock_token', 'session_id', 'generation', 'nonce',
  'operation', 'guardian_pid', 'group_pid', 'source_phase', 'worker_spawned',
  'terminal_kind', 'authority',
];

function exactKeys(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...KEYS].sort());
}

function outcomePath(store, value) {
  return path.join(store.paths.pending, `guardian-outcome-${value.session_id}-${value.generation}-${value.nonce}.json`);
}

function publicationOptions(store) {
  return {
    pendingDirectory: store.paths.pending,
    purpose: 'guardian-outcome',
    code: 'COMPANION_STORE_CORRUPT',
    accessCode: 'COMPANION_STORE_BLOCKED',
    validate: (candidate) => validateGuardianOutcome(store, candidate),
  };
}

export function isGuardianOutcomeName(name) {
  return OUTCOME_NAME.test(String(name));
}

export function validateGuardianOutcome(store, value, filename = null) {
  if (!exactKeys(value) || value.schema_version !== OUTCOME_SCHEMA
    || value.store_id !== store.owner.store_id || !HASH32.test(value.lock_token ?? '')
    || !SESSION_ID.test(value.session_id ?? '') || !HASH32.test(value.generation ?? '')
    || !HASH32.test(value.nonce ?? '') || !['no_authority', 'authority_possible'].includes(value.authority)
    || !OPERATIONS.has(value.operation)
    || !Number.isSafeInteger(value.guardian_pid) || value.guardian_pid <= 0
    || !(value.group_pid === null || (Number.isSafeInteger(value.group_pid) && value.group_pid > 0))
    || !['armed', 'request_accepted', 'group_armed', 'worker_spawned', 'complete'].includes(value.source_phase)
    || typeof value.worker_spawned !== 'boolean'
    || !(value.terminal_kind === null || TERMINALS.has(value.terminal_kind))) {
    fail('COMPANION_STORE_CORRUPT', 'managed guardian outcome shape differs');
  }
  if (filename !== null && filename !== path.basename(outcomePath(store, value))) {
    fail('COMPANION_STORE_CORRUPT', 'managed guardian outcome filename differs');
  }
  const noAuthority = value.source_phase === 'complete'
    ? value.worker_spawned === false
    : value.group_pid === null;
  if ((noAuthority ? 'no_authority' : 'authority_possible') !== value.authority) {
    fail('COMPANION_STORE_CORRUPT', 'managed guardian outcome authority differs');
  }
  return Object.freeze(value);
}

export function guardianOutcome(store, lockOwner, record) {
  const guardian = validateGuardianRecord(record, store.owner, lockOwner);
  const noAuthority = guardian.phase === 'complete'
    ? guardian.worker_spawned === false
    : guardian.group_pid === null;
  return validateGuardianOutcome(store, {
    schema_version: OUTCOME_SCHEMA,
    store_id: guardian.store_id,
    lock_token: guardian.lock_token,
    session_id: guardian.session_id,
    generation: guardian.generation,
    nonce: guardian.nonce,
    operation: guardian.operation,
    guardian_pid: guardian.guardian_pid,
    group_pid: guardian.group_pid,
    source_phase: guardian.phase,
    worker_spawned: guardian.worker_spawned,
    terminal_kind: guardian.terminal_kind,
    authority: noAuthority ? 'no_authority' : 'authority_possible',
  });
}

export function publishGuardianOutcome(store, lockOwner, record, options = {}) {
  const value = guardianOutcome(store, lockOwner, record);
  const publication = publishExclusivePrivateRecord(outcomePath(store, value), value, {
    pendingDirectory: store.paths.pending,
    purpose: 'guardian-outcome',
    code: 'COMPANION_STORE_BUSY',
    accessCode: 'COMPANION_STORE_BLOCKED',
    acceptExisting: true,
    validate: (candidate) => validateGuardianOutcome(store, candidate),
    hooks: options.hooks,
  });
  if (JSON.stringify(publication.value) !== JSON.stringify(value)) {
    fail('COMPANION_STORE_BLOCKED', 'managed guardian outcome conflicts');
  }
  fsyncDirectory(store.paths.pending);
  return publication.value;
}

export function listGuardianOutcomes(store) {
  const names = fs.readdirSync(store.paths.pending).filter(isGuardianOutcomeName).sort();
  if (names.length > MAX_OUTCOMES) fail('COMPANION_STORE_CORRUPT', 'managed guardian outcome limit is exceeded');
  return names.map((name) => {
    const file = path.join(store.paths.pending, name);
    const info = lstatOptional(file);
    if (!info || info.size > MAX_OUTCOME_BYTES) fail('COMPANION_STORE_CORRUPT', 'managed guardian outcome size differs');
    const publication = inspectExclusiveRecordPublication(file, publicationOptions(store));
    if (!publication.value) fail('COMPANION_STORE_CORRUPT', 'managed guardian outcome disappeared');
    return validateGuardianOutcome(store, publication.value, name);
  });
}

export function consumeGuardianOutcome(store, outcome, options = {}) {
  const value = validateGuardianOutcome(store, outcome);
  const file = outcomePath(store, value);
  const publication = recoverExclusiveRecordPublication(file, publicationOptions(store));
  const before = lstatOptional(file);
  if (!before) {
    try { fsyncDirectory(store.paths.pending); return Object.freeze({ recovery_pending: false }); } catch {}
    return Object.freeze({ recovery_pending: true });
  }
  if (before.size > MAX_OUTCOME_BYTES) fail('COMPANION_STORE_CORRUPT', 'managed guardian outcome size differs');
  const observed = validateGuardianOutcome(store, publication.value, path.basename(file));
  if (JSON.stringify(observed) !== JSON.stringify(value)) fail('COMPANION_STORE_BLOCKED', 'managed guardian outcome changed');
  try {
    options.beforeUnlink?.(value);
    const after = fs.lstatSync(file);
    if (after.dev !== before.dev || after.ino !== before.ino || after.nlink !== 1) {
      fail('COMPANION_STORE_BLOCKED', 'managed guardian outcome identity changed');
    }
    fs.unlinkSync(file);
    options.afterUnlink?.(value);
    fsyncDirectory(store.paths.pending);
    return Object.freeze({ recovery_pending: false });
  } catch (error) {
    if (error?.code?.startsWith?.('COMPANION_')) throw error;
    if (lstatOptional(file)) return Object.freeze({ recovery_pending: true });
    try { fsyncDirectory(store.paths.pending); return Object.freeze({ recovery_pending: false }); } catch {}
    return Object.freeze({ recovery_pending: true });
  }
}

export { MAX_OUTCOMES, OUTCOME_SCHEMA };
