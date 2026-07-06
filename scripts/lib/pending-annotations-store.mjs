import fs from 'node:fs';
import path from 'node:path';
import {
  AgentWorkspaceError,
  readJSONExisting as readSharedJSONExisting,
  runtimeMode,
  stateDir,
  stateRoot,
  writeJSONAtomic,
} from './agent-workspace/core.mjs';
import {
  withLocalStateMutationLock,
} from './local-state-lock.mjs';
import {
  LIFECYCLE_STATES,
  SAFE_ID,
  SCHEMA_VERSION,
  TARGET_KINDS,
  CAPABILITY_STATUSES,
  fail,
  nowISO,
  validateID,
} from './pending-annotations-constants.mjs';

const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const DEFAULT_LOCK_STALE_MS = 30000;

export { runtimeMode, stateRoot };

export function pendingRoot(env = process.env) {
  return path.join(stateDir(env), 'pending-annotations');
}

export function indexPath(env = process.env) {
  return path.join(pendingRoot(env), 'index.json');
}

export function recordsDir(env = process.env) {
  return path.join(pendingRoot(env), 'records');
}

export function recordPath(id, env = process.env) {
  return path.join(recordsDir(env), `${validateID(id, 'annotation id')}.json`);
}

function lockDir(env = process.env) {
  return path.join(pendingRoot(env), '.mutation.lock');
}

