import { sessionFail, validateSessionRecord } from './session-model.mjs';
import { validateManagedOperationInput, runManagedWorker } from './session-runner.mjs';
import {
  isAcknowledgementUnknown,
  workerPendingDetails,
} from './session-worker-pending.mjs';
import { consumeEvidenceAck, publishEvidenceAck } from './session-evidence-ack.mjs';
import {
  operationNonce,
  publishTransition,
  sessionOperationReceipt,
  transitionRecord,
} from './session-transitions.mjs';

function acknowledgeOperation(store, record, nonce, options) {
  return publishTransition(
    store,
    transitionRecord(record, 'operation_committed', options, {
      operation: 'evidence_capture',
      nonce,
    }),
    options,
  );
}

function finishOperation(store, committed, options) {
  if (!committed || committed.recovery_pending) {
    sessionFail('BROWSER_SESSION_CLEANUP_REQUIRED', 'managed evidence acknowledgement durability is pending');
  }
  return publishTransition(store, transitionRecord(committed.record, 'active', options), options);
}

export async function executeEvidenceWorkers(store, heldLock, record, input, options) {
  const nonce = operationNonce();
  const operating = publishTransition(
    store,
    transitionRecord(record, 'operating', options, { operation: 'evidence_capture', nonce }),
    options,
  );
  if (operating.recovery_pending) {
    sessionFail('BROWSER_SESSION_CLEANUP_REQUIRED', 'managed evidence intent durability is pending');
  }

  let journal = null;
  let committed = null;
  let query = null;
  let screenshot = null;
  const acknowledgeStep = (step, phase) => {
    const published = publishEvidenceAck(
      store,
      heldLock,
      operating.record,
      nonce,
      journal,
      step,
      phase,
      {
        afterRename: options.hooks?.afterEvidenceAckRename,
        beforeReconcile: options.hooks?.beforeEvidenceAckReconcile,
      },
    );
    journal = published.ack;
    if (published.recovery_pending || phase !== 'acknowledged') return published;
    committed = acknowledgeOperation(store, operating.record, nonce, options);
    return committed;
  };

  try {
    const workerOptions = { ...options, lockOwner: heldLock };
    if (input?.url !== undefined) {
      await runManagedWorker(
        store,
        operating.record,
        'navigate',
        validateManagedOperationInput('navigate', { url: input.url }),
        { ...workerOptions, acknowledge: () => acknowledgeStep('navigate', 'progress') },
      );
    }
    query = await runManagedWorker(
      store,
      operating.record,
      'evidence_query',
      { candidates: input?.candidates },
      {
        ...workerOptions,
        acknowledge: (value) => acknowledgeStep(
          'evidence_query',
          value.result.status === 'captured' ? 'progress' : 'acknowledged',
        ),
      },
    );
    screenshot = query.result.status === 'captured'
      ? await runManagedWorker(
        store,
        operating.record,
        'screenshot',
        {},
        { ...workerOptions, acknowledge: () => acknowledgeStep('screenshot', 'acknowledged') },
      )
      : null;
    const completion = finishOperation(store, committed, options);
    if (completion.recovery_pending) {
      return Object.freeze({
        receipt: sessionOperationReceipt('evidence_capture', completion.record, true),
        result: query.result,
        screenshot: screenshot?.artifact ?? null,
      });
    }
    const consumed = consumeEvidenceAck(store, journal, {
      beforeUnlink: options.hooks?.beforeEvidenceAckUnlink,
      afterUnlink: options.hooks?.afterEvidenceAckUnlink,
    });
    return Object.freeze({
      receipt: sessionOperationReceipt('evidence_capture', completion.record, consumed.recovery_pending),
      result: query.result,
      screenshot: screenshot?.artifact ?? null,
    });
  } catch (error) {
    const pending = workerPendingDetails(error);
    if (pending) {
      if (pending.acknowledgement?.record) {
        const acknowledged = validateSessionRecord(pending.acknowledgement.record);
        if (acknowledged.session_id !== operating.record.session_id
          || acknowledged.generation !== operating.record.generation
          || acknowledged.state !== 'operation_committed'
          || acknowledged.pending_operation !== 'evidence_capture'
          || acknowledged.operation_nonce !== nonce
          || journal?.phase !== 'acknowledged') {
          sessionFail('COMPANION_STORE_CORRUPT', 'managed evidence final acknowledgement differs');
        }
        const result = query?.result ?? pending.value.result;
        const artifact = screenshot?.artifact ?? pending.value.artifact ?? null;
        return Object.freeze({
          receipt: sessionOperationReceipt('evidence_capture', acknowledged, true),
          result,
          screenshot: artifact,
        });
      }
      if (pending.acknowledgement?.ack) {
        journal = pending.acknowledgement.ack;
        publishTransition(store, transitionRecord(operating.record, 'cleanup_required', options), options);
        sessionFail('BROWSER_SESSION_CLEANUP_REQUIRED', 'managed evidence progress recovery is pending');
      }
      sessionFail('COMPANION_STORE_CORRUPT', 'managed evidence acknowledgement differs');
    }
    if (isAcknowledgementUnknown(error)) throw error;
    if (committed) {
      sessionFail('BROWSER_SESSION_CLEANUP_REQUIRED', 'managed evidence completion recovery is pending');
    }
    const state = journal || error?.authority_possible !== false ? 'cleanup_required' : 'active';
    publishTransition(store, transitionRecord(operating.record, state, options), options);
    throw error;
  }
}
