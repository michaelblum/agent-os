import {
  createWorkRecordSubject,
  isWorkRecordV0,
  normalizeWorkRecord,
  runWorkRecordVerifierProfile,
  workRecordEvidenceArtifacts,
  workRecordIsReadOnly,
} from '../../workbench/work-record.js';

export const WORK_RECORD_WORKBENCH_SCHEMA_VERSION = '2026-05-04';
const WORK_RECORD_WORKBENCH_URL = 'aos://toolkit/components/work-record-workbench/index.html';

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

function uniqueTextList(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => text(value)).filter(Boolean))];
}

function workRecordWorkbenchHost(facet = '', preferred = false) {
  return {
    kind: 'canvas',
    target_dialect: 'canvas',
    entry: {
      kind: 'aos-url',
      value: WORK_RECORD_WORKBENCH_URL,
      ...(facet ? { facet } : {}),
    },
    ...(preferred ? { preferred: true } : {}),
  };
}

function mergeSubjectFacetContracts(facets = [], key = '', contracts = []) {
  let found = false;
  const next = (Array.isArray(facets) ? facets : []).map((facet) => {
    if (facet?.key !== key) return facet;
    found = true;
    return {
      ...facet,
      contracts: uniqueTextList([
        ...(Array.isArray(facet.contracts) ? facet.contracts : []),
        ...contracts,
      ]),
    };
  });
  if (!found && contracts.length > 0) {
    next.push({
      key,
      layer: 'controls',
      label: 'Work Record Controls',
      capabilities: ['editable'],
      contracts: uniqueTextList(contracts),
      hosts: [workRecordWorkbenchHost('controls')],
    });
  }
  return next;
}

function appendSubjectFacet(facets = [], facet = {}) {
  if (!facet?.key) return Array.isArray(facets) ? facets : [];
  if ((Array.isArray(facets) ? facets : []).some((item) => item?.key === facet.key)) {
    return facets;
  }
  return [...(Array.isArray(facets) ? facets : []), facet];
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
  if (isWorkRecordV0(next)) return cloneJson(next);
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

function readOnlyResult(state, type, reason = 'read_only') {
  state.lastResult = {
    type,
    schema_version: WORK_RECORD_WORKBENCH_SCHEMA_VERSION,
    status: 'rejected',
    record_id: state.record.id,
    reason,
    message: 'Work Record v0 opens read-only in this workbench.',
  };
  return state.lastResult;
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
  if (workRecordIsReadOnly(state.record)) {
    return readOnlyResult(state, 'work_record.intent.patch.result');
  }
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
  if (workRecordIsReadOnly(state.record)) {
    return readOnlyResult(state, 'work_record.execution_map.patch.result');
  }

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
  if (workRecordIsReadOnly(state.record)) {
    throw new TypeError('read-only Work Records cannot build patch requests');
  }
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
  const adapter = normalizeWorkRecord(normalized);
  const executionMap = objectValue(normalized.execution_map);
  const verifierCheck = isWorkRecordV0(normalized) ? runWorkRecordVerifierProfile(normalized) : null;
  return {
    record_id: normalized.id,
    record_type: normalized.type,
    format: adapter.format,
    read_only: adapter.readOnly,
    health_state: text(adapter.health.state, 'unknown'),
    health_reason: text(adapter.health.reason),
    surface: text(adapter.surface),
    action_verb: text(objectValue(adapter.action).verb),
    artifact_count: adapter.artifacts.length,
    evidence_count: adapter.evidence.length || adapter.artifacts.length,
    claim_count: adapter.claims.length,
    claim_result_count: adapter.claimResults.length,
    postcondition_count: arrayValue(objectValue(executionMap).postconditions).length,
    verifier_status: verifierCheck?.status || null,
    verifier_diagnostic_count: verifierCheck?.diagnostics?.length || 0,
    execution_map_keys: Object.keys(executionMap).sort(),
    has_intent: !!text(adapter.intent.nl || adapter.intent.summary),
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
  const readOnly = workRecordIsReadOnly(state.record);
  subject.contracts = [...new Set([
    ...(Array.isArray(subject.contracts) ? subject.contracts : []),
    ...(readOnly ? [] : ['work_record.patch.requested']),
    'work_record.snapshot',
  ])];
  subject.facets = appendSubjectFacet(subject.facets, {
    key: 'work_record.summary',
    layer: 'descriptor',
    label: 'Work Record Summary',
    capabilities: ['inspectable'],
    contracts: ['work_record.snapshot'],
    hosts: [workRecordWorkbenchHost('summary')],
  });
  if (!readOnly) {
    subject.facets = mergeSubjectFacetContracts(subject.facets, 'work_record.controls', [
      'work_record.patch.requested',
    ]);
  }
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
  return workRecordEvidenceArtifacts(normalizeRecord(record));
}

export function workRecordVerifierCheck(record = {}) {
  return runWorkRecordVerifierProfile(normalizeRecord(record));
}

export { workRecordIsReadOnly };
