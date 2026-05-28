import {
  ARTIFACT_BUNDLE_WORKBENCH_URL,
  createArtifactBundleSubject,
} from './artifact-bundle-subject.js';
import { createWorkRecordSubject } from './work-record.js';
import {
  subjectCapabilities,
  subjectCanonicalContracts,
  subjectCanonicalReferences,
  subjectFacets,
} from './subject.js';
import {
  deriveWorkbenchSubjectControls,
  findWorkbenchSubjectControl,
} from './subject-controls.js';
import {
  normalizeSubjectEntryHandle,
} from './subject-entry-handle.js';

export const SUBJECT_CATALOG_SCHEMA_VERSION = '2026-05-06-subject-catalog-v0';
export const SUBJECT_CATALOG_LOAD_TYPE = 'subject_catalog.load';
export const SUBJECT_OPEN_REQUEST_TYPE = 'subject.open.requested';
export const SUBJECT_OPEN_RESULT_TYPE = 'subject.open.result';

export const WORK_RECORD_WORKBENCH_URL = 'aos://toolkit/components/work-record-workbench/index.html';
export const STEP_DESCRIPTOR_WORKBENCH_URL = 'aos://toolkit/components/step-descriptor-workbench/index.html';
export { ARTIFACT_BUNDLE_WORKBENCH_URL };

const COMPONENT_OPENERS = Object.freeze([
  {
    id: 'work-record-workbench',
    component_url: WORK_RECORD_WORKBENCH_URL,
    subject_types: ['aos.work_record', 'aos.do_step', 'aos.recipe_health_event'],
    required_contract_prefix: 'work_record.',
    message_types: ['work_record.open'],
  },
  {
    id: 'step-descriptor-workbench',
    component_url: STEP_DESCRIPTOR_WORKBENCH_URL,
    subject_types: ['aos.step_descriptor_prototype'],
    required_contract_prefix: 'step_descriptor.',
    message_types: [SUBJECT_CATALOG_LOAD_TYPE, 'step_descriptor_workbench.load'],
  },
  {
    id: 'artifact-bundle-workbench',
    component_url: ARTIFACT_BUNDLE_WORKBENCH_URL,
    subject_types: ['aos.artifact_bundle'],
    required_contract_prefix: 'artifact_bundle.',
    message_types: ['artifact_bundle.open'],
  },
]);

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

function textList(values = []) {
  return arrayValue(values).map((value) => text(value)).filter(Boolean);
}

function uniqueTextList(values = []) {
  return [...new Set(textList(values))];
}

function subjectIsDescriptor(subject = {}) {
  return objectValue(subject).type === 'aos.workbench.subject'
    && !!text(subject.id)
    && !!text(subject.subject_type);
}

function catalogKey(value = '') {
  const normalized = text(value, 'subject')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'subject';
}

function entryIdForSubject(subject = {}) {
  return `subject-catalog:${catalogKey(subject.id || subject.label || subject.subject_type)}`;
}

function entryHandleForSubject(subject = {}) {
  const id = text(subject.id);
  return normalizeSubjectEntryHandle(id) || id;
}

function facetContracts(facet = {}) {
  return uniqueTextList(facet.contracts);
}

function canonicalContractsForSubject(subject = {}) {
  return uniqueTextList([
    ...subjectCanonicalContracts(subject),
    ...subjectFacets(subject).flatMap((facet) => facetContracts(facet)),
  ]);
}

function facetHostCandidatesForFacets(facets = []) {
  return arrayValue(facets).flatMap((facet) => {
    const hosts = arrayValue(facet.hosts);
    return hosts.map((host) => ({
      facet: {
        key: text(facet.key),
        layer: text(facet.layer),
        label: text(facet.label),
        contracts: facetContracts(facet),
      },
      host: cloneJson(host),
    }));
  });
}

function hostComponentUrl(host = {}) {
  const entry = objectValue(host.entry);
  return text(entry.value);
}

function openersForSubject(subject = {}) {
  const controls = deriveWorkbenchSubjectControls(subject);
  const openControl = findWorkbenchSubjectControl(controls, 'open');
  const contracts = canonicalContractsForSubject(subject);
  const hosts = facetHostCandidatesForFacets(openControl?.facets);
  const subjectType = text(subject.subject_type);
  if (!openControl?.enabled) return [];

  return COMPONENT_OPENERS.flatMap((opener) => {
    if (!opener.subject_types.includes(subjectType)) return [];
    if (!contracts.some((contract) => contract.startsWith(opener.required_contract_prefix))) return [];
    const candidate = hosts.find(({ host }) => hostComponentUrl(host) === opener.component_url);
    if (!candidate) return [];
    return [{
      id: opener.id,
      component_url: opener.component_url,
      target_dialect: text(candidate.host.target_dialect),
      message_types: [...opener.message_types],
      facet: candidate.facet,
      host: candidate.host,
    }];
  });
}

