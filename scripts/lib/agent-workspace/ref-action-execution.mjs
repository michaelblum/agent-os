import { spawnSync } from 'node:child_process';
import {
  SCHEMA_VERSION,
  aosPath,
  printJSON,
  runtimeMode,
  stateRoot,
} from './core.mjs';
import { refSummary } from './refs.mjs';
import { recommendedRefreshCommand } from './ref-action-resolution.mjs';

function hasStateIDArg(args) {
  return args.includes('--state-id');
}

export function appendStateID(args, stateID) {
  if (!stateID || hasStateIDArg(args)) return args;
  return [...args, '--state-id', stateID];
}

export function resolutionStatusFor(currentValidation, secondaryCurrentValidation, unsafe, secondaryUnsafe, secondary) {
  const validationRequired = unsafe || secondaryUnsafe;
  if (validationRequired) return 'validation_required';
  if (currentValidation && (!secondary || secondaryCurrentValidation)) return 'reacquired';
  return 'resolved';
}

function resolvedCommand(action, actionArgs) {
  return ['aos', 'do', action, ...actionArgs];
}

export function emitDryRunEnvelope({
  action,
  actionArgs,
  workspace,
  record,
  secondary,
  currentValidation,
  secondaryCurrentValidation,
  unsafe,
  secondaryUnsafe,
}) {
  const validationRequired = unsafe || secondaryUnsafe;
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
      resolution_status: resolutionStatusFor(currentValidation, secondaryCurrentValidation, unsafe, secondaryUnsafe, secondary),
    },
    current_validation: currentValidation,
    secondary_current_validation: secondaryCurrentValidation,
    recommended_next_command: validationRequired ? recommendedRefreshCommand(workspace) : null,
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

function actionEnvelope({
  status,
  action,
  actionArgs,
  workspace,
  record,
  secondary,
  currentValidation,
  secondaryCurrentValidation,
  unsafe,
  secondaryUnsafe,
  result,
}) {
  const exitCode = result.status ?? 1;
  const parsedStdout = parseJSONOutput(result.stdout);
  const parsedStderr = parseJSONOutput(result.stderr);
  const recommendation = recommendedRefreshCommand(workspace);
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
      resolution_status: resolutionStatusFor(currentValidation, secondaryCurrentValidation, unsafe, secondaryUnsafe, secondary),
      exit_code: exitCode,
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
  unsafe,
  secondaryUnsafe,
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
  const envelope = actionEnvelope({
    status: success ? 'success' : 'error',
    action,
    actionArgs,
    workspace,
    record,
    secondary,
    currentValidation,
    secondaryCurrentValidation,
    unsafe,
    secondaryUnsafe,
    result,
  });
  const text = `${JSON.stringify(envelope, null, 2)}\n`;
  if (success) process.stdout.write(text);
  else process.stderr.write(text);
  process.exit(result.status ?? 1);
}
