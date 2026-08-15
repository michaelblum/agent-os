import {
  exitAgentWorkspaceError,
  validateLocalID,
  workspaceID,
} from './core.mjs';
import {
  failUnsupportedRef,
  loadRefRecord,
} from './ref-action-resolution.mjs';
import { parseRefToken, positionalIndexes, stripWorkspaceFlags } from './ref-action-args.mjs';
import { loadDragDestinationRecord, validateActionArgs } from './ref-action-grammar.mjs';
import {
  appendStateID,
  dispatchResolvedAction,
  emitDryRunEnvelope,
  resolveLocatorDryRun,
} from './ref-action-execution.mjs';

function present(value) {
  return value !== null && value !== undefined && String(value).length > 0;
}

function appendFlag(args, flag, value) {
  if (present(value)) args.push(flag, String(value));
}

function nativeAXValueArg(args, targetIndex) {
  const valueFlagIndex = args.indexOf('--value');
  if (valueFlagIndex >= 0 && valueFlagIndex + 1 < args.length && !String(args[valueFlagIndex + 1]).startsWith('--')) {
    return args[valueFlagIndex + 1];
  }
  const valueIndex = positionalIndexes(args).find((index) => index !== targetIndex);
  return valueIndex === undefined ? null : args[valueIndex];
}

function nativeAXArgs(action, args, targetIndex, handle) {
  const query = handle.query ?? {};
  const out = [];
  appendFlag(out, '--pid', query.pid);
  appendFlag(out, '--window', query.window_id);
  appendFlag(out, '--role', query.role);
  appendFlag(out, '--title', query.title);
  appendFlag(out, '--label', query.label);
  appendFlag(out, '--identifier', query.identifier);
  appendFlag(out, '--index', query.index);
  appendFlag(out, '--near', query.near);
  appendFlag(out, '--match', query.match);
  appendFlag(out, '--depth', query.depth);
  appendFlag(out, '--timeout', query.timeout_ms);
  if (action === 'set-value') {
    const value = nativeAXValueArg(args, targetIndex);
    if (value !== null && value !== undefined) out.push('--value', String(value));
  }
  if (args.includes('--dry-run')) out.push('--dry-run');
  return out;
}

function validateExplicitState(args, handle) {
  const indexes = args
    .map((arg, index) => (arg === '--state-id' ? index : null))
    .filter((index) => index !== null);
  if (indexes.length > 1) {
    exitAgentWorkspaceError('saved-handle actions accept at most one --state-id', 'TARGET_HANDLE_INVALID');
  }
  if (indexes.length === 0) return;
  const stateID = args[indexes[0] + 1];
  if (handle?.kind === 'locator') {
    exitAgentWorkspaceError('Locators do not support --state-id', 'TARGET_STATE_UNSUPPORTED');
  }
  if (stateID !== handle?.state_id) {
    exitAgentWorkspaceError('explicit state_id does not match the saved Observation Ref', 'TARGET_STATE_STALE', {
      state_id: stateID ?? null,
      handle_state_id: handle?.state_id ?? null,
    });
  }
}

function assertTypedHandle(record, workspace) {
  if (!record.handle || record.handle.backend !== record.backend) failUnsupportedRef(record, workspace);
}

function validateHandle(record, env) {
  const handle = record.handle;
  if (handle?.kind === 'observation_ref' && handle.backend === 'browser') {
    exitAgentWorkspaceError(
      'browser Observation Ref actions remain unsupported by the managed session contract',
      'TARGET_ACTION_UNSUPPORTED',
      { reason: 'browser_ref_actions_unsupported', session: handle.scope.session, state_id: handle.state_id, ref: handle.ref },
    );
  }
  if (handle?.kind === 'locator' && ['aos_canvas', 'native_ax'].includes(handle.backend)) {
    return { status: 'resolution_required', backend: handle.backend, query: handle.query };
  }
  exitAgentWorkspaceError(`Saved handle '${record.ref}' is invalid`, 'TARGET_HANDLE_INVALID', { handle });
}

