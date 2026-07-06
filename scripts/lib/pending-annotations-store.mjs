import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  JSON_SPACING,
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

export function runtimeMode(env = process.env) {
  return env.AOS_RUNTIME_MODE?.toLowerCase() === 'installed' ? 'installed' : 'repo';
}

export function stateRoot(env = process.env) {
  return path.resolve(env.AOS_STATE_ROOT || path.join(os.homedir(), '.config/aos'));
}

export function pendingRoot(env = process.env) {
  return path.join(stateRoot(env), runtimeMode(env), 'pending-annotations');
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

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
  }
  return value;
}

export function writeJSONAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(sortObject(value), null, JSON_SPACING)}\n`);
  fs.renameSync(tmp, file);
}

export function readJSONExisting(file, { failOnCorrupt = true } = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (!failOnCorrupt) return null;
    fail(`Pending annotation state is corrupt or unreadable: ${file}`, 'PENDING_ANNOTATION_STATE_CORRUPT', { path: file });
  }
}

export function assertRecord(value, file, env = process.env) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || value.schema_version !== SCHEMA_VERSION
    || !SAFE_ID.test(value.id)
    || value.runtime_mode !== runtimeMode(env)
    || !value.lifecycle
    || !LIFECYCLE_STATES.has(value.lifecycle.state)
    || !value.target
    || !TARGET_KINDS.has(value.target.kind)
    || !value.capability
    || !CAPABILITY_STATUSES.has(value.capability.status)
    || !Array.isArray(value.recommended_next)
    || !Array.isArray(value.artifact_refs)
  ) {
    fail(`Pending annotation record is schema-invalid: ${file}`, 'PENDING_ANNOTATION_STATE_CORRUPT', { path: file });
  }
  for (const item of value.recommended_next) {
    if (!item || typeof item !== 'object' || !Array.isArray(item.argv) || item.argv.some((arg) => typeof arg !== 'string' || arg.length === 0)) {
      fail(`Pending annotation record has invalid recommended argv: ${file}`, 'PENDING_ANNOTATION_STATE_CORRUPT', { path: file });
    }
  }
  return value;
}

export function loadRecord(id, env = process.env) {
  const file = recordPath(id, env);
  const record = readJSONExisting(file);
  if (!record) fail(`Pending annotation not found: ${id}`, 'PENDING_ANNOTATION_NOT_FOUND', { id });
  return assertRecord(record, file, env);
}

export function annotationSummary(record) {
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
    path: record.paths.record,
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
  return listRecordFiles(env).map((file) => assertRecord(readJSONExisting(file), file, env));
}

export function rebuildIndexFromRecords(env = process.env, previousIndex = null) {
  const previousCreatedAt = previousIndex?.created_at || nowISO();
  const annotations = loadAllRecords(env)
    .map(annotationSummary)
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
  const summaries = records.map(annotationSummary);
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

function lockNumber(envValue, fallback) {
  const parsed = Number(envValue);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function sleep(ms) {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function lockOwnerPath(dir) {
  return path.join(dir, 'owner.json');
}

function lockIsStale(dir, staleMs) {
  try {
    const stat = fs.statSync(dir);
    return Date.now() - stat.mtimeMs > staleMs;
  } catch {
    return true;
  }
}

function acquireLock(env = process.env) {
  const dir = lockDir(env);
  const timeoutMs = lockNumber(env.AOS_PENDING_ANNOTATION_LOCK_TIMEOUT_MS, DEFAULT_LOCK_TIMEOUT_MS);
  const staleMs = lockNumber(env.AOS_PENDING_ANNOTATION_STALE_LOCK_MS, DEFAULT_LOCK_STALE_MS);
  const deadline = Date.now() + timeoutMs;
  fs.mkdirSync(pendingRoot(env), { recursive: true });
  for (;;) {
    try {
      fs.mkdirSync(dir);
      writeJSONAtomic(lockOwnerPath(dir), {
        pid: process.pid,
        acquired_at: nowISO(),
        runtime_mode: runtimeMode(env),
      });
      return dir;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (lockIsStale(dir, staleMs)) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
          continue;
        } catch {
          // Another process may have acquired or removed it; retry until deadline.
        }
      }
      if (Date.now() >= deadline) {
        fail('Pending annotation store is locked by another mutation', 'PENDING_ANNOTATION_LOCKED', {
          status: 'locked',
          lock_path: dir,
        });
      }
      sleep(Math.min(25, Math.max(1, deadline - Date.now())));
    }
  }
}

export function withPendingAnnotationMutation(env, mutate) {
  const dir = acquireLock(env);
  try {
    return mutate();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