export function readJSONExisting(file, { failOnCorrupt = true } = {}) {
  try {
    return readSharedJSONExisting(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (!failOnCorrupt) return null;
    if (error instanceof AgentWorkspaceError || error?.code === 'AGENT_WORKSPACE_STATE_CORRUPT') {
      fail(`Pending annotation state is corrupt or unreadable: ${file}`, 'PENDING_ANNOTATION_STATE_CORRUPT', { path: file });
    }
    fail(`Pending annotation state is corrupt or unreadable: ${file}`, 'PENDING_ANNOTATION_STATE_CORRUPT', { path: file });
  }
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function nullableString(value) {
  return value === null || nonEmptyString(value);
}

function assertStringArray(value) {
  return Array.isArray(value) && value.every(nonEmptyString);
}

function assertActor(value) {
  return isObject(value)
    && nonEmptyString(value.source)
    && isObject(value.session)
    && (value.session.id === null || typeof value.session.id === 'string')
    && nonEmptyString(value.session.mode)
    && nonEmptyString(value.session.harness);
}

function assertArtifactRefs(value) {
  return Array.isArray(value) && value.every((item) => (
    isObject(item)
    && nonEmptyString(item.role)
    && nonEmptyString(item.path)
    && (item.media_type === undefined || nonEmptyString(item.media_type))
    && (item.bytes === undefined || item.bytes === null || (Number.isInteger(item.bytes) && item.bytes >= 0))
  ));
}

function assertSavedRef(value) {
  return value === null || (
    isObject(value)
    && SAFE_ID.test(value.workspace_id)
    && SAFE_ID.test(value.snapshot_id)
    && SAFE_ID.test(value.ref)
    && nullableString(value.action_target)
  );
}

function assertSchemaShape(value) {
  if (
    !isObject(value)
    || value.schema_version !== SCHEMA_VERSION
    || !SAFE_ID.test(value.id)
    || !['repo', 'installed'].includes(value.runtime_mode)
    || !isObject(value.lifecycle)
    || !LIFECYCLE_STATES.has(value.lifecycle.state)
    || !nonEmptyString(value.lifecycle.created_at)
    || !nonEmptyString(value.lifecycle.updated_at)
    || !nullableString(value.lifecycle.consumed_at)
    || !(value.lifecycle.consumed_by === null || assertActor(value.lifecycle.consumed_by))
    || !nullableString(value.lifecycle.deleted_at)
    || !assertActor(value.actor)
    || !isObject(value.comment)
    || !nullableString(value.comment.text)
    || !isObject(value.target)
    || !TARGET_KINDS.has(value.target.kind)
    || !nonEmptyString(value.target.summary)
    || !assertSavedRef(value.target.saved_ref)
    || !isObject(value.capability)
    || !CAPABILITY_STATUSES.has(value.capability.status)
    || !assertStringArray(value.capability.reasons)
    || typeof value.capability.fallback_used !== 'boolean'
    || typeof value.capability.saved_ref_available !== 'boolean'
    || !Array.isArray(value.fallback_evidence)
    || !assertArtifactRefs(value.artifact_refs)
    || !Array.isArray(value.recommended_next)
    || value.recommended_next.length < 1
    || !Array.isArray(value.work_record_links)
    || !isObject(value.paths)
    || !nonEmptyString(value.paths.root)
    || !nonEmptyString(value.paths.record)
  ) {
    return false;
  }
  if (!value.fallback_evidence.every((item) => (
    isObject(item)
    && nonEmptyString(item.kind)
    && nonEmptyString(item.reason)
    && nonEmptyString(item.summary)
    && assertArtifactRefs(item.artifact_refs)
  ))) return false;
  for (const item of value.recommended_next) {
    if (!isObject(item) || !nonEmptyString(item.kind) || !nonEmptyString(item.reason) || !assertStringArray(item.argv)) {
      return false;
    }
  }
  if (!value.work_record_links.every((item) => (
    isObject(item)
    && nonEmptyString(item.ref)
    && nonEmptyString(item.relationship)
    && nonEmptyString(item.status)
    && assertArtifactRefs(item.artifact_refs)
    && (item.linked_at === undefined || nonEmptyString(item.linked_at))
    && (item.linked_by === undefined || assertActor(item.linked_by))
  ))) return false;
  return true;
}

function assertPathInvariants(record, file, env) {
  const expectedRoot = pendingRoot(env);
  const expectedRecord = recordPath(record.id, env);
  const expectedName = `${record.id}.json`;
  const resolvedRoot = path.resolve(expectedRoot);
  const resolvedRecord = path.resolve(record.paths.record);
  const resolvedExpectedRecord = path.resolve(expectedRecord);
  const resolvedFile = path.resolve(file);
  if (
    path.basename(file) !== expectedName
    || resolvedFile !== resolvedExpectedRecord
    || record.paths.root !== expectedRoot
    || record.paths.record !== expectedRecord
    || resolvedRecord !== resolvedExpectedRecord
    || (resolvedRecord !== resolvedRoot && !resolvedRecord.startsWith(`${resolvedRoot}${path.sep}`))
  ) {
    fail(`Pending annotation record has invalid path invariants: ${file}`, 'PENDING_ANNOTATION_STATE_CORRUPT', { path: file, id: record.id });
  }
}

export function validatePendingAnnotationRecord(value, file, env = process.env) {
  if (!assertSchemaShape(value) || value.runtime_mode !== runtimeMode(env)) {
    fail(`Pending annotation record is schema-invalid: ${file}`, 'PENDING_ANNOTATION_STATE_CORRUPT', { path: file });
  }
  assertPathInvariants(value, file, env);
  return value;
}

export function loadRecord(id, env = process.env) {
  const file = recordPath(id, env);
  const record = readJSONExisting(file);
  if (!record) fail(`Pending annotation not found: ${id}`, 'PENDING_ANNOTATION_NOT_FOUND', { id });
  return validatePendingAnnotationRecord(record, file, env);
}

export function annotationSummary(record, env = process.env) {
  validatePendingAnnotationRecord(record, recordPath(record.id, env), env);
  return {
    id: record.id,
    state: record.lifecycle.state,
    created_at: record.lifecycle.created_at,
    updated_at: record.lifecycle.updated_at,
    consumed_at: record.lifecycle.consumed_at ?? null,
    target_kind: record.target.kind,
    target_summary: record.target.summary,
    comment_text: record.comment?.text ?? null,
    capability_status: record.capability.status,
    saved_ref: record.target.saved_ref ?? null,
    fallback_count: record.fallback_evidence.length,
    recommended_next_count: record.recommended_next.length,
    work_record_link_count: Array.isArray(record.work_record_links) ? record.work_record_links.length : 0,
    path: recordPath(record.id, env),
  };
}

function defaultIndex(env = process.env) {
  const now = nowISO();
  return {
    schema_version: SCHEMA_VERSION,
    runtime_mode: runtimeMode(env),
    state_root: stateRoot(env),
    created_at: now,
    updated_at: now,
    annotations: [],
  };
}

function assertIndex(value, file, env = process.env) {
  if (!value) return null;
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || value.schema_version !== SCHEMA_VERSION
    || value.runtime_mode !== runtimeMode(env)
    || !Array.isArray(value.annotations)
  ) {
    return null;
  }
  for (const entry of value.annotations) {
    if (
      !entry
      || typeof entry !== 'object'
      || Array.isArray(entry)
      || !SAFE_ID.test(entry.id)
      || !LIFECYCLE_STATES.has(entry.state)
      || typeof entry.updated_at !== 'string'
    ) {
      return null;
    }
  }
  return value;
}

function listRecordFiles(env = process.env) {
  try {
    return fs.readdirSync(recordsDir(env))
      .filter((name) => name.endsWith('.json') && !name.includes('.tmp-'))
      .sort()
      .map((name) => path.join(recordsDir(env), name));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    fail(`Pending annotation records cannot be listed: ${recordsDir(env)}`, 'PENDING_ANNOTATION_STATE_CORRUPT', { path: recordsDir(env) });
  }
}

export function loadAllRecords(env = process.env) {
  return listRecordFiles(env).map((file) => validatePendingAnnotationRecord(readJSONExisting(file), file, env));
}

export function rebuildIndexFromRecords(env = process.env, previousIndex = null) {
  const previousCreatedAt = previousIndex?.created_at || nowISO();
  const annotations = loadAllRecords(env)
    .map((record) => annotationSummary(record, env))
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const index = {
    ...defaultIndex(env),
    created_at: previousCreatedAt,
    updated_at: nowISO(),
    annotations,
  };
  writeJSONAtomic(indexPath(env), index);
  return index;
}

export function loadIndex(env = process.env) {
  const raw = readJSONExisting(indexPath(env), { failOnCorrupt: false });
  const asserted = assertIndex(raw, indexPath(env), env);
  if (!asserted) return rebuildIndexFromRecords(env, raw);
  const records = loadAllRecords(env);
  const summaries = records.map((record) => annotationSummary(record, env));
  const assertedByID = new Map(asserted.annotations.map((entry) => [entry.id, entry]));
  const indexIDs = new Set(asserted.annotations.map((entry) => entry.id));
  const drift = asserted.annotations.length !== summaries.length
    || summaries.some((summary) => {
      const entry = assertedByID.get(summary.id);
      return !entry || !indexIDs.has(summary.id) || JSON.stringify(entry) !== JSON.stringify(summary);
    });
  if (drift) return rebuildIndexFromRecords(env, asserted);
  return asserted;
}

export function saveRecordAndRebuildIndex(record, env = process.env) {
  writeJSONAtomic(recordPath(record.id, env), record);
  rebuildIndexFromRecords(env);
}

export function withPendingAnnotationMutation(env, mutate) {
  const dir = lockDir(env);
  return withLocalStateMutationLock({
    lockDir: dir,
    ensureDir: pendingRoot(env),
    timeoutMs: env.AOS_PENDING_ANNOTATION_LOCK_TIMEOUT_MS ?? DEFAULT_LOCK_TIMEOUT_MS,
    staleMs: env.AOS_PENDING_ANNOTATION_STALE_LOCK_MS ?? DEFAULT_LOCK_STALE_MS,
    owner: {
      schema_version: SCHEMA_VERSION,
      runtime_mode: runtimeMode(env),
    },
    lockedError() {
      fail('Pending annotation store is locked by another mutation', 'PENDING_ANNOTATION_LOCKED', {
        status: 'locked',
        lock_path: dir,
      });
    },
  }, mutate);
}
