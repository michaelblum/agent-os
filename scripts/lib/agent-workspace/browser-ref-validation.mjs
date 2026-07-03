import { spawnSync } from 'node:child_process';
import {
  aosPath,
  exitAgentWorkspaceError,
  runtimeMode,
  stateRoot,
} from './core.mjs';
import {
  browserIdentityComparable,
  browserIdentityComplete,
  queryBrowserPageIdentity,
} from './browser-identity.mjs';
import { refSummary } from './refs.mjs';
import {
  savedRefBackendSupportsAction,
  savedRefProducerActionsForBrowserElement,
} from './contracts.mjs';
import {
  failIncompatibleDragEndpoint,
  recommendedRefreshCommand,
} from './ref-action-resolution.mjs';

export function parseBrowserActionTarget(value) {
  if (!value?.startsWith?.('browser:')) return null;
  const remainder = value.slice('browser:'.length);
  const slash = remainder.indexOf('/');
  if (slash <= 0 || slash === remainder.length - 1) return null;
  return {
    session: remainder.slice(0, slash),
    ref: remainder.slice(slash + 1),
  };
}

function compactBrowserElement(element) {
  return {
    ref: element.ref ?? null,
    role: element.role ?? null,
    title: element.title ?? null,
    label: element.label ?? null,
    context_path: element.context_path ?? [],
    enabled: element.enabled ?? null,
    bounds: element.bounds ?? null,
    supported_actions: savedRefProducerActionsForBrowserElement(element),
  };
}

function normalizedText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function optionalTextMatches(expected, actual) {
  const saved = normalizedText(expected);
  if (!saved) return true;
  return saved === normalizedText(actual);
}

function contextPathMatches(expected, actual) {
  if (!Array.isArray(expected) || expected.length === 0) return true;
  if (!Array.isArray(actual)) return false;
  return JSON.stringify(expected) === JSON.stringify(actual);
}

function browserCurrentMismatch(record, current) {
  if (!optionalTextMatches(record.identity_facts?.role ?? record.hint_facts?.role, current.role)) return 'role_changed';
  if (!optionalTextMatches(record.identity_facts?.title ?? record.hint_facts?.title, current.title)) return 'title_changed';
  if (!optionalTextMatches(record.identity_facts?.label ?? record.hint_facts?.label, current.label)) return 'label_changed';
  if (!contextPathMatches(record.identity_facts?.context_path, current.context_path)) return 'context_changed';
  return null;
}

function browserIdentityMismatch(record, currentIdentity) {
  if (!record.identity_facts?.session) return 'missing_saved_session';
  if (!browserIdentityComplete(currentIdentity)) return 'missing_current_page_identity';
  const expected = {
    session: normalizedText(record.identity_facts.session),
    page_url: normalizedText(record.identity_facts.page_url),
    frame_url: normalizedText(record.identity_facts.frame_url),
    top_frame_url: normalizedText(record.identity_facts.top_frame_url),
    document_title: normalizedText(record.identity_facts.document_title),
  };
  for (const key of ['page_url', 'frame_url', 'top_frame_url']) {
    if (!expected[key]) return `missing_saved_${key}`;
    if (expected[key] !== normalizedText(currentIdentity[key])) return `${key}_changed`;
  }
  if (expected.session !== normalizedText(currentIdentity.session)) return 'session_changed';
  if (expected.document_title && expected.document_title !== normalizedText(currentIdentity.document_title)) {
    return 'document_title_changed';
  }
  return null;
}

function currentBrowserIdentity(session, env, identityCache) {
  if (identityCache.has(session)) return identityCache.get(session);
  const identity = browserIdentityComparable(queryBrowserPageIdentity(session, env));
  identityCache.set(session, identity);
  return identity;
}

function isAgentWorkspaceParseError(error) {
  return error?.name === 'AgentWorkspaceError';
}

