import fs from 'node:fs';
import path from 'node:path';
import {
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
  isPendingAnnotationError,
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

function processIsGone(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === 'ESRCH' ? true : null;
  }
}

function inspectLockStatus(env = process.env) {
  const dir = lockDir(env);
  let stat = null;
  try {
    stat = fs.lstatSync(dir);
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error?.code)) throw error;
  }
  if (!stat) return { status: 'absent', path: dir };
  if (stat.isSymbolicLink()) return { status: 'corrupt', path: dir, path_status: 'symlink' };
  if (!stat.isDirectory()) return { status: 'corrupt', path: dir, path_status: 'not_directory' };
  let owner = null;
  try {
    owner = JSON.parse(fs.readFileSync(path.join(dir, 'owner.json'), 'utf8'));
  } catch {
    owner = null;
  }
  const pid = Number(owner?.pid);
  const ownerPid = Number.isInteger(pid) && pid > 0 ? pid : null;
  const ageMs = Math.max(0, Date.now() - stat.mtimeMs);
  const gone = ownerPid ? processIsGone(ownerPid) : null;
  const staleMs = Number(env.AOS_PENDING_ANNOTATION_STALE_LOCK_MS ?? DEFAULT_LOCK_STALE_MS);
  const staleThreshold = Number.isFinite(staleMs) && staleMs >= 0 ? staleMs : DEFAULT_LOCK_STALE_MS;
  const stale = gone === true || (!ownerPid && ageMs >= staleThreshold);
  return {
    status: stale ? 'stale' : 'active',
    path: dir,
    owner_pid: ownerPid,
    age_ms: Math.round(ageMs),
  };
}

function pathInside(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function lstatIfExists(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail(`Pending annotation path cannot be inspected: ${file}`, 'PENDING_ANNOTATION_STATE_CORRUPT', {
      path: file,
      path_status: 'unreadable',
      storage_status: 'unreadable',
      cause_code: error?.code || 'UNKNOWN',
    });
  }
}

