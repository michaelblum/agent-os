import crypto from 'node:crypto';

import { loadSourceDescriptor } from './descriptor.mjs';
import { fail } from './errors.mjs';
import { requireChromeExtensionProfile } from './extension-profile.mjs';
import {
  clearSessionCreateIntent,
  listSessionCreateIntents,
  publishSessionCreateIntent,
} from './session-intent.mjs';
import { withStoreLock } from './store-lock.mjs';
import { inspectManagedState } from './store-state.mjs';
import { sessionFail, validateSessionId, validateSessionRecord } from './session-model.mjs';
import { runManagedWorker } from './session-runner.mjs';
import {
  isAcknowledgementUnknown,
  workerPendingDetails,
} from './session-worker-pending.mjs';
import { recoverGuardianOutcomes } from './session-guardian-recovery.mjs';
import {
  cleanupClosedSession,
  cleanupPreparedSessionWorkspace,
  createSessionWorkspace,
  inspectLegacySessions,
  listSessions,
  readSession,
  retireEmptyLegacySessions,
  sessionWorkspace,
} from './session-store.mjs';
import {
  publishTransition,
  operationNonce,
  sessionMutationReceipt,
  sessionNow,
  transitionRecord,
} from './session-transitions.mjs';

function currentRuntimeBinding(env, current, heldLock) {
  const view = inspectManagedState(env, current.digest, { heldLock });
  if (!view.store || !view.active || !view.validated) sessionFail('BROWSER_SESSION_NOT_ACTIVE', 'managed runtime is not installed');
  if (view.active.descriptor_sha256 !== current.digest) fail('COMPANION_UPDATE_REQUIRED', 'managed runtime requires update');
  return Object.freeze({ active: view.active, validated: view.validated });
}

function validateCreateSpec(spec) {
  if (!spec || !['launched', 'attached'].includes(spec.kind)) sessionFail('BROWSER_SESSION_INVALID', 'session kind is invalid');
  if (spec.kind === 'attached') {
    if (!['cdp', 'extension'].includes(spec.attach_kind)) sessionFail('BROWSER_SESSION_INVALID', 'attach kind is invalid');
    if (spec.attach_kind === 'cdp' && typeof spec.cdp_url !== 'string') sessionFail('BROWSER_SESSION_INVALID', 'CDP URL is required');
    if (spec.attach_kind === 'extension' && spec.cdp_url !== undefined) sessionFail('BROWSER_SESSION_INVALID', 'extension attach forbids CDP URL');
  } else if (spec.attach_kind !== undefined || spec.cdp_url !== undefined || (spec.url !== undefined && typeof spec.url !== 'string')) {
    sessionFail('BROWSER_SESSION_INVALID', 'launched session arguments differ');
  }
  const candidate = spec.kind === 'attached' ? spec.cdp_url : spec.url;
  if (candidate !== undefined) {
    try {
      if (Buffer.byteLength(candidate) > 4096) throw new Error('length');
      const allowed = spec.kind === 'attached' ? ['http:', 'https:', 'ws:', 'wss:'] : ['http:', 'https:', 'data:', 'about:'];
      if (!allowed.includes(new URL(candidate).protocol)) throw new Error('protocol');
    } catch {
      sessionFail('BROWSER_SESSION_INVALID', spec.kind === 'attached' ? 'CDP URL is invalid' : 'initial URL is invalid');
    }
  }
  return spec;
}

function makeRecord(sessionId, binding, spec, options) {
  const generation = crypto.randomBytes(16).toString('hex');
  const timestamp = sessionNow(options);
  const attached = spec.kind === 'attached';
  return validateSessionRecord({
    schema_version: 'aos.browser.companion-session.v1', session_id: validateSessionId(sessionId), generation,
    upstream_session_id: `aos-${crypto.randomBytes(16).toString('hex')}`, state: 'starting',
    ownership: attached ? 'attached' : 'launched', attach_kind: attached ? spec.attach_kind : null,
    headless: attached ? null : spec.headless === true, persistent: attached ? false : spec.persistent === true,
    version_key: binding.active.version_key, version: binding.active.version,
    descriptor_sha256: binding.active.descriptor_sha256, closure_sha256: binding.active.closure_sha256,
    entrypoint: binding.validated.descriptor.entrypoint, workspace: `${sessionId}-${generation}`,
    cleanup_operation: attached ? 'detach' : 'close', pending_operation: null, operation_nonce: null,
    created_at: timestamp, updated_at: timestamp,
  });
}