function currentBrowserCapture(session, workspace, record, env) {
  const result = spawnSync(aosPath(env), ['__see', 'capture', `browser:${session}`, '--xray'], {
    encoding: 'utf8',
    env: {
      ...env,
      AOS_RUNTIME_MODE: runtimeMode(env),
      AOS_STATE_ROOT: stateRoot(env),
    },
    maxBuffer: 100 * 1024 * 1024,
  });
  if (result.status !== 0) {
    exitAgentWorkspaceError('Browser ref validation capture failed', 'REF_REVALIDATION_FAILED', {
      status: 'known_limit',
      backend: 'browser',
      known_limit: 'current browser xray capture failed during saved-ref validation',
      safe_next_action: recommendedRefreshCommand(workspace, record),
      recommended_next_command: recommendedRefreshCommand(workspace, record),
      requires_user_approval: false,
      stderr: result.stderr || null,
    });
  }
  try {
    const capture = JSON.parse(result.stdout);
    if (!Array.isArray(capture.elements)) {
      exitAgentWorkspaceError('Browser ref validation capture did not include elements', 'REF_REVALIDATION_FAILED', {
        status: 'known_limit',
        backend: 'browser',
        known_limit: 'current browser xray capture returned no element list',
        safe_next_action: recommendedRefreshCommand(workspace, record),
        recommended_next_command: recommendedRefreshCommand(workspace, record),
        requires_user_approval: false,
      });
    }
    return capture;
  } catch (error) {
    if (isAgentWorkspaceParseError(error)) throw error;
    exitAgentWorkspaceError('Browser ref validation capture did not return JSON', 'REF_REVALIDATION_FAILED', {
      status: 'known_limit',
      backend: 'browser',
      known_limit: 'current browser xray capture returned invalid JSON',
      safe_next_action: recommendedRefreshCommand(workspace, record),
      recommended_next_command: recommendedRefreshCommand(workspace, record),
      requires_user_approval: false,
    });
  }
}