function realpathIfExists(file) {
  try {
    return fs.realpathSync(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    fail(`Pending annotation path cannot be resolved: ${file}`, 'PENDING_ANNOTATION_STATE_CORRUPT', {
      path: file,
      path_status: 'unreadable',
      storage_status: 'unreadable',
      cause_code: error?.code || 'UNKNOWN',
    });
  }
}

function failSymlink(file, label) {
  fail(`Pending annotation ${label} cannot be a symlink: ${file}`, 'PENDING_ANNOTATION_STATE_CORRUPT', {
    path: file,
    path_status: 'symlink',
    storage_status: 'symlink',
  });
}

export function canonicalPendingRoot(env = process.env, { forWrite = false } = {}) {
  const root = pendingRoot(env);
  const resolved = path.resolve(root);
  const existing = lstatIfExists(root);
  if (!existing) {
    if (!forWrite) return { path: root, resolved, real: resolved, exists: false };
    fs.mkdirSync(root, { recursive: true });
    return canonicalPendingRoot(env, { forWrite: false });
  }
  if (existing.isSymbolicLink()) failSymlink(root, 'root');
  if (!existing.isDirectory()) {
    fail(`Pending annotation root is not a directory: ${root}`, 'PENDING_ANNOTATION_STATE_CORRUPT', {
      path: root,
      path_status: 'not_directory',
      storage_status: 'not_directory',
    });
  }
  return { path: root, resolved, real: fs.realpathSync(root), exists: true };
}

export function canonicalRecordsDir(env = process.env, { forWrite = false } = {}) {
  const root = canonicalPendingRoot(env, { forWrite });
  const dir = recordsDir(env);
  const existing = lstatIfExists(dir);
  if (!existing) {
    if (!forWrite) return null;
    fs.mkdirSync(dir, { recursive: true });
    return canonicalRecordsDir(env, { forWrite: false });
  }
  if (existing.isSymbolicLink()) failSymlink(dir, 'records directory');
  if (!existing.isDirectory()) {
    fail(`Pending annotation records path is not a directory: ${dir}`, 'PENDING_ANNOTATION_STATE_CORRUPT', { path: dir });
  }
  const real = fs.realpathSync(dir);
  if (!pathInside(root.real, real)) {
    fail(`Pending annotation records directory escapes root: ${dir}`, 'PENDING_ANNOTATION_STATE_CORRUPT', {
      path: dir,
      path_status: 'path_escape',
      storage_status: 'path_escape',
    });
  }
  return { path: dir, real, root };
}

export function canonicalIndexPath(env = process.env) {
  const root = canonicalPendingRoot(env);
  const file = indexPath(env);
  const existing = lstatIfExists(file);
  if (!existing) return { path: file, real: null, root };
  if (existing.isSymbolicLink()) failSymlink(file, 'index file');
  const real = realpathIfExists(file);
  if (real && !pathInside(root.real, real)) {
    fail(`Pending annotation index escapes root: ${file}`, 'PENDING_ANNOTATION_STATE_CORRUPT', {
      path: file,
      path_status: 'path_escape',
      storage_status: 'path_escape',
    });
  }
  return { path: file, real, root };
}

export function canonicalRecordPath(id, env = process.env) {
  const dir = canonicalRecordsDir(env);
  const file = recordPath(id, env);
  const existing = lstatIfExists(file);
  if (!existing) return { path: file, real: null, records: dir };
  if (!dir) {
    fail(`Pending annotation record exists without records directory: ${file}`, 'PENDING_ANNOTATION_STATE_CORRUPT', {
      path: file,
      id,
      storage_status: 'invalid_record_shape',
    });
  }
  if (existing.isSymbolicLink()) failSymlink(file, 'record file');
  const real = realpathIfExists(file);
  if (real && !pathInside(dir.root.real, real)) {
    fail(`Pending annotation record escapes root: ${file}`, 'PENDING_ANNOTATION_STATE_CORRUPT', {
      path: file,
      id,
      path_status: 'path_escape',
      storage_status: 'path_escape',
    });
  }
  return { path: file, real, records: dir };
}

export function readJSONExisting(file, { failOnCorrupt = true } = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (!failOnCorrupt) return null;
    const status = error instanceof SyntaxError ? 'corrupt' : 'unreadable';
    fail(`Pending annotation state is ${status}: ${file}`, 'PENDING_ANNOTATION_STATE_CORRUPT', {
      path: file,
      status,
      storage_status: status === 'corrupt' ? 'corrupt_json' : 'unreadable',
      ...(status === 'unreadable' ? { cause_code: error?.code || 'UNKNOWN' } : {}),
    });
  }
}

export function validatePendingAnnotationRecord(value, file, env = process.env) {
  const record = validateModelPendingAnnotationRecord(value, {
    file,
    runtime_mode: runtimeMode(env),
    pending_root: pendingRoot(env),
    record_path_for_id: (id) => recordPath(id, env),
  });
  const expected = recordPath(record.id, env);
  if (file !== expected || record.paths.record !== expected) {
    fail(`Pending annotation record path does not match id: ${file}`, 'PENDING_ANNOTATION_STATE_CORRUPT', {
      path: file,
      id: record.id,
      storage_status: 'invalid_record_shape',
    });
  }
  canonicalRecordPath(record.id, env);
  return record;
}

export function loadRecord(id, env = process.env) {
  const file = canonicalRecordPath(id, env).path;
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
  const dir = canonicalRecordsDir(env);
  if (!dir) return [];
  try {
    return fs.readdirSync(dir.path)
      .filter((name) => name.endsWith('.json') && !name.includes('.tmp-'))
      .sort()
      .map((name) => path.join(dir.path, name));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    fail(`Pending annotation records cannot be listed: ${dir.path}`, 'PENDING_ANNOTATION_STATE_CORRUPT', {
      path: dir.path,
      storage_status: 'unreadable',
      cause_code: error?.code || 'UNKNOWN',
    });
  }
}

export function loadAllRecords(env = process.env) {
  return listRecordFiles(env).map((file) => {
    const id = path.basename(file, '.json');
    const canonical = canonicalRecordPath(id, env);
    return validatePendingAnnotationRecord(readJSONExisting(canonical.path), canonical.path, env);
  });
}

