export const WORK_RECORD_EVIDENCE_ADAPTER_VERSION = '2026-05-evidence-adapters-v0';

export const WORK_RECORD_EVIDENCE_ADAPTER_IDS = Object.freeze({
  browserSemanticTargets: 'aos.work-record.evidence.browser-semantic-targets',
  canvasSemanticTargets: 'aos.work-record.evidence.canvas-semantic-targets',
  artifactMetadata: 'aos.work-record.evidence.artifact-metadata',
});

const SEMANTIC_CHECK_KINDS = new Set([
  'semantic_target_exists',
  'semantic_target_matches',
  'semantic_target_value_contains',
  'semantic_target_value_equals',
  'semantic_target_text_contains',
  'semantic_target_text_equals',
  'semantic_target_role_equals',
  'semantic_target_name_equals',
  'semantic_target_role_name_equals',
]);

const ARTIFACT_METADATA_CHECK_KINDS = new Set([
  'artifact_metadata_present',
  'artifact_metadata_matches',
  'artifact_uri_equals',
  'artifact_digest_equals',
  'artifact_dimensions_equal',
]);

const ADAPTERS = Object.freeze([
  Object.freeze({
    id: WORK_RECORD_EVIDENCE_ADAPTER_IDS.browserSemanticTargets,
    version: WORK_RECORD_EVIDENCE_ADAPTER_VERSION,
    mode: 'report_only',
    mutates_record: false,
    evidence: 'browser DOM/ARIA-like semantic targets in evidence metadata',
  }),
  Object.freeze({
    id: WORK_RECORD_EVIDENCE_ADAPTER_IDS.canvasSemanticTargets,
    version: WORK_RECORD_EVIDENCE_ADAPTER_VERSION,
    mode: 'report_only',
    mutates_record: false,
    evidence: 'canvas/AX-like semantic targets in evidence metadata',
  }),
  Object.freeze({
    id: WORK_RECORD_EVIDENCE_ADAPTER_IDS.artifactMetadata,
    version: WORK_RECORD_EVIDENCE_ADAPTER_VERSION,
    mode: 'report_only',
    mutates_record: false,
    evidence: 'artifact and screenshot metadata only',
  }),
]);

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function refList(values = []) {
  return arrayValue(values).map((value) => text(value)).filter(Boolean);
}

function mapById(values = []) {
  const result = new Map();
  arrayValue(values).forEach((value, index) => {
    const item = objectValue(value);
    const id = text(item.id);
    if (id) result.set(id, { item, index });
  });
  return result;
}

function targetRef(target = '') {
  const value = text(target);
  const schemeIndex = value.indexOf(':');
  const slashIndex = value.lastIndexOf('/');
  if (schemeIndex < 0 || slashIndex <= schemeIndex + 1 || slashIndex === value.length - 1) {
    return '';
  }
  return value.slice(slashIndex + 1);
}

function targetDialect(target = '') {
  const value = text(target);
  const schemeIndex = value.indexOf(':');
  return schemeIndex > 0 ? value.slice(0, schemeIndex) : '';
}

function addDiagnostic(diagnostics, code, message, path, details = {}) {
  diagnostics.push({
    severity: 'error',
    code,
    failure_class: text(details.failure_class, code),
    report_only: true,
    source: 'work_record_evidence_adapter',
    message,
    path,
    ...details,
  });
}

function normalizedCandidate(candidate = {}) {
  const value = objectValue(candidate);
  return {
    raw: value,
    ref: text(value.ref || value.id || value.object_id || value.ax_path),
    target: text(value.target),
    semanticRef: text(value.semantic_ref || value.data_aos_ref || value.aos_ref),
    role: text(value.role || value.ax_role || value.aria_role || value.semantic_role),
    name: text(value.name || value.label || value.aria_label || value.ax_label),
    value: text(value.value ?? value.text ?? value.text_content ?? value.inner_text),
    text: text(value.text ?? value.text_content ?? value.inner_text ?? value.value),
    enabled: typeof value.enabled === 'boolean' ? value.enabled : undefined,
  };
}

