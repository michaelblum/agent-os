import {
  workRecordSubjectId,
} from './work-record-adapter.js';
import {
  parseSubjectEntryHandle,
} from './subject-entry-handle.js';

export function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

export function multilineText(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\r\n/g, '\n').trim();
  return normalized || fallback;
}

export function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

export function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

export function slug(value = '') {
  return text(value, 'command-evidence')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'command-evidence';
}

export function workRecordHandleSubjectId(value = '') {
  const normalized = text(value);
  const parsed = parseSubjectEntryHandle(normalized);
  return parsed?.facet_key === 'work-record' ? parsed.subject_id : normalized;
}

export function workRecordCaptureBaseId(recordId = '', sourceId = '') {
  return slug(workRecordHandleSubjectId(text(recordId) || sourceId));
}

export function workRecordCaptureRecordId(recordId = '', baseId = '') {
  return workRecordSubjectId(text(recordId) || baseId);
}

export function fnv1a32(value = '') {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(value[key])}`
  )).join(',')}}`;
}

export function evidenceDigest(value) {
  return `fnv1a32:${fnv1a32(stableJson(value))}`;
}

export function requireText(value, label) {
  const normalized = text(value);
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}

export function commandTarget(command) {
  return `command:${command}`;
}

export function evidenceTarget(target, fallback = '') {
  return requireText(target || fallback, 'evidence target');
}

export function confidenceFor(passed) {
  return passed ? 0.98 : 0.3;
}

export function postconditionResult({ postcondition, passed, evidenceId, reason }) {
  return {
    postcondition_id: postcondition.id,
    status: passed ? 'passed' : 'failed',
    evidence_refs: [evidenceId],
    reason,
  };
}

export function claimResult({ claim, passed, evidenceId, postcondition, reason }) {
  return {
    id: `claim-result:${claim.id.replace(/^claim:/, '')}`,
    claim_id: claim.id,
    status: passed ? 'verified' : 'failed',
    confidence: confidenceFor(passed),
    reason,
    evidence_refs: [evidenceId],
    postcondition_results: [
      postconditionResult({ postcondition, passed, evidenceId, reason }),
    ],
  };
}

export function claimResultForPostconditions({
  claim,
  passed,
  evidenceRefs,
  postconditionResults,
  reason,
  confidence = confidenceFor(passed),
}) {
  return {
    id: `claim-result:${claim.id.replace(/^claim:/, '')}`,
    claim_id: claim.id,
    status: passed ? 'verified' : 'failed',
    confidence,
    reason,
    evidence_refs: evidenceRefs,
    postcondition_results: postconditionResults,
  };
}

export function resultFor(postcondition, { passed, evidenceRefs, reason }) {
  return {
    postcondition_id: postcondition.id,
    status: passed ? 'passed' : 'failed',
    evidence_refs: evidenceRefs,
    reason,
  };
}

export function evidenceEventPayload(event, extra = {}) {
  return {
    id: text(event.id),
    command: text(event.command),
    target: text(event.target),
    state_id: text(event.state_id),
    created_at: text(event.captured_at || event.executed_at),
    summary: text(event.summary),
    artifact_uri: text(event.artifact_uri),
    elements: cloneJson(arrayValue(event.elements)),
    semantic_targets: cloneJson(arrayValue(event.semantic_targets)),
    metadata: cloneJson(objectValue(event.metadata)),
    ...extra,
  };
}

export function actionStatus(action) {
  return text(action.status || objectValue(action.result).status, 'unknown');
}

export function healthVerdictForSource({
  evidenceSource,
  actionPassed,
  postconditionPassed,
  cleanupPassed,
}) {
  const validationStatus = text(objectValue(evidenceSource.current_validation).status || objectValue(objectValue(evidenceSource.action).current_validation).status);
  if (['stale', 'ambiguous', 'missing'].includes(validationStatus)) return 'repairable';
  if (!actionPassed || !postconditionPassed || cleanupPassed === false) return 'blocked';
  const explicit = text(objectValue(evidenceSource.health).verdict);
  if ([
    'valid',
    'stale',
    'repairable',
    'blocked',
    'impossible',
    'superseded',
    'retired',
  ].includes(explicit)) {
    return explicit;
  }
  return 'valid';
}

