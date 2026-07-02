import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  DO_VALUE_FLAGS,
  SCHEMA_VERSION,
  aosPath,
  exitAgentWorkspaceError,
  printJSON,
  runtimeMode,
  stateRoot,
  validateLocalID,
  workspaceDir,
  workspaceID,
} from './core.mjs';
import { loadSnapshot, readRefsRecord, requireWorkspace } from './store.mjs';
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
    const refs = readRefsRecord(refsPath, workspace, snapshot.snapshot_id);
    if (!refs) continue;
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

function parseBrowserActionTarget(value) {
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
  if (!optionalTextMatches(record.hint_facts?.role, current.role)) return 'role_changed';
  if (!optionalTextMatches(record.hint_facts?.title, current.title)) return 'title_changed';
  if (!optionalTextMatches(record.hint_facts?.label, current.label)) return 'label_changed';
  if (!contextPathMatches(record.identity_facts?.context_path, current.context_path)) return 'context_changed';
  return null;
}

function currentBrowserCapture(session, workspace, env) {
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
      safe_next_action: recommendedRefreshCommand(workspace),
      recommended_next_command: recommendedRefreshCommand(workspace),
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
        safe_next_action: recommendedRefreshCommand(workspace),
        recommended_next_command: recommendedRefreshCommand(workspace),
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
      safe_next_action: recommendedRefreshCommand(workspace),
      recommended_next_command: recommendedRefreshCommand(workspace),
      requires_user_approval: false,
    });
  }
}

function isAgentWorkspaceParseError(error) {
  return error?.name === 'AgentWorkspaceError';
}

function validateBrowserCurrentRef(record, action, workspace, env) {
  if (!['click', 'fill'].includes(action)) return null;
  const target = parseBrowserActionTarget(record.action_target);
  const sourceRef = record.identity_facts?.source_ref || target?.ref || null;
  if (!target || !sourceRef) return null;

  const capture = currentBrowserCapture(target.session, workspace, env);
  const matches = capture.elements.filter((element) => element.ref === sourceRef);
  if (matches.length === 0) {
    exitAgentWorkspaceError(`Browser ref '${record.ref}' is stale; current xray no longer contains ${sourceRef}`, 'REF_STALE', {
      status: 'stale_ref',
      backend: 'browser',
      ref: refSummary(record),
      safe_next_action: recommendedRefreshCommand(workspace),
      recommended_next_command: recommendedRefreshCommand(workspace),
      requires_user_approval: false,
    });
  }
  if (matches.length > 1) {
    exitAgentWorkspaceError(`Browser ref '${record.ref}' is ambiguous in current xray`, 'REF_AMBIGUOUS', {
      status: 'ambiguous',
      backend: 'browser',
      ref: refSummary(record),
      candidates: matches.map(compactBrowserElement),
      safe_next_action: recommendedRefreshCommand(workspace),
      recommended_next_command: recommendedRefreshCommand(workspace),
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
      safe_next_action: recommendedRefreshCommand(workspace),
      recommended_next_command: recommendedRefreshCommand(workspace),
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
      safe_next_action: recommendedRefreshCommand(workspace),
      recommended_next_command: recommendedRefreshCommand(workspace),
      requires_user_approval: false,
    });
  }

  return {
    status: 'reacquired',
    backend: 'browser',
    capture_state_id: capture.state_id ?? null,
    current_target: compactBrowserElement(current),
    validation_command: `aos see capture browser:${target.session} --xray`,
  };
}

function unsafeResolutionForMutation(record) {
  if (record.resolution_class === 'stable') return null;
  if (record.resolution_class === 'reacquirable' && record.backend === 'aos_canvas') return null;
  return record.resolution_class || 'unsupported';
}

function recommendedRefreshCommand(workspace) {
  return `aos see capture --save --workspace ${workspace}`;
}

function failUnsupportedRef(record, workspace) {
  exitAgentWorkspaceError(`Ref '${record.ref}' is not actionable`, 'REF_UNSUPPORTED', {
    status: 'unsupported',
    ref: refSummary(record),
    recommended_next_command: recommendedRefreshCommand(workspace),
    safe_next_action: recommendedRefreshCommand(workspace),
    requires_user_approval: false,
  });
}

function failIncompatibleAction(record, action, workspace) {
  exitAgentWorkspaceError(`Ref '${record.ref}' does not support ${action}`, 'ACTION_INCOMPATIBLE', {
    status: 'action_incompatible',
    ref: refSummary(record),
    supported_actions: record.supported_actions ?? [],
    recommended_next_command: recommendedRefreshCommand(workspace),
    safe_next_action: recommendedRefreshCommand(workspace),
    requires_user_approval: false,
  });
}

function validateActionArgs(action, args, targetIndex) {
  if (action === 'set-value') {
    const valueFlagIndex = args.indexOf('--value');
    const hasFlagValue = valueFlagIndex >= 0
      && valueFlagIndex + 1 < args.length
      && !String(args[valueFlagIndex + 1]).startsWith('--');
    const positions = positionalIndexes(args);
    const hasPositionalValue = positions.some((index) => index !== targetIndex);
    if (!hasFlagValue && !hasPositionalValue) {
      exitAgentWorkspaceError('set-value requires --value or a positional value', 'MISSING_ARG');
    }
  }
  if (action === 'fill') {
    const positions = positionalIndexes(args);
    const hasText = positions.some((index) => index !== targetIndex);
    if (!hasText) {
      exitAgentWorkspaceError('fill requires a text argument', 'MISSING_ARG');
    }
  }
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

  if (!record.action_target) {
    failUnsupportedRef(record, workspace);
  }
  if (!(record.supported_actions ?? []).includes(action)) {
    failIncompatibleAction(record, action, workspace);
  }

  let unsafe = unsafeResolutionForMutation(record);
  let currentValidation = null;
  if (record.backend === 'browser' && record.resolution_class === 'snapshot_scoped') {
    currentValidation = validateBrowserCurrentRef(record, action, workspace, env);
    if (currentValidation) unsafe = null;
  }
  if (!dryRun && unsafe) {
    exitAgentWorkspaceError(`Ref '${record.ref}' is ${unsafe}; refresh perception before mutating`, 'REF_REVALIDATION_REQUIRED', {
      status: unsafe,
      ref: refSummary(record),
      safe_next_action: recommendedRefreshCommand(workspace),
      recommended_next_command: recommendedRefreshCommand(workspace),
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
        resolution_status: currentValidation?.status ?? (unsafe ? 'validation_required' : 'resolved'),
      },
      current_validation: currentValidation,
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
