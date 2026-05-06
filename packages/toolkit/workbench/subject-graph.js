import {
  subjectCapabilities,
  subjectCanonicalContracts,
  subjectCanonicalReferences,
  subjectFacets,
} from './subject.js';

export const SUBJECT_GRAPH_INDEX_TYPE = 'aos.subject_graph.index';
export const SUBJECT_GRAPH_INDEX_SCHEMA_VERSION = '2026-05-06-subject-graph-index-v0';

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

function subjectNodeId(subjectId = '') {
  return `subject:${text(subjectId)}`;
}

function facetNodeId(subjectId = '', facetKey = '') {
  return `facet:${text(subjectId)}#${text(facetKey)}`;
}

function hostReferenceId(subjectId = '', facetKey = '', hostIndex = 0) {
  return `host:${text(subjectId)}#${text(facetKey)}#${hostIndex + 1}`;
}

function referenceEdgeId(subjectId = '', reference = {}) {
  return [
    'edge',
    subjectNodeId(subjectId),
    'subject_reference',
    text(reference.id, text(reference.relationship, 'reference')),
  ].join(':');
}

function compareById(left = {}, right = {}) {
  return text(left.id).localeCompare(text(right.id));
}

function catalogSourceRecord(entry = {}) {
  return {
    kind: 'catalog_entry',
    entry_id: text(entry.id),
    key: text(entry.key),
    entry_handle: text(entry.entry_handle || entry.subject?.id),
    schema_version: text(entry.schema_version),
  };
}

function descriptorSourceRecord(subject = {}) {
  return {
    kind: 'descriptor',
    entry_handle: text(subject.id),
  };
}

function normalizeSubjectInputs(input = []) {
  const records = [];

  function add(value, sourceRecord = null) {
    const candidate = objectValue(value);
    if (candidate.type === 'aos.subject_catalog.entry' && subjectIsDescriptor(candidate.subject)) {
      records.push({
        subject: cloneJson(candidate.subject),
        source_record: catalogSourceRecord(candidate),
      });
      return;
    }
    if (subjectIsDescriptor(candidate.subject)) {
      records.push({
        subject: cloneJson(candidate.subject),
        source_record: sourceRecord || {
          kind: 'descriptor_wrapper',
          entry_handle: text(candidate.entry_handle || candidate.subject.id),
        },
      });
      return;
    }
    if (subjectIsDescriptor(candidate)) {
      records.push({
        subject: cloneJson(candidate),
        source_record: sourceRecord || descriptorSourceRecord(candidate),
      });
    }
  }

  if (Array.isArray(input)) {
    for (const value of input) add(value);
  } else {
    const value = objectValue(input);
    for (const subject of arrayValue(value.subjects)) add(subject, descriptorSourceRecord(subject));
    for (const entry of arrayValue(value.entries)) add(entry);
    if (records.length === 0) add(value);
  }

  const bySubjectId = new Map();
  for (const record of records) {
    const subjectId = text(record.subject.id);
    if (!subjectId || bySubjectId.has(subjectId)) continue;
    bySubjectId.set(subjectId, record);
  }

  return [...bySubjectId.values()].sort((left, right) => (
    text(left.subject.id).localeCompare(text(right.subject.id))
  ));
}

function hostEntry(host = {}) {
  const value = objectValue(host);
  return {
    kind: text(value.kind),
    target_dialect: text(value.target_dialect),
    entry: cloneJson(objectValue(value.entry)),
    preferred: value.preferred === true,
    browser_compatible: value.browser_compatible === true,
    ...(text(value.notes) ? { notes: text(value.notes) } : {}),
  };
}

function healthMetadata(subject = {}) {
  const state = objectValue(subject.state);
  const health = state.health ?? subject.health ?? objectValue(subject.metadata).health ?? null;
  const verifierStatus = text(state.verifier_status || objectValue(subject.metadata).verifier_status);
  const verifierReportId = text(state.verifier_report_id || objectValue(subject.metadata).verifier_report_id);
  if (!health && !verifierStatus && !verifierReportId) return null;
  return {
    ...(health && typeof health === 'object' ? cloneJson(health) : {}),
    ...(health && typeof health !== 'object' ? { status: text(health) } : {}),
    ...(verifierStatus ? { verifier_status: verifierStatus } : {}),
    ...(verifierReportId ? { verifier_report_id: verifierReportId } : {}),
  };
}

