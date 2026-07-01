import fs from 'node:fs';
import path from 'node:path';
import {
  SAFE_ID,
  SCHEMA_VERSION,
  agentWorkspacesRoot,
  defaultWorkspaceMetadata,
  exitAgentWorkspaceError,
  printJSON,
  runtimeMode,
  stateRoot,
  validateLocalID,
  workspaceID,
  workspaceDir,
  readJSON,
} from './core.mjs';
import {
  deleteSnapshot,
  deleteWorkspace,
  loadSnapshot,
  pruneSnapshots,
  requireWorkspace,
} from './store.mjs';
import { queryMatches, refSummary } from './refs.mjs';

function parseReadArgs(args, { requireID = false } = {}) {
  let id = null;
  let workspace = null;
  let snapshot = null;
  let query = null;
  let json = false;
  let dryRun = false;
  let acknowledge = false;
  let olderThan = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') { json = true; continue; }
    if (arg === '--dry-run') { dryRun = true; continue; }
    if (arg === '--i-understand-local-artifacts') { acknowledge = true; continue; }
    if (arg === '--workspace' || arg === '--snapshot' || arg === '--query' || arg === '--older-than') {
      if (i + 1 >= args.length || args[i + 1].startsWith('--')) {
        exitAgentWorkspaceError(`${arg} requires a value`, 'MISSING_ARG');
      }
      if (arg === '--workspace') workspace = args[i + 1];
      if (arg === '--snapshot') snapshot = args[i + 1];
      if (arg === '--query') query = args[i + 1];
      if (arg === '--older-than') olderThan = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      exitAgentWorkspaceError(`Unknown flag: ${arg}`, 'UNKNOWN_FLAG');
    }
    if (id) {
      exitAgentWorkspaceError(`Unknown argument: ${arg}`, 'UNKNOWN_ARG');
    }
    id = arg;
  }
  if (requireID && !id) exitAgentWorkspaceError('Missing id', 'MISSING_ARG');
  return {
    id,
    workspace: workspaceID(workspace),
    snapshot: snapshot ? validateLocalID(snapshot, 'snapshot id') : null,
    query,
    json,
    dryRun,
    acknowledge,
    olderThan,
  };
}

export function workspacesCommand(args, env = process.env) {
  parseReadArgs(args);
  const root = agentWorkspacesRoot(env);
  const workspaces = [];
  if (fs.existsSync(root)) {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!SAFE_ID.test(entry.name)) continue;
      const metadata = readJSON(path.join(root, entry.name, 'workspace.json'));
      const index = readJSON(path.join(root, entry.name, 'index.json'));
      workspaces.push({
        workspace_id: entry.name,
        current_snapshot_id: index?.current_snapshot_id ?? null,
        snapshot_count: index?.snapshots?.length ?? 0,
        updated_at: index?.updated_at ?? metadata?.updated_at ?? null,
        path: path.join(root, entry.name),
      });
    }
  }
  printJSON({
    status: 'success',
    schema_version: SCHEMA_VERSION,
    runtime_mode: runtimeMode(env),
    state_root: stateRoot(env),
    workspaces: workspaces.sort((a, b) => String(a.workspace_id).localeCompare(String(b.workspace_id))),
  });
}

export function snapshotsCommand(args, env = process.env) {
  const parsed = parseReadArgs(args);
  const { index } = requireWorkspace(parsed.workspace, env);
  printJSON({
    status: 'success',
    schema_version: SCHEMA_VERSION,
    workspace_id: parsed.workspace,
    runtime_mode: runtimeMode(env),
    current_snapshot_id: index.current_snapshot_id ?? null,
    snapshots: index.snapshots ?? [],
  });
}

export function refsCommand(args, env = process.env) {
  const parsed = parseReadArgs(args);
  const { index } = requireWorkspace(parsed.workspace, env);
  const snapshotIDs = parsed.snapshot
    ? [parsed.snapshot]
    : [index.current_snapshot_id].filter(Boolean);
  const refs = [];
  for (const snap of snapshotIDs) {
    const loaded = loadSnapshot(parsed.workspace, snap, env);
    refs.push(...(loaded.refs.refs ?? []).filter((record) => queryMatches(record, parsed.query)).map(refSummary));
  }
  printJSON({
    status: 'success',
    schema_version: SCHEMA_VERSION,
    workspace_id: parsed.workspace,
    runtime_mode: runtimeMode(env),
    snapshot_id: parsed.snapshot ?? index.current_snapshot_id ?? null,
    query: parsed.query,
    refs,
  });
}

