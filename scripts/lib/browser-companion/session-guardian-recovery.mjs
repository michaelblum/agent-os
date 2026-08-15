import { fail } from './errors.mjs';
import {
  clearSessionCreateIntent,
  listSessionCreateIntents,
  publishSessionCreateIntent,
} from './session-intent.mjs';
import {
  cleanupClosedSession,
  cleanupPreparedSessionWorkspace,
  publishSession,
  readSession,
  sessionWorkspace,
} from './session-store.mjs';
import {
  consumeEvidenceAck,
  listEvidenceAcks,
} from './session-evidence-ack.mjs';
import {
  publishTransition,
  transitionRecord,
} from './session-transitions.mjs';
import {
  consumeGuardianOutcome,
  listGuardianOutcomes,
} from './worker-guardian-outcome.mjs';

function clearIntent(store, intent, options) {
  return clearSessionCreateIntent(store, intent, {
    beforeUnlink: options.hooks?.beforeSessionIntentUnlink,
    afterUnlink: options.hooks?.afterSessionIntentUnlink,
    syncDirectory: options.hooks?.syncSessionIntentDirectory,
  });
}

function consumeOutcome(store, outcome, options) {
  return consumeGuardianOutcome(store, outcome, {
    beforeUnlink: options.hooks?.beforeGuardianOutcomeUnlink,
    afterUnlink: options.hooks?.afterGuardianOutcomeUnlink,
  });
}

function recoverNoAuthorityCreation(store, intent, outcome, options) {
  let rollback = intent;
  if (intent.phase !== 'rollback_no_authority') {
    const published = publishSessionCreateIntent(store, intent.record, 'rollback_no_authority', {
      guardian: { operation: outcome.operation, nonce: outcome.nonce },
      afterRename: options.hooks?.afterSessionIntentRename,
      beforeReconcile: options.hooks?.beforeSessionIntentReconcile,
    });
    if (published.recovery_pending) return published;
    rollback = published.intent;
  }
  options.hooks?.afterGuardianRollbackIntent?.(rollback);
  let record = readSession(store, rollback.record.session_id);
  if (record && record.generation !== rollback.record.generation) {
    fail('COMPANION_STORE_CORRUPT', 'guardian rollback conflicts with a managed session');
  }
  if (record && record.state === 'starting') {
    const closed = publishTransition(store, transitionRecord(record, 'closed', options), options);
    if (closed.recovery_pending) return closed;
    record = closed.record;
  } else if (record && record.state !== 'closed') {
    fail('COMPANION_STORE_CORRUPT', 'guardian rollback session state differs');
  }
  const workspace = cleanupPreparedSessionWorkspace(store, rollback.record, options.hooks ?? {});
  if (workspace.recovery_pending) return workspace;
  if (record) {
    const cleanup = cleanupClosedSession(store, record, options.hooks ?? {});
    if (cleanup.recovery_pending) return cleanup;
  }
  const cleared = clearIntent(store, rollback, options);
  if (cleared.recovery_pending) return cleared;
  return consumeOutcome(store, outcome, options);
}

function recoverPossibleCreation(store, intent, outcome, options) {
  let record = readSession(store, intent.record.session_id);
  if (record && record.generation !== intent.record.generation) {
    fail('COMPANION_STORE_CORRUPT', 'guardian outcome conflicts with a managed session');
  }
  sessionWorkspace(store, intent.record);
  if (!record) {
    const published = publishSession(store, intent.record, options);
    if (published.recovery_pending) return published;
    record = published.record;
  }
  if (intent.phase === 'acknowledged') {
    if (outcome.source_phase !== 'complete' || outcome.terminal_kind !== 'exited'
      || !outcome.worker_spawned) {
      fail('COMPANION_STORE_CORRUPT', 'acknowledged creation guardian outcome differs');
    }
    if (record.state === 'starting') {
      const active = publishTransition(store, transitionRecord(record, 'active', options), options);
      if (active.recovery_pending) return active;
    } else if (record.state !== 'active') {
      fail('COMPANION_STORE_CORRUPT', 'acknowledged creation session state differs');
    }
    return consumeOutcome(store, outcome, options);
  }
  if (record.state === 'starting') {
    const required = publishTransition(store, transitionRecord(record, 'cleanup_required', options), options);
    if (required.recovery_pending) return required;
    record = required.record;
  } else if (!['cleanup_required', 'closed'].includes(record.state)) {
    fail('COMPANION_STORE_CORRUPT', 'guardian outcome session state differs');
  }
  const cleared = clearIntent(store, intent, options);
  if (cleared.recovery_pending) return cleared;
  options.hooks?.afterGuardianCleanupRequired?.(record);
  return consumeOutcome(store, outcome, options);
}

function operationMatches(pending, actual) {
  if (pending === actual) return true;
  return pending === 'evidence_capture' && ['navigate', 'evidence_query', 'screenshot'].includes(actual);
}

function alreadyAppliedOutcome(record, outcome) {
  if (record.operation_nonce !== null) return false;
  if (outcome.authority === 'authority_possible' && record.state === 'cleanup_required') return true;
  if (outcome.authority === 'no_authority') {
    return outcome.operation !== 'start' && record.state === 'active';
  }
  if (outcome.operation === 'cleanup') return record.state === 'closed';
  return record.state === 'active';
}

