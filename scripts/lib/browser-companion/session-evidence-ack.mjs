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

const SCHEMA = 'aos.browser.evidence-ack.v1';
const KEYS = [
  'schema_version', 'store_id', 'lock_token', 'session_id', 'generation',
  'operation_nonce', 'phase', 'steps',
];
const NAME = /^evidence-ack-([A-Za-z0-9][A-Za-z0-9_-]{0,63})-([a-f0-9]{32})-([a-f0-9]{32})\.json$/u;
const HASH32 = /^[a-f0-9]{32}$/u;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const MAX_ACKS = 128;

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function validSteps(steps, phase) {
  const canonical = JSON.stringify(steps);
  const progress = new Set([
    '["navigate"]', '["evidence_query"]',
    '["navigate","evidence_query"]',
  ]);
  const acknowledged = new Set([
    '["evidence_query"]', '["navigate","evidence_query"]',
    '["evidence_query","screenshot"]',
    '["navigate","evidence_query","screenshot"]',
  ]);
  return (phase === 'progress' ? progress : acknowledged).has(canonical);
}

function ackPath(store, value) {
  return path.join(
    store.paths.pending,
    `evidence-ack-${value.session_id}-${value.generation}-${value.operation_nonce}.json`,
  );
}

export function isEvidenceAckName(name) {
  return NAME.test(String(name));
}

export function validateEvidenceAck(store, value, filename = null) {
  if (!exactKeys(value, KEYS) || value.schema_version !== SCHEMA
    || value.store_id !== store.owner.store_id || !HASH32.test(value.lock_token ?? '')
    || !SESSION_ID.test(value.session_id ?? '') || !HASH32.test(value.generation ?? '')
    || !HASH32.test(value.operation_nonce ?? '')
    || !['progress', 'acknowledged'].includes(value.phase)
    || !Array.isArray(value.steps) || !validSteps(value.steps, value.phase)) {
    fail('COMPANION_STORE_CORRUPT', 'managed evidence acknowledgement shape differs');
  }
  if (filename !== null && filename !== path.basename(ackPath(store, value))) {
    fail('COMPANION_STORE_CORRUPT', 'managed evidence acknowledgement filename differs');
  }
  return Object.freeze({ ...value, steps: Object.freeze([...value.steps]) });
}

export function listEvidenceAcks(store) {
  const names = fs.readdirSync(store.paths.pending).filter(isEvidenceAckName).sort();
  if (names.length > MAX_ACKS) fail('COMPANION_STORE_CORRUPT', 'managed evidence acknowledgement limit is exceeded');
  return names.map((name) => validateEvidenceAck(
    store,
    readPrivateRecord(path.join(store.paths.pending, name)),
    name,
  ));
}

export function publishEvidenceAck(store, lockOwner, record, nonce, previous, step, phase, options = {}) {
  const session = validateSessionRecord(record);
  if (session.state !== 'operating' || session.pending_operation !== 'evidence_capture'
    || session.operation_nonce !== nonce || lockOwner.store_id !== store.owner.store_id
    || !HASH32.test(lockOwner.token ?? '')) {
    fail('COMPANION_STORE_BLOCKED', 'managed evidence acknowledgement binding differs');
  }
  const prior = previous ? validateEvidenceAck(store, previous) : null;
  if (prior && (prior.session_id !== session.session_id || prior.generation !== session.generation
    || prior.operation_nonce !== nonce || prior.lock_token !== lockOwner.token
    || prior.phase !== 'progress')) {
    fail('COMPANION_STORE_CORRUPT', 'managed evidence acknowledgement predecessor differs');
  }
  const value = validateEvidenceAck(store, {
    schema_version: SCHEMA,
    store_id: store.owner.store_id,
    lock_token: lockOwner.token,
    session_id: session.session_id,
    generation: session.generation,
    operation_nonce: nonce,
    phase,
    steps: [...(prior?.steps ?? []), step],
  });
  const file = ackPath(store, value);
  const publication = writePrivateRecordAtomic(file, value, {
    pendingDirectory: store.paths.pending,
    afterRename: options.afterRename,
    returnCommittedFailure: true,
  });
  const observed = validateEvidenceAck(store, readPrivateRecord(file), path.basename(file));
  if (JSON.stringify(observed) !== JSON.stringify(value)) {
    fail('COMPANION_STORE_CORRUPT', 'managed evidence acknowledgement publication differs');
  }
  let recoveryPending = publication.recovery_pending;
  if (recoveryPending) {
    try {
      options.beforeReconcile?.();
      fsyncDirectory(store.paths.pending);
      recoveryPending = false;
    } catch {}
  }
  return Object.freeze({ ack: observed, recovery_pending: recoveryPending });
}

export function consumeEvidenceAck(store, value, options = {}) {
  const ack = validateEvidenceAck(store, value);
  const file = ackPath(store, ack);
  const before = lstatOptional(file);
  if (!before) {
    try { fsyncDirectory(store.paths.pending); return Object.freeze({ recovery_pending: false }); }
    catch { return Object.freeze({ recovery_pending: true }); }
  }
  const observed = validateEvidenceAck(store, readPrivateRecord(file), path.basename(file));
  if (JSON.stringify(observed) !== JSON.stringify(ack)) {
    fail('COMPANION_STORE_BLOCKED', 'managed evidence acknowledgement changed');
  }
  try {
    options.beforeUnlink?.(ack);
    const after = fs.lstatSync(file);
    if (!after.isFile() || after.dev !== before.dev || after.ino !== before.ino || after.nlink !== 1) {
      fail('COMPANION_STORE_BLOCKED', 'managed evidence acknowledgement identity changed');
    }
    fs.unlinkSync(file);
    options.afterUnlink?.(ack);
    fsyncDirectory(store.paths.pending);
  } catch (error) {
    if (error?.code?.startsWith?.('COMPANION_')) throw error;
    if (lstatOptional(file)) return Object.freeze({ recovery_pending: true });
    try { fsyncDirectory(store.paths.pending); }
    catch { return Object.freeze({ recovery_pending: true }); }
  }
  return Object.freeze({ recovery_pending: false });
}

export { MAX_ACKS, SCHEMA as EVIDENCE_ACK_SCHEMA };
