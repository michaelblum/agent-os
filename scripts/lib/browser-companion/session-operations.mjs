import { loadSourceDescriptor } from './descriptor.mjs';
import { withStoreLock } from './store-lock.mjs';
import {
  cleanupSupersededVersions,
  inspectManagedState,
  readActive,
} from './store-state.mjs';
import { inspectStore } from './store-paths.mjs';
import {
  backendIdentity,
  publicSession,
  sessionFail,
  validateSessionId,
  validateSessionRecord,
} from './session-model.mjs';
import { validateManagedOperationInput, runManagedWorker } from './session-runner.mjs';
import {
  exactWorkerCommit,
  isAcknowledgementUnknown,
  workerPendingDetails,
} from './session-worker-pending.mjs';
import { listSessionCreateIntentsReadOnly } from './session-intent.mjs';
import { recoverSessionCreations } from './session-create.mjs';
import { executeEvidenceWorkers } from './session-evidence-operation.mjs';
import {
  cleanupClosedSession,
  inspectLegacySessions,
  listSessionsReadOnly,
  readSession,
  retireEmptyLegacySessions,
} from './session-store.mjs';
import {
  operationNonce,
  publishTransition,
  recoverInternalSession,
  sessionMutationReceipt,
  sessionNow,
  sessionOperationReceipt,
  transitionRecord,
} from './session-transitions.mjs';
function inspectSessionStore(env, current, heldLock) {
  const view = inspectManagedState(env, current.digest, { heldLock });
  if (!view.store) sessionFail('BROWSER_SESSION_NOT_ACTIVE', 'managed runtime is not installed');
  return view;
}

function recoverCreations(store, options) {
  if (recoverSessionCreations(store, options).recovery_pending) {
    sessionFail('BROWSER_SESSION_CLEANUP_REQUIRED', 'managed session creation recovery is pending');
  }
}

function recoverRecord(store, record, options) {
  const recovered = recoverInternalSession(store, record, options);
  if (recovered.recovery_pending) {
    sessionFail('BROWSER_SESSION_CLEANUP_REQUIRED', 'managed session recovery durability is pending');
  }
  return recovered.record;
}

function publicListSnapshot(store, options = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const leases = listSessionsReadOnly(store, options.listHooks);
    const intents = listSessionCreateIntentsReadOnly(store, options.intentHooks);
    const byId = new Map(leases.map((record) => [record.session_id, record]));
    for (const intent of intents) {
      const existing = byId.get(intent.record.session_id);
      if (existing && existing.generation !== intent.record.generation) {
        sessionFail('COMPANION_STORE_CORRUPT', 'managed session list intent conflicts with a lease');
      }
      if (!existing) byId.set(intent.record.session_id, intent.record);
    }
    const first = [...byId.values()].sort((left, right) => left.session_id.localeCompare(right.session_id));
    options.afterListSnapshot?.(attempt, first);
    const secondLeases = listSessionsReadOnly(store, options.listHooks);
    const secondIntents = listSessionCreateIntentsReadOnly(store, options.intentHooks);
    const signature = (records, pending) => JSON.stringify({
      records,
      pending: pending.map((intent) => ({ phase: intent.phase, record: intent.record })),
    });
    if (signature(leases, intents) === signature(secondLeases, secondIntents)) return first.map(publicSession);
  }
  sessionFail('COMPANION_STORE_BUSY', 'managed session list changed during inspection');
}

export async function listManagedSessions(options = {}) {
  const env = options.env ?? process.env;
  const current = options.current ?? loadSourceDescriptor({ repoRoot: options.repoRoot });
  const inspected = inspectStore(env);
  inspectLegacySessions(inspected.paths.browser);
  const view = inspectManagedState(env, current.digest);
  if (view.guardian_recovery_pending) {
    sessionFail('COMPANION_STORE_BUSY', 'managed guardian recovery is pending');
  }
  return Object.freeze({
    schema_version: 'aos.browser.session.list.v1', operation: 'list', status: 'ok',
    sessions: view.store ? publicListSnapshot(view.store, options) : [], checked_at: sessionNow(options),
  });
}