function candidateIdentities(candidate = {}) {
  const normalized = normalizedCandidate(candidate);
  return new Set([
    normalized.ref,
    normalized.target,
    targetRef(normalized.target),
    normalized.semanticRef,
  ].filter(Boolean));
}

function semanticTargetsForEvidence(evidence = {}) {
  const metadata = objectValue(objectValue(evidence).metadata);
  const payload = objectValue(metadata.payload);
  return [
    ...arrayValue(metadata.semantic_targets),
    ...arrayValue(metadata.elements),
    ...arrayValue(metadata.browser_targets),
    ...arrayValue(metadata.canvas_targets),
    ...arrayValue(metadata.ax_targets),
    ...arrayValue(payload.semantic_targets),
  ];
}

function expectedObject(check = {}) {
  return objectValue(objectValue(check).expected);
}

function expectedPrimitive(check = {}) {
  const value = objectValue(check).expected;
  return value && typeof value === 'object' ? '' : text(objectValue(check).expected);
}

function semanticSpec(postcondition = {}) {
  const value = objectValue(postcondition);
  const check = objectValue(value.check);
  const expected = expectedObject(check);
  const target = text(check.target || expected.target || value.target);
  const ref = text(check.ref || expected.ref || targetRef(target));

  return {
    checkKind: text(check.kind),
    target,
    targetRef: targetRef(target),
    ref,
    semanticRef: text(check.semantic_ref || check.data_aos_ref || expected.semantic_ref || expected.data_aos_ref),
    role: text(check.role || check.expected_role || expected.role),
    name: text(check.name || check.expected_name || expected.name),
    value: text(expected.value ?? check.value ?? expectedPrimitive(check)),
    text: text(expected.text ?? check.text),
    contains: text(expected.contains ?? expected.value_contains ?? check.contains),
    enabled: typeof expected.enabled === 'boolean'
      ? expected.enabled
      : (typeof check.enabled === 'boolean' ? check.enabled : undefined),
  };
}

function specIdentities(spec = {}) {
  return new Set([
    text(spec.ref),
    text(spec.target),
    targetRef(spec.target),
    text(spec.semanticRef),
  ].filter(Boolean));
}

function findSemanticTarget(evidenceItems = [], spec = {}) {
  const identities = specIdentities(spec);
  const candidates = [];

  for (const evidence of evidenceItems) {
    for (const candidate of semanticTargetsForEvidence(evidence)) {
      candidates.push({ evidence, candidate });
    }
  }

  if (identities.size > 0) {
    for (const item of candidates) {
      for (const identity of candidateIdentities(item.candidate)) {
        if (identities.has(identity)) return item;
      }
    }
  }

  if (spec.role || spec.name) {
    return candidates.find(({ candidate }) => {
      const normalized = normalizedCandidate(candidate);
      return (!spec.role || normalized.role === spec.role)
        && (!spec.name || normalized.name === spec.name);
    }) || null;
  }

  return null;
}

function evidenceForRefs(evidenceById = new Map(), refs = []) {
  return refList(refs)
    .map((ref) => evidenceById.get(ref)?.item)
    .filter(Boolean);
}

function semanticValueForKind(candidate = {}, checkKind = '') {
  const normalized = normalizedCandidate(candidate);
  if (checkKind.includes('_text_')) return normalized.text;
  return normalized.value;
}

