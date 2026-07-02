import {
  exitAgentWorkspaceError,
  validateLocalID,
  workspaceID,
} from './core.mjs';
import {
  failIncompatibleAction,
  failLowConfidenceRef,
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

function present(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return String(value).length > 0;
}

function appendFlag(args, flag, value) {
  if (present(value)) args.push(flag, String(value));
}

function nativeAXValueArg(args, targetIndex) {
  const valueFlagIndex = args.indexOf('--value');
  if (valueFlagIndex >= 0 && valueFlagIndex + 1 < args.length && !String(args[valueFlagIndex + 1]).startsWith('--')) {
    return args[valueFlagIndex + 1];
  }
  const positions = positionalIndexes(args);
  const valueIndex = positions.find((index) => index !== targetIndex);
  return valueIndex === undefined ? null : args[valueIndex];
}

function directNativeAXArgs(action, args, targetIndex, record) {
  const facts = record.identity_facts ?? {};
  const directArgs = [];
  appendFlag(directArgs, '--pid', facts.app_pid);
  appendFlag(directArgs, '--window', facts.window_id);
  appendFlag(directArgs, '--role', facts.role);
  appendFlag(directArgs, '--title', facts.title);
  appendFlag(directArgs, '--label', facts.label);
  appendFlag(directArgs, '--identifier', facts.ax_identifier);
  appendFlag(directArgs, '--index', facts.index);
  appendFlag(directArgs, '--near', facts.near);
  appendFlag(directArgs, '--match', facts.match);
  appendFlag(directArgs, '--depth', facts.depth);
  appendFlag(directArgs, '--timeout', facts.timeout_ms);
  if (action === 'set-value') {
    appendFlag(directArgs, '--value', nativeAXValueArg(args, targetIndex));
  }
  return directArgs;
}

function currentNativeAXValidation(record, action) {
  const facts = record.identity_facts ?? {};
  return {
    status: 'direct_ax_current_matching_required',
    backend: 'native_ax',
    action,
    validation: 'saved durable native facts are converted to direct AX selector flags; the native primitive performs current matching at dispatch',
    direct_target: {
      app_pid: facts.app_pid ?? null,
      window_id: facts.window_id ?? null,
      role: facts.role ?? null,
      title: facts.title ?? null,
      label: facts.label ?? null,
      ax_identifier: facts.ax_identifier ?? null,
      stable_path: facts.stable_path ?? null,
    },
  };
}

function assertActionable(record, action, workspace) {
  if (record.confidence === 'low') {
    failLowConfidenceRef(record, workspace);
  }
  if (record.resolution_class === 'coordinate_fallback') {
    failUnsupportedRef(record, workspace);
  }
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
  if (record.backend === 'native_ax' && record.resolution_class === 'stable') {
    currentValidation = currentNativeAXValidation(record, action);
  }

  return { currentValidation, secondaryCurrentValidation };
}

function maybeRunRefAction(action, args, env = process.env) {
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
  validateActionArgs(action, stripped.args, strippedTargetIndex, record);

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
      safe_next_action: recommendedRefreshCommand(workspace, unsafeRecord),
      recommended_next_command: recommendedRefreshCommand(workspace, unsafeRecord),
      requires_user_approval: false,
    });
  }

  const transformed = record.backend === 'native_ax'
    ? directNativeAXArgs(action, stripped.args, strippedTargetIndex, record)
    : [...stripped.args];
  if (record.backend !== 'native_ax') transformed[strippedTargetIndex] = record.action_target;
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

export function runRefAction(action, args, env = process.env) {
  if (maybeRunRefAction(action, args, env)) return;
  exitAgentWorkspaceError(`aos do ${action} saved-ref route requires a ref:<id> or ref:<snapshot-id>:<id> target`, 'INVALID_REF_TARGET');
}
