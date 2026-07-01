import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  DO_VALUE_FLAGS,
  SCHEMA_VERSION,
  aosPath,
  exitAgentWorkspaceError,
  printJSON,
  readJSON,
  runtimeMode,
  stateRoot,
  validateLocalID,
  workspaceDir,
  workspaceID,
} from './core.mjs';
import { loadSnapshot, requireWorkspace } from './store.mjs';
import { refSummary } from './refs.mjs';

function positionalIndexes(args) {
  const indexes = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      if (DO_VALUE_FLAGS.has(arg)) i += 1;
      continue;
    }
    indexes.push(i);
  }
  return indexes;
}

function parseRefToken(value) {
  if (!value?.startsWith?.('ref:')) return null;
  const body = value.slice('ref:'.length);
  const parts = body.split(':');
  if (parts.length === 1) return { snapshot_id: null, ref: validateLocalID(parts[0], 'ref id') };
  if (parts.length === 2) return { snapshot_id: validateLocalID(parts[0], 'snapshot id'), ref: validateLocalID(parts[1], 'ref id') };
  exitAgentWorkspaceError('ref target must be ref:<id> or ref:<snapshot-id>:<id>', 'INVALID_REF_TARGET');
}

function stripWorkspaceFlags(args) {
  const out = [];
  let workspace = null;
  let snapshot = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--workspace' || args[i] === '--snapshot') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        exitAgentWorkspaceError(`${args[i]} requires a value`, 'MISSING_ARG');
      }
      if (args[i] === '--workspace') workspace = args[i + 1];
      if (args[i] === '--snapshot') snapshot = args[i + 1];
      i += 1;
      continue;
    }
    out.push(args[i]);
  }
  return { args: out, workspace, snapshot };
}

function loadRefRecord(workspace, refToken, explicitSnapshot, env = process.env) {
  const { index } = requireWorkspace(workspace, env);
  const snapshotIDValue = refToken.snapshot_id || explicitSnapshot;
  if (snapshotIDValue) {
    const loaded = loadSnapshot(workspace, snapshotIDValue, env);
    const record = (loaded.refs.refs ?? []).find((item) => item.ref === refToken.ref);
    if (!record) exitAgentWorkspaceError(`Ref '${refToken.ref}' not found in snapshot '${snapshotIDValue}'`, 'REF_NOT_FOUND');
    return record;
  }

  const matches = [];
  for (const snapshot of index.snapshots ?? []) {
    const refsPath = path.join(workspaceDir(workspace, env), 'snapshots', snapshot.snapshot_id, 'refs.json');
    const refs = readJSON(refsPath);
    const record = (refs?.refs ?? []).find((item) => item.ref === refToken.ref);
    if (record) matches.push(record);
  }
  if (matches.length === 0) exitAgentWorkspaceError(`Ref '${refToken.ref}' not found in workspace '${workspace}'`, 'REF_NOT_FOUND');
  if (matches.length > 1) {
    exitAgentWorkspaceError(
      `Ref '${refToken.ref}' is present in multiple snapshots; pass ref:<snapshot-id>:${refToken.ref} or --snapshot`,
      'REF_AMBIGUOUS',
      { status: 'ambiguous', candidates: matches.map(refSummary) },
    );
  }
  return matches[0];
}

function hasStateIDArg(args) {
  return args.includes('--state-id');
}

function appendStateID(args, stateID) {
  if (!stateID || hasStateIDArg(args)) return args;
  return [...args, '--state-id', stateID];
}

function unsafeResolutionForMutation(record) {
  if (record.resolution_class === 'stable') return null;
  if (record.resolution_class === 'reacquirable' && record.backend === 'aos_canvas') return null;
  return record.resolution_class || 'unsupported';
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

  if (!record.action_target) {
    exitAgentWorkspaceError(`Ref '${record.ref}' is not actionable`, 'REF_UNSUPPORTED', {
      status: 'unsupported',
      ref: refSummary(record),
      recommended_next_command: `aos see capture --save --workspace ${workspace}`,
    });
  }
  if (!(record.supported_actions ?? []).includes(action)) {
    exitAgentWorkspaceError(`Ref '${record.ref}' does not support ${action}`, 'ACTION_INCOMPATIBLE', {
      status: 'action_incompatible',
      ref: refSummary(record),
      supported_actions: record.supported_actions ?? [],
    });
  }

  const unsafe = unsafeResolutionForMutation(record);
  if (!dryRun && unsafe) {
    exitAgentWorkspaceError(`Ref '${record.ref}' is ${unsafe}; refresh perception before mutating`, 'REF_REVALIDATION_REQUIRED', {
      status: unsafe,
      ref: refSummary(record),
      safe_next_action: `aos see capture --save --workspace ${workspace}`,
      requires_user_approval: false,
    });
  }

  const transformed = [...stripped.args];
  transformed[strippedTargetIndex] = record.action_target;
  const actionArgs = appendStateID(transformed.filter((arg) => arg !== '--dry-run'), record.identity_facts?.state_id);
  if (dryRun) {
    printJSON({
      status: 'dry_run',
      schema_version: SCHEMA_VERSION,
      action,
      workspace_id: workspace,
      snapshot_id: record.snapshot_id,
      ref: refSummary(record),
      resolved_action: {
        command: ['aos', 'do', action, ...actionArgs],
        resolution_status: unsafe ? 'validation_required' : 'resolved',
      },
      recommended_next_command: unsafe ? `aos see capture --save --workspace ${workspace}` : null,
    });
    process.exit(0);
  }

  const result = spawnSync(aosPath(env), ['do', action, ...actionArgs], {
    encoding: 'utf8',
    env: {
      ...env,
      AOS_RUNTIME_MODE: runtimeMode(env),
      AOS_STATE_ROOT: stateRoot(env),
    },
    maxBuffer: 100 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}
