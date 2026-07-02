import {
  exitAgentWorkspaceError,
  validateLocalID,
  workspaceID,
} from './core.mjs';
import {
  failIncompatibleAction,
  failUnsupportedRef,
  loadRefRecord,
  recommendedRefreshCommand,
  unsafeResolutionForMutation,
} from './ref-action-resolution.mjs';
import {
  parseRefToken,
  positionalIndexes,
  stripWorkspaceFlags,
} from './ref-action-args.mjs';
import {
  loadDragDestinationRecord,
  validateActionArgs,
} from './ref-action-grammar.mjs';
import {
  appendStateID,
  dispatchResolvedAction,
  emitDryRunEnvelope,
} from './ref-action-execution.mjs';
import {
  validateBrowserCurrentRef,
  validateBrowserDragPair,
} from './browser-ref-validation.mjs';
import { refSummary } from './refs.mjs';

function assertActionable(record, action, workspace) {
  if (!record.action_target) {
    failUnsupportedRef(record, workspace);
  }
  if (!(record.supported_actions ?? []).includes(action)) {
    failIncompatibleAction(record, action, workspace);
  }
}

function validateCurrentTargets(action, record, secondary, workspace, env) {
  let currentValidation = null;
  let secondaryCurrentValidation = null;
  const browserValidationCaptureCache = new Map();
  const browserValidationIdentityCache = new Map();

  if (record.backend === 'browser' && record.resolution_class === 'snapshot_scoped') {
    currentValidation = validateBrowserCurrentRef(record, action, workspace, env, browserValidationCaptureCache, browserValidationIdentityCache);
  }
  if (secondary?.record.backend === 'browser' && secondary.record.resolution_class === 'snapshot_scoped') {
    secondaryCurrentValidation = validateBrowserCurrentRef(secondary.record, action, workspace, env, browserValidationCaptureCache, browserValidationIdentityCache);
  }

  return { currentValidation, secondaryCurrentValidation };
}

export function maybeRunRefAction(action, args, env = process.env) {
  const positions = positionalIndexes(args);
  const firstIndex = positions[0];
  const refToken = firstIndex === undefined ? null : parseRefToken(args[firstIndex]);
  if (!refToken) return false;

  const stripped = stripWorkspaceFlags(args);
  const workspace = workspaceID(stripped.workspace, env);
  const explicitSnapshot = stripped.snapshot ? validateLocalID(stripped.snapshot, 'snapshot id') : null;
  const strippedPositions = positionalIndexes(stripped.args);
  const strippedTargetIndex = strippedPositions[0];
  const record = loadRefRecord(workspace, refToken, explicitSnapshot, env);
  const dryRun = stripped.args.includes('--dry-run');
  validateActionArgs(action, stripped.args, strippedTargetIndex);

  const secondary = action === 'drag'
    ? loadDragDestinationRecord(stripped.args, strippedTargetIndex, workspace, explicitSnapshot, env)
    : null;

  assertActionable(record, action, workspace);
  if (secondary) {
    assertActionable(secondary.record, action, workspace);
    validateBrowserDragPair(record, secondary.record, workspace);
  }

  const { currentValidation, secondaryCurrentValidation } = validateCurrentTargets(action, record, secondary, workspace, env);
  const unsafe = unsafeResolutionForMutation(record, action, currentValidation);
  const secondaryUnsafe = secondary ? unsafeResolutionForMutation(secondary.record, action, secondaryCurrentValidation) : null;
  if (!dryRun && (unsafe || secondaryUnsafe)) {
    const unsafeRecord = unsafe ? record : secondary.record;
    const unsafeStatus = unsafe || secondaryUnsafe;
    exitAgentWorkspaceError(`Ref '${unsafeRecord.ref}' is ${unsafeStatus}; refresh perception before mutating`, 'REF_REVALIDATION_REQUIRED', {
      status: unsafeStatus,
      ref: refSummary(unsafeRecord),
      safe_next_action: recommendedRefreshCommand(workspace),
      recommended_next_command: recommendedRefreshCommand(workspace),
      requires_user_approval: false,
    });
  }

  const transformed = [...stripped.args];
  transformed[strippedTargetIndex] = record.action_target;
  if (secondary) transformed[secondary.index] = secondary.record.action_target;
  const actionArgs = appendStateID(transformed.filter((arg) => arg !== '--dry-run'), record.identity_facts?.state_id);
  const envelopeArgs = {
    action,
    actionArgs,
    workspace,
    record,
    secondary,
    currentValidation,
    secondaryCurrentValidation,
    unsafe,
    secondaryUnsafe,
  };

  if (dryRun) {
    emitDryRunEnvelope(envelopeArgs);
    process.exit(0);
  }

  dispatchResolvedAction({ ...envelopeArgs, env });
}