export async function managedSessionIdentity(sessionId, options = {}) {
  const env = options.env ?? process.env;
  const current = options.current ?? loadSourceDescriptor({ repoRoot: options.repoRoot });
  return withStoreLock(env, async (store, heldLock) => {
    recoverCreations(store, options);
    retireEmptyLegacySessions(store);
    inspectSessionStore(env, current, heldLock);
    let record = readSession(store, sessionId);
    if (!record) sessionFail('BROWSER_SESSION_NOT_FOUND', 'managed session is absent');
    record = recoverRecord(store, record, options);
    if (record.state !== 'active') sessionFail('BROWSER_SESSION_NOT_ACTIVE', 'managed session is not active');
    const nonce = operationNonce();
    const operating = publishTransition(
      store, transitionRecord(record, 'operating', options, { operation: 'liveness', nonce }), options,
    );
    if (operating.recovery_pending) {
      sessionFail('BROWSER_SESSION_CLEANUP_REQUIRED', 'managed liveness intent durability is pending');
    }
    let committed;
    try {
      await runManagedWorker(store, operating.record, 'liveness', {}, {
        ...options,
        lockOwner: heldLock,
        acknowledge: () => {
          committed = acknowledgeOperation(store, operating.record, 'liveness', nonce, options);
          return committed;
        },
      });
    } catch (error) {
      const pending = exactWorkerCommit(error, operating.record, 'liveness', nonce);
      if (pending) {
        return Object.freeze({
          session: publicSession(pending.committed),
          backend_identity: backendIdentity(pending.committed),
          receipt: sessionOperationReceipt('liveness', pending.committed, true),
        });
      }
      if (isAcknowledgementUnknown(error)) throw error;
      const state = error?.authority_possible === false ? 'active' : 'cleanup_required';
      const recovered = publishTransition(store, transitionRecord(operating.record, state, options), options);
      if (state === 'active' && !recovered.recovery_pending) throw error;
      sessionFail('BROWSER_SESSION_CLEANUP_REQUIRED', 'managed session liveness is unproven');
    }
    const completed = finishOperation(store, committed, options);
    if (completed.recovery_pending) sessionFail('BROWSER_SESSION_CLEANUP_REQUIRED', 'managed liveness completion is pending');
    return Object.freeze({
      session: publicSession(completed.record),
      backend_identity: backendIdentity(completed.record),
      receipt: sessionOperationReceipt('liveness', completed.record, completed.recovery_pending),
    });
  }, { hooks: options.hooks });
}

export async function validateManagedSessionOperation(sessionId, operation, input = {}, options = {}) {
  const env = options.env ?? process.env;
  const current = options.current ?? loadSourceDescriptor({ repoRoot: options.repoRoot });
  validateSessionId(sessionId);
  const validatedInput = validateManagedOperationInput(operation, input);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const inspected = inspectStore(env);
      inspectLegacySessions(inspected.paths.browser);
      const view = inspectManagedState(env, current.digest);
      if (!view.store) sessionFail('BROWSER_SESSION_NOT_ACTIVE', 'managed runtime is not installed');
      if (view.guardian_recovery_pending) sessionFail('COMPANION_STORE_BUSY', 'managed guardian recovery is pending');
      const before = readSession(view.store, sessionId);
      if (!before) sessionFail('BROWSER_SESSION_NOT_FOUND', 'managed session is absent');
      options.afterValidationRead?.(before, attempt);
      const after = readSession(view.store, sessionId);
      if (!after || JSON.stringify(before) !== JSON.stringify(after)) {
        sessionFail('COMPANION_STORE_BUSY', 'managed session changed during validation');
      }
      if (after.state !== 'active') sessionFail('BROWSER_SESSION_NOT_ACTIVE', 'managed session is not active');
      return Object.freeze({ session: publicSession(after), backend_identity: backendIdentity(after), input: validatedInput });
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'COMPANION_STORE_BUSY') throw error;
    }
  }
  sessionFail('COMPANION_STORE_BUSY', 'managed session changed during validation');
}