function recoverOperation(store, record, outcome, evidenceAcks, options) {
  if (record.generation !== outcome.generation) fail('COMPANION_STORE_CORRUPT', 'guardian outcome generation differs');
  if (record.operation_nonce === null) {
    if (!alreadyAppliedOutcome(record, outcome)) {
      fail('COMPANION_STORE_CORRUPT', 'guardian outcome lacks a durable operation binding');
    }
    return consumeOutcome(store, outcome, options);
  }
  if (record.operation_nonce !== outcome.nonce || !operationMatches(record.pending_operation, outcome.operation)) {
    fail('COMPANION_STORE_CORRUPT', 'guardian outcome operation binding differs');
  }
  const evidence = record.pending_operation === 'evidence_capture'
    ? evidenceAcks.find((candidate) => candidate.session_id === record.session_id
      && candidate.generation === record.generation && candidate.operation_nonce === record.operation_nonce)
    : null;
  if (evidence && evidence.lock_token !== outcome.lock_token) {
    fail('COMPANION_STORE_CORRUPT', 'managed evidence guardian lock binding differs');
  }
  const acknowledged = record.state === 'operation_committed' || record.state === 'cleanup_committed';
  if (acknowledged && (outcome.source_phase !== 'complete' || outcome.terminal_kind !== 'exited'
    || !outcome.worker_spawned)) {
    fail('COMPANION_STORE_CORRUPT', 'acknowledged guardian outcome differs');
  }
  const state = record.state === 'operation_committed' ? 'active'
    : record.state === 'cleanup_committed' ? 'closed'
      : evidence || outcome.authority !== 'no_authority' ? 'cleanup_required' : 'active';
  const recovered = publishTransition(store, transitionRecord(record, state, options), options);
  if (recovered.recovery_pending) return recovered;
  options.hooks?.afterGuardianOperationRecovery?.(recovered.record, outcome);
  return consumeOutcome(store, outcome, options);
}

function recoverEvidenceAcks(store, options) {
  let recoveryPending = false;
  for (const ack of listEvidenceAcks(store)) {
    const record = readSession(store, ack.session_id);
    if (!record || record.generation !== ack.generation) {
      fail('COMPANION_STORE_CORRUPT', 'managed evidence acknowledgement lacks its session');
    }
    let settled = record;
    if (record.operation_nonce !== null) {
      if (record.pending_operation !== 'evidence_capture' || record.operation_nonce !== ack.operation_nonce) {
        fail('COMPANION_STORE_CORRUPT', 'managed evidence acknowledgement operation differs');
      }
      const state = record.state === 'operation_committed' && ack.phase === 'acknowledged'
        ? 'active' : 'cleanup_required';
      const published = publishTransition(store, transitionRecord(record, state, options), options);
      if (published.recovery_pending) { recoveryPending = true; continue; }
      settled = published.record;
    } else if (record.state === 'active' && ack.phase !== 'acknowledged') {
      fail('COMPANION_STORE_CORRUPT', 'managed evidence settled phase differs');
    } else if (!['active', 'cleanup_required'].includes(record.state)) {
      fail('COMPANION_STORE_CORRUPT', 'managed evidence acknowledgement settled state differs');
    }
    options.hooks?.afterEvidenceAckRecovery?.(settled, ack);
    const consumed = consumeEvidenceAck(store, ack, {
      beforeUnlink: options.hooks?.beforeEvidenceAckUnlink,
      afterUnlink: options.hooks?.afterEvidenceAckUnlink,
    });
    recoveryPending ||= consumed.recovery_pending;
  }
  return Object.freeze({ recovery_pending: recoveryPending });
}

export function recoverGuardianOutcomes(store, options = {}) {
  let recoveryPending = false;
  const evidenceAcks = listEvidenceAcks(store);
  for (const outcome of listGuardianOutcomes(store)) {
    const intents = listSessionCreateIntents(store);
    const intent = intents.find((candidate) => candidate.record.session_id === outcome.session_id
      && candidate.record.generation === outcome.generation);
    let recovered;
    if (outcome.operation === 'start' && intent) {
      if (intent.guardian_operation !== outcome.operation || intent.guardian_nonce !== outcome.nonce) {
        fail('COMPANION_STORE_CORRUPT', 'guardian outcome creation binding differs');
      }
      recovered = outcome.authority === 'no_authority'
        ? recoverNoAuthorityCreation(store, intent, outcome, options)
        : recoverPossibleCreation(store, intent, outcome, options);
    } else {
      const record = readSession(store, outcome.session_id);
      if (!record) {
        if (outcome.operation === 'start' && outcome.authority === 'no_authority') {
          recovered = consumeOutcome(store, outcome, options);
        } else fail('COMPANION_STORE_CORRUPT', 'guardian outcome lacks its managed session');
      } else recovered = recoverOperation(store, record, outcome, evidenceAcks, options);
    }
    recoveryPending ||= recovered.recovery_pending;
  }
  if (recoveryPending) return Object.freeze({ recovery_pending: true });
  return recoverEvidenceAcks(store, options);
}
