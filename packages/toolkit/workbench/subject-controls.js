import {
  subjectCapabilities,
  subjectCanonicalContracts,
  subjectFacets,
} from './subject.js';

export const WORKBENCH_SUBJECT_CONTROL_ORDER = Object.freeze([
  'open',
  'edit',
  'verify',
  'replay',
  'export',
]);

const CONTROL_DEFINITIONS = Object.freeze({
  open: {
    label: 'Open',
    capability: 'inspectable',
    layers: ['narrative', 'descriptor', 'controls', 'artifacts', 'evidence', 'health'],
    contractPattern: /\.(view|inspect|render)$|\.read$/,
    missingReason: 'missing_inspectable_facet',
  },
  edit: {
    label: 'Edit',
    capability: 'editable',
    layers: ['controls'],
    facetCapability: 'editable',
    contractPattern: /\.(edit|patch)$|\.patch\.requested$|\.save\.requested$/,
    requiresContractOrPersistence: true,
    missingReason: 'missing_edit_facet_or_contract',
  },
  verify: {
    label: 'Verify',
    capability: 'verifier-target',
    layers: ['health', 'artifacts', 'evidence', 'descriptor'],
    contractPattern: /(verifier|validation|health|claim|postcondition)/,
    missingReason: 'missing_verifier_facet',
  },
  replay: {
    label: 'Replay',
    capability: 'replayable',
    layers: ['controls', 'descriptor'],
    facetCapability: 'replayable',
    contractPattern: /(playbook|workflow|replay|invoke)/,
    missingReason: 'missing_replay_facet',
  },
  export: {
    label: 'Export',
    capability: 'exportable',
    layers: ['artifacts', 'evidence'],
    facetCapability: 'exportable',
    contractPattern: /\.(exports?|evidence)(\.|$)/,
    missingReason: 'missing_export_facet',
  },
});

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

function uniqueTextList(values = []) {
  return [...new Set(arrayValue(values).map((value) => text(value)).filter(Boolean))];
}

function facetContracts(facet = {}) {
  return uniqueTextList(facet.contracts);
}

function facetCapabilities(facet = {}) {
  return uniqueTextList(facet.capabilities);
}

function subjectPersistence(subject = {}) {
  return objectValue(subject.persistence);
}

function controlDefinition(controlId = '') {
  return CONTROL_DEFINITIONS[text(controlId)] || null;
}

function contractMatches(contract = '', pattern = null) {
  return pattern instanceof RegExp && pattern.test(text(contract));
}

function facetMatchesControl(facet = {}, definition = {}) {
  const layer = text(facet.layer);
  const capabilities = facetCapabilities(facet);
  const contracts = facetContracts(facet);
  return arrayValue(definition.layers).includes(layer)
    || (!!definition.facetCapability && capabilities.includes(definition.facetCapability))
    || contracts.some((contract) => contractMatches(contract, definition.contractPattern));
}

function matchingContracts(contracts = [], definition = {}) {
  return uniqueTextList(contracts).filter((contract) => contractMatches(contract, definition.contractPattern));
}

function facetSummary(facet = {}) {
  return {
    key: text(facet.key),
    layer: text(facet.layer),
    label: text(facet.label),
    capabilities: facetCapabilities(facet),
    contracts: facetContracts(facet),
    hosts: arrayValue(facet.hosts).map((host) => cloneJson(host)),
  };
}

function deriveControl(subject = {}, controlId = '') {
  const definition = controlDefinition(controlId);
  if (!definition) return null;

  const capabilities = subjectCapabilities(subject);
  if (!capabilities.includes(definition.capability)) return null;

  const facets = subjectFacets(subject);
  const matchedFacets = facets.filter((facet) => facetMatchesControl(facet, definition));
  const allContracts = uniqueTextList([
    ...subjectCanonicalContracts(subject),
    ...facets.flatMap((facet) => facetContracts(facet)),
  ]);
  const matchedContracts = matchingContracts(allContracts, definition);
  const persistence = subjectPersistence(subject);
  const hasPersistence = Object.keys(persistence).length > 0;
  const hasRequiredContract = matchedContracts.length > 0 || !definition.requiresContractOrPersistence;
  const enabled = matchedFacets.length > 0
    && (!definition.requiresContractOrPersistence || hasRequiredContract || hasPersistence);

  return {
    id: controlId,
    label: definition.label,
    capability: definition.capability,
    enabled,
    reason: enabled ? 'available' : definition.missingReason,
    facets: matchedFacets.map(facetSummary),
    contracts: matchedContracts,
    ...(hasPersistence ? { persistence: cloneJson(persistence) } : {}),
  };
}

export function deriveWorkbenchSubjectControls(subject = {}) {
  return WORKBENCH_SUBJECT_CONTROL_ORDER
    .map((controlId) => deriveControl(subject, controlId))
    .filter(Boolean);
}

export function findWorkbenchSubjectControl(subjectOrControls = {}, controlId = '') {
  const controls = Array.isArray(subjectOrControls)
    ? subjectOrControls
    : deriveWorkbenchSubjectControls(subjectOrControls);
  const id = text(controlId);
  return controls.find((control) => control?.id === id) || null;
}
