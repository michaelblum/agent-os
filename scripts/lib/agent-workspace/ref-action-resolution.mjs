import path from 'node:path';
import { exitAgentWorkspaceError, workspaceDir } from './core.mjs';
import { loadSnapshot, readRefsRecord, requireWorkspace } from './store.mjs';
import { refSummary } from './refs.mjs';
import { savedRefBackendSupportsRealMutation } from './contracts.mjs';

export function recommendedRefreshCommand(workspace) {
  return `aos see capture --save --workspace ${workspace}`;
}

export function loadRefRecord(workspace, refToken, explicitSnapshot, env = process.env) {
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
    recommended_next_command: recommendedRefreshCommand(workspace),
    safe_next_action: recommendedRefreshCommand(workspace),
    requires_user_approval: false,
  });
}

export function failIncompatibleAction(record, action, workspace) {
  exitAgentWorkspaceError(`Ref '${record.ref}' does not support ${action}`, 'ACTION_INCOMPATIBLE', {
    status: 'action_incompatible',
    ref: refSummary(record),
    supported_actions: record.supported_actions ?? [],
    recommended_next_command: recommendedRefreshCommand(workspace),
    safe_next_action: recommendedRefreshCommand(workspace),
    requires_user_approval: false,
  });
}

export function failIncompatibleDragEndpoint(record, workspace, reason) {
  exitAgentWorkspaceError(`Ref '${record.ref}' cannot be used as a browser drag endpoint: ${reason}`, 'ACTION_INCOMPATIBLE', {
    status: 'action_incompatible',
    reason,
    ref: refSummary(record),
    recommended_next_command: recommendedRefreshCommand(workspace),
    safe_next_action: recommendedRefreshCommand(workspace),
    requires_user_approval: false,
  });
}
