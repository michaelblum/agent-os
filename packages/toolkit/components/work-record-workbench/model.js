import { createWorkRecordSubject } from '../../workbench/work-record-subject.js';

export const WORK_RECORD_WORKBENCH_SCHEMA_VERSION = '2026-05-04';

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

function recordsEqual(a, b) {
  return stableJson(a) === stableJson(b);
}

function defaultRecord() {
  return {
    type: 'aos.do_step',
    schema_version: WORK_RECORD_WORKBENCH_SCHEMA_VERSION,
    id: 'untitled-work-record',
    intent: {
      nl: '',
      purpose: '',
      acceptance: '',
    },
    execution_map: {},
    evidence: {
      artifacts: [],
    },
    health: {
      state: 'stale',
      reason: 'manual draft',
    },
  };
}

function normalizeRecord(record = {}) {
  const next = objectValue(record);
  const base = defaultRecord();
  return {
    ...base,
    ...cloneJson(next),
    type: text(next.type, base.type),
    schema_version: text(next.schema_version, base.schema_version),
    id: text(next.id, base.id),
    intent: {
      ...base.intent,
      ...objectValue(next.intent),
    },
    execution_map: objectValue(next.execution_map),
    evidence: {
      ...base.evidence,
      ...objectValue(next.evidence),
      artifacts: arrayValue(objectValue(next.evidence).artifacts),
    },
    health: {
      ...base.health,
      ...objectValue(next.health),
    },
  };
}

function unwrapMessage(message = {}) {
  if (message?.payload && typeof message.payload === 'object') {
    return { ...message.payload, type: message.payload.type || message.type };
  }
  return message || {};
}

function recordFromMessage(message = {}) {
  const payload = unwrapMessage(message);
  return payload.record && typeof payload.record === 'object' ? payload.record : payload;
}

function normalizeSource(source = null) {
  if (!source || typeof source !== 'object') return null;
  const kind = text(source.kind);
  if (!kind) return null;
  return {
    ...cloneJson(source),
    kind,
    path: text(source.path) || null,
  };
}

export function createWorkRecordWorkbenchState({ record = null, source = null } = {}) {
  const initial = normalizeRecord(record || defaultRecord());
  return {
    record: initial,
    savedRecord: cloneJson(initial),
    source: normalizeSource(source),
    dirty: false,
    selectedView: 'intent',
    lastResult: null,
    errors: [],
  };
}

export function openWorkRecord(state, message = {}) {
  const payload = unwrapMessage(message);
  const record = normalizeRecord(recordFromMessage(message));
  state.record = record;
  state.savedRecord = cloneJson(record);
  state.source = normalizeSource(payload.source) || state.source || null;
  state.dirty = false;
  state.lastResult = {
    type: 'work_record.open.result',
    schema_version: WORK_RECORD_WORKBENCH_SCHEMA_VERSION,
    status: 'opened',
    record_id: record.id,
    source: state.source,
    subject: buildWorkRecordWorkbenchSubject(state),
  };
  return state.lastResult;
}

function markDirty(state) {
  state.dirty = !recordsEqual(state.record, state.savedRecord);
}

export function updateWorkRecordIntent(state, intentPatch = {}) {
  state.record.intent = {
    ...objectValue(state.record.intent),
    ...objectValue(intentPatch),
  };
  markDirty(state);
  state.lastResult = {
    type: 'work_record.intent.patch.result',
    schema_version: WORK_RECORD_WORKBENCH_SCHEMA_VERSION,
    status: 'applied',
    record_id: state.record.id,
    dirty: state.dirty,
  };
  return state.lastResult;
}

export function updateWorkRecordExecutionMapJson(state, jsonText = '') {
  let executionMap;
  try {
    executionMap = JSON.parse(String(jsonText || '{}'));
  } catch (error) {
    state.lastResult = {
      type: 'work_record.execution_map.patch.result',
      schema_version: WORK_RECORD_WORKBENCH_SCHEMA_VERSION,
      status: 'rejected',
      record_id: state.record.id,
      reason: 'invalid_json',
      message: String(error?.message || error),
    };
    state.errors.push(state.lastResult.message);
    while (state.errors.length > 12) state.errors.shift();
    return state.lastResult;
  }

  if (!executionMap || typeof executionMap !== 'object' || Array.isArray(executionMap)) {
    state.lastResult = {
      type: 'work_record.execution_map.patch.result',
      schema_version: WORK_RECORD_WORKBENCH_SCHEMA_VERSION,
      status: 'rejected',
      record_id: state.record.id,
      reason: 'not_object',
      message: 'execution_map must be a JSON object',
    };
    state.errors.push(state.lastResult.message);
    while (state.errors.length > 12) state.errors.shift();
    return state.lastResult;
  }

  state.record.execution_map = executionMap;
  markDirty(state);
  state.lastResult = {
    type: 'work_record.execution_map.patch.result',
    schema_version: WORK_RECORD_WORKBENCH_SCHEMA_VERSION,
    status: 'applied',
    record_id: state.record.id,
    dirty: state.dirty,
  };
  return state.lastResult;
}

