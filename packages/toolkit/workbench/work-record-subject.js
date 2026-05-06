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

function legacyWorkRecordFacetKeys(kind) {
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

function v0WorkRecordFacetKeys() {
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

function workRecordFacetKeys(record) {
  if (record.format === 'v0') return v0WorkRecordFacetKeys();
  return legacyWorkRecordFacetKeys(record.type);
}

function labelFromKey(key = '') {
  return text(key)
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function layerForWorkRecordFacetKey(key = '') {
  if (key.includes('intent')) return 'narrative';
  if (key.includes('execution_map') || key.includes('timeline')) return 'descriptor';
  if (key.includes('evidence') || key.includes('claims') || key.includes('verifier_report')) return 'artifacts';
  if (key.includes('health') || key.includes('retirement')) return 'health';
  return 'descriptor';
}

function uniqueTextList(values = []) {
  return [...new Set(values.map((value) => text(value)).filter(Boolean))];
}

function contractsForWorkRecordFacetKey(key = '') {
  const contracts = [];
  if (key.includes('intent')) contracts.push('work_record.intent.view');
  if (key.includes('execution_map')) contracts.push('work_record.execution_map.view');
  if (key.includes('timeline')) contracts.push('work_record.do_step.inspect');
  if (key.includes('evidence')) contracts.push('work_record.evidence.view');
  if (key.includes('claims')) contracts.push('work_record.claims.view');
  if (key.includes('claim_results')) contracts.push('work_record.claim_results.view');
  if (key.includes('verifier_report')) contracts.push('work_record.verifier_report.view');
  if (key.includes('health')) contracts.push('work_record.health.view');
  if (key.includes('retirement')) contracts.push('work_record.retirement.inspect');
  return uniqueTextList(contracts);
}

function workRecordControlContracts(record) {
  if (record.readOnly) return [];
  const contracts = ['work_record.intent.edit'];
  if (workRecordFacetKeys(record).some((key) => key.includes('execution_map'))) {
    contracts.push('work_record.execution_map.edit');
  }
  if (record.type === 'aos.recipe_health_event') {
    contracts.push('work_record.retirement.inspect');
  }
  return uniqueTextList(contracts);
}

function workRecordWorkbenchHost(preferred = false, facet = '') {
  return {
    kind: 'canvas',
    target_dialect: 'canvas',
    entry: {
      kind: 'aos-url',
      value: 'aos://toolkit/components/work-record-workbench/index.html',
      ...(facet ? { facet } : {}),
    },
    ...(preferred ? { preferred: true } : {}),
  };
}

function workRecordFacets(record) {
  const projectionFacets = workRecordFacetKeys(record).map((key, index) => ({
    key,
    layer: layerForWorkRecordFacetKey(key),
    label: labelFromKey(key),
    capabilities: ['inspectable'],
    contracts: contractsForWorkRecordFacetKey(key),
    hosts: [workRecordWorkbenchHost(index === 0, key)],
  }));
  const controlFacets = record.readOnly ? [] : [{
    key: 'work_record.controls',
    layer: 'controls',
    label: 'Work Record Controls',
    capabilities: ['editable'],
    contracts: workRecordControlContracts(record),
    hosts: [workRecordWorkbenchHost(false, 'controls')],
  }];
  return [...projectionFacets, ...controlFacets];
}

function workRecordContracts(record) {
  return uniqueTextList([
    ...workRecordFacetKeys(record).flatMap((key) => contractsForWorkRecordFacetKey(key)),
    ...workRecordControlContracts(record),
  ]);
}

function legacyWorkRecordCapabilities() {
  return ['inspectable', 'editable', 'verifier-target', 'exportable'];
}

function v0WorkRecordCapabilities() {
  return [
    'inspectable',
    'verifier-target',
    'exportable',
  ];
}

function workRecordCapabilities(record) {
  if (record.format === 'v0') return v0WorkRecordCapabilities();
  return legacyWorkRecordCapabilities();
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
    contracts: workRecordContracts(normalized),
    facets: workRecordFacets(normalized),
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
