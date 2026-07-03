import fs from 'node:fs';
import path from 'node:path';
import {
  SAFE_ID,
  SCHEMA_VERSION,
  assertUnderWorkspacesRoot,
  defaultWorkspaceMetadata,
  directoryBytes,
  exitAgentWorkspaceError,
  nowISO,
  randomToken,
  readJSONExisting,
  runtimeMode,
  sessionMetadata,
  stateRoot,
  validateLocalID,
  workspaceDir,
  writeJSONAtomic,
} from './core.mjs';
import {
  isSavedRefBackend,
  isSavedRefConfidence,
  isSavedRefResolutionClass,
} from './contracts.mjs';

const LOCK_DIRNAME = '.write-lock';
const STAGING_DIRNAME = '.staging';
const COMMITTED_MARKER = 'committed.json';

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

function assertConformance(value, file, label) {
  assertPlainObject(value, file, label);
  if (
    !isNonEmptyString(value.actionability)
    || !isNonEmptyString(value.mutation)
    || !isNonEmptyString(value.validation)
    || !isNonEmptyString(value.proof_level)
  ) {
    exitAgentWorkspaceError(`${label} is schema-invalid: ${file}`, 'AGENT_WORKSPACE_STATE_CORRUPT', { path: file });
  }
  assertPlainObject(value.proof, file, `${label} proof`);
  if (
    !isNonEmptyString(value.proof.level)
    || !isNonEmptyString(value.proof.status)
    || !Array.isArray(value.proof.evidence)
    || !Array.isArray(value.proof.approval_gates)
  ) {
    exitAgentWorkspaceError(`${label} is schema-invalid: ${file}`, 'AGENT_WORKSPACE_STATE_CORRUPT', { path: file });
  }
  assertStringArray(value.proof.evidence, file, `${label} proof evidence`);
  if (value.proof.approval_gates.some((item) => !isNonEmptyString(item))) {
    exitAgentWorkspaceError(`${label} is schema-invalid: ${file}`, 'AGENT_WORKSPACE_STATE_CORRUPT', { path: file });
  }
  assertPlainObject(value.no_foreground, file, `${label} no_foreground`);
  assertPlainObject(value.target_uncertainty, file, `${label} target_uncertainty`);
  if (
    !isNonEmptyString(value.no_foreground.claim)
    || !isNonEmptyString(value.no_foreground.focus_preservation)
    || !isNonEmptyString(value.no_foreground.cursor_preservation)
    || !isNonEmptyString(value.no_foreground.space_preservation)
    || typeof value.no_foreground.fallback_used !== 'boolean'
    || typeof value.no_foreground.foreground_fallback_required !== 'boolean'
    || !isNonEmptyString(value.no_foreground.permission_state)
  ) {
    exitAgentWorkspaceError(`${label} is schema-invalid: ${file}`, 'AGENT_WORKSPACE_STATE_CORRUPT', { path: file });
  }
  if (
    !isNonEmptyString(value.target_uncertainty.status)
    || !Array.isArray(value.target_uncertainty.reasons)
    || !Array.isArray(value.target_uncertainty.missing_identity_facts)
    || !Array.isArray(value.target_uncertainty.available_identity_facts)
  ) {
    exitAgentWorkspaceError(`${label} is schema-invalid: ${file}`, 'AGENT_WORKSPACE_STATE_CORRUPT', { path: file });
  }
  assertStringArray(value.target_uncertainty.reasons, file, `${label} target uncertainty reasons`);
  if (value.target_uncertainty.missing_identity_facts.some((item) => !isNonEmptyString(item))) {
    exitAgentWorkspaceError(`${label} is schema-invalid: ${file}`, 'AGENT_WORKSPACE_STATE_CORRUPT', { path: file });
  }
  if (value.target_uncertainty.available_identity_facts.some((item) => !isNonEmptyString(item))) {
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
      || !isNonEmptyString(snapshot.capture_target)
      || !isNonEmptyString(snapshot.target)
      || !isNullableString(snapshot.query)
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
    || !isNonEmptyString(snapshot.capture_target)
    || !isNonEmptyString(snapshot.ref_scope_grammar)
    || !isNonEmptyString(snapshot.target)
    || !isNullableString(snapshot.query)
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
    || !isNonEmptyString(record.capture_target)
    || !isNonEmptyString(record.capture_mode)
    || !isNonEmptyString(record.ref)
    || !isNonEmptyString(record.short_action_target)
    || !isNullableString(record.action_target)
    || !isNullableString(record.copyable_action_target)
    || !isSavedRefBackend(record.backend)
    || !isSavedRefResolutionClass(record.resolution_class)
    || !isSavedRefConfidence(record.confidence)
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
  assertConformance(record.conformance, file, 'ref conformance');
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

function snapshotsRoot(dir) {
  return path.join(dir, 'snapshots');
}

function committedMarkerPath(snapshotDir) {
  return path.join(snapshotDir, COMMITTED_MARKER);
}

function snapshotFilePaths(dir, snapshotIDValue, snapshotDir = path.join(snapshotsRoot(dir), snapshotIDValue)) {
  const artifactsDir = path.join(snapshotDir, 'artifacts');
  return {
    workspace: dir,
    snapshot: snapshotDir,
    snapshot_record: path.join(snapshotDir, 'snapshot.json'),
    capture: path.join(snapshotDir, 'capture.json'),
    summary: path.join(snapshotDir, 'summary.json'),
    refs: path.join(snapshotDir, 'refs.json'),
    artifacts: artifactsDir,
  };
}

function readCommittedMarker(file, workspace, snapshotIDValue, { optional = false } = {}) {
  const marker = readJSONExisting(file);
  if (!marker && optional) return null;
  if (!marker) return null;
  assertSchemaVersion(marker, file, 'snapshot commit marker');
  if (
    marker.workspace_id !== workspace
    || marker.snapshot_id !== snapshotIDValue
    || !isNonEmptyString(marker.committed_at)
    || marker.snapshot_record !== 'snapshot.json'
  ) {
    exitAgentWorkspaceError(`snapshot commit marker is schema-invalid: ${file}`, 'AGENT_WORKSPACE_STATE_CORRUPT', { path: file });
  }
  return marker;
}

function isCommittedSnapshotDir(snapshotDir, workspace, snapshotIDValue) {
  return Boolean(readCommittedMarker(committedMarkerPath(snapshotDir), workspace, snapshotIDValue, { optional: true }));
}

function snapshotIndexEntry(snapshot) {
  return {
    snapshot_id: snapshot.snapshot_id,
    created_at: snapshot.created_at,
    capture_mode: snapshot.capture_mode,
    capture_target: snapshot.capture_target,
    target: snapshot.target,
    query: snapshot.query ?? null,
    ref_count: snapshot.ref_count,
    artifact_count: snapshot.artifact_refs.length,
    paths: snapshot.paths,
  };
}

function sortSnapshotEntries(entries) {
  return entries.sort((a, b) => {
    const at = Date.parse(a.created_at ?? '');
    const bt = Date.parse(b.created_at ?? '');
    if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return bt - at;
    return String(b.snapshot_id).localeCompare(String(a.snapshot_id));
  });
}

function committedSnapshotIndexEntries(dir, workspace) {
  const root = snapshotsRoot(dir);
  if (!fs.existsSync(root)) return [];
  const entries = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === STAGING_DIRNAME) continue;
    if (!SAFE_ID.test(entry.name)) continue;
    const snapshotDir = path.join(root, entry.name);
    if (!isCommittedSnapshotDir(snapshotDir, workspace, entry.name)) continue;
    const snapshot = readSnapshotRecord(path.join(snapshotDir, 'snapshot.json'), workspace, entry.name);
    readRefsRecord(path.join(snapshotDir, 'refs.json'), workspace, entry.name);
    entries.push(snapshotIndexEntry(snapshot));
  }
  return sortSnapshotEntries(entries);
}

