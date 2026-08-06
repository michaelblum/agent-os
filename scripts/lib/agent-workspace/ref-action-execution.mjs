import { spawnSync } from 'node:child_process';
import {
  SCHEMA_VERSION,
  aosPath,
  exitAgentWorkspaceError,
  printJSON,
  runtimeMode,
  stateRoot,
} from './core.mjs';
import { refSummary } from './refs.mjs';
import { recommendedRefreshCommand, recommendedRefreshDescriptor } from './ref-action-resolution.mjs';

function hasStateIDArg(args) {
  return args.includes('--state-id');
}

export function appendStateID(args, stateID) {
  if (!stateID || hasStateIDArg(args)) return args;
  return [...args, '--state-id', stateID];
}

export function resolutionStatusFor(currentValidation, secondaryCurrentValidation, secondary) {
  if (['validated', 'resolved'].includes(currentValidation?.status)
    && (!secondary || ['validated', 'resolved'].includes(secondaryCurrentValidation?.status))) {
    return 'validated';
  }
  return 'resolution_required';
}

function resolvedCommand(action, actionArgs) {
  return ['aos', 'do', action, ...actionArgs];
}

function resolvedStateIDs(record, currentValidation) {
  return {
    handle_state_id: record?.handle?.state_id ?? null,
    validated_state_id: currentValidation?.state_id ?? null,
  };
}

export function emitDryRunEnvelope({
  action,
  actionArgs,
  workspace,
  record,
  secondary,
  currentValidation,
  secondaryCurrentValidation,
}) {
  printJSON({
    status: 'dry_run',
    schema_version: SCHEMA_VERSION,
    action,
    workspace_id: workspace,
    snapshot_id: record.snapshot_id,
    ref: refSummary(record),
    secondary_ref: secondary ? refSummary(secondary.record) : null,
    resolved_action: {
      command: resolvedCommand(action, actionArgs),
      resolution_status: resolutionStatusFor(currentValidation, secondaryCurrentValidation, secondary),
      ...resolvedStateIDs(record, currentValidation),
    },
    current_validation: currentValidation,
    secondary_current_validation: secondaryCurrentValidation,
    mutation_performed: false,
    recommended_next: null,
    recommended_next_command: null,
  });
}

function parseJSONOutput(output) {
  const text = String(output || '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function resolveLocatorDryRun(action, actionArgs, env) {
  const result = spawnSync(aosPath(env), ['do', action, ...actionArgs], {
    encoding: 'utf8',
    env: {
      ...env,
      AOS_RUNTIME_MODE: runtimeMode(env),
      AOS_STATE_ROOT: stateRoot(env),
    },
    maxBuffer: 100 * 1024 * 1024,
  });
  const payload = parseJSONOutput(result.stdout) ?? parseJSONOutput(result.stderr);
  if ((result.status ?? 1) !== 0) {
    const code = payload?.code ?? payload?.error?.code ?? 'TARGET_HANDLE_INVALID';
    const message = payload?.error?.message ?? payload?.error ?? `dry-run target resolution failed with exit ${result.status ?? 1}`;
    const details = payload && typeof payload === 'object'
      ? Object.fromEntries(Object.entries(payload).filter(([key]) => !['code', 'error'].includes(key)))
      : {};
    exitAgentWorkspaceError(String(message), String(code), details);
  }
  return payload ?? { status: 'dry_run', mutation_performed: false };
}

function actionEnvelope({
  status,
  action,
  actionArgs,
  workspace,
  record,
  secondary,
  currentValidation,
  secondaryCurrentValidation,
  result,
}) {
  const exitCode = result.status ?? 1;
  const parsedStdout = parseJSONOutput(result.stdout);
  const parsedStderr = parseJSONOutput(result.stderr);
  const recommendation = recommendedRefreshCommand(workspace, record);
  const recommendedNext = recommendedRefreshDescriptor(workspace, record);
  return {
    status,
    schema_version: SCHEMA_VERSION,
    action,
    workspace_id: workspace,
    snapshot_id: record.snapshot_id,
    ref: refSummary(record),
    secondary_ref: secondary ? refSummary(secondary.record) : null,
    resolved_action: {
      command: resolvedCommand(action, actionArgs),
      resolution_status: resolutionStatusFor(currentValidation, secondaryCurrentValidation, secondary),
      exit_code: exitCode,
      ...resolvedStateIDs(record, currentValidation),
    },
    current_validation: currentValidation,
    secondary_current_validation: secondaryCurrentValidation,
    underlying_exit_code: exitCode,
    underlying_result: parsedStdout ?? parsedStderr,
    underlying_stdout: parsedStdout ? null : (result.stdout || null),
    underlying_stderr: parsedStderr ? null : (result.stderr || null),
    post_action: {
      verification: status === 'success' ? 'fresh_capture_recommended' : 'underlying_action_failed',
      state: null,
      recommended_next: recommendedNext,
      recommended_next_command: recommendation,
    },
    recommended_next_command: recommendation,
  };
}

export function dispatchResolvedAction({
  action,
  actionArgs,
  workspace,
  record,
  secondary,
  currentValidation,
  secondaryCurrentValidation,
  env,
}) {
  const result = spawnSync(aosPath(env), ['do', action, ...actionArgs], {
    encoding: 'utf8',
    env: {
      ...env,
      AOS_RUNTIME_MODE: runtimeMode(env),
      AOS_STATE_ROOT: stateRoot(env),
    },
    maxBuffer: 100 * 1024 * 1024,
  });
  const success = (result.status ?? 1) === 0;
  const parsedStdout = parseJSONOutput(result.stdout);
  const parsedStderr = parseJSONOutput(result.stderr);
  const underlying = parsedStdout ?? parsedStderr;
  if (!success) {
    const code = underlying?.code ?? underlying?.error?.code ?? 'TARGET_HANDLE_INVALID';
    const message = underlying?.error?.message
      ?? (typeof underlying?.error === 'string' ? underlying.error : null)
      ?? `saved Locator action failed with exit ${result.status ?? 1}`;
    const underlyingDetails = underlying && typeof underlying === 'object'
      ? Object.fromEntries(Object.entries(underlying).filter(([key]) => !['status', 'code', 'error'].includes(key)))
      : {};
    exitAgentWorkspaceError(String(message), String(code), {
      ...underlyingDetails,
      schema_version: SCHEMA_VERSION,
      action,
      workspace_id: workspace,
      snapshot_id: record.snapshot_id,
      ref: refSummary(record),
      underlying_exit_code: result.status ?? 1,
    });
  }
  const resolvedValidation = record.handle?.kind === 'locator'
    ? {
        status: 'resolved',
        backend: record.handle.backend,
        query: record.handle.query,
        result: underlying,
      }
    : currentValidation;
  const envelope = actionEnvelope({
    status: 'success',
    action,
    actionArgs,
    workspace,
    record,
    secondary,
    currentValidation: resolvedValidation,
    secondaryCurrentValidation,
    result,
  });
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  process.exit(0);
}