export function workspaceCommand(args, env = process.env) {
  const [subcommand, ...rest] = args;
  if (subcommand === 'delete') return deleteWorkspaceCommand(rest, env);
  if (subcommand === 'prune') return pruneWorkspaceCommand(rest, env);
  const parsed = parseReadArgs(args, { requireID: true });
  const workspace = validateLocalID(parsed.id, 'workspace id');
  const { dir, metadata, index } = requireWorkspace(workspace, env);
  printJSON({
    status: 'success',
    schema_version: SCHEMA_VERSION,
    workspace_id: workspace,
    runtime_mode: runtimeMode(env),
    path: dir,
    metadata,
    index_health: {
      current_snapshot_id: index.current_snapshot_id ?? null,
      snapshot_count: index.snapshots?.length ?? 0,
      warnings: [],
    },
    retention: metadata.retention ?? defaultWorkspaceMetadata(workspace, env).retention,
    lock_state: {
      status: 'not_implemented',
      reason: 'workspace write locks are not needed for this single-process external composition slice',
    },
  });
}

function deleteWorkspaceCommand(args, env = process.env) {
  const parsed = parseReadArgs(args, { requireID: true });
  const workspace = validateLocalID(parsed.id, 'workspace id');
  if (!parsed.acknowledge) {
    exitAgentWorkspaceError('workspace delete requires --i-understand-local-artifacts', 'ACK_REQUIRED');
  }
  const { dir, bytes } = deleteWorkspace(workspace, env);
  printJSON({
    status: 'deleted',
    schema_version: SCHEMA_VERSION,
    workspace_id: workspace,
    path: dir,
    bytes_reclaimed: bytes,
  });
}

function parseDurationMs(value) {
  const match = /^(\d+)(ms|s|m|h|d)?$/.exec(String(value || ''));
  if (!match) exitAgentWorkspaceError('--older-than must be a duration such as 7d, 12h, 30m, or 60s', 'INVALID_ARG');
  const n = Number(match[1]);
  const unit = match[2] || 's';
  return n * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]);
}

function pruneWorkspaceCommand(args, env = process.env) {
  const parsed = parseReadArgs(args, { requireID: true });
  if (!parsed.olderThan) exitAgentWorkspaceError('workspace prune requires --older-than <duration>', 'MISSING_ARG');
  if (!parsed.dryRun && !parsed.acknowledge) {
    exitAgentWorkspaceError('workspace prune requires --dry-run or --i-understand-local-artifacts', 'ACK_REQUIRED');
  }
  const workspace = validateLocalID(parsed.id, 'workspace id');
  const { index } = requireWorkspace(workspace, env);
  const threshold = Date.now() - parseDurationMs(parsed.olderThan);
  const candidates = (index.snapshots ?? []).filter((snapshot) => {
    const created = Date.parse(snapshot.created_at ?? '');
    return Number.isFinite(created) && created < threshold;
  });
  const { removed, bytes } = pruneSnapshots(workspace, candidates, { dryRun: parsed.dryRun }, env);
  printJSON({
    status: parsed.dryRun ? 'dry_run' : 'pruned',
    schema_version: SCHEMA_VERSION,
    workspace_id: workspace,
    older_than: parsed.olderThan,
    removed,
    bytes_reclaimed: bytes,
  });
}

export function snapshotCommand(args, env = process.env) {
  const [subcommand, ...rest] = args;
  if (subcommand !== 'delete') {
    exitAgentWorkspaceError(`Unknown snapshot subcommand: ${subcommand ?? ''}`, 'UNKNOWN_SUBCOMMAND');
  }
  const parsed = parseReadArgs(rest, { requireID: true });
  if (!parsed.acknowledge) {
    exitAgentWorkspaceError('snapshot delete requires --i-understand-local-artifacts', 'ACK_REQUIRED');
  }
  const snapshot = validateLocalID(parsed.id, 'snapshot id');
  const { snapshotDir, bytes } = deleteSnapshot(parsed.workspace, snapshot, env);
  printJSON({
    status: 'deleted',
    schema_version: SCHEMA_VERSION,
    workspace_id: parsed.workspace,
    snapshot_id: snapshot,
    path: snapshotDir,
    bytes_reclaimed: bytes,
  });
}

export function agentWorkspaceCLI(argv, env = process.env) {
  const [command, ...args] = argv;
  switch (command) {
    case 'workspaces':
      return workspacesCommand(args, env);
    case 'snapshots':
      return snapshotsCommand(args, env);
    case 'refs':
      return refsCommand(args, env);
    case 'workspace':
      return workspaceCommand(args, env);
    case 'snapshot':
      return snapshotCommand(args, env);
    default:
      exitAgentWorkspaceError(`Unknown agent workspace command: ${command ?? ''}`, 'UNKNOWN_SUBCOMMAND');
  }
}
