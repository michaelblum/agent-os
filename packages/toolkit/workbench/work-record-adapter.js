import {
  formatSubjectEntryHandle,
  parseSubjectEntryHandle,
} from './subject-entry-handle.js';

export const WORK_RECORD_V0_SCHEMA_VERSION = '2026-05-work-record-v0';

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function numberValue(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function firstText(...values) {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return '';
}

export function isWorkRecordV0(record = {}) {
  const value = objectValue(record);
  return text(value.type) === 'aos.work_record'
    && text(value.schema_version) === WORK_RECORD_V0_SCHEMA_VERSION;
}

export function workRecordSubjectId(recordId = '') {
  const id = text(recordId);
  if (!id) return '';
  const parsed = parseSubjectEntryHandle(id);
  if (parsed?.facet_key === 'work-record') return parsed.handle;
  return formatSubjectEntryHandle('work-record', id);
}

function legacyKind(record = {}) {
  const kind = text(record.type);
  if (kind === 'aos.do_step') return 'aos.do_step';
  if (kind === 'aos.recipe_health_event') return 'aos.recipe_health_event';
  return 'aos.work_record';
}

function legacyHealth(record = {}) {
  const next = objectValue(record.next_health);
  const current = objectValue(record.health);
  const state = text(next.state || current.state, 'unknown');
  return {
    state,
    verdict: state,
    reason: text(next.reason || current.reason),
  };
}

function v0Health(record = {}) {
  const health = objectValue(record.health);
  const verdict = text(health.verdict, 'unknown');
  return {
    ...cloneJson(health),
    state: verdict,
    verdict,
    reason: text(health.reason),
    confidence: numberValue(health.confidence),
    repair_gate_refs: arrayValue(health.repair_gate_refs),
    replay_gate_refs: arrayValue(health.replay_gate_refs),
  };
}

function legacyArtifacts(record = {}) {
  const evidence = objectValue(record.evidence);
  const artifacts = arrayValue(evidence.artifacts).map((artifact) => objectValue(artifact));
  if (evidence.last_trace) {
    artifacts.push({
      kind: 'trace',
      path: text(evidence.last_trace),
    });
  }
  return artifacts.filter((artifact) => text(artifact.kind) || text(artifact.path));
}

function v0Artifacts(record = {}) {
  return arrayValue(record.evidence)
    .map((evidence) => {
      const item = objectValue(evidence);
      return {
        id: text(item.id) || null,
        kind: text(item.kind, 'evidence'),
        label: firstText(item.summary, item.id, item.kind, item.uri),
        path: text(item.uri),
        uri: text(item.uri),
        state_id: text(item.state_id) || null,
        target: text(item.target) || null,
        created_at: text(item.created_at) || null,
        immutable: item.immutable === true,
      };
    })
    .filter((artifact) => text(artifact.kind) || text(artifact.path) || text(artifact.id));
}

function normalizeV0Intent(record = {}) {
  const intent = objectValue(record.intent);
  return {
    ...cloneJson(intent),
    nl: firstText(intent.nl, intent.summary),
    summary: text(intent.summary),
    purpose: text(intent.purpose),
    acceptance: text(intent.acceptance),
    constraints: arrayValue(intent.constraints),
    claim_refs: arrayValue(intent.claim_refs),
  };
}

function normalizeLegacyIntent(record = {}) {
  const intent = objectValue(record.intent);
  return {
    ...cloneJson(intent),
    nl: text(intent.nl),
    summary: firstText(intent.summary, intent.nl),
    purpose: text(intent.purpose),
    acceptance: text(intent.acceptance),
    constraints: arrayValue(intent.constraints),
    claim_refs: arrayValue(intent.claim_refs),
  };
}

function normalizeV0(record = {}) {
  const intent = normalizeV0Intent(record);
  const executionMap = objectValue(record.execution_map);
  const evidence = arrayValue(record.evidence).map((item) => cloneJson(item));
  const claims = arrayValue(record.claims).map((item) => cloneJson(item));
  const claimResults = arrayValue(record.claim_results).map((item) => cloneJson(item));
  const verifierReport = objectValue(record.verifier_report);
  const replayPolicy = objectValue(executionMap.replay_policy);
  return {
    format: 'v0',
    readOnly: true,
    raw: cloneJson(record),
    type: text(record.type, 'aos.work_record'),
    schemaVersion: text(record.schema_version),
    id: text(record.id),
    label: firstText(record.label, intent.summary, intent.nl, record.id),
    sourceKind: 'work_record',
    sourceRecordType: text(record.type, 'aos.work_record'),
    origin: cloneJson(objectValue(record.origin)),
    references: arrayValue(record.references).map((item) => cloneJson(item)),
    intent,
    executionMap,
    evidence,
    artifacts: v0Artifacts(record),
    claims,
    claimResults,
    verifierReport: cloneJson(verifierReport),
    health: v0Health(record),
    replayPolicy: cloneJson(replayPolicy),
    surface: null,
    action: null,
    automaticReplayAllowed: null,
    hasExecutionMap: Object.keys(executionMap).length > 0,
  };
}

function normalizeLegacy(record = {}) {
  const kind = legacyKind(record);
  const intent = normalizeLegacyIntent(record);
  const executionMap = objectValue(record.execution_map);
  const health = legacyHealth(record);
  return {
    format: 'legacy',
    readOnly: false,
    raw: cloneJson(record),
    type: kind,
    schemaVersion: text(record.schema_version),
    id: text(record.id),
    label: firstText(intent.nl, intent.summary, record.id),
    sourceKind: kind === 'aos.recipe_health_event' ? 'recipe_health_event' : 'work_record',
    sourceRecordType: text(record.type, kind),
    origin: record.origin ? cloneJson(objectValue(record.origin)) : null,
    references: arrayValue(record.references).map((item) => cloneJson(item)),
    intent,
    executionMap,
    evidence: [],
    artifacts: legacyArtifacts(record),
    claims: arrayValue(record.claims).map((item) => cloneJson(item)),
    claimResults: arrayValue(record.claim_results).map((item) => cloneJson(item)),
    verifierReport: record.verifier_report ? cloneJson(objectValue(record.verifier_report)) : null,
    health,
    replayPolicy: cloneJson(objectValue(executionMap.replay_policy)),
    surface: text(record.surface) || null,
    action: objectValue(record.action).verb ? cloneJson(record.action) : null,
    automaticReplayAllowed: objectValue(record.retirement).automatic_replay_allowed ?? null,
    hasExecutionMap: Object.keys(executionMap).length > 0,
  };
}

export function normalizeWorkRecord(record = {}) {
  return isWorkRecordV0(record) ? normalizeV0(record) : normalizeLegacy(record);
}

export function workRecordIsReadOnly(record = {}) {
  return normalizeWorkRecord(record).readOnly;
}

export function workRecordEvidenceArtifacts(record = {}) {
  return normalizeWorkRecord(record).artifacts.map((artifact) => cloneJson(artifact));
}
