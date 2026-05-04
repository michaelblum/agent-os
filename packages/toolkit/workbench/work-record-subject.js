import { createWorkbenchSubject } from './subject.js';

const DEFAULT_OWNER = 'aos-work-record';

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

function labelFromIntent(intent = {}, fallback = '') {
  const nl = text(objectValue(intent).nl);
  if (!nl) return fallback;
  return nl.length > 96 ? `${nl.slice(0, 93)}...` : nl;
}

function workRecordKind(record = {}) {
  const kind = text(record.type);
  if (kind === 'aos.do_step') return 'aos.do_step';
  if (kind === 'aos.recipe_health_event') return 'aos.recipe_health_event';
  return 'aos.work_record';
}

function workRecordId(record = {}) {
  const id = text(record.id);
  if (!id) throw new TypeError('work record subject requires an id');
  return id;
}

function workRecordHealth(record = {}) {
  const next = objectValue(record.next_health);
  const current = objectValue(record.health);
  return {
    state: text(next.state || current.state, 'unknown'),
    reason: text(next.reason || current.reason),
  };
}

function workRecordArtifacts(record = {}) {
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

function workRecordViews(kind) {
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

function workRecordControls(kind) {
  const base = ['intent.editor', 'health.status'];
  if (kind === 'aos.do_step') return [...base, 'execution_map.json.editor'];
  if (kind === 'aos.recipe_health_event') return [...base, 'retirement.note'];
  return base;
}

function workRecordCapabilities(kind) {
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

export function createWorkRecordSubject(record = {}) {
  const kind = workRecordKind(record);
  const id = workRecordId(record);
  const intent = objectValue(record.intent);
  const health = workRecordHealth(record);
  const label = labelFromIntent(intent, id);
  const sourceKind = kind === 'aos.recipe_health_event' ? 'recipe_health_event' : 'work_record';

  return createWorkbenchSubject({
    id: `work-record:${id}`,
    type: kind,
    label,
    owner: DEFAULT_OWNER,
    source: {
      kind: sourceKind,
      record_type: text(record.type, kind),
      record_id: id,
      recipe_id: text(record.recipe_id) || null,
    },
    capabilities: workRecordCapabilities(kind),
    views: workRecordViews(kind),
    controls: workRecordControls(kind),
    persistence: {
      kind: 'agent_handoff',
      request: 'work_record.patch.requested',
      result: 'work_record.patch.result',
    },
    artifacts: workRecordArtifacts(record),
    state: {
      health,
      surface: text(record.surface) || null,
      action: objectValue(record.action).verb ? cloneJson(record.action) : null,
      automatic_replay_allowed: objectValue(record.retirement).automatic_replay_allowed ?? null,
    },
    metadata: {
      schema_version: text(record.schema_version),
      purpose: text(intent.purpose),
      acceptance: text(intent.acceptance),
      has_execution_map: Object.keys(objectValue(record.execution_map)).length > 0,
    },
  });
}

export function createWorkRecordSubjects(records = []) {
  return arrayValue(records).map((record) => createWorkRecordSubject(record));
}
