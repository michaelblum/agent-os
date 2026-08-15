import fs from 'node:fs';
import path from 'node:path';

import { fail } from './errors.mjs';
import {
  fsyncDirectory,
  lstatOptional,
  readPrivateRecord,
  writePrivateRecordAtomic,
} from './store-paths.mjs';
import { validateSessionRecord } from './session-model.mjs';

const INTENT_SCHEMA = 'aos.browser.companion-session-create-intent.v1';
const INTENT_KEYS = [
  'schema_version', 'store_id', 'phase', 'guardian_operation', 'guardian_nonce', 'record',
];
const INTENT_NAME = /^session-create-([A-Za-z0-9][A-Za-z0-9_-]{0,63})-([a-f0-9]{32})\.json$/u;
const PHASES = new Set(['prepared', 'authority_possible', 'acknowledged', 'rollback_no_authority']);
const NONCE = /^[a-f0-9]{32}$/u;
const MAX_INTENTS = 8;

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function intentPath(store, record) {
  return path.join(store.paths.pending, `session-create-${record.session_id}-${record.generation}.json`);
}

export function isSessionCreateIntentName(name) {
  return INTENT_NAME.test(String(name));
}

export function validateSessionCreateIntent(store, value, filename = null) {
  if (!exactKeys(value, INTENT_KEYS) || value.schema_version !== INTENT_SCHEMA
    || value.store_id !== store.owner.store_id || !PHASES.has(value.phase)) {
    fail('COMPANION_STORE_CORRUPT', 'managed session creation intent shape differs');
  }
  const record = validateSessionRecord(value.record);
  if (record.state !== 'starting' || record.pending_operation !== null || record.operation_nonce !== null) {
    fail('COMPANION_STORE_CORRUPT', 'managed session creation intent record differs');
  }
  const guardianBound = ['authority_possible', 'acknowledged', 'rollback_no_authority'].includes(value.phase);
  if (guardianBound) {
    if (value.guardian_operation !== 'start' || !NONCE.test(value.guardian_nonce ?? '')) {
      fail('COMPANION_STORE_CORRUPT', 'managed session creation guardian binding differs');
    }
  } else if (value.guardian_operation !== null || value.guardian_nonce !== null) {
    fail('COMPANION_STORE_CORRUPT', 'prepared session creation has a guardian binding');
  }
  if (filename !== null && filename !== path.basename(intentPath(store, record))) {
    fail('COMPANION_STORE_CORRUPT', 'managed session creation intent filename differs');
  }
  return Object.freeze({ ...value, record });
}

export function listSessionCreateIntents(store) {
  const names = fs.readdirSync(store.paths.pending).filter(isSessionCreateIntentName).sort();
  if (names.length > MAX_INTENTS) fail('COMPANION_STORE_CORRUPT', 'managed session creation intent limit is exceeded');
  return names.map((name) => validateSessionCreateIntent(
    store,
    readPrivateRecord(path.join(store.paths.pending, name)),
    name,
  ));
}

export function listSessionCreateIntentsReadOnly(store, options = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const beforeDirectory = fs.lstatSync(store.paths.pending);
      const beforeNames = fs.readdirSync(store.paths.pending).filter(isSessionCreateIntentName).sort();
      if (beforeNames.length > MAX_INTENTS) fail('COMPANION_STORE_CORRUPT', 'managed session creation intent limit is exceeded');
      const values = beforeNames.map((name) => {
        const value = readPrivateRecord(path.join(store.paths.pending, name));
        if (!value) fail('COMPANION_STORE_BUSY', 'managed session creation intent changed during inspection');
        return validateSessionCreateIntent(store, value, name);
      });
      options.afterScan?.(attempt, values);
      const afterDirectory = fs.lstatSync(store.paths.pending);
      const afterNames = fs.readdirSync(store.paths.pending).filter(isSessionCreateIntentName).sort();
      if (beforeDirectory.dev === afterDirectory.dev && beforeDirectory.ino === afterDirectory.ino
        && JSON.stringify(beforeNames) === JSON.stringify(afterNames)) return values;
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'COMPANION_STORE_BUSY') throw error;
    }
  }
  fail('COMPANION_STORE_BUSY', 'managed session creation intents changed during inspection');
}

export function publishSessionCreateIntent(store, record, phase, options = {}) {
  const value = validateSessionCreateIntent(store, {
    schema_version: INTENT_SCHEMA,
    store_id: store.owner.store_id,
    phase,
    guardian_operation: options.guardian?.operation ?? null,
    guardian_nonce: options.guardian?.nonce ?? null,
    record: validateSessionRecord(record),
  });
  const file = intentPath(store, value.record);
  const publication = writePrivateRecordAtomic(file, value, {
    pendingDirectory: store.paths.pending,
    afterRename: options.afterRename,
    returnCommittedFailure: true,
  });
  const observed = readPrivateRecord(file);
  const validated = validateSessionCreateIntent(store, observed, path.basename(file));
  if (JSON.stringify(validated) !== JSON.stringify(value)) {
    fail('COMPANION_STORE_CORRUPT', 'managed session creation intent publication differs');
  }
  let recoveryPending = publication.recovery_pending;
  if (recoveryPending) {
    try {
      options.beforeReconcile?.();
      fsyncDirectory(store.paths.pending);
      recoveryPending = false;
    } catch {}
  }
  return Object.freeze({ file, intent: validated, recovery_pending: recoveryPending });
}

export function clearSessionCreateIntent(store, intent, options = {}) {
  const validated = validateSessionCreateIntent(store, intent);
  const file = intentPath(store, validated.record);
  const observed = validateSessionCreateIntent(store, readPrivateRecord(file), path.basename(file));
  if (JSON.stringify(observed) !== JSON.stringify(validated)) {
    fail('COMPANION_STORE_CORRUPT', 'managed session creation intent changed');
  }
  try {
    options.beforeUnlink?.();
    fs.unlinkSync(file);
    options.afterUnlink?.();
    (options.syncDirectory ?? fsyncDirectory)(store.paths.pending);
  } catch (error) {
    if (lstatOptional(file)) return Object.freeze({ recovery_pending: true });
    try { (options.syncDirectory ?? fsyncDirectory)(store.paths.pending); }
    catch { return Object.freeze({ recovery_pending: true }); }
  }
  return Object.freeze({ recovery_pending: false });
}

export { INTENT_SCHEMA };
