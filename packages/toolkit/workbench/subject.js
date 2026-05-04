export const WORKBENCH_SUBJECT_SCHEMA_VERSION = '2026-05-03';

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function textList(values = []) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => text(value))
    .filter(Boolean);
}

export function createWorkbenchSubject({
  id,
  type,
  label,
  owner,
  source = null,
  capabilities = [],
  views = [],
  controls = [],
  persistence = null,
  artifacts = [],
  state = {},
  metadata = {},
} = {}) {
  const subjectId = text(id);
  const subjectType = text(type);
  if (!subjectId) throw new TypeError('workbench subject requires an id');
  if (!subjectType) throw new TypeError('workbench subject requires a type');

  return {
    type: 'aos.workbench.subject',
    schema_version: WORKBENCH_SUBJECT_SCHEMA_VERSION,
    id: subjectId,
    subject_type: subjectType,
    label: text(label, subjectId),
    owner: text(owner, 'unknown'),
    source: source ? cloneJson(source) : null,
    capabilities: textList(capabilities),
    views: textList(views),
    controls: textList(controls),
    persistence: persistence ? cloneJson(persistence) : null,
    artifacts: Array.isArray(artifacts) ? cloneJson(artifacts) : [],
    state: cloneJson(state) || {},
    metadata: cloneJson(metadata) || {},
  };
}

export function subjectCapabilitySet(subject = {}) {
  return new Set(textList(subject.capabilities));
}

export function subjectSupports(subject = {}, capability = '') {
  return subjectCapabilitySet(subject).has(text(capability));
}