function checkExpectedText({
  diagnostics,
  postcondition,
  postconditionIndex,
  candidate,
  spec,
}) {
  const checkKind = spec.checkKind;
  if (![
    'semantic_target_value_contains',
    'semantic_target_value_equals',
    'semantic_target_text_contains',
    'semantic_target_text_equals',
    'semantic_target_matches',
  ].includes(checkKind)) {
    return;
  }

  const expectedContains = checkKind.endsWith('_contains') ? spec.value || spec.text || spec.contains : spec.contains;
  const expectedEquals = checkKind.endsWith('_equals') || checkKind === 'semantic_target_matches'
    ? spec.value || spec.text
    : '';
  const actual = semanticValueForKind(candidate, checkKind);
  const postconditionId = text(postcondition.id, `postconditions[${postconditionIndex}]`);

  if (expectedContains && !actual.includes(expectedContains)) {
    addDiagnostic(
      diagnostics,
      'semantic_target_value_mismatch',
      `postcondition ${postconditionId} expected semantic target ${text(spec.ref, spec.target)} to contain ${expectedContains}`,
      `execution_map.postconditions[${postconditionIndex}].check.expected`,
      {
        failure_class: 'semantic_value_mismatch',
        adapter_id: semanticAdapterId(postcondition, candidate),
        postcondition_id: postconditionId,
        expected_value: expectedContains,
        actual_value: actual,
      },
    );
  }

  if (expectedEquals && actual !== expectedEquals) {
    addDiagnostic(
      diagnostics,
      'semantic_target_value_mismatch',
      `postcondition ${postconditionId} expected semantic target ${text(spec.ref, spec.target)} value ${expectedEquals}`,
      `execution_map.postconditions[${postconditionIndex}].check.expected`,
      {
        failure_class: 'semantic_value_mismatch',
        adapter_id: semanticAdapterId(postcondition, candidate),
        postcondition_id: postconditionId,
        expected_value: expectedEquals,
        actual_value: actual,
      },
    );
  }
}

function checkExpectedRoleName({
  diagnostics,
  postcondition,
  postconditionIndex,
  candidate,
  spec,
}) {
  if (!spec.role && !spec.name) return;
  const normalized = normalizedCandidate(candidate);
  const roleMismatch = spec.role && normalized.role !== spec.role;
  const nameMismatch = spec.name && normalized.name !== spec.name;
  if (!roleMismatch && !nameMismatch) return;

  const postconditionId = text(postcondition.id, `postconditions[${postconditionIndex}]`);
  addDiagnostic(
    diagnostics,
    'semantic_target_role_name_mismatch',
    `postcondition ${postconditionId} expected semantic target ${text(spec.ref, spec.target)} role/name metadata to match`,
    `execution_map.postconditions[${postconditionIndex}].check.expected`,
    {
      failure_class: 'semantic_role_name_mismatch',
      adapter_id: semanticAdapterId(postcondition, candidate),
      postcondition_id: postconditionId,
      expected_role: spec.role || null,
      actual_role: normalized.role || null,
      expected_name: spec.name || null,
      actual_name: normalized.name || null,
    },
  );
}

function semanticAdapterId(postcondition = {}, candidate = {}) {
  const dialect = targetDialect(text(postcondition.target || normalizedCandidate(candidate).target));
  if (dialect === 'canvas' || dialect === 'ax') {
    return WORK_RECORD_EVIDENCE_ADAPTER_IDS.canvasSemanticTargets;
  }
  return WORK_RECORD_EVIDENCE_ADAPTER_IDS.browserSemanticTargets;
}

