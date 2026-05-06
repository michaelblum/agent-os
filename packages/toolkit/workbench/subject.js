export const WORKBENCH_SUBJECT_SCHEMA_VERSION = '2026-05-03';
export const WORKBENCH_SUBJECT_CAPABILITY_REGISTRY = Object.freeze([
  'inspectable',
  'editable',
  'verifier-target',
  'replayable',
  'exportable',
]);

const WORKBENCH_SUBJECT_CAPABILITY_SET = new Set(WORKBENCH_SUBJECT_CAPABILITY_REGISTRY);

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

function uniqueTextList(values = []) {
  return [...new Set(textList(values))];
}

function objectList(values = []) {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value) => value && typeof value === 'object' && !Array.isArray(value))
    .map((value) => cloneJson(value));
}

function uniqueObjects(values = [], keyFn = (value) => JSON.stringify(value)) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = keyFn(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

export function isLegacyOperationContract(value = '') {
  return text(value).includes('.');
}

export function isWorkbenchSubjectCapability(value = '') {
  return WORKBENCH_SUBJECT_CAPABILITY_SET.has(text(value));
}

export function subjectRawCapabilities(subject = {}) {
  return uniqueTextList(subject.capabilities);
}

export function subjectCapabilities(subject = {}) {
  return subjectRawCapabilities(subject).filter(isWorkbenchSubjectCapability);
}

export function subjectContracts(subject = {}) {
  return uniqueTextList([
    ...textList(subject.contracts),
    ...subjectRawCapabilities(subject).filter(isLegacyOperationContract),
  ]);
}

export function subjectCanonicalContracts(subject = {}) {
  return uniqueTextList(subject.contracts);
}

export function subjectCanonicalReferences(subject = {}) {
  return uniqueObjects(
    objectList(subject.subject_references),
    (reference) => [
      text(reference.id),
      text(reference.relationship),
      text(reference.handle || reference.subject_id),
    ].join('|'),
  );
}

export function subjectReferences(subject = {}) {
  const metadataReferences = objectList(subject.metadata?.subject_references);
  return uniqueObjects(
    [
      ...subjectCanonicalReferences(subject),
      ...metadataReferences,
    ],
    (reference) => [
      text(reference.id),
      text(reference.relationship),
      text(reference.handle || reference.subject_id),
    ].join('|'),
  );
}

export function subjectFacetHosts(facet = {}) {
  return objectList(facet.hosts);
}

export function subjectFacets(subject = {}) {
  return objectList(subject.facets).map((facet) => ({
    ...facet,
    capabilities: uniqueTextList(facet.capabilities),
    contracts: uniqueTextList(facet.contracts),
    hosts: subjectFacetHosts(facet),
  }));
}

export function subjectHosts(subject = {}) {
  return subjectFacets(subject).flatMap((facet) => subjectFacetHosts(facet));
}

export function subjectLegacyViews(subject = {}) {
  return uniqueTextList(subject.views);
}

export function subjectLegacyControls(subject = {}) {
  return uniqueTextList(subject.controls);
}

export function normalizeWorkbenchSubjectDescriptor(subject = {}) {
  return {
    ...cloneJson(subject),
    capabilities: subjectCapabilities(subject),
    legacy_capabilities: subjectRawCapabilities(subject),
    contracts: subjectContracts(subject),
    subject_references: subjectReferences(subject),
    facets: subjectFacets(subject),
    views: subjectLegacyViews(subject),
    controls: subjectLegacyControls(subject),
  };
}

export function createWorkbenchSubject({
  id,
  type,
  label,
  owner,
  source = null,
  capabilities = [],
  contracts = [],
  subject_references = [],
  facets = [],
  persistence = null,
  artifacts = [],
  state = {},
  metadata = {},
} = {}) {
  const subjectId = text(id);
  const subjectType = text(type);
  if (!subjectId) throw new TypeError('workbench subject requires an id');
  if (!subjectType) throw new TypeError('workbench subject requires a type');

  const rawCapabilities = uniqueTextList(capabilities);

  return {
    type: 'aos.workbench.subject',
    schema_version: WORKBENCH_SUBJECT_SCHEMA_VERSION,
    id: subjectId,
    subject_type: subjectType,
    label: text(label, subjectId),
    owner: text(owner, 'unknown'),
    source: source ? cloneJson(source) : null,
    capabilities: rawCapabilities.filter(isWorkbenchSubjectCapability),
    contracts: uniqueTextList([
      ...textList(contracts),
      ...rawCapabilities.filter(isLegacyOperationContract),
    ]),
    subject_references: objectList(subject_references),
    facets: objectList(facets),
    persistence: persistence ? cloneJson(persistence) : null,
    artifacts: Array.isArray(artifacts) ? cloneJson(artifacts) : [],
    state: cloneJson(state) || {},
    metadata: cloneJson(metadata) || {},
  };
}

export function subjectCapabilitySet(subject = {}) {
  return new Set(subjectCapabilities(subject));
}

export function subjectSupports(subject = {}, capability = '') {
  const value = text(capability);
  if (!value) return false;
  return subjectCapabilitySet(subject).has(value) || subjectContracts(subject).includes(value);
}

export function subjectSupportsCapability(subject = {}, capability = '') {
  const value = text(capability);
  return !!value && subjectCapabilities(subject).includes(value);
}

export function subjectSupportsContract(subject = {}, contract = '') {
  const value = text(contract);
  return !!value && subjectContracts(subject).includes(value);
}
