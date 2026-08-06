import { exitAgentWorkspaceError } from './core.mjs';
import { loadSnapshot, requireWorkspace } from './store.mjs';
import { refSummary } from './refs.mjs';

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

function captureSourceArgv(record = null) {
  const sourceArgv = record?.capture_source?.argv;
  if (Array.isArray(sourceArgv) && sourceArgv.length > 0) {
    return sourceArgv.map((arg) => String(arg));
  }
  const target = record?.capture_target;
  if (!target) return null;
  const externalMatch = String(target).match(/^external ([1-9]\d*)$/);
  if (externalMatch) return ['external', externalMatch[1]];
  return [String(target)];
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

export function recommendedRefreshDescriptor(workspace, record = null) {
  const sourceArgv = captureSourceArgv(record);
  const mode = record?.capture_mode;
  const command = recommendedRefreshCommand(workspace, record);
  if (!sourceArgv || !mode || !command) return null;
  const argv = [
    'aos',
    'see',
    'capture',
    ...sourceArgv,
    '--save',
    '--workspace',
    String(workspace),
    '--mode',
    String(mode),
  ];
  if (record?.query) argv.push('--query', String(record.query));
  return {
    kind: 'fresh_saved_capture',
    reason: 're-perceive after saved-ref mutation before asserting state',
    command,
    argv,
    workspace_id: String(workspace),
    capture_mode: String(mode),
    capture_target: record?.capture_target ?? null,
    capture_source: record?.capture_source ?? null,
    query: record?.query ?? null,
  };
}

export function recommendedRefreshResponseFields(workspace, record = null) {
  const command = recommendedRefreshCommand(workspace, record);
  return {
    safe_next_action: command,
    recommended_next_command: command,
    recommended_next: recommendedRefreshDescriptor(workspace, record),
  };
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
  requireWorkspace(workspace, env);
  if (!refToken.snapshot_id) {
    exitAgentWorkspaceError('saved handle target must include its snapshot id', 'TARGET_HANDLE_INVALID');
  }
  if (explicitSnapshot && explicitSnapshot !== refToken.snapshot_id) {
    exitAgentWorkspaceError('--snapshot does not match the saved handle address', 'TARGET_HANDLE_INVALID', {
      address_snapshot_id: refToken.snapshot_id,
      explicit_snapshot_id: explicitSnapshot,
    });
  }
  const loaded = loadSnapshot(workspace, refToken.snapshot_id, env);
  const record = (loaded.refs.refs ?? []).find((item) => item.ref === refToken.ref);
  if (!record) {
    const nextCommand = recommendedRefsCommand(workspace, refToken.snapshot_id);
    exitAgentWorkspaceError(`Saved handle '${refToken.ref}' not found in snapshot '${refToken.snapshot_id}'`, 'TARGET_NOT_FOUND', {
      status: 'not_found',
      ref: refToken.ref,
      workspace_id: workspace,
      snapshot_id: refToken.snapshot_id,
      safe_next_action: nextCommand,
      recommended_next_command: nextCommand,
    });
  }
  return record;
}

export function failUnsupportedRef(record, workspace) {
  exitAgentWorkspaceError(`Saved handle '${record.ref}' is not actionable`, 'TARGET_ACTION_UNSUPPORTED', {
    status: 'unsupported',
    ref: refSummary(record),
    ...recommendedRefreshResponseFields(workspace, record),
    requires_user_approval: false,
  });
}