function finalRemoval(store, record, env, current, heldLock, options) {
  const local = cleanupClosedSession(store, record, options.hooks ?? {});
  let recoveryPending = local.recovery_pending;
  if (!recoveryPending) {
    try {
      const active = readActive(store);
      if (active) cleanupSupersededVersions(store, active.version_key);
    } catch {
      try {
        recoveryPending = inspectManagedState(env, current.digest, { heldLock }).state === 'partial';
      } catch { recoveryPending = true; }
    }
  }
  return sessionMutationReceipt({
    operation: 'remove', status: recoveryPending ? 'recovery_pending' : 'removed',
    record, recoveryPending,
  });
}

export async function removeManagedSession(sessionId, options = {}) {
  const env = options.env ?? process.env;
  const current = options.current ?? loadSourceDescriptor({ repoRoot: options.repoRoot });
  validateSessionId(sessionId);
  return withStoreLock(env, async (store, heldLock) => {
    recoverCreations(store, options);
    retireEmptyLegacySessions(store);
    let record = readSession(store, sessionId);
    if (!record) sessionFail('BROWSER_SESSION_NOT_FOUND', 'managed session is absent');
    inspectSessionStore(env, current, heldLock);
    record = recoverRecord(store, record, options);
    if (record.state === 'closed') return finalRemoval(store, record, env, current, heldLock, options);
    const nonce = operationNonce();
    const closing = publishTransition(store, transitionRecord(record, 'closing', options, { operation: 'cleanup', nonce }), options);
    record = closing.record;
    if (closing.recovery_pending) {
      return sessionMutationReceipt({ operation: 'remove', status: 'cleanup_required', record, cleanupRequired: true, recoveryPending: true });
    }
    let cleanupCommitted;
    try {
      await runManagedWorker(store, record, 'cleanup', {}, {
        ...options,
        lockOwner: heldLock,
        acknowledge: () => {
          cleanupCommitted = publishTransition(
            store, transitionRecord(record, 'cleanup_committed', options, { operation: 'cleanup', nonce }), options,
          );
          return cleanupCommitted;
        },
      });
      record = cleanupCommitted.record;
    } catch (error) {
      const pending = workerPendingDetails(error);
      if (pending) {
        const acknowledged = validateSessionRecord(pending.acknowledgement?.record);
        if (acknowledged.session_id !== record.session_id
          || acknowledged.generation !== record.generation
          || acknowledged.state !== 'cleanup_committed'
          || acknowledged.pending_operation !== 'cleanup'
          || acknowledged.operation_nonce !== nonce) {
          sessionFail('COMPANION_STORE_CORRUPT', 'managed cleanup acknowledgement differs');
        }
        return sessionMutationReceipt({
          operation: 'remove', status: 'recovery_pending',
          record: acknowledged, recoveryPending: true,
        });
      }
      if (isAcknowledgementUnknown(error)) throw error;
      if (error?.authority_possible === false) {
        const restored = publishTransition(store, transitionRecord(record, 'active', options), options);
        if (!restored.recovery_pending) throw error;
        sessionFail('BROWSER_SESSION_CLEANUP_REQUIRED', 'managed cleanup rollback durability is pending');
      }
      record = publishTransition(store, transitionRecord(record, 'cleanup_required', options), options).record;
      return sessionMutationReceipt({ operation: 'remove', status: 'cleanup_required', record, cleanupRequired: true, recoveryPending: true });
    }
    const closed = publishTransition(store, transitionRecord(record, 'closed', options), options);
    if (closed.recovery_pending) return sessionMutationReceipt({ operation: 'remove', status: 'recovery_pending', record: closed.record, recoveryPending: true });
    return finalRemoval(store, closed.record, env, current, heldLock, options);
  }, { hooks: options.hooks });
}