function readWorkspaceIndexForReconcile(indexFile, workspace) {
  try {
    return readWorkspaceIndex(indexFile, workspace, { optional: true });
  } catch (error) {
    if (error?.code === 'AGENT_WORKSPACE_STATE_CORRUPT') return null;
    throw error;
  }
}

function indexMatchesCommitted(index, next) {
  if (!index) return false;
  return index.schema_version === next.schema_version
    && index.workspace_id === next.workspace_id
    && index.runtime_mode === next.runtime_mode
    && index.current_snapshot_id === next.current_snapshot_id
    && JSON.stringify(index.snapshots ?? []) === JSON.stringify(next.snapshots ?? []);
}

function reconcileWorkspaceIndex(workspace, current, env = process.env, { preferredCurrentSnapshotID = null, write = true } = {}) {
  const entries = committedSnapshotIndexEntries(current.dir, workspace);
  const hasPreferred = preferredCurrentSnapshotID && entries.some((item) => item.snapshot_id === preferredCurrentSnapshotID);
  const hasExistingCurrent = current.index?.current_snapshot_id
    && entries.some((item) => item.snapshot_id === current.index.current_snapshot_id);
  const currentSnapshotID = hasPreferred
    ? preferredCurrentSnapshotID
    : (hasExistingCurrent ? current.index.current_snapshot_id : (entries[0]?.snapshot_id ?? null));
  const next = {
    schema_version: SCHEMA_VERSION,
    workspace_id: workspace,
    runtime_mode: runtimeMode(env),
    current_snapshot_id: currentSnapshotID,
    snapshots: entries,
    updated_at: current.index?.updated_at ?? nowISO(),
  };
  if (!indexMatchesCommitted(current.index, next) && write) {
    next.updated_at = nowISO();
    writeJSONAtomic(current.indexFile, next);
    refreshWorkspaceMetadata(workspace, current, env);
  }
  return next;
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
  fs.mkdirSync(snapshotsRoot(dir), { recursive: true });

  let metadata = readWorkspaceMetadata(workspaceFile, workspace, { optional: true });
  if (!metadata) {
    metadata = defaultWorkspaceMetadata(workspace, env);
    writeJSONAtomic(workspaceFile, metadata);
  } else if (Object.hasOwn(metadata, 'current_snapshot_id')) {
    const { current_snapshot_id: _currentSnapshotID, ...withoutCurrentSnapshot } = metadata;
    metadata = withoutCurrentSnapshot;
    writeJSONAtomic(workspaceFile, metadata);
  }

  let index = readWorkspaceIndexForReconcile(indexFile, workspace);
  index = reconcileWorkspaceIndex(workspace, { dir, workspaceFile, indexFile, metadata, index }, env, { write: true });

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

export function prepareSnapshotWrite(workspace, snapshotIDValue, env = process.env) {
  const snapshotID = validateLocalID(snapshotIDValue, 'snapshot id');
  const current = ensureWorkspace(workspace, env);
  const finalDir = path.join(snapshotsRoot(current.dir), snapshotID);
  if (fs.existsSync(finalDir)) {
    if (isCommittedSnapshotDir(finalDir, workspace, snapshotID)) {
      exitAgentWorkspaceError(`Snapshot '${snapshotID}' already exists in workspace '${workspace}'`, 'SNAPSHOT_EXISTS');
    }
    fs.rmSync(finalDir, { recursive: true, force: true });
  }
  const stagingRoot = path.join(snapshotsRoot(current.dir), STAGING_DIRNAME);
  const stagingDir = path.join(stagingRoot, `${snapshotID}.${process.pid}.${randomToken()}`);
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(stagingDir, 'artifacts'), { recursive: true });
  return {
    current,
    snapshot_id: snapshotID,
    finalDir,
    stagingDir,
    finalPaths: snapshotFilePaths(current.dir, snapshotID, finalDir),
    stagedPaths: snapshotFilePaths(current.dir, snapshotID, stagingDir),
  };
}