export function validateBrowserCurrentRef(record, action, workspace, env, captureCache = new Map(), identityCache = new Map()) {
  if (!savedRefBackendSupportsAction('browser', action)) return null;
  const target = parseBrowserActionTarget(record.action_target);
  const sourceRef = record.identity_facts?.source_ref || target?.ref || null;
  if (!target || !sourceRef) return null;
  if (record.identity_facts?.session && record.identity_facts.session !== target.session) {
    exitAgentWorkspaceError(`Browser ref '${record.ref}' session identity changed`, 'REF_STALE', {
      status: 'stale_ref',
      reason: 'session_changed',
      backend: 'browser',
      ref: refSummary(record),
      safe_next_action: recommendedRefreshCommand(workspace, record),
      recommended_next_command: recommendedRefreshCommand(workspace, record),
      requires_user_approval: false,
    });
  }

  let capture = captureCache.get(target.session);
  if (!capture) {
    capture = currentBrowserCapture(target.session, workspace, record, env);
    captureCache.set(target.session, capture);
  }
  const pageIdentity = currentBrowserIdentity(target.session, env, identityCache);
  const identityMismatch = browserIdentityMismatch(record, pageIdentity);
  if (identityMismatch) {
    const missingCapability = identityMismatch.startsWith('missing_');
    exitAgentWorkspaceError(`Browser ref '${record.ref}' failed page/frame/navigation validation: ${identityMismatch}`, missingCapability ? 'REF_REVALIDATION_REQUIRED' : 'REF_STALE', {
      status: missingCapability ? 'validation_required' : 'stale_ref',
      reason: identityMismatch,
      backend: 'browser',
      ref: refSummary(record),
      current_identity: pageIdentity,
      safe_next_action: recommendedRefreshCommand(workspace, record),
      recommended_next_command: recommendedRefreshCommand(workspace, record),
      requires_user_approval: false,
    });
  }
  const matches = capture.elements.filter((element) => element.ref === sourceRef);
  if (matches.length === 0) {
    exitAgentWorkspaceError(`Browser ref '${record.ref}' is stale; current xray no longer contains ${sourceRef}`, 'REF_STALE', {
      status: 'stale_ref',
      reason: 'current_target_not_found',
      backend: 'browser',
      ref: refSummary(record),
      safe_next_action: recommendedRefreshCommand(workspace, record),
      recommended_next_command: recommendedRefreshCommand(workspace, record),
      requires_user_approval: false,
    });
  }
  if (matches.length > 1) {
    exitAgentWorkspaceError(`Browser ref '${record.ref}' is ambiguous in current xray`, 'REF_AMBIGUOUS', {
      status: 'ambiguous',
      reason: 'current_target_ambiguous',
      backend: 'browser',
      ref: refSummary(record),
      candidates: matches.map(compactBrowserElement),
      safe_next_action: recommendedRefreshCommand(workspace, record),
      recommended_next_command: recommendedRefreshCommand(workspace, record),
      requires_user_approval: false,
    });
  }

  const current = matches[0];
  if (current.enabled === false) {
    exitAgentWorkspaceError(`Browser ref '${record.ref}' is disabled in current xray`, 'ACTION_INCOMPATIBLE', {
      status: 'action_incompatible',
      reason: 'target_disabled',
      backend: 'browser',
      ref: refSummary(record),
      current_target: compactBrowserElement(current),
      safe_next_action: recommendedRefreshCommand(workspace, record),
      recommended_next_command: recommendedRefreshCommand(workspace, record),
      requires_user_approval: false,
    });
  }
  const mismatch = browserCurrentMismatch(record, current);
  if (mismatch) {
    exitAgentWorkspaceError(`Browser ref '${record.ref}' failed current validation: ${mismatch}`, 'REF_STALE', {
      status: 'stale_ref',
      reason: mismatch,
      backend: 'browser',
      ref: refSummary(record),
      current_target: compactBrowserElement(current),
      safe_next_action: recommendedRefreshCommand(workspace, record),
      recommended_next_command: recommendedRefreshCommand(workspace, record),
      requires_user_approval: false,
    });
  }

  const currentSupportedActions = savedRefProducerActionsForBrowserElement(current);
  if (!currentSupportedActions.includes(action)) {
    exitAgentWorkspaceError(`Browser ref '${record.ref}' no longer supports ${action}`, 'ACTION_INCOMPATIBLE', {
      status: 'action_incompatible',
      reason: 'current_target_action_incompatible',
      backend: 'browser',
      ref: refSummary(record),
      current_target: compactBrowserElement(current),
      supported_actions: currentSupportedActions,
      safe_next_action: recommendedRefreshCommand(workspace, record),
      recommended_next_command: recommendedRefreshCommand(workspace, record),
      requires_user_approval: false,
    });
  }

  return {
    status: 'reacquired',
    backend: 'browser',
    capture_state_id: capture.state_id ?? null,
    current_identity: pageIdentity,
    current_target: compactBrowserElement(current),
    validation_command: `aos see capture browser:${target.session} --xray`,
  };
}

export function validateBrowserDragPair(sourceRecord, destinationRecord, workspace) {
  if (sourceRecord.backend !== 'browser') failIncompatibleDragEndpoint(sourceRecord, workspace, 'source_not_browser');
  if (destinationRecord.backend !== 'browser') failIncompatibleDragEndpoint(destinationRecord, workspace, 'destination_not_browser');
  if (sourceRecord.snapshot_id !== destinationRecord.snapshot_id) {
    failIncompatibleDragEndpoint(destinationRecord, workspace, 'snapshot_mismatch');
  }
  const sourceTarget = parseBrowserActionTarget(sourceRecord.action_target);
  const destinationTarget = parseBrowserActionTarget(destinationRecord.action_target);
  if (!sourceTarget || !destinationTarget) {
    failIncompatibleDragEndpoint(destinationRecord, workspace, 'missing_browser_action_target');
  }
  if (sourceTarget.session !== destinationTarget.session) {
    failIncompatibleDragEndpoint(destinationRecord, workspace, 'session_mismatch');
  }
}
