import fs from 'node:fs';
import {
  LIFECYCLE_STATES,
  SCHEMA_VERSION,
  array,
  fail,
  nowISO,
  text,
} from './pending-annotations-constants.mjs';
import {
  annotationSummary,
  loadIndex,
  loadRecord,
  recordPath,
  saveRecordAndRebuildIndex,
  stateRoot,
  pendingRoot,
  runtimeMode,
  withPendingAnnotationMutation,
} from './pending-annotations-store.mjs';
import {
  compactResult,
  normalizeRecordInput,
  normalizeWorkRecordLink,
  sessionMetadata,
} from './pending-annotations-record.mjs';

export function createPendingAnnotation(input, env = process.env) {
  return withPendingAnnotationMutation(env, () => {
    const record = normalizeRecordInput(input, env);
    const file = recordPath(record.id, env);
    if (fs.existsSync(file)) fail(`Pending annotation already exists: ${record.id}`, 'PENDING_ANNOTATION_EXISTS', { id: record.id });
    saveRecordAndRebuildIndex(record, env);
    return compactResult(record, 'created');
  });
}

export function listPendingAnnotations(options = {}, env = process.env) {
  const state = options.state || null;
  if (state && !LIFECYCLE_STATES.has(state)) fail(`Unsupported annotation state: ${state}`, 'INVALID_ARG');
  const index = loadIndex(env);
  const annotations = index.annotations.filter((item) => !state || item.state === state);
  return {
    status: 'success',
    schema_version: SCHEMA_VERSION,
    runtime_mode: runtimeMode(env),
    state_root: stateRoot(env),
    pending_annotations_root: pendingRoot(env),
    count: annotations.length,
    annotations,
  };
}

export function readPendingAnnotation(id, env = process.env) {
  return {
    status: 'success',
    schema_version: SCHEMA_VERSION,
    runtime_mode: runtimeMode(env),
    annotation: loadRecord(id, env),
  };
}

export function consumePendingAnnotation(id, options = {}, env = process.env) {
  return withPendingAnnotationMutation(env, () => {
    const record = loadRecord(id, env);
    const status = record.capability?.status || 'blocked';
    if (record.lifecycle.state !== 'pending' || status === 'unsupported' || status === 'ambiguous' || status === 'blocked') {
      fail(`Pending annotation is not consumable: ${id}`, 'PENDING_ANNOTATION_NOT_CONSUMABLE', {
        id,
        state: record.lifecycle.state,
        capability_status: status,
        status: 'not_consumable',
      });
    }
    const now = nowISO();
    const consumed = {
      ...record,
      lifecycle: {
        ...record.lifecycle,
        state: 'consumed',
        updated_at: now,
        consumed_at: now,
        consumed_by: {
          source: text(options.actor, 'agent'),
          session: sessionMetadata(env),
        },
      },
    };
    saveRecordAndRebuildIndex(consumed, env);
    return {
      ...compactResult(consumed, 'consumed'),
      consumed_annotation: consumed,
    };
  });
}

export function linkPendingAnnotationWorkRecord(id, input = {}, env = process.env) {
  return withPendingAnnotationMutation(env, () => {
    const record = loadRecord(id, env);
    if (record.lifecycle.state === 'deleted') {
      fail(`Pending annotation is deleted and cannot be linked: ${id}`, 'PENDING_ANNOTATION_NOT_LINKABLE', {
        id,
        state: record.lifecycle.state,
        status: 'not_linkable',
      });
    }
    const now = nowISO();
    const link = {
      ...normalizeWorkRecordLink(input, array(record.work_record_links).length),
      linked_at: now,
      linked_by: {
        source: text(input.actor || input.source, 'agent'),
        session: sessionMetadata(env),
      },
    };
    const linked = {
      ...record,
      lifecycle: {
        ...record.lifecycle,
        updated_at: now,
      },
      work_record_links: [...array(record.work_record_links), link],
    };
    saveRecordAndRebuildIndex(linked, env);
    return {
      ...compactResult(linked, 'linked'),
      work_record_link: link,
      linked_annotation: linked,
    };
  });
}

export function deletePendingAnnotation(id, env = process.env) {
  return withPendingAnnotationMutation(env, () => {
    const record = loadRecord(id, env);
    if (record.lifecycle.state === 'deleted') {
      fail(`Pending annotation is already deleted: ${id}`, 'PENDING_ANNOTATION_NOT_CONSUMABLE', {
        id,
        state: record.lifecycle.state,
        status: 'not_consumable',
      });
    }
    const now = nowISO();
    const deleted = {
      ...record,
      lifecycle: {
        ...record.lifecycle,
        state: 'deleted',
        updated_at: now,
        deleted_at: now,
      },
    };
    saveRecordAndRebuildIndex(deleted, env);
    return compactResult(deleted, 'deleted');
  });
}