function checkSemanticTarget({
  diagnostics,
  postcondition,
  postconditionIndex,
  evidenceItems,
}) {
  const spec = semanticSpec(postcondition);
  const postconditionId = text(postcondition.id, `postconditions[${postconditionIndex}]`);

  if (spec.targetRef && spec.ref && spec.targetRef !== spec.ref) {
    addDiagnostic(
      diagnostics,
      'evidence_target_ref_drift',
      `postcondition ${postconditionId} target ref ${spec.targetRef} does not match check ref ${spec.ref}`,
      `execution_map.postconditions[${postconditionIndex}].target`,
      {
        failure_class: 'target_ref_drift',
        adapter_id: semanticAdapterId(postcondition),
        postcondition_id: postconditionId,
        expected_ref: spec.ref,
        actual_ref: spec.targetRef,
        expected_target: spec.target,
      },
    );
  }

  const match = findSemanticTarget(evidenceItems, spec);
  if (!match) {
    addDiagnostic(
      diagnostics,
      'missing_semantic_target',
      `postcondition ${postconditionId} could not find semantic target ${text(spec.ref, spec.target)} in referenced evidence`,
      `execution_map.postconditions[${postconditionIndex}].check.ref`,
      {
        failure_class: 'semantic_target_missing',
        adapter_id: semanticAdapterId(postcondition),
        postcondition_id: postconditionId,
        expected_ref: spec.ref || null,
        expected_target: spec.target || null,
      },
    );
    return;
  }

  const normalized = normalizedCandidate(match.candidate);
  if (spec.target && normalized.target && spec.target !== normalized.target) {
    addDiagnostic(
      diagnostics,
      'evidence_target_ref_drift',
      `postcondition ${postconditionId} target ${spec.target} does not match evidence target ${normalized.target}`,
      `execution_map.postconditions[${postconditionIndex}].target`,
      {
        failure_class: 'target_ref_drift',
        adapter_id: semanticAdapterId(postcondition, match.candidate),
        postcondition_id: postconditionId,
        expected_target: spec.target,
        actual_target: normalized.target,
      },
    );
  }

  checkExpectedRoleName({
    diagnostics,
    postcondition,
    postconditionIndex,
    candidate: match.candidate,
    spec,
  });
  checkExpectedText({
    diagnostics,
    postcondition,
    postconditionIndex,
    candidate: match.candidate,
    spec,
  });

  if (typeof spec.enabled === 'boolean' && normalized.enabled !== undefined && normalized.enabled !== spec.enabled) {
    addDiagnostic(
      diagnostics,
      'semantic_target_state_mismatch',
      `postcondition ${postconditionId} expected semantic target ${text(spec.ref, spec.target)} enabled=${spec.enabled}`,
      `execution_map.postconditions[${postconditionIndex}].check.expected`,
      {
        failure_class: 'semantic_state_mismatch',
        adapter_id: semanticAdapterId(postcondition, match.candidate),
        postcondition_id: postconditionId,
        expected_enabled: spec.enabled,
        actual_enabled: normalized.enabled,
      },
    );
  }
}

function numberValue(value) {
  return Number.isFinite(value) ? value : null;
}

function artifactMetadata(evidence = {}) {
  const value = objectValue(evidence);
  const metadata = objectValue(value.metadata);
  const dimensions = objectValue(metadata.dimensions);
  const attachment = objectValue(metadata.attachment);
  return {
    uri: text(value.uri),
    digest: text(value.digest),
    kind: text(value.kind),
    width: numberValue(metadata.width) ?? numberValue(dimensions.width),
    height: numberValue(metadata.height) ?? numberValue(dimensions.height),
    content_type: text(metadata.content_type || metadata.mime_type),
    size_bytes: numberValue(metadata.size_bytes),
    attachment_id: text(metadata.attachment_id || attachment.id),
    attachment_kind: text(metadata.attachment_kind || attachment.kind),
  };
}

function artifactExpectation(check = {}) {
  const value = objectValue(check);
  const expected = expectedObject(value);
  const dimensions = objectValue(expected.dimensions);
  const result = {
    uri: text(expected.uri),
    digest: text(expected.digest),
    kind: text(expected.kind),
    content_type: text(expected.content_type || expected.mime_type),
    attachment_id: text(expected.attachment_id),
    attachment_kind: text(expected.attachment_kind),
  };

  if (Number.isFinite(expected.width)) result.width = expected.width;
  if (Number.isFinite(expected.height)) result.height = expected.height;
  if (Number.isFinite(dimensions.width)) result.width = dimensions.width;
  if (Number.isFinite(dimensions.height)) result.height = dimensions.height;
  if (Number.isFinite(expected.size_bytes)) result.size_bytes = expected.size_bytes;

  if (value.kind === 'artifact_uri_equals') result.uri = text(value.expected);
  if (value.kind === 'artifact_digest_equals') result.digest = text(value.expected);
  if (value.kind === 'artifact_dimensions_equal') {
    result.width = Number.isFinite(expected.width) ? expected.width : dimensions.width;
    result.height = Number.isFinite(expected.height) ? expected.height : dimensions.height;
  }

  return result;
}