export function cleanupStagedSnapshot(prepared) {
  if (prepared?.stagingDir) fs.rmSync(prepared.stagingDir, { recursive: true, force: true });
}

export function commitStagedSnapshot(workspace, snapshot, prepared, env = process.env) {
  writeJSONAtomic(path.join(prepared.stagingDir, COMMITTED_MARKER), {
    schema_version: SCHEMA_VERSION,
    workspace_id: workspace,
    snapshot_id: snapshot.snapshot_id,
    committed_at: nowISO(),
    snapshot_record: 'snapshot.json',
    session: sessionMetadata(env),
  });
  fs.renameSync(prepared.stagingDir, prepared.finalDir);
  return saveSnapshotToIndex(workspace, snapshot, env, { lockHeld: true });
}

export function saveSnapshotToIndex(workspace, snapshot, env = process.env, { lockHeld = false } = {}) {
  const write = () => {
    const current = ensureWorkspace(workspace, env);
    return reconcileWorkspaceIndex(workspace, current, env, { preferredCurrentSnapshotID: snapshot.snapshot_id });
  };
  return lockHeld ? write() : withWorkspaceLock(workspace, write, env);
}

export function loadWorkspaceIndex(workspace, env = process.env, { repair = false } = {}) {
  const dir = workspaceDir(workspace, env);
  const workspaceFile = path.join(dir, 'workspace.json');
  const indexFile = path.join(dir, 'index.json');
  const metadata = readWorkspaceMetadata(workspaceFile, workspace, { optional: true });
  if (!metadata) return { dir, index: null, metadata: null };
  const index = reconcileWorkspaceIndex(workspace, {
    dir,
    workspaceFile,
    indexFile,
    metadata,
    index: readWorkspaceIndexForReconcile(indexFile, workspace),
  }, env, { write: repair });
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
  if (!isCommittedSnapshotDir(snapshotDir, workspace, snapshotID)) {
    exitAgentWorkspaceError(`Snapshot '${snapshotIDValue}' not found in workspace '${workspace}'`, 'SNAPSHOT_NOT_FOUND');
  }
  const snapshot = readSnapshotRecord(path.join(snapshotDir, 'snapshot.json'), workspace, snapshotID);
  const refs = readRefsRecord(path.join(snapshotDir, 'refs.json'), workspace, snapshotID);
  if (!snapshot || !refs) {
    exitAgentWorkspaceError(`Snapshot '${snapshotIDValue}' not found in workspace '${workspace}'`, 'SNAPSHOT_NOT_FOUND');
  }
  return { workspaceData, snapshotDir, snapshot, refs };
}

function writeIndexAfterSnapshotRemoval(workspace, current, env = process.env) {
  return reconcileWorkspaceIndex(workspace, {
    ...current,
    workspaceFile: path.join(current.dir, 'workspace.json'),
    indexFile: path.join(current.dir, 'index.json'),
  }, env);
}

export function deleteSnapshot(workspace, snapshot, env = process.env) {
  return withWorkspaceLock(workspace, () => {
    const current = requireWorkspace(workspace, env);
    const snapshotDir = path.join(current.dir, 'snapshots', validateLocalID(snapshot, 'snapshot id'));
    if (!fs.existsSync(snapshotDir) || !isCommittedSnapshotDir(snapshotDir, workspace, snapshot)) {
      exitAgentWorkspaceError(`Snapshot '${snapshot}' not found in workspace '${workspace}'`, 'SNAPSHOT_NOT_FOUND');
    }
    const bytes = directoryBytes(snapshotDir);
    fs.rmSync(snapshotDir, { recursive: true, force: true });
    writeIndexAfterSnapshotRemoval(workspace, current, env);
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
      writeIndexAfterSnapshotRemoval(workspace, current, env);
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