function assertDragPair(source, destination) {
  const a = source.handle;
  const b = destination.handle;
  if (a?.kind !== 'observation_ref' || b?.kind !== 'observation_ref' || a.backend !== 'browser' || b.backend !== 'browser') {
    exitAgentWorkspaceError('saved-handle drag requires two browser Observation Refs', 'TARGET_ACTION_UNSUPPORTED');
  }
  if (a.scope.session !== b.scope.session || a.state_id !== b.state_id) {
    exitAgentWorkspaceError('browser drag endpoints must share one session and capture generation', 'TARGET_STATE_STALE');
  }
}

function transformedActionArgs(action, args, targetIndex, record) {
  const handle = record.handle;
  if (handle.backend === 'native_ax') return nativeAXArgs(action, args, targetIndex, handle);
  const out = [...args];
  out[targetIndex] = handle.backend === 'browser'
    ? `browser:${handle.scope.session}/${handle.ref}`
    : `canvas:${handle.query.canvas_id}/${handle.query.ref}`;
  return out;
}

function maybeRunRefAction(action, args, env = process.env) {
  const firstIndex = positionalIndexes(args)[0];
  const refToken = firstIndex === undefined ? null : parseRefToken(args[firstIndex]);
  if (!refToken) return false;

  const stripped = stripWorkspaceFlags(args);
  const workspace = workspaceID(stripped.workspace, env);
  const explicitSnapshot = stripped.snapshot ? validateLocalID(stripped.snapshot, 'snapshot id') : null;
  const strippedTargetIndex = positionalIndexes(stripped.args)[0];
  const record = loadRefRecord(workspace, refToken, explicitSnapshot, env);
  const dryRun = stripped.args.includes('--dry-run');
  validateExplicitState(stripped.args, record.handle);
  validateActionArgs(action, stripped.args, strippedTargetIndex, record);
  assertTypedHandle(record, workspace);

  const secondary = action === 'drag'
    ? loadDragDestinationRecord(stripped.args, strippedTargetIndex, workspace, explicitSnapshot, env)
    : null;
  if (secondary) {
    assertTypedHandle(secondary.record, workspace);
    validateExplicitState(stripped.args, secondary.record.handle);
    assertDragPair(record, secondary.record);
  }

  let currentValidation = validateHandle(record, env);
  let secondaryCurrentValidation = secondary ? validateHandle(secondary.record, env) : null;
  if (record.handle.kind === 'observation_ref') {
    exitAgentWorkspaceError(
      'browser Observation Ref actions are not supported by the managed companion surface',
      'TARGET_ACTION_UNSUPPORTED',
      {
        reason: 'browser_ref_actions_unsupported',
        session: record.handle.scope.session,
        state_id: record.handle.state_id,
        ref: record.handle.ref,
        backend_version: currentValidation.backend_version,
        recapture_required: true,
      },
    );
  }
  let actionArgs = transformedActionArgs(action, stripped.args, strippedTargetIndex, record);
  if (secondary) {
    const handle = secondary.record.handle;
    actionArgs[secondary.index] = `browser:${handle.scope.session}/${handle.ref}`;
  }
  if (record.handle.kind === 'observation_ref') actionArgs = appendStateID(actionArgs, record.handle.state_id);

  const envelopeArgs = {
    action,
    actionArgs,
    workspace,
    record,
    secondary,
    currentValidation,
    secondaryCurrentValidation,
  };
  if (dryRun) {
    if (record.handle.kind === 'locator') {
      const resolution = resolveLocatorDryRun(action, actionArgs, env);
      currentValidation = {
        status: 'resolved',
        backend: record.handle.backend,
        query: record.handle.query,
        result: resolution,
      };
      envelopeArgs.currentValidation = currentValidation;
      envelopeArgs.secondaryCurrentValidation = secondaryCurrentValidation;
    }
    emitDryRunEnvelope(envelopeArgs);
    process.exit(0);
  }
  actionArgs = actionArgs.filter((arg) => arg !== '--dry-run');
  envelopeArgs.actionArgs = actionArgs;
  dispatchResolvedAction({ ...envelopeArgs, env });
  return true;
}

export function runRefAction(action, args, env = process.env) {
  if (maybeRunRefAction(action, args, env)) return;
  exitAgentWorkspaceError(
    `aos do ${action} saved-handle route requires ref:<snapshot-id>:<ref-id>`,
    'TARGET_HANDLE_INVALID',
  );
}