function evidenceMetadata(subject = {}) {
  const metadata = objectValue(subject.metadata);
  const artifacts = arrayValue(subject.artifacts);
  const evidenceCount = Number.isFinite(Number(metadata.evidence_count))
    ? Number(metadata.evidence_count)
    : null;
  const claimCount = Number.isFinite(Number(metadata.claim_count))
    ? Number(metadata.claim_count)
    : null;
  const claimResultCount = Number.isFinite(Number(metadata.claim_result_count))
    ? Number(metadata.claim_result_count)
    : null;
  const artifactCount = artifacts.length;
  if (
    artifactCount === 0
    && evidenceCount === null
    && claimCount === null
    && claimResultCount === null
  ) {
    return null;
  }
  return {
    artifact_count: artifactCount,
    ...(evidenceCount !== null ? { evidence_count: evidenceCount } : {}),
    ...(claimCount !== null ? { claim_count: claimCount } : {}),
    ...(claimResultCount !== null ? { claim_result_count: claimResultCount } : {}),
  };
}

function edgeTargetForReference(reference = {}) {
  const subjectId = text(reference.subject_id);
  const handle = text(reference.handle);
  const targetSubjectId = subjectId || handle;
  return {
    node_id: targetSubjectId ? subjectNodeId(targetSubjectId) : '',
    subject_id: subjectId || null,
    handle: handle || null,
    subject_type: text(reference.subject_type) || null,
    facet_key: text(reference.facet_key) || null,
    layer: text(reference.layer) || null,
  };
}

function facetContracts(facet = {}) {
  return uniqueTextList(facet.contracts);
}

function createSubjectNode({ subject, source_record, facets, references }) {
  const facetHostCount = facets.reduce((count, facet) => count + arrayValue(facet.hosts).length, 0);
  return {
    id: subjectNodeId(subject.id),
    kind: 'subject',
    subject_id: text(subject.id),
    subject_type: text(subject.subject_type),
    label: text(subject.label, subject.id),
    owner: text(subject.owner),
    entry_handle: text(source_record.entry_handle, subject.id),
    capabilities: subjectCapabilities(subject),
    contracts: subjectCanonicalContracts(subject),
    source: subject.source ? cloneJson(subject.source) : null,
    facet_count: facets.length,
    host_count: facetHostCount,
    reference_count: references.length,
    health: healthMetadata(subject),
    evidence: evidenceMetadata(subject),
    source_record: cloneJson(source_record),
  };
}

function createFacetSummary(subject = {}, facet = {}) {
  const subjectId = text(subject.id);
  const key = text(facet.key);
  return {
    id: facetNodeId(subjectId, key),
    kind: 'facet',
    subject_node_id: subjectNodeId(subjectId),
    subject_id: subjectId,
    key,
    layer: text(facet.layer),
    label: text(facet.label, key),
    capabilities: uniqueTextList(facet.capabilities),
    contracts: facetContracts(facet),
    source: facet.source ? cloneJson(facet.source) : null,
    source_ref: text(facet.source_ref) || null,
    host_count: arrayValue(facet.hosts).length,
  };
}

function createHostReference(subject = {}, facet = {}, host = {}, hostIndex = 0) {
  const subjectId = text(subject.id);
  const facetKey = text(facet.key);
  return {
    id: hostReferenceId(subjectId, facetKey, hostIndex),
    kind: 'host',
    subject_node_id: subjectNodeId(subjectId),
    subject_id: subjectId,
    facet_node_id: facetNodeId(subjectId, facetKey),
    facet_key: facetKey,
    host_index: hostIndex,
    ...hostEntry(host),
  };
}

function createReferenceEdge(subject = {}, reference = {}) {
  const subjectId = text(subject.id);
  const target = edgeTargetForReference(reference);
  return {
    id: referenceEdgeId(subjectId, reference),
    kind: 'subject_reference',
    relationship: text(reference.relationship, 'references'),
    source: subjectNodeId(subjectId),
    target: target.node_id,
    source_subject_id: subjectId,
    reference_id: text(reference.id),
    role: text(reference.role) || null,
    target_subject_id: target.subject_id,
    target_handle: target.handle,
    target_subject_type: target.subject_type,
    target_facet_key: target.facet_key,
    target_layer: target.layer,
    metadata: reference.metadata ? cloneJson(reference.metadata) : {},
  };
}

