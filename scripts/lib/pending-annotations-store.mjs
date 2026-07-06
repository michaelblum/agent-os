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
  SCHEMA_VERSION,
  SAFE_ID,
  LIFECYCLE_STATES,
  annotationSummary as modelAnnotationSummary,
  validateID,
  validatePendingAnnotationRecord as validateModelPendingAnnotationRecord,
} from './pending-annotations-model.mjs';
import {
  fail,
  nowISO,
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

export function validatePendingAnnotationRecord(value, file, env = process.env) {
  return validateModelPendingAnnotationRecord(value, {
    file,
    runtime_mode: runtimeMode(env),
    pending_root: pendingRoot(env),
    record_path_for_id: (id) => recordPath(id, env),
  });
}

export function loadRecord(id, env = process.env) {
  const file = recordPath(id, env);
  const record = readJSONExisting(file);
  if (!record) fail(`Pending annotation not found: ${id}`, 'PENDING_ANNOTATION_NOT_FOUND', { id });
  return validatePendingAnnotationRecord(record, file, env);
}

export function annotationSummary(record, env = process.env) {
  validatePendingAnnotationRecord(record, recordPath(record.id, env), env);
  return modelAnnotationSummary(record, { path: recordPath(record.id, env) });
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

export function buildIndexFromRecords(env = process.env, previousIndex = null, { write = false } = {}) {
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
  if (write) writeJSONAtomic(indexPath(env), index);
  return index;
}

export function rebuildIndexFromRecords(env = process.env, previousIndex = null) {
  return buildIndexFromRecords(env, previousIndex, { write: true });
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

export function loadIndexReadOnly(env = process.env) {
  const raw = readJSONExisting(indexPath(env), { failOnCorrupt: false });
  const asserted = assertIndex(raw, indexPath(env), env);
  if (!asserted) return buildIndexFromRecords(env, null, { write: false });
  const records = loadAllRecords(env);
  const summaries = records
    .map((record) => annotationSummary(record, env))
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const assertedByID = new Map(asserted.annotations.map((entry) => [entry.id, entry]));
  const indexIDs = new Set(asserted.annotations.map((entry) => entry.id));
  const drift = asserted.annotations.length !== summaries.length
    || summaries.some((summary) => {
      const entry = assertedByID.get(summary.id);
      return !entry || !indexIDs.has(summary.id) || JSON.stringify(entry) !== JSON.stringify(summary);
    });
  if (drift) return buildIndexFromRecords(env, asserted, { write: false });
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