export function healthReasonForVerdict(verdict, fallback = '') {
  const reasons = {
    valid: 'All run Claims verified against immutable AOS saved-ref action evidence.',
    stale: 'The Work Record requires fresh validation before it can be trusted for replay or repair.',
    repairable: 'Saved-ref validation is stale, ambiguous, or missing, but intent and immutable evidence are sufficient for workflow-gated repair.',
    blocked: 'One or more run Claims failed against the AOS saved-ref action evidence.',
    impossible: 'The recorded intent can no longer be satisfied by the known target class.',
    superseded: 'A newer Work Record explicitly replaces this record.',
    retired: 'This Work Record is intentionally no longer executable.',
  };
  return text(fallback, reasons[verdict] || 'The Work Record verifier classified the record health.');
}

export function uniqueStrings(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values.map((item) => text(item)).filter(Boolean)) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

export function mergeReferences(...groups) {
  const seen = new Set();
  const result = [];
  for (const group of groups) {
    for (const reference of arrayValue(group)) {
      const copy = cloneJson(objectValue(reference));
      const key = text(copy.id, text(copy.ref));
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(copy);
    }
  }
  return result;
}

export function findById(values = [], id = '') {
  return arrayValue(values).find((value) => text(objectValue(value).id) === id);
}

export function stepDescriptorRunId(stepDescriptor, evidenceSource) {
  const runSlug = slug(text(stepDescriptor.id || evidenceSource.id).replace(/^step-descriptor:/, ''));
  const timestamp = requireText(
    evidenceSource.completed_at || evidenceSource.created_at,
    'evidence completed_at',
  ).replace(/[:.]/g, '-');
  return `run:${runSlug}:${timestamp}`;
}

export function stepDescriptorPostconditionSource(stepDescriptor, evidenceSource) {
  const sourcePostcondition = objectValue(evidenceSource.postcondition);
  const promotion = objectValue(arrayValue(stepDescriptor.claim_promotions)[0]);
  const templatePostcondition = objectValue(
    findById(stepDescriptor.postconditions, text(promotion.postcondition_ref))
      || findById(stepDescriptor.postconditions, text(sourcePostcondition.id)),
  );
  const templateCheck = objectValue(templatePostcondition.check);
  const sourceCheck = objectValue(sourcePostcondition.check);
  const templateRepairPolicy = objectValue(templatePostcondition.repair_policy);
  const sourceRepairPolicy = objectValue(sourcePostcondition.repair_policy);

  return {
    ...cloneJson(sourcePostcondition),
    id: text(templatePostcondition.id, text(sourcePostcondition.id)),
    kind: text(templatePostcondition.kind, text(sourcePostcondition.kind)),
    description: text(templatePostcondition.description, text(sourcePostcondition.description)),
    target: text(sourcePostcondition.target, text(templatePostcondition.target)),
    check: {
      ...cloneJson(templateCheck),
      ...cloneJson(sourceCheck),
    },
    repair_policy: Object.keys(templateRepairPolicy).length > 0
      ? cloneJson(templateRepairPolicy)
      : cloneJson(sourceRepairPolicy),
  };
}

export function stepDescriptorEvidenceSource(stepDescriptor, evidenceSource) {
  const stepIntent = objectValue(stepDescriptor.intent);
  const sourceIntent = objectValue(evidenceSource.intent);
  const promotion = objectValue(arrayValue(stepDescriptor.claim_promotions)[0]);

  return {
    ...cloneJson(evidenceSource),
    intent: {
      summary: text(stepIntent.summary, text(sourceIntent.summary)),
      purpose: text(stepIntent.purpose, text(sourceIntent.purpose)),
      acceptance: text(stepIntent.acceptance, text(sourceIntent.acceptance)),
      constraints: uniqueStrings([
        ...arrayValue(stepIntent.constraints),
        ...arrayValue(sourceIntent.constraints),
      ]),
    },
    references: mergeReferences(arrayValue(stepDescriptor.references), arrayValue(evidenceSource.references)),
    postcondition: stepDescriptorPostconditionSource(stepDescriptor, evidenceSource),
    claim_text: text(promotion.claim_text, text(evidenceSource.claim_text)),
    acceptance: text(promotion.acceptance, text(evidenceSource.acceptance)),
  };
}