function clearCreationIntent(store, intent, options) {
  return clearSessionCreateIntent(store, intent, {
    beforeUnlink: options.hooks?.beforeSessionIntentUnlink,
    afterUnlink: options.hooks?.afterSessionIntentUnlink,
    syncDirectory: options.hooks?.syncSessionIntentDirectory,
  });
}

function recoverNoAuthorityCreation(store, intent, options) {
  const planned = intent.record;
  let record = readSession(store, planned.session_id);
  if (record && record.generation !== planned.generation) {
    fail('COMPANION_STORE_CORRUPT', 'managed session rollback conflicts with a lease');
  }
  if (record && record.state === 'starting') {
    const closed = publishTransition(store, transitionRecord(record, 'closed', options), options);
    record = closed.record;
    if (closed.recovery_pending) return Object.freeze({ recovery_pending: true });
  } else if (record && record.state !== 'closed') {
    fail('COMPANION_STORE_CORRUPT', 'managed session rollback lease differs');
  }
  const workspace = cleanupPreparedSessionWorkspace(store, planned, options.hooks ?? {});
  if (workspace.recovery_pending) return workspace;
  if (record) {
    const cleanup = cleanupClosedSession(store, record, options.hooks ?? {});
    if (cleanup.recovery_pending) return cleanup;
  }
  return clearCreationIntent(store, intent, options);
}

export function recoverSessionCreations(store, options = {}) {
  const guardian = recoverGuardianOutcomes(store, options);
  if (guardian.recovery_pending) return guardian;
  let recoveryPending = false;
  for (const intent of listSessionCreateIntents(store)) {
    const planned = intent.record;
    let record = readSession(store, planned.session_id);
    if (record && record.generation !== planned.generation) fail('COMPANION_STORE_CORRUPT', 'managed session creation intent conflicts with a lease');
    if (['prepared', 'rollback_no_authority'].includes(intent.phase)) {
      if (recoverNoAuthorityCreation(store, intent, options).recovery_pending) recoveryPending = true;
      continue;
    }
    if (record?.state === 'closed') {
      const workspace = cleanupPreparedSessionWorkspace(store, planned, options.hooks ?? {});
      if (workspace.recovery_pending) { recoveryPending = true; continue; }
      const cleanup = cleanupClosedSession(store, record, options.hooks ?? {});
      if (cleanup.recovery_pending) { recoveryPending = true; continue; }
      const cleared = clearCreationIntent(store, intent, options);
      recoveryPending ||= cleared.recovery_pending;
      continue;
    }
    sessionWorkspace(store, planned);
    if (!record) {
      const published = publishTransition(store, planned, options);
      record = published.record;
      if (published.recovery_pending) { recoveryPending = true; continue; }
    }
    const nextState = intent.phase === 'acknowledged' ? 'active' : 'cleanup_required';
    if (record.state === 'starting') {
      const recovered = publishTransition(store, transitionRecord(record, nextState, options), options);
      record = recovered.record;
      if (recovered.recovery_pending) { recoveryPending = true; continue; }
    } else if (![nextState, 'cleanup_required', 'closed'].includes(record.state)) {
      fail('COMPANION_STORE_CORRUPT', 'managed session creation intent state differs');
    }
    const cleared = clearCreationIntent(store, intent, options);
    recoveryPending ||= cleared.recovery_pending;
  }
  return Object.freeze({ recovery_pending: recoveryPending });
}

