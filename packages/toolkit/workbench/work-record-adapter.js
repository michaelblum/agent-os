import {
  formatSubjectEntryHandle,
  parseSubjectEntryHandle,
} from './subject-entry-handle.js';
import validateWorkRecordV1 from './work-record-v1-validator.generated.js';

export const WORK_RECORD_V1_SCHEMA_VERSION = '2026-08-work-record-v1';
export const WORK_RECORD_HISTORICAL_V0_SCHEMA_VERSION = '2026-05-work-record-v0';

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function rawText(value, fallback = '') {
  const raw = String(value ?? '');
  return raw || fallback;
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

function firstRawText(...values) {
  for (const value of values) {
    const raw = rawText(value);
    if (raw) return raw;
  }
  return '';
}

export function isWorkRecordV1(record = {}) {
  const value = objectValue(record);
  return text(value.type) === 'aos.work_record'
    && text(value.schema_version) === WORK_RECORD_V1_SCHEMA_VERSION;
}

export function isHistoricalWorkRecordV0(record = {}) {
  const value = objectValue(record);
  return text(value.type) === 'aos.work_record'
    && text(value.schema_version) === WORK_RECORD_HISTORICAL_V0_SCHEMA_VERSION;
}

export function isValidWorkRecordV1(record = {}) {
  return isWorkRecordV1(record) && validateWorkRecordV1(record) === true;
}

export function workRecordSubjectId(recordId = '') {
  const id = text(recordId);
  if (!id) return '';
  const parsed = parseSubjectEntryHandle(id);
  if (parsed?.facet_key === 'work-record') return parsed.handle;
  return formatSubjectEntryHandle('work-record', id);
}

function normalizeIntent(record = {}) {
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

function normalizeHealth(record = {}) {
  const health = objectValue(record.health);
  const verdict = text(health.verdict, 'unknown');
  return {
    ...cloneJson(health),
    state: verdict,
    verdict,
    reason: text(health.reason),
    confidence: numberValue(health.confidence),
  };
}

function evidenceArtifacts(record = {}) {
  return arrayValue(record.evidence)
    .map((evidence) => {
      const item = objectValue(evidence);
      return {
        id: text(item.id) || null,
        kind: text(item.kind, 'evidence'),
        label: firstRawText(item.summary, item.id, item.kind, item.uri),
        path: rawText(item.uri),
        uri: rawText(item.uri),
        state_id: rawText(item.state_id) || null,
        target: rawText(item.target) || null,
        created_at: text(item.created_at) || null,
        immutable: item.immutable === true,
      };
    })
    .filter((artifact) => text(artifact.kind) || text(artifact.path) || text(artifact.id));
}

function unsupported(record = {}) {
  const value = objectValue(record);
  return {
    format: isHistoricalWorkRecordV0(value) ? 'historical_v0_unsupported' : 'unsupported',
    readOnly: true,
    supported: false,
    raw: null,
    type: text(value.type),
    schemaVersion: text(value.schema_version),
    id: text(value.id),
    label: firstRawText(value.label, value.id),
    sourceKind: 'unsupported',
    sourceRecordType: text(value.type),
    origin: null,
    references: [],
    intent: {},
    executionMap: {},
    evidence: [],
    artifacts: [],
    claims: [],
    claimResults: [],
    verifierReport: null,
    health: { state: 'unsupported', verdict: 'unsupported', reason: '' },
    surface: null,
    action: null,
    hasExecutionMap: false,
  };
}

export function normalizeWorkRecord(record = {}) {
  if (!isValidWorkRecordV1(record)) return unsupported(record);
  const intent = normalizeIntent(record);
  const executionMap = objectValue(record.execution_map);
  return {
    format: 'v1',
    readOnly: true,
    supported: true,
    raw: cloneJson(record),
    type: text(record.type, 'aos.work_record'),
    schemaVersion: text(record.schema_version),
    id: text(record.id),
    label: firstRawText(record.label, intent.summary, intent.nl, record.id),
    sourceKind: 'work_record',
    sourceRecordType: text(record.type, 'aos.work_record'),
    origin: cloneJson(objectValue(record.origin)),
    references: arrayValue(record.references).map((item) => cloneJson(item)),
    intent,
    executionMap,
    evidence: arrayValue(record.evidence).map((item) => cloneJson(item)),
    artifacts: evidenceArtifacts(record),
    claims: arrayValue(record.claims).map((item) => cloneJson(item)),
    claimResults: arrayValue(record.claim_results).map((item) => cloneJson(item)),
    verifierReport: cloneJson(objectValue(record.verifier_report)),
    health: normalizeHealth(record),
    surface: null,
    action: null,
    hasExecutionMap: Object.keys(executionMap).length > 0,
  };
}

export function workRecordIsReadOnly(record = {}) {
  return normalizeWorkRecord(record).readOnly;
}

export function workRecordEvidenceArtifacts(record = {}) {
  return normalizeWorkRecord(record).artifacts.map((artifact) => cloneJson(artifact));
}