function expectedArtifactEntries(expectation = {}) {
  return Object.entries(expectation).filter(([, value]) => value !== '' && value !== undefined && value !== null);
}

function checkArtifactMetadata({
  diagnostics,
  postcondition,
  postconditionIndex,
  evidenceItems,
}) {
  const postconditionId = text(postcondition.id, `postconditions[${postconditionIndex}]`);
  const check = objectValue(postcondition.check);
  const expected = artifactExpectation(check);
  const expectedEntries = expectedArtifactEntries(expected);
  const mismatches = [];

  if (evidenceItems.length === 0) {
    addDiagnostic(
      diagnostics,
      'artifact_metadata_missing',
      `postcondition ${postconditionId} has no artifact evidence to inspect`,
      `execution_map.postconditions[${postconditionIndex}].evidence_refs`,
      {
        failure_class: 'artifact_metadata_missing',
        adapter_id: WORK_RECORD_EVIDENCE_ADAPTER_IDS.artifactMetadata,
        postcondition_id: postconditionId,
      },
    );
    return;
  }

  for (const evidence of evidenceItems) {
    const actual = artifactMetadata(evidence);
    for (const [field, expectedValue] of expectedEntries) {
      if (actual[field] !== expectedValue) {
        mismatches.push({
          evidence_ref: text(evidence.id),
          field,
          expected: expectedValue,
          actual: actual[field] ?? null,
        });
      }
    }
  }

  if (mismatches.length > 0) {
    addDiagnostic(
      diagnostics,
      'artifact_metadata_mismatch',
      `postcondition ${postconditionId} artifact metadata did not match expected metadata`,
      `execution_map.postconditions[${postconditionIndex}].check.expected`,
      {
        failure_class: 'artifact_metadata_mismatch',
        adapter_id: WORK_RECORD_EVIDENCE_ADAPTER_IDS.artifactMetadata,
        postcondition_id: postconditionId,
        mismatches,
      },
    );
  }
}

function adapterKindForPostcondition(postcondition = {}) {
  const checkKind = text(objectValue(objectValue(postcondition).check).kind);
  if (SEMANTIC_CHECK_KINDS.has(checkKind)) return 'semantic';
  if (ARTIFACT_METADATA_CHECK_KINDS.has(checkKind)) return 'artifact_metadata';
  return '';
}

export function workRecordEvidenceAdapters() {
  return ADAPTERS.map((adapter) => cloneJson(adapter));
}

export function checkWorkRecordEvidenceAdapters(record = {}) {
  const diagnostics = [];
  const executionMap = objectValue(objectValue(record).execution_map);
  const postconditions = arrayValue(executionMap.postconditions);
  const evidenceById = mapById(objectValue(record).evidence);
  let checked = 0;
  let skipped = 0;

  postconditions.forEach((postcondition, postconditionIndex) => {
    const value = objectValue(postcondition);
    const adapterKind = adapterKindForPostcondition(value);
    if (!adapterKind) {
      skipped += 1;
      return;
    }

    const evidenceItems = evidenceForRefs(evidenceById, value.evidence_refs);
    checked += 1;

    if (adapterKind === 'semantic') {
      checkSemanticTarget({
        diagnostics,
        postcondition: value,
        postconditionIndex,
        evidenceItems,
      });
      return;
    }

    checkArtifactMetadata({
      diagnostics,
      postcondition: value,
      postconditionIndex,
      evidenceItems,
    });
  });

  const failureClasses = [...new Set(diagnostics.map((diagnostic) => diagnostic.failure_class).filter(Boolean))].sort();
  return {
    type: 'work_record.evidence_adapter_check',
    schema_version: WORK_RECORD_EVIDENCE_ADAPTER_VERSION,
    mode: 'report_only',
    status: diagnostics.length === 0 ? 'passed' : 'failed',
    mutates_record: false,
    adapter_ids: ADAPTERS.map((adapter) => adapter.id),
    diagnostics,
    failure_classes: failureClasses,
    summary: {
      checked,
      skipped,
      failures: diagnostics.length,
      failure_classes: failureClasses,
    },
  };
}
