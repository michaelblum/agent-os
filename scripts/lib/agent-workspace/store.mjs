import fs from 'node:fs';
import path from 'node:path';
import {
  SCHEMA_VERSION,
  assertUnderWorkspacesRoot,
  defaultWorkspaceMetadata,
  directoryBytes,
  exitAgentWorkspaceError,
  nowISO,
  readJSON,
  runtimeMode,
  sessionMetadata,
  stateRoot,
  validateLocalID,
  workspaceDir,
  writeJSONAtomic,
} from './core.mjs';

export function ensureWorkspace(workspace, env = process.env) {
  const dir = assertUnderWorkspacesRoot(workspaceDir(workspace, env), env);
  const workspaceFile = path.join(dir, 'workspace.json');
  const indexFile = path.join(dir, 'index.json');
  fs.mkdirSync(path.join(dir, 'snapshots'), { recursive: true });

  let metadata = readJSON(workspaceFile);
  if (!metadata) {
    metadata = defaultWorkspaceMetadata(workspace, env);
    writeJSONAtomic(workspaceFile, metadata);
  } else if (Object.hasOwn(metadata, 'current_snapshot_id')) {
    const { current_snapshot_id: _currentSnapshotID, ...withoutCurrentSnapshot } = metadata;
    metadata = withoutCurrentSnapshot;
    writeJSONAtomic(workspaceFile, metadata);
  }

  let index = readJSON(indexFile);
  if (!index) {
    index = {
      schema_version: SCHEMA_VERSION,
      workspace_id: workspace,
      runtime_mode: runtimeMode(env),
      current_snapshot_id: null,
      snapshots: [],
      updated_at: nowISO(),
    };
    writeJSONAtomic(indexFile, index);
  }

  return { dir, workspaceFile, indexFile, metadata, index };
}

export function refreshWorkspaceMetadata(workspace, current, env = process.env) {
  const nextMetadata = {
    ...current.metadata,
    schema_version: SCHEMA_VERSION,
    workspace_id: workspace,
    runtime_mode: runtimeMode(env),
    state_root: stateRoot(env),
    workspace_dir: current.dir,
    updated_at: nowISO(),
    session: sessionMetadata(env),
  };
  delete nextMetadata.current_snapshot_id;
  writeJSONAtomic(current.workspaceFile, nextMetadata);
  return nextMetadata;
}

export function saveSnapshotToIndex(workspace, snapshot, env = process.env) {
  const current = ensureWorkspace(workspace, env);
  const withoutOld = (current.index.snapshots ?? []).filter((item) => item.snapshot_id !== snapshot.snapshot_id);
  const nextIndex = {
    ...current.index,
    schema_version: SCHEMA_VERSION,
    workspace_id: workspace,
    runtime_mode: runtimeMode(env),
    current_snapshot_id: snapshot.snapshot_id,
    updated_at: nowISO(),
    snapshots: [
      {
        snapshot_id: snapshot.snapshot_id,
        created_at: snapshot.created_at,
        capture_mode: snapshot.capture_mode,
        target: snapshot.target,
        ref_count: snapshot.ref_count,
        artifact_count: snapshot.artifact_refs.length,
        paths: snapshot.paths,
      },
      ...withoutOld,
    ],
  };
  writeJSONAtomic(current.indexFile, nextIndex);
  refreshWorkspaceMetadata(workspace, current, env);
  return nextIndex;
}

export function loadWorkspaceIndex(workspace, env = process.env) {
  const dir = workspaceDir(workspace, env);
  const index = readJSON(path.join(dir, 'index.json'));
  const metadata = readJSON(path.join(dir, 'workspace.json'));
  return { dir, index, metadata };
}

export function requireWorkspace(workspace, env = process.env) {
  const loaded = loadWorkspaceIndex(workspace, env);
  if (!loaded.index || !loaded.metadata) {
    exitAgentWorkspaceError(`Workspace '${workspace}' not found`, 'WORKSPACE_NOT_FOUND');
  }
  return loaded;
}

export function loadSnapshot(workspace, snapshotIDValue, env = process.env) {
  const workspaceData = requireWorkspace(workspace, env);
  const snapshotDir = path.join(workspaceData.dir, 'snapshots', validateLocalID(snapshotIDValue, 'snapshot id'));
  const snapshot = readJSON(path.join(snapshotDir, 'snapshot.json'));
  const refs = readJSON(path.join(snapshotDir, 'refs.json'));
  if (!snapshot || !refs) {
    exitAgentWorkspaceError(`Snapshot '${snapshotIDValue}' not found in workspace '${workspace}'`, 'SNAPSHOT_NOT_FOUND');
  }
  return { workspaceData, snapshotDir, snapshot, refs };
}

function writeIndexAfterSnapshotRemoval(workspace, current, removedSnapshotIDs, env = process.env) {
  const removed = new Set(removedSnapshotIDs);
  const kept = (current.index.snapshots ?? []).filter((snapshot) => !removed.has(snapshot.snapshot_id));
  const currentSnapshotID = kept.some((snapshot) => snapshot.snapshot_id === current.index.current_snapshot_id)
    ? current.index.current_snapshot_id
    : kept[0]?.snapshot_id ?? null;
  const nextIndex = {
    ...current.index,
    schema_version: SCHEMA_VERSION,
    workspace_id: workspace,
    runtime_mode: runtimeMode(env),
    current_snapshot_id: currentSnapshotID,
    snapshots: kept,
    updated_at: nowISO(),
  };
  writeJSONAtomic(path.join(current.dir, 'index.json'), nextIndex);
  refreshWorkspaceMetadata(workspace, {
    ...current,
    workspaceFile: path.join(current.dir, 'workspace.json'),
  }, env);
  return nextIndex;
}

export function deleteSnapshot(workspace, snapshot, env = process.env) {
  const current = requireWorkspace(workspace, env);
  const snapshotDir = path.join(current.dir, 'snapshots', validateLocalID(snapshot, 'snapshot id'));
  if (!fs.existsSync(snapshotDir)) {
    exitAgentWorkspaceError(`Snapshot '${snapshot}' not found in workspace '${workspace}'`, 'SNAPSHOT_NOT_FOUND');
  }
  const bytes = directoryBytes(snapshotDir);
  fs.rmSync(snapshotDir, { recursive: true, force: true });
  writeIndexAfterSnapshotRemoval(workspace, current, [snapshot], env);
  return { snapshotDir, bytes };
}

export function pruneSnapshots(workspace, candidates, { dryRun = false } = {}, env = process.env) {
  const current = requireWorkspace(workspace, env);
  const removed = [];
  let bytes = 0;
  for (const candidate of candidates) {
    const snapshotDir = path.join(current.dir, 'snapshots', validateLocalID(candidate.snapshot_id, 'snapshot id'));
    bytes += directoryBytes(snapshotDir);
    removed.push({ snapshot_id: candidate.snapshot_id, path: snapshotDir });
    if (!dryRun) fs.rmSync(snapshotDir, { recursive: true, force: true });
  }
  if (!dryRun && candidates.length) {
    writeIndexAfterSnapshotRemoval(workspace, current, candidates.map((candidate) => candidate.snapshot_id), env);
  }
  return { removed, bytes };
}

export function deleteWorkspace(workspace, env = process.env) {
  const dir = assertUnderWorkspacesRoot(workspaceDir(workspace, env), env);
  const bytes = directoryBytes(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  return { dir, bytes };
}