function summariesFromRecords(records, env = process.env) {
  return records
    .map((record) => annotationSummary(record, env))
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

function buildIndexFromRecordList(records, env = process.env, previousIndex = null) {
  const previousCreatedAt = previousIndex?.created_at || nowISO();
  return {
    ...defaultIndex(env),
    created_at: previousCreatedAt,
    updated_at: nowISO(),
    annotations: summariesFromRecords(records, env),
  };
}

export function buildIndexFromRecords(env = process.env, previousIndex = null, { write = false } = {}) {
  const records = loadAllRecords(env);
  const index = buildIndexFromRecordList(records, env, previousIndex);
  if (write) writeJSONAtomic(indexPath(env), index);
  return index;
}

export function rebuildIndexFromRecords(env = process.env, previousIndex = null) {
  return buildIndexFromRecords(env, previousIndex, { write: true });
}

export function loadIndex(env = process.env) {
  return loadIndexReadOnly(env);
}

function readIndexCandidate(env = process.env) {
  canonicalIndexPath(env);
  return readJSONExisting(indexPath(env), { failOnCorrupt: false });
}

function indexDrifted(asserted, summaries) {
  const assertedByID = new Map(asserted.annotations.map((entry) => [entry.id, entry]));
  const indexIDs = new Set(asserted.annotations.map((entry) => entry.id));
  return asserted.annotations.length !== summaries.length
    || summaries.some((summary) => {
      const entry = assertedByID.get(summary.id);
      return !entry || !indexIDs.has(summary.id) || JSON.stringify(entry) !== JSON.stringify(summary);
    });
}

export function loadIndexReadOnly(env = process.env) {
  const raw = readIndexCandidate(env);
  const asserted = assertIndex(raw, indexPath(env), env);
  if (!asserted) return buildIndexFromRecords(env, null, { write: false });
  const records = loadAllRecords(env);
  const summaries = summariesFromRecords(records, env);
  if (indexDrifted(asserted, summaries)) return buildIndexFromRecords(env, asserted, { write: false });
  return asserted;
}

function storageErrorStatus(error, fallbackStatus = 'corrupt') {
  if (!isPendingAnnotationError(error)) throw error;
  const structuredStatus = error.extra?.path_status || error.extra?.storage_status;
  switch (structuredStatus) {
    case 'symlink':
    case 'not_directory':
    case 'path_escape':
    case 'unreadable':
    case 'unknown':
    case 'corrupt':
      return structuredStatus;
    case 'corrupt_json':
    case 'invalid_record_shape':
    case 'invalid_index_shape':
      return 'corrupt';
    default:
      return fallbackStatus;
  }
}

function storageErrorDetails(error, prefix) {
  const status = storageErrorStatus(error);
  const pathValue = typeof error.extra?.path === 'string' ? error.extra.path : null;
  const storageStatus = typeof error.extra?.storage_status === 'string' ? error.extra.storage_status : null;
  const pathStatus = typeof error.extra?.path_status === 'string' ? error.extra.path_status : null;
  return {
    [`${prefix}_error_status`]: status,
    ...(storageStatus ? { [`${prefix}_error_storage_status`]: storageStatus } : {}),
    ...(pathStatus ? { [`${prefix}_error_path_status`]: pathStatus } : {}),
    ...(pathValue ? { [`${prefix}_error_path`]: pathValue } : {}),
  };
}

export function pendingAnnotationStoreStatus(env = process.env) {
  const base = {
    root: pendingRoot(env),
    records_dir: recordsDir(env),
    index_path: indexPath(env),
  };
  const unknownLock = () => ({ status: 'unknown', path: lockDir(env) });

  try {
    const root = canonicalPendingRoot(env, { forWrite: false });
    if (!root.exists) {
      return {
        status: 'not_initialized',
        ...base,
        lock: unknownLock(),
        root_status: 'missing',
        records_status: 'missing',
        index_status: 'missing',
        record_count: 0,
      };
    }
  } catch (error) {
    return {
      status: 'corrupt',
      ...base,
      lock: unknownLock(),
      root_status: storageErrorStatus(error),
      records_status: 'unknown',
      index_status: 'unknown',
      record_count: 0,
      ...storageErrorDetails(error, 'root'),
    };
  }

  const lock = inspectLockStatus(env);
  const baseWithLock = { ...base, lock };

  if (lock.status === 'corrupt') {
    return {
      status: 'corrupt',
      ...baseWithLock,
      root_status: 'exists',
      records_status: 'unknown',
      index_status: 'unknown',
      record_count: 0,
    };
  }

  let recordCount = 0;
  let recordsStatus = 'missing';
  try {
    const records = canonicalRecordsDir(env, { forWrite: false });
    if (records) {
      recordsStatus = 'exists';
      recordCount = loadAllRecords(env).length;
    }
  } catch (error) {
    const recordsErrorStatus = storageErrorStatus(error);
    return {
      status: 'corrupt',
      ...baseWithLock,
      root_status: 'exists',
      records_status: recordsErrorStatus,
      index_status: 'unknown',
      record_count: 0,
      ...storageErrorDetails(error, 'records'),
    };
  }

  let indexStatus = 'missing';
  try {
    const index = canonicalIndexPath(env);
    if (index.real) {
      const raw = readJSONExisting(index.path, { failOnCorrupt: false });
      indexStatus = assertIndex(raw, index.path, env) ? 'present' : 'corrupt';
    }
  } catch (error) {
    return {
      status: 'corrupt',
      ...baseWithLock,
      root_status: 'exists',
      records_status: recordsStatus,
      index_status: storageErrorStatus(error),
      record_count: recordCount,
      ...storageErrorDetails(error, 'index'),
    };
  }

  return {
    status: lock.status === 'stale' ? 'stale' : (recordsStatus === 'exists' ? 'initialized' : 'not_initialized'),
    ...baseWithLock,
    root_status: 'exists',
    records_status: recordsStatus,
    index_status: indexStatus,
    record_count: recordCount,
  };
}

function bestEffortWriteIndexFromRecords(records, env = process.env) {
  try {
    const previousIndex = readIndexCandidate(env);
    const assertedPreviousIndex = assertIndex(previousIndex, indexPath(env), env);
    const proposedIndex = buildIndexFromRecordList(records, env, assertedPreviousIndex);
    if (!assertIndex(proposedIndex, indexPath(env), env)) return;
    writeJSONAtomic(indexPath(env), proposedIndex);
  } catch {
    // Records are the durable source of truth; index.json is a disposable cache.
  }
}

function recordsByID(records) {
  return new Map(records.map((record) => [record.id, record]));
}

function validateProposedRecords(records, env = process.env) {
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.id)) {
      fail(`Duplicate pending annotation id in proposed store: ${record.id}`, 'PENDING_ANNOTATION_STATE_CORRUPT', { id: record.id });
    }
    seen.add(record.id);
    validatePendingAnnotationRecord(record, recordPath(record.id, env), env);
  }
}