function createFacetReferenceEdge(subject = {}, facet = {}, reference = {}) {
  const subjectId = text(subject.id);
  const facetKey = text(facet.key);
  const target = edgeTargetForReference(reference);
  return {
    id: [
      'edge',
      facetNodeId(subjectId, facetKey),
      'facet_source_reference',
      text(reference.id),
    ].join(':'),
    kind: 'facet_source_reference',
    relationship: 'facet_source_reference',
    source: facetNodeId(subjectId, facetKey),
    target: target.node_id,
    source_subject_id: subjectId,
    source_facet_key: facetKey,
    reference_id: text(reference.id),
    target_subject_id: target.subject_id,
    target_handle: target.handle,
    target_subject_type: target.subject_type,
    target_facet_key: target.facet_key,
    target_layer: target.layer,
  };
}

function indexSummary(nodes, facetSummaries, hostReferences, edges, records) {
  const healthCounts = {};
  for (const node of nodes) {
    const status = text(node.health?.verdict || node.health?.status || node.health?.verifier_status);
    if (!status) continue;
    healthCounts[status] = (healthCounts[status] || 0) + 1;
  }
  return {
    subject_count: nodes.length,
    facet_count: facetSummaries.length,
    host_count: hostReferences.length,
    edge_count: edges.length,
    catalog_entry_count: records.filter((record) => record.source_record.kind === 'catalog_entry').length,
    descriptor_count: records.filter((record) => record.source_record.kind !== 'catalog_entry').length,
    health: healthCounts,
  };
}

export function deriveSubjectGraphIndex(input = []) {
  const records = normalizeSubjectInputs(input);
  const nodes = [];
  const facet_summaries = [];
  const host_references = [];
  const edges = [];

  for (const record of records) {
    const subject = record.subject;
    const facets = subjectFacets(subject);
    const references = subjectCanonicalReferences(subject);
    const referenceById = new Map(references.map((reference) => [text(reference.id), reference]));

    nodes.push(createSubjectNode({
      subject,
      source_record: record.source_record,
      facets,
      references,
    }));

    for (const facet of facets) {
      const summary = createFacetSummary(subject, facet);
      facet_summaries.push(summary);
      edges.push({
        id: [
          'edge',
          subjectNodeId(subject.id),
          'has_facet',
          summary.id,
        ].join(':'),
        kind: 'has_facet',
        relationship: 'has_facet',
        source: subjectNodeId(subject.id),
        target: summary.id,
        source_subject_id: text(subject.id),
        target_facet_key: summary.key,
        target_layer: summary.layer,
      });

      arrayValue(facet.hosts).forEach((host, hostIndex) => {
        const hostReference = createHostReference(subject, facet, host, hostIndex);
        host_references.push(hostReference);
        edges.push({
          id: [
            'edge',
            summary.id,
            'hosted_by',
            hostReference.id,
          ].join(':'),
          kind: 'hosted_by',
          relationship: 'hosted_by',
          source: summary.id,
          target: hostReference.id,
          source_subject_id: text(subject.id),
          source_facet_key: summary.key,
          host_kind: hostReference.kind,
          target_dialect: hostReference.target_dialect,
        });
      });

      const sourceReference = referenceById.get(text(facet.source_ref));
      if (sourceReference) {
        edges.push(createFacetReferenceEdge(subject, facet, sourceReference));
      }
    }

    for (const reference of references) {
      edges.push(createReferenceEdge(subject, reference));
    }
  }

  nodes.sort(compareById);
  facet_summaries.sort(compareById);
  host_references.sort(compareById);
  edges.sort(compareById);

  return {
    type: SUBJECT_GRAPH_INDEX_TYPE,
    schema_version: SUBJECT_GRAPH_INDEX_SCHEMA_VERSION,
    nodes,
    facet_summaries,
    host_references,
    edges,
    metadata: indexSummary(nodes, facet_summaries, host_references, edges, records),
  };
}

export function summarizeSubjectGraphIndex(index = {}) {
  return {
    subject_count: Number(index.metadata?.subject_count || 0),
    facet_count: Number(index.metadata?.facet_count || 0),
    host_count: Number(index.metadata?.host_count || 0),
    edge_count: Number(index.metadata?.edge_count || 0),
    relationship_types: uniqueTextList(arrayValue(index.edges).map((edge) => edge.relationship)).sort(),
    subject_types: uniqueTextList(arrayValue(index.nodes).map((node) => node.subject_type)).sort(),
    health: cloneJson(index.metadata?.health || {}),
  };
}
