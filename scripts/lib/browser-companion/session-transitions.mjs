import crypto from 'node:crypto';

import {
  backendIdentity,
  publicSession,
  validateSessionRecord,
} from './session-model.mjs';
import { publishSession } from './session-store.mjs';

export function sessionNow(options = {}) {
  return (options.now ?? (() => new Date().toISOString()))();
}

export function operationNonce() {
  return crypto.randomBytes(16).toString('hex');
}

export function transitionRecord(record, state, options = {}, intent = null) {
  return validateSessionRecord({
    ...record,
    state,
    pending_operation: intent?.operation ?? null,
    operation_nonce: intent?.nonce ?? null,
    updated_at: sessionNow(options),
  });
}

export function publishTransition(store, record, options = {}) {
  return publishSession(store, record, {
    afterRename: options.hooks?.afterSessionRecordRename,
    beforeReconcile: options.hooks?.beforeSessionRecordReconcile,
  });
}

export function recoverInternalSession(store, record, options = {}) {
  const session = validateSessionRecord(record);
  if (session.state === 'operating') {
    return publishTransition(store, transitionRecord(session, 'cleanup_required', options), options);
  }
  if (session.state === 'operation_committed') {
    return publishTransition(store, transitionRecord(session, 'active', options), options);
  }
  if (session.state === 'cleanup_committed') {
    return publishTransition(store, transitionRecord(session, 'closed', options), options);
  }
  return Object.freeze({ record: session, recovery_pending: false });
}

export function sessionMutationReceipt({ operation, status, record, cleanupRequired = false, recoveryPending = false }) {
  const session = validateSessionRecord(record);
  return Object.freeze({
    schema_version: 'aos.browser.session.mutation.v1',
    operation,
    status,
    session: publicSession(session),
    runtime: {
      version: session.version,
      descriptor_sha256: session.descriptor_sha256,
      closure_sha256: session.closure_sha256,
      entrypoint: session.entrypoint,
    },
    cleanup_required: cleanupRequired,
    recovery_pending: recoveryPending,
    completed_at: session.updated_at,
  });
}

export function sessionOperationReceipt(operation, record, recoveryPending = false) {
  const session = validateSessionRecord(record);
  return Object.freeze({
    schema_version: 'aos.browser.session.operation.v1',
    operation,
    status: recoveryPending ? 'recovery_pending' : 'success',
    session_id: session.session_id,
    session_generation: session.generation,
    backend_identity: backendIdentity(session),
    recovery_pending: recoveryPending,
    completed_at: session.updated_at,
  });
}