export function commitPendingAnnotationRecordMutation(env, planMutation) {
  return withPendingAnnotationMutation(env, () => {
    const existingRecords = loadAllRecords(env);
    const existingByID = recordsByID(existingRecords);
    const planned = planMutation({
      records: existingRecords,
      recordsByID: existingByID,
    });
    if (Array.isArray(planned?.changedRecords)) {
      fail('Pending annotation mutations support one changed record plus index only', 'PENDING_ANNOTATION_INTERNAL_CONTRACT', {
        status: 'invalid_mutation_plan',
        changed_record_count: planned.changedRecords.length,
      });
    }
    const changedRecord = planned?.changedRecord ?? null;
    const proposedByID = recordsByID(existingRecords);
    if (changedRecord) proposedByID.set(changedRecord.id, changedRecord);
    const proposedRecords = [...proposedByID.values()]
      .sort((a, b) => a.id.localeCompare(b.id));
    validateProposedRecords(proposedRecords, env);
    canonicalRecordsDir(env, { forWrite: true });
    if (changedRecord) {
      canonicalRecordPath(changedRecord.id, env);
      writeJSONAtomic(recordPath(changedRecord.id, env), changedRecord);
    }
    bestEffortWriteIndexFromRecords(proposedRecords, env);
    return planned?.result;
  });
}

export function withPendingAnnotationMutation(env, mutate) {
  canonicalPendingRoot(env, { forWrite: true });
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
