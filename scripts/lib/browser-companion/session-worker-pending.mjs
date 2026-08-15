import {
  ManagedSessionError,
  sessionFail,
  validateSessionRecord,
} from './session-model.mjs';

const pendingDetails = new WeakMap();
const acknowledgementUnknown = new WeakSet();

export function knownWorkerPending(value, acknowledgement, phase) {
  const error = new ManagedSessionError(
    'BROWSER_SESSION_CLEANUP_REQUIRED',
    'managed worker acknowledgement recovery is pending',
  );
  pendingDetails.set(error, Object.freeze({
    value: Object.freeze(value),
    acknowledgement,
    phase,
  }));
  return error;
}

export function workerPendingDetails(error) {
  return error && typeof error === 'object' ? pendingDetails.get(error) ?? null : null;
}

export function exactWorkerCommit(error, record, operation, nonce) {
  const pending = workerPendingDetails(error);
  if (!pending) return null;
  const acknowledgement = pending.acknowledgement;
  const committed = validateSessionRecord(acknowledgement?.record);
  if (committed.session_id !== record.session_id || committed.generation !== record.generation
    || committed.state !== 'operation_committed'
    || committed.pending_operation !== operation || committed.operation_nonce !== nonce) {
    sessionFail('COMPANION_STORE_CORRUPT', 'managed operation acknowledgement differs');
  }
  return Object.freeze({ pending, committed, publication: acknowledgement });
}

export function markAcknowledgementUnknown(error) {
  const value = error && typeof error === 'object'
    ? error
    : new ManagedSessionError(
      'BROWSER_SESSION_CLEANUP_REQUIRED',
      'managed worker acknowledgement result is unknown',
    );
  acknowledgementUnknown.add(value);
  return value;
}

export function isAcknowledgementUnknown(error) {
  return error && typeof error === 'object' && acknowledgementUnknown.has(error);
}
