import path from 'node:path';
import { exitAgentWorkspaceError, workspaceDir } from './core.mjs';
import { loadSnapshot, readRefsRecord, requireWorkspace } from './store.mjs';
import { refSummary } from './refs.mjs';
import { savedRefBackendSupportsRealMutation } from './contracts.mjs';

function commandToken(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=,@+-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function captureTargetToken(value) {
  const text = String(value);
  if (/^external [1-9]\d*$/.test(text)) return text;
  return commandToken(text);
}

function captureSourceToken(record = null) {
  const sourceArgv = record?.capture_source?.argv;
  if (Array.isArray(sourceArgv) && sourceArgv.length > 0) {
    return sourceArgv.map(commandToken).join(' ');
  }
  const target = record?.capture_target;
  return target ? captureTargetToken(target) : null;
}

export function recommendedRefreshCommand(workspace, record = null) {
  const source = captureSourceToken(record);
  const mode = record?.capture_mode;
  if (!source || !mode) return null;
  return [
    'aos',
    'see',
    'capture',
    source,
    '--save',
    '--workspace',
    commandToken(workspace),
    '--mode',
    commandToken(mode),
    record.query ? `--query ${commandToken(record.query)}` : null,
  ].filter(Boolean).join(' ');
}

function recommendedRefsCommand(workspace, snapshot = null) {
  return [
    'aos',
    'see',
    'refs',
    '--workspace',
    commandToken(workspace),
    snapshot ? `--snapshot ${commandToken(snapshot)}` : null,
    '--json',
  ].filter(Boolean).join(' ');
}

export function loadRefRecord(workspace, refToken, explicitSnapshot, env = process.env) {
  const { index } = requireWorkspace(workspace, env);
  const snapshotIDValue = refToken.snapshot_id || explicitSnapshot;
  if (snapshotIDValue) {
    const loaded = loadSnapshot(workspace, snapshotIDValue, env);
    const record = (loaded.refs.refs ?? []).find((item) => item.ref === refToken.ref);
    if (!record) {
      const nextCommand = recommendedRefsCommand(workspace, snapshotIDValue);
      exitAgentWorkspaceError(`Ref '${refToken.ref}' not found in snapshot '${snapshotIDValue}'`, 'REF_NOT_FOUND', {
        status: 'not_found',
        ref: refToken.ref,
        workspace_id: workspace,
        snapshot_id: snapshotIDValue,
        safe_next_action: nextCommand,
        recommended_next_command: nextCommand,
        requires_user_approval: false,
      });
    }
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
  if (matches.length === 0) {
    const nextCommand = recommendedRefsCommand(workspace);
    exitAgentWorkspaceError(`Ref '${refToken.ref}' not found in workspace '${workspace}'`, 'REF_NOT_FOUND', {
      status: 'not_found',
      ref: refToken.ref,
      workspace_id: workspace,
      safe_next_action: nextCommand,
      recommended_next_command: nextCommand,
      requires_user_approval: false,
    });
  }
  if (matches.length > 1) {
    const snapshots = [...new Set(matches.map((record) => record.snapshot_id).filter(Boolean))];
    exitAgentWorkspaceError(
      `Ref '${refToken.ref}' is present in multiple snapshots; pass ref:<snapshot-id>:${refToken.ref} or --snapshot`,
      'REF_AMBIGUOUS',
      {
        status: 'ambiguous',
        ref: refToken.ref,
        workspace_id: workspace,
        candidates: matches.map(refSummary),
        safe_next_action: `retry with ref:<snapshot-id>:${refToken.ref} from one candidate or pass --snapshot <snapshot-id>`,
        recommended_next_commands: snapshots.map((snapshot) => recommendedRefsCommand(workspace, snapshot)),
        requires_user_approval: false,
      },
    );
  }
  return matches[0];
}

export function unsafeResolutionForMutation(record, action, currentValidation = null) {
  if (record.resolution_class === 'stable') return null;
  if (record.resolution_class === 'reacquirable' && record.backend === 'aos_canvas') return null;
  if (
    record.resolution_class === 'snapshot_scoped'
    && savedRefBackendSupportsRealMutation(record.backend, action)
    && currentValidation?.status === 'reacquired'
  ) {
    return null;
  }
  return record.resolution_class || 'unsupported';
}

export function failUnsupportedRef(record, workspace) {
  exitAgentWorkspaceError(`Ref '${record.ref}' is not actionable`, 'REF_UNSUPPORTED', {
    status: 'unsupported',
    ref: refSummary(record),
    recommended_next_command: recommendedRefreshCommand(workspace, record),
    safe_next_action: recommendedRefreshCommand(workspace, record),
    requires_user_approval: false,
  });
}

export function failLowConfidenceRef(record, workspace) {
  exitAgentWorkspaceError(`Ref '${record.ref}' is low confidence and not safe for saved-ref mutation`, 'REF_UNSUPPORTED', {
    status: 'unsupported',
    reason: 'low_confidence_target',
    ref: refSummary(record),
    recommended_next_command: recommendedRefreshCommand(workspace, record),
    safe_next_action: recommendedRefreshCommand(workspace, record),
    requires_user_approval: false,
  });
}

export function failIncompatibleAction(record, action, workspace) {
  exitAgentWorkspaceError(`Ref '${record.ref}' does not support ${action}`, 'ACTION_INCOMPATIBLE', {
    status: 'action_incompatible',
    ref: refSummary(record),
    supported_actions: record.supported_actions ?? [],
    recommended_next_command: recommendedRefreshCommand(workspace, record),
    safe_next_action: recommendedRefreshCommand(workspace, record),
    requires_user_approval: false,
  });
}

export function failIncompatibleDragEndpoint(record, workspace, reason) {
  exitAgentWorkspaceError(`Ref '${record.ref}' cannot be used as a browser drag endpoint: ${reason}`, 'ACTION_INCOMPATIBLE', {
    status: 'action_incompatible',
    reason,
    ref: refSummary(record),
    recommended_next_command: recommendedRefreshCommand(workspace, record),
    safe_next_action: recommendedRefreshCommand(workspace, record),
    requires_user_approval: false,
  });
}