export async function createManagedSession(sessionId, spec, options = {}) {
  const env = options.env ?? process.env;
  const current = options.current ?? loadSourceDescriptor({ repoRoot: options.repoRoot });
  validateSessionId(sessionId);
  validateCreateSpec(spec);
  return withStoreLock(env, async (store, heldLock) => {
    if (recoverSessionCreations(store, options).recovery_pending) {
      sessionFail('BROWSER_SESSION_CLEANUP_REQUIRED', 'managed session creation recovery is pending');
    }
    inspectLegacySessions(store.paths.browser);
    if (readSession(store, sessionId)) sessionFail('BROWSER_SESSION_EXISTS', 'managed session already exists');
    if (listSessions(store).length >= 128) sessionFail('BROWSER_SESSION_LIMIT', 'managed session capacity is full');
    const binding = currentRuntimeBinding(env, current, heldLock);
    const extensionUserDataDir = spec.kind === 'attached' && spec.attach_kind === 'extension'
      ? requireChromeExtensionProfile({ userHome: options.userHome, platform: options.platform }) : null;
    retireEmptyLegacySessions(store);
    let record = makeRecord(sessionId, binding, spec, options);
    const startNonce = operationNonce();
    let intent = publishSessionCreateIntent(store, record, 'prepared', {
      afterRename: options.hooks?.afterSessionIntentRename,
      beforeReconcile: options.hooks?.beforeSessionIntentReconcile,
    });
    if (intent.recovery_pending) return sessionMutationReceipt({ operation: 'create', status: 'recovery_pending', record, recoveryPending: true });
    createSessionWorkspace(store, record, {
      afterDirectory: options.hooks?.afterSessionWorkspaceDirectory,
    });
    options.hooks?.afterSessionWorkspace?.(record);
    const starting = publishTransition(store, record, options);
    if (starting.recovery_pending) return sessionMutationReceipt({ operation: 'create', status: 'recovery_pending', record: starting.record, recoveryPending: true });
    intent = publishSessionCreateIntent(store, record, 'authority_possible', {
      guardian: { operation: 'start', nonce: startNonce },
      afterRename: options.hooks?.afterSessionIntentRename,
      beforeReconcile: options.hooks?.beforeSessionIntentReconcile,
    });
    if (intent.recovery_pending) return sessionMutationReceipt({ operation: 'create', status: 'cleanup_required', record, cleanupRequired: true, recoveryPending: true });
    try {
      await runManagedWorker(store, record, 'start', spec, {
        ...options, extensionUserDataDir, lockOwner: heldLock, guardianNonce: startNonce,
        acknowledge: () => {
          intent = publishSessionCreateIntent(store, record, 'acknowledged', {
            guardian: { operation: 'start', nonce: startNonce },
            afterRename: options.hooks?.afterSessionIntentRename,
            beforeReconcile: options.hooks?.beforeSessionIntentReconcile,
          });
          return intent;
        },
      });
    } catch (error) {
      const pending = workerPendingDetails(error);
      if (pending) {
        const acknowledged = pending.acknowledgement;
        if (acknowledged?.intent?.phase !== 'acknowledged'
          || acknowledged.intent.record.session_id !== record.session_id
          || acknowledged.intent.record.generation !== record.generation
          || acknowledged.intent.guardian_operation !== 'start'
          || acknowledged.intent.guardian_nonce !== startNonce) {
          fail('COMPANION_STORE_CORRUPT', 'managed creation acknowledgement differs');
        }
        intent = acknowledged;
        return sessionMutationReceipt({
          operation: 'create', status: 'recovery_pending', record, recoveryPending: true,
        });
      }
      if (isAcknowledgementUnknown(error)) throw error;
      if (error?.authority_possible === false) {
        intent = publishSessionCreateIntent(store, record, 'rollback_no_authority', {
          guardian: { operation: 'start', nonce: startNonce },
          afterRename: options.hooks?.afterSessionIntentRename,
          beforeReconcile: options.hooks?.beforeSessionIntentReconcile,
        });
        if (intent.recovery_pending) {
          return sessionMutationReceipt({ operation: 'create', status: 'recovery_pending', record, recoveryPending: true });
        }
        options.hooks?.afterRollbackIntent?.(intent.intent);
        const rollback = recoverNoAuthorityCreation(store, intent.intent, options);
        if (rollback.recovery_pending) return sessionMutationReceipt({ operation: 'create', status: 'recovery_pending', record, recoveryPending: true });
        throw error;
      }
      const cleanupRequired = publishTransition(store, transitionRecord(record, 'cleanup_required', options), options);
      record = cleanupRequired.record;
      if (!cleanupRequired.recovery_pending) clearCreationIntent(store, intent.intent, options);
      return sessionMutationReceipt({ operation: 'create', status: 'cleanup_required', record, cleanupRequired: true, recoveryPending: true });
    }
    const active = publishTransition(store, transitionRecord(record, 'active', options), options);
    if (active.recovery_pending) {
      return sessionMutationReceipt({ operation: 'create', status: 'recovery_pending', record: active.record, recoveryPending: true });
    }
    const cleared = clearCreationIntent(store, intent.intent, options);
    const recoveryPending = cleared.recovery_pending;
    return sessionMutationReceipt({ operation: 'create', status: recoveryPending ? 'recovery_pending' : 'active', record: active.record, recoveryPending });
  }, { hooks: options.hooks });
}

export { currentRuntimeBinding, validateCreateSpec };