export function subjectCatalogAffordances(subject = {}) {
  if (!subjectIsDescriptor(subject)) {
    return {
      inspectable: false,
      openable: false,
      read_only: true,
      openers: [],
      reference_count: 0,
      followable_reference_count: 0,
    };
  }

  const controls = deriveWorkbenchSubjectControls(subject);
  const references = subjectCanonicalReferences(subject);
  const openers = openersForSubject(subject);
  const openControl = findWorkbenchSubjectControl(controls, 'open');
  const editControl = findWorkbenchSubjectControl(controls, 'edit');
  return {
    inspectable: !!openControl,
    openable: openers.length > 0,
    read_only: !editControl?.enabled,
    openers,
    reference_count: references.length,
    followable_reference_count: references.filter((reference) => text(reference.handle)).length,
  };
}

export function createSubjectCatalogEntry(input = {}, options = {}) {
  const subject = objectValue(input.subject || input);
  if (!subjectIsDescriptor(subject)) {
    throw new TypeError('subject catalog entry requires an aos.workbench.subject descriptor');
  }

  const openPayload = input.open_payload || input.openPayload || options.open_payload || options.openPayload || null;
  const affordances = subjectCatalogAffordances(subject);
  return {
    type: 'aos.subject_catalog.entry',
    schema_version: SUBJECT_CATALOG_SCHEMA_VERSION,
    id: text(input.id || options.id, entryIdForSubject(subject)),
    key: text(input.key || options.key, catalogKey(subject.id)),
    entry_handle: text(input.entry_handle || options.entry_handle, entryHandleForSubject(subject)),
    label: text(input.label || options.label, subject.label || subject.id),
    subject: cloneJson(subject),
    capabilities: subjectCapabilities(subject),
    contracts: canonicalContractsForSubject(subject),
    subject_references: subjectCanonicalReferences(subject),
    facets: subjectFacets(subject),
    affordances: {
      ...affordances,
      openable: affordances.openable && !!openPayload,
    },
    ...(openPayload ? { open_payload: cloneJson(openPayload) } : {}),
    metadata: cloneJson(input.metadata || options.metadata || {}),
  };
}

export function createSubjectCatalogEntries(entries = []) {
  return arrayValue(entries).map((entry) => createSubjectCatalogEntry(entry));
}

export function createWorkRecordSubjectCatalogEntry(record = {}, {
  id = '',
  key = '',
  source = null,
} = {}) {
  const subject = createWorkRecordSubject(record);
  const normalizedSource = source && typeof source === 'object'
    ? cloneJson(source)
    : {
      kind: 'subject_browser_catalog',
      path: null,
      read_only: true,
    };
  return createSubjectCatalogEntry({
    id,
    key,
    subject,
    entry_handle: entryHandleForSubject(subject),
    open_payload: {
      type: 'work_record.open',
      source: normalizedSource,
      record: cloneJson(record),
    },
  });
}

export function createArtifactBundleSubjectCatalogEntry(bundle = {}, {
  id = '',
  key = '',
  source = null,
  content_root = null,
  contentRoot = content_root,
} = {}) {
  const subject = createArtifactBundleSubject(bundle);
  const normalizedSource = source && typeof source === 'object'
    ? cloneJson(source)
    : {
      kind: 'subject_browser_catalog',
      path: subject.source?.path || null,
      read_only: true,
    };
  const openMessage = {
    type: 'artifact_bundle.open',
    source: normalizedSource,
    subject: cloneJson(subject),
  };
  if (contentRoot && typeof contentRoot === 'object') {
    openMessage.content_root = cloneJson(contentRoot);
  }
  return createSubjectCatalogEntry({
    id,
    key,
    subject,
    entry_handle: entryHandleForSubject(subject),
    open_payload: openMessage,
  });
}

function entryOpenersForPayload(entry = {}) {
  const payloadType = text(entry.open_payload?.type);
  return arrayValue(entry.affordances?.openers)
    .filter((opener) => arrayValue(opener.message_types).includes(payloadType));
}

export function subjectCatalogEntryCanOpen(entry = {}) {
  return entryOpenersForPayload(entry).length > 0;
}

export function createSubjectOpenRequestFromCatalogEntry(entry = {}, {
  requestId = '',
} = {}) {
  const value = entry.type === 'aos.subject_catalog.entry'
    ? cloneJson(entry)
    : createSubjectCatalogEntry(entry);
  const openers = entryOpenersForPayload(value);
  const opener = openers[0];
  if (!opener) return null;

  return {
    type: SUBJECT_OPEN_REQUEST_TYPE,
    schema_version: SUBJECT_CATALOG_SCHEMA_VERSION,
    request_id: text(requestId, `subject-open-${Date.now().toString(36)}`),
    entry_id: text(value.id),
    entry_handle: text(value.entry_handle),
    subject: cloneJson(value.subject),
    selected_facet: cloneJson(opener.facet),
    host: cloneJson(opener.host),
    opener: {
      id: text(opener.id),
      component_url: text(opener.component_url),
      target_dialect: text(opener.target_dialect),
      message_type: text(value.open_payload?.type),
    },
    open_message: cloneJson(value.open_payload),
  };
}
