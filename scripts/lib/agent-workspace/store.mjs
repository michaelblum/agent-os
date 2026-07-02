import fs from 'node:fs';
import path from 'node:path';
import {
  SCHEMA_VERSION,
  assertUnderWorkspacesRoot,
  defaultWorkspaceMetadata,
  directoryBytes,
  exitAgentWorkspaceError,
  nowISO,
  readJSONExisting,
  runtimeMode,
  sessionMetadata,
  stateRoot,
  validateLocalID,
  workspaceDir,
  writeJSONAtomic,
} from './core.mjs';

const LOCK_DIRNAME = '.write-lock';

function assertPlainObject(value, file, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    exitAgentWorkspaceError(`${label} is schema-invalid: ${file}`, 'AGENT_WORKSPACE_STATE_CORRUPT', { path: file });
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isNullableString(value) {
  return value === null || typeof value === 'string';
}

function assertStringArray(value, file, label) {
  if (!Array.isArray(value) || value.some((item) => !isNonEmptyString(item))) {
    exitAgentWorkspaceError(`${label} is schema-invalid: ${file}`, 'AGENT_WORKSPACE_STATE_CORRUPT', { path: file });
  }
}

function assertArtifactRef(value, file, label) {
  assertPlainObject(value, file, label);
  if (!isNonEmptyString(value.role) || !isNonEmptyString(value.path)) {
    exitAgentWorkspaceError(`${label} is schema-invalid: ${file}`, 'AGENT_WORKSPACE_STATE_CORRUPT', { path: file });
  }
}

function assertPaths(value, file, label) {
  assertPlainObject(value, file, label);
  for (const key of ['workspace', 'snapshot', 'snapshot_record', 'capture', 'summary', 'refs', 'artifacts']) {
    if (!isNonEmptyString(value[key])) {
      exitAgentWorkspaceError(`${label} is schema-invalid: ${file}`, 'AGENT_WORKSPACE_STATE_CORRUPT', { path: file });
    }
  }
}

function assertSchemaVersion(value, file, label) {
  assertPlainObject(value, file, label);
  if (value.schema_version !== SCHEMA_VERSION) {
    exitAgentWorkspaceError(`${label} has an unsupported schema_version: ${file}`, 'AGENT_WORKSPACE_STATE_CORRUPT', { path: file });
  }
}

export function readWorkspaceMetadata(file, workspace, { optional = false } = {}) {
  const metadata = readJSONExisting(file);
  if (!metadata && optional) return null;
  if (!metadata) return null;
  assertSchemaVersion(metadata, file, 'workspace metadata');
  if (
    metadata.workspace_id !== workspace
    || !isNonEmptyString(metadata.runtime_mode)
    || !isNonEmptyString(metadata.state_root)
    || !isNonEmptyString(metadata.workspace_dir)
    || !isNonEmptyString(metadata.created_at)
    || !isNonEmptyString(metadata.updated_at)
    || !metadata.retention
    || typeof metadata.retention !== 'object'
    || Array.isArray(metadata.retention)
    || !metadata.session
    || typeof metadata.session !== 'object'
    || Array.isArray(metadata.session)
  ) {
    exitAgentWorkspaceError(`workspace metadata id mismatch: ${file}`, 'AGENT_WORKSPACE_STATE_CORRUPT', { path: file });
  }
  return metadata;
}

export function readWorkspaceIndex(file, workspace, { optional = false } = {}) {
  const index = readJSONExisting(file);
  if (!index && optional) return null;
  if (!index) return null;
  assertSchemaVersion(index, file, 'workspace index');
  if (
    index.workspace_id !== workspace
    || !isNonEmptyString(index.runtime_mode)
    || !(index.current_snapshot_id === null || isNonEmptyString(index.current_snapshot_id))
    || !Array.isArray(index.snapshots)
    || !isNonEmptyString(index.updated_at)
  ) {
    exitAgentWorkspaceError(`workspace index is schema-invalid: ${file}`, 'AGENT_WORKSPACE_STATE_CORRUPT', { path: file });
  }
  for (const snapshot of index.snapshots) {
    assertPlainObject(snapshot, file, 'workspace index snapshot');
    if (
      !isNonEmptyString(snapshot.snapshot_id)
      || !isNonEmptyString(snapshot.created_at)
      || !isNonEmptyString(snapshot.capture_mode)
      || !isNonEmptyString(snapshot.target)
      || !Number.isInteger(snapshot.ref_count)
      || snapshot.ref_count < 0
      || !Number.isInteger(snapshot.artifact_count)
      || snapshot.artifact_count < 0
    ) {
      exitAgentWorkspaceError(`workspace index is schema-invalid: ${file}`, 'AGENT_WORKSPACE_STATE_CORRUPT', { path: file });
    }
    assertPaths(snapshot.paths, file, 'workspace index snapshot paths');
  }
  return index;
}

export function readSnapshotRecord(file, workspace, snapshotIDValue) {
  const snapshot = readJSONExisting(file);
  if (!snapshot) return null;
  assertSchemaVersion(snapshot, file, 'snapshot record');
  if (
    snapshot.workspace_id !== workspace
    || snapshot.snapshot_id !== snapshotIDValue
    || !isNonEmptyString(snapshot.created_at)
    || !isNonEmptyString(snapshot.runtime_mode)
    || !isNonEmptyString(snapshot.capture_mode)
    || !isNonEmptyString(snapshot.ref_scope_grammar)
    || !isNonEmptyString(snapshot.target)
    || !Array.isArray(snapshot.artifact_refs)
    || !Number.isInteger(snapshot.ref_count)
    || snapshot.ref_count < 0
  ) {
    exitAgentWorkspaceError(`snapshot record id mismatch: ${file}`, 'AGENT_WORKSPACE_STATE_CORRUPT', { path: file });
  }
  assertPaths(snapshot.paths, file, 'snapshot record paths');
  assertStringArray(snapshot.omitted_from_compact_stdout, file, 'snapshot omitted payloads');
  assertStringArray(snapshot.known_limits, file, 'snapshot known limits');
  return snapshot;
}

function assertRefRecord(record, file, workspace, snapshotIDValue) {
  assertSchemaVersion(record, file, 'ref record');
  if (
    record.ref_scope !== 'snapshot'
    || record.workspace_id !== workspace
    || record.snapshot_id !== snapshotIDValue
    || !isNonEmptyString(record.ref)
    || !isNonEmptyString(record.short_action_target)
    || !isNullableString(record.action_target)
    || !isNullableString(record.copyable_action_target)
    || !isNonEmptyString(record.backend)
    || !isNonEmptyString(record.resolution_class)
    || !isNonEmptyString(record.confidence)
    || !isNonEmptyString(record.target_summary)
  ) {
    exitAgentWorkspaceError(`ref record is schema-invalid: ${file}`, 'AGENT_WORKSPACE_STATE_CORRUPT', { path: file });
  }
  assertStringArray(record.supported_actions, file, 'ref supported actions');
  assertStringArray(record.warnings, file, 'ref warnings');
  assertStringArray(record.known_limits, file, 'ref known limits');
  assertPlainObject(record.identity_facts, file, 'ref identity facts');
  if (
    !Object.hasOwn(record.identity_facts, 'state_id')
    || !Object.hasOwn(record.identity_facts, 'source_ref')
    || !isNullableString(record.identity_facts.state_id)
    || !isNullableString(record.identity_facts.source_ref)
  ) {
    exitAgentWorkspaceError(`ref record is schema-invalid: ${file}`, 'AGENT_WORKSPACE_STATE_CORRUPT', { path: file });
  }
  assertPlainObject(record.hint_facts, file, 'ref hint facts');
  assertPlainObject(record.current_address, file, 'ref current address');
  if (!Object.hasOwn(record.current_address, 'action_target') || !isNullableString(record.current_address.action_target)) {
    exitAgentWorkspaceError(`ref record is schema-invalid: ${file}`, 'AGENT_WORKSPACE_STATE_CORRUPT', { path: file });
  }
  if (!Array.isArray(record.artifact_refs)) {
    exitAgentWorkspaceError(`ref record is schema-invalid: ${file}`, 'AGENT_WORKSPACE_STATE_CORRUPT', { path: file });
  }
  for (const artifactRef of record.artifact_refs) assertArtifactRef(artifactRef, file, 'ref artifact ref');
}

export function readRefsRecord(file, workspace, snapshotIDValue) {
  const refs = readJSONExisting(file);
  if (!refs) return null;
  assertSchemaVersion(refs, file, 'refs record');
  if (
    refs.workspace_id !== workspace
    || refs.snapshot_id !== snapshotIDValue
    || !isNonEmptyString(refs.created_at)
    || !Array.isArray(refs.refs)
  ) {
    exitAgentWorkspaceError(`refs record is schema-invalid: ${file}`, 'AGENT_WORKSPACE_STATE_CORRUPT', { path: file });
  }
  for (const record of refs.refs) assertRefRecord(record, file, workspace, snapshotIDValue);
  return refs;
}

function workspaceLockDir(dir) {
  return path.join(dir, LOCK_DIRNAME);
}

export function workspaceLockState(dir) {
  const lockDir = workspaceLockDir(dir);
  if (!fs.existsSync(lockDir)) return { status: 'unlocked', path: lockDir };
  let owner = null;
  try {
    owner = JSON.parse(fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8'));
  } catch {
    owner = null;
  }
  return { status: 'locked', path: lockDir, owner };
}

export function withWorkspaceLock(workspace, callback, env = process.env, { create = false } = {}) {
  const dir = assertUnderWorkspacesRoot(workspaceDir(workspace, env), env);
  if (create) {
    fs.mkdirSync(dir, { recursive: true });
  } else if (!fs.existsSync(dir)) {
    exitAgentWorkspaceError(`Workspace '${workspace}' not found`, 'WORKSPACE_NOT_FOUND');
  }
  const lockDir = workspaceLockDir(dir);
  let lockHeld = false;
  try {
    fs.mkdirSync(lockDir);
    lockHeld = true;
  } catch (error) {
    if (error?.code === 'EEXIST') {
      exitAgentWorkspaceError(`Workspace '${workspace}' is locked for mutation: ${lockDir}`, 'AGENT_WORKSPACE_LOCKED', {
        workspace_id: workspace,
        lock_path: lockDir,
      });
    }
    if (error?.code === 'ENOENT') {
      exitAgentWorkspaceError(`Workspace '${workspace}' not found`, 'WORKSPACE_NOT_FOUND');
    }
    throw error;
  }
  try {
    writeJSONAtomic(path.join(lockDir, 'owner.json'), {
      schema_version: SCHEMA_VERSION,
      workspace_id: workspace,
      pid: process.pid,
      created_at: nowISO(),
      session: sessionMetadata(env),
    });
    return callback();
  } finally {
    if (lockHeld) fs.rmSync(lockDir, { recursive: true, force: true });
  }
}

export function ensureWorkspace(workspace, env = process.env) {
  const dir = assertUnderWorkspacesRoot(workspaceDir(workspace, env), env);
  const workspaceFile = path.join(dir, 'workspace.json');
  const indexFile = path.join(dir, 'index.json');
  fs.mkdirSync(path.join(dir, 'snapshots'), { recursive: true });

  let metadata = readWorkspaceMetadata(workspaceFile, workspace, { optional: true });
  if (!metadata) {
    metadata = defaultWorkspaceMetadata(workspace, env);
    writeJSONAtomic(workspaceFile, metadata);
  } else if (Object.hasOwn(metadata, 'current_snapshot_id')) {
    const { current_snapshot_id: _currentSnapshotID, ...withoutCurrentSnapshot } = metadata;
    metadata = withoutCurrentSnapshot;
    writeJSONAtomic(workspaceFile, metadata);
  }

  let index = readWorkspaceIndex(indexFile, workspace, { optional: true });
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

export function saveSnapshotToIndex(workspace, snapshot, env = process.env, { lockHeld = false } = {}) {
  const write = () => {
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
  };
  return lockHeld ? write() : withWorkspaceLock(workspace, write, env);
}

export function loadWorkspaceIndex(workspace, env = process.env) {
  const dir = workspaceDir(workspace, env);
  const index = readWorkspaceIndex(path.join(dir, 'index.json'), workspace);
  const metadata = readWorkspaceMetadata(path.join(dir, 'workspace.json'), workspace);
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
  const snapshotID = validateLocalID(snapshotIDValue, 'snapshot id');
  const snapshotDir = path.join(workspaceData.dir, 'snapshots', snapshotID);
  const snapshot = readSnapshotRecord(path.join(snapshotDir, 'snapshot.json'), workspace, snapshotID);
  const refs = readRefsRecord(path.join(snapshotDir, 'refs.json'), workspace, snapshotID);
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
  return withWorkspaceLock(workspace, () => {
    const current = requireWorkspace(workspace, env);
    const snapshotDir = path.join(current.dir, 'snapshots', validateLocalID(snapshot, 'snapshot id'));
    if (!fs.existsSync(snapshotDir)) {
      exitAgentWorkspaceError(`Snapshot '${snapshot}' not found in workspace '${workspace}'`, 'SNAPSHOT_NOT_FOUND');
    }
    const bytes = directoryBytes(snapshotDir);
    fs.rmSync(snapshotDir, { recursive: true, force: true });
    writeIndexAfterSnapshotRemoval(workspace, current, [snapshot], env);
    return { snapshotDir, bytes };
  }, env);
}

export function pruneSnapshots(workspace, candidates, { dryRun = false } = {}, env = process.env) {
  const prune = () => {
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
  };
  return dryRun ? prune() : withWorkspaceLock(workspace, prune, env);
}

export function deleteWorkspace(workspace, env = process.env) {
  return withWorkspaceLock(workspace, () => {
    const current = requireWorkspace(workspace, env);
    const dir = assertUnderWorkspacesRoot(current.dir, env);
    const bytes = directoryBytes(dir);
    fs.rmSync(dir, { recursive: true, force: true });
    return { dir, bytes };
  }, env);
}
