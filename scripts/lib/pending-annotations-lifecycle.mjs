import {
  array,
  fail,
  nowISO,
  text,
} from './pending-annotations-constants.mjs';
import {
  LIFECYCLE_STATES,
  SCHEMA_VERSION,
  assertConsumableCapability,
  compactResult,
  normalizeRecordInput,
  normalizeWorkRecordLink,
  sessionMetadata,
} from './pending-annotations-model.mjs';
import {
  commitPendingAnnotationRecordMutation,
  loadIndexReadOnly,
  loadRecord,
  recordPath,
  stateRoot,
  pendingRoot,
  runtimeMode,
} from './pending-annotations-store.mjs';
function modelContext(env = process.env) {
  return {
    env,
    runtime_mode: runtimeMode(env),
    pending_root: pendingRoot(env),
    record_path_for_id: (id) => recordPath(id, env),
  };
}

function summaryContext(record, env = process.env) {
  return { path: recordPath(record.id, env) };
}

export function createPendingAnnotation(input, env = process.env) {
  return commitPendingAnnotationRecordMutation(env, ({ recordsByID }) => {
    const record = normalizeRecordInput(input, modelContext(env));
    if (recordsByID.has(record.id)) fail(`Pending annotation already exists: ${record.id}`, 'PENDING_ANNOTATION_EXISTS', { id: record.id });
    return {
      changedRecord: record,
      result: compactResult(record, 'created', summaryContext(record, env)),
    };
  });
}

export function listPendingAnnotations(options = {}, env = process.env) {
  const state = options.state || null;
  if (state && !LIFECYCLE_STATES.has(state)) fail(`Unsupported annotation state: ${state}`, 'INVALID_ARG');
  const index = loadIndexReadOnly(env);
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
  return commitPendingAnnotationRecordMutation(env, ({ recordsByID }) => {
    const record = recordsByID.get(id);
    if (!record) fail(`Pending annotation not found: ${id}`, 'PENDING_ANNOTATION_NOT_FOUND', { id });
    assertConsumableCapability(record, id);
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
    return {
      changedRecord: consumed,
      result: {
        ...compactResult(consumed, 'consumed', summaryContext(consumed, env)),
        consumed_annotation: consumed,
      },
    };
  });
}

export function linkPendingAnnotationWorkRecord(id, input = {}, env = process.env) {
  return commitPendingAnnotationRecordMutation(env, ({ recordsByID }) => {
    const record = recordsByID.get(id);
    if (!record) fail(`Pending annotation not found: ${id}`, 'PENDING_ANNOTATION_NOT_FOUND', { id });
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
    return {
      changedRecord: linked,
      result: {
        ...compactResult(linked, 'linked', summaryContext(linked, env)),
        work_record_link: link,
        linked_annotation: linked,
      },
    };
  });
}

export function deletePendingAnnotation(id, env = process.env) {
  return commitPendingAnnotationRecordMutation(env, ({ recordsByID }) => {
    const record = recordsByID.get(id);
    if (!record) fail(`Pending annotation not found: ${id}`, 'PENDING_ANNOTATION_NOT_FOUND', { id });
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
    return {
      changedRecord: deleted,
      result: compactResult(deleted, 'deleted', summaryContext(deleted, env)),
    };
  });
}
