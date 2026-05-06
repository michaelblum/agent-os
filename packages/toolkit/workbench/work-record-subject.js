import { createWorkbenchSubject } from './subject.js';
import {
  normalizeWorkRecord,
  workRecordSubjectId,
} from './work-record-adapter.js';

const DEFAULT_OWNER = 'aos-work-record';

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function clippedLabel(label = '', fallback = '') {
  const value = text(label, fallback);
  return value.length > 96 ? `${value.slice(0, 93)}...` : value;
}

function workRecordId(record = {}) {
  const normalized = normalizeWorkRecord(record);
  const id = text(normalized.id);
  if (!id) throw new TypeError('work record subject requires an id');
  return id;
}

function legacyWorkRecordViews(kind) {
  const base = [
    'work_record.intent',
    'work_record.execution_map.json',
    'work_record.evidence',
    'work_record.health',
  ];
  if (kind === 'aos.do_step') return [...base, 'work_record.step.timeline'];
  if (kind === 'aos.recipe_health_event') return [
    'work_record.intent',
    'work_record.evidence',
    'work_record.health',
    'work_record.retirement',
  ];
  return base;
}

function v0WorkRecordViews() {
  return [
    'work_record.intent',
    'work_record.execution_map.json',
    'work_record.execution_map.postconditions',
    'work_record.evidence',
    'work_record.claims',
    'work_record.claim_results',
    'work_record.verifier_report',
    'work_record.health',
  ];
}

function workRecordViews(record) {
  if (record.format === 'v0') return v0WorkRecordViews();
  return legacyWorkRecordViews(record.type);
}

function legacyWorkRecordControls(kind) {
  const base = ['intent.editor', 'health.status'];
  if (kind === 'aos.do_step') return [...base, 'execution_map.json.editor'];
  if (kind === 'aos.recipe_health_event') return [...base, 'retirement.note'];
  return base;
}

function workRecordControls(record) {
  if (record.readOnly) return ['health.status'];
  return legacyWorkRecordControls(record.type);
}

function legacyWorkRecordCapabilities(kind) {
  const base = [
    'work_record.intent.edit',
    'work_record.evidence.view',
    'work_record.health.view',
  ];
  if (kind === 'aos.do_step') return [
    ...base,
    'work_record.execution_map.edit',
    'work_record.do_step.inspect',
  ];
  if (kind === 'aos.recipe_health_event') return [
    ...base,
    'work_record.retirement.inspect',
  ];
  return base;
}

function v0WorkRecordCapabilities() {
  return [
    'inspectable',
    'verifier-target',
    'exportable',
    'work_record.intent.view',
    'work_record.execution_map.view',
    'work_record.evidence.view',
    'work_record.claims.view',
    'work_record.verifier_report.view',
    'work_record.health.view',
  ];
}

function workRecordCapabilities(record) {
  if (record.format === 'v0') return v0WorkRecordCapabilities();
  return legacyWorkRecordCapabilities(record.type);
}

function workRecordSource(record) {
  return {
    kind: record.sourceKind,
    record_type: record.sourceRecordType,
    record_id: record.id,
    recipe_id: text(record.raw?.recipe_id) || null,
    origin: record.origin ? cloneJson(record.origin) : null,
    format: record.format,
  };
}

export function createWorkRecordSubject(record = {}) {
  const id = workRecordId(record);
  const normalized = normalizeWorkRecord(record);
  const label = clippedLabel(normalized.label, id);

  return createWorkbenchSubject({
    id: workRecordSubjectId(id),
    type: normalized.type,
    label,
    owner: DEFAULT_OWNER,
    source: workRecordSource(normalized),
    capabilities: workRecordCapabilities(normalized),
    views: workRecordViews(normalized),
    controls: workRecordControls(normalized),
    persistence: normalized.readOnly ? null : {
      kind: 'agent_handoff',
      request: 'work_record.patch.requested',
      result: 'work_record.patch.result',
    },
    artifacts: normalized.artifacts,
    state: {
      health: normalized.health,
      surface: normalized.surface,
      action: normalized.action,
      automatic_replay_allowed: normalized.automaticReplayAllowed,
      read_only: normalized.readOnly,
      origin: normalized.origin ? cloneJson(normalized.origin) : null,
      verifier_report_id: text(normalized.verifierReport?.id) || null,
      replay_policy: normalized.replayPolicy ? cloneJson(normalized.replayPolicy) : null,
    },
    metadata: {
      schema_version: normalized.schemaVersion,
      format: normalized.format,
      purpose: text(normalized.intent.purpose),
      acceptance: text(normalized.intent.acceptance),
      has_execution_map: normalized.hasExecutionMap,
      reference_count: normalized.references.length,
      evidence_count: normalized.evidence.length || normalized.artifacts.length,
      claim_count: normalized.claims.length,
      claim_result_count: normalized.claimResults.length,
    },
  });
}

export function createWorkRecordSubjects(records = []) {
  return arrayValue(records).map((record) => createWorkRecordSubject(record));
}