export function applyWorkRecordPatchResult(state, message = {}) {
  const payload = unwrapMessage(message);
  const status = ['saved', 'applied'].includes(payload.status) ? 'saved' : 'rejected';
  if (status === 'saved') {
    state.savedRecord = cloneJson(state.record);
    state.dirty = false;
  }
  state.lastResult = {
    type: 'work_record.patch.result',
    schema_version: WORK_RECORD_WORKBENCH_SCHEMA_VERSION,
    status,
    record_id: state.record.id,
    message: text(payload.message),
  };
  return state.lastResult;
}

export function buildWorkRecordPatchRequest(state, {
  requestId = `work-record-patch-${Date.now().toString(36)}`,
} = {}) {
  return {
    type: 'work_record.patch.requested',
    schema_version: WORK_RECORD_WORKBENCH_SCHEMA_VERSION,
    request_id: requestId,
    subject: buildWorkRecordWorkbenchSubject(state),
    source: state.source,
    record_id: state.record.id,
    patch: {
      intent: cloneJson(objectValue(state.record.intent)),
      execution_map: cloneJson(objectValue(state.record.execution_map)),
    },
    record: cloneJson(state.record),
  };
}

export function workRecordDiagnostics(record = {}) {
  const normalized = normalizeRecord(record);
  const evidence = objectValue(normalized.evidence);
  const artifacts = [
    ...arrayValue(evidence.artifacts),
    ...(evidence.last_trace ? [{ kind: 'trace', path: evidence.last_trace }] : []),
  ];
  const executionMap = objectValue(normalized.execution_map);
  return {
    record_id: normalized.id,
    record_type: normalized.type,
    health_state: text(objectValue(normalized.next_health).state || normalized.health.state, 'unknown'),
    health_reason: text(objectValue(normalized.next_health).reason || normalized.health.reason),
    surface: text(normalized.surface),
    action_verb: text(objectValue(normalized.action).verb),
    artifact_count: artifacts.length,
    execution_map_keys: Object.keys(executionMap).sort(),
    has_intent: !!text(objectValue(normalized.intent).nl),
  };
}

export function workRecordWorkbenchSnapshot(state) {
  return {
    type: 'work_record.snapshot',
    schema_version: WORK_RECORD_WORKBENCH_SCHEMA_VERSION,
    subject: buildWorkRecordWorkbenchSubject(state),
    source: state.source,
    record: cloneJson(state.record),
    dirty: !!state.dirty,
    diagnostics: workRecordDiagnostics(state.record),
    last_result: state.lastResult,
    errors: [...state.errors],
  };
}

export function buildWorkRecordWorkbenchSubject(state = {}) {
  const subject = createWorkRecordSubject(normalizeRecord(state.record));
  subject.capabilities = [...new Set([
    ...subject.capabilities,
    'work_record.patch.requested',
    'work_record.snapshot',
  ])];
  subject.views = [...new Set([
    ...subject.views,
    'work_record.summary',
  ])];
  subject.controls = [...new Set([
    ...subject.controls,
    'patch.request',
  ])];
  subject.state = {
    ...subject.state,
    dirty: !!state.dirty,
    diagnostics: workRecordDiagnostics(state.record),
  };
  return subject;
}

export function executionMapJson(record = {}) {
  return stableJson(objectValue(normalizeRecord(record).execution_map));
}

export function evidenceArtifacts(record = {}) {
  const normalized = normalizeRecord(record);
  const evidence = objectValue(normalized.evidence);
  const artifacts = arrayValue(evidence.artifacts).map((artifact) => objectValue(artifact));
  if (evidence.last_trace) {
    artifacts.push({ kind: 'trace', path: evidence.last_trace });
  }
  return artifacts.filter((artifact) => text(artifact.kind) || text(artifact.path));
}