async function executeWithIntent(store, record, operation, input, heldLock, options) {
  const nonce = operationNonce();
  const operating = publishTransition(store, transitionRecord(record, 'operating', options, { operation, nonce }), options);
  if (operating.recovery_pending) sessionFail('BROWSER_SESSION_CLEANUP_REQUIRED', 'managed operation intent durability is pending');
  try {
    let committed;
    const worker = await runManagedWorker(store, operating.record, operation, input, {
      ...options,
      lockOwner: heldLock,
      acknowledge: () => {
        committed = acknowledgeOperation(store, operating.record, operation, nonce, options);
        return committed;
      },
    });
    return { record: operating.record, committed, worker, nonce };
  } catch (error) {
    const pending = exactWorkerCommit(error, operating.record, operation, nonce);
    if (pending) {
      return {
        record: operating.record,
        committed: pending.publication,
        worker: pending.pending.value,
        nonce,
        recovery_pending: true,
      };
    }
    if (isAcknowledgementUnknown(error)) throw error;
    const state = error?.authority_possible === false ? 'active' : 'cleanup_required';
    publishTransition(store, transitionRecord(operating.record, state, options), options);
    throw error;
  }
}

function acknowledgeOperation(store, record, operation, nonce, options) {
  return publishTransition(
    store, transitionRecord(record, 'operation_committed', options, { operation, nonce }), options,
  );
}

function finishOperation(store, committed, options) {
  if (!committed || committed.recovery_pending) {
    sessionFail('BROWSER_SESSION_CLEANUP_REQUIRED', 'managed operation acknowledgement durability is pending');
  }
  return publishTransition(store, transitionRecord(committed.record, 'active', options), options);
}

export async function executeManagedSessionOperation(sessionId, operation, input = {}, options = {}) {
  const env = options.env ?? process.env;
  const current = options.current ?? loadSourceDescriptor({ repoRoot: options.repoRoot });
  validateSessionId(sessionId);
  const validatedInput = validateManagedOperationInput(operation, input);
  return withStoreLock(env, async (store, heldLock) => {
    recoverCreations(store, options);
    retireEmptyLegacySessions(store);
    inspectSessionStore(env, current, heldLock);
    let record = readSession(store, sessionId);
    if (!record) sessionFail('BROWSER_SESSION_NOT_FOUND', 'managed session is absent');
    record = recoverRecord(store, record, options);
    if (record.state !== 'active') sessionFail('BROWSER_SESSION_NOT_ACTIVE', 'managed session is not active');
    const executed = await executeWithIntent(store, record, operation, validatedInput, heldLock, options);
    if (executed.recovery_pending) {
      return Object.freeze({
        receipt: sessionOperationReceipt(operation, executed.committed.record, true),
        worker: executed.worker,
      });
    }
    const completion = finishOperation(store, executed.committed, options);
    return Object.freeze({
      receipt: sessionOperationReceipt(operation, completion.record, completion.recovery_pending), worker: executed.worker,
    });
  }, { hooks: options.hooks });
}

export async function captureManagedBrowserEvidence(sessionId, input, options = {}) {
  const env = options.env ?? process.env;
  const current = options.current ?? loadSourceDescriptor({ repoRoot: options.repoRoot });
  validateSessionId(sessionId);
  return withStoreLock(env, async (store, heldLock) => {
    recoverCreations(store, options);
    retireEmptyLegacySessions(store);
    inspectSessionStore(env, current, heldLock);
    let record = readSession(store, sessionId);
    if (!record) sessionFail('BROWSER_SESSION_NOT_FOUND', 'managed session is absent');
    record = recoverRecord(store, record, options);
    if (record.state !== 'active') sessionFail('BROWSER_SESSION_NOT_ACTIVE', 'managed session is not active');
    return executeEvidenceWorkers(store, heldLock, record, input, options);
  }, { hooks: options.hooks });
}
