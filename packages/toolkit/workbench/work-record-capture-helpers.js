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

export function rawText(value, fallback = '') {
  const raw = String(value ?? '');
  return raw || fallback;
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

function exactValue(left, right) {
  return stableJson(left) === stableJson(right);
}

function templateTokens(value = '') {
  return [...String(value).matchAll(/{{([^{}]+)}}/g)].map((match) => match[1]);
}

function renderTemplate(value = '', variables = {}) {
  return String(value).replace(/{{([^{}]+)}}/g, (match, key) => (
    Object.hasOwn(variables, key) ? String(variables[key]) : match
  ));
}

function mismatch(code, path, message) {
  return { code, path, message };
}

function duplicateIdMismatches(owner, key) {
  const seen = new Set();
  const result = [];
  for (const [index, item] of arrayValue(objectValue(owner)[key]).entries()) {
    const id = text(objectValue(item).id);
    if (id && seen.has(id)) {
      result.push(mismatch(
        'step_descriptor_duplicate_id',
        `step_descriptor.${key}[${index}].id`,
        `Step Descriptor ${key} id ${id} is duplicated.`,
      ));
    }
    if (id) seen.add(id);
  }
  return result;
}

function semanticTargetFor(condition, perception) {
  const value = objectValue(condition);
  const check = objectValue(value.check);
  const ref = text(check.ref);
  const target = rawText(value.target);
  return arrayValue(objectValue(perception).semantic_targets).find((candidate) => {
    const item = objectValue(candidate);
    if (ref && text(item.ref) !== ref) return false;
    return !target || rawText(item.target) === target;
  }) || null;
}

function conditionSatisfied(condition, perception) {
  const value = objectValue(condition);
  const check = objectValue(value.check);
  const candidate = semanticTargetFor(value, perception);
  if (!candidate) return false;
  const expected = check.expected;
  const expectedText = String(expected ?? '');
  const item = objectValue(candidate);
  switch (text(check.kind)) {
    case 'semantic_target_exists':
      return true;
    case 'semantic_target_value_contains':
      return String(item.value ?? '').includes(expectedText);
    case 'semantic_target_value_equals':
      return exactValue(item.value, expected);
    case 'semantic_target_text_contains':
      return String(item.text ?? '').includes(expectedText);
    case 'semantic_target_text_equals':
      return exactValue(item.text, expected);
    case 'semantic_target_name_contains':
      return String(item.name ?? '').includes(expectedText);
    case 'semantic_target_name_equals':
      return exactValue(item.name, expected);
    case 'semantic_target_role_equals':
      return exactValue(item.role, expected);
    default:
      return false;
  }
}

export function stepDescriptorContractMismatches(stepDescriptor = {}) {
  const step = objectValue(stepDescriptor);
  const result = [];
  for (const key of [
    'references',
    'preconditions',
    'postconditions',
    'claim_promotions',
    'evidence_requirements',
  ]) {
    result.push(...duplicateIdMismatches(step, key));
  }
  const supportedEvidenceRequirements = new Map([
    ['before:aos_see_capture', true],
    ['action:aos_do_action', true],
    ['after:aos_see_capture', true],
  ]);
  const evidenceRequirementBindings = arrayValue(step.evidence_requirements).map((requirement) => {
    const item = objectValue(requirement);
    return `${text(item.phase)}:${text(item.kind)}`;
  });
  if (new Set(evidenceRequirementBindings).size !== evidenceRequirementBindings.length) {
    result.push(mismatch(
      'step_descriptor_duplicate_evidence_requirement_binding',
      'step_descriptor.evidence_requirements',
      'Step Descriptor evidence requirements may declare each supported phase/kind binding only once.',
    ));
  }
  evidenceRequirementBindings.forEach((binding, index) => {
    if (!supportedEvidenceRequirements.has(binding)) {
      result.push(mismatch(
        'step_descriptor_evidence_requirement_unsupported',
        `step_descriptor.evidence_requirements[${index}]`,
        'Step Descriptor V1 supports only before/after aos_see_capture and action aos_do_action evidence requirements.',
      ));
    }
  });

  const resolution = objectValue(step.target_resolution);
  const action = objectValue(step.action);
  if (text(step.target_dialect) !== text(resolution.dialect)) {
    result.push(mismatch(
      'step_descriptor_target_dialect_mismatch',
      'step_descriptor.target_resolution.dialect',
      'Step Descriptor target_dialect must exactly match target_resolution.dialect.',
    ));
  }
  if (rawText(action.target) !== rawText(resolution.target_with_ref)) {
    result.push(mismatch(
      'step_descriptor_action_target_mismatch',
      'step_descriptor.action.target',
      'Step Descriptor action.target must exactly match target_resolution.target_with_ref.',
    ));
  }

  const resolutionRef = text(resolution.ref);
  if (resolutionRef) {
    const hint = arrayValue(resolution.candidate_hints)
      .find((candidate) => text(objectValue(candidate).ref) === resolutionRef);
    if (!hint) {
      result.push(mismatch(
        'step_descriptor_resolution_ref_unbound',
        'step_descriptor.target_resolution.ref',
        'Step Descriptor target_resolution.ref must identify one candidate hint.',
      ));
    } else if (text(resolution.semantic_ref)
      && text(objectValue(hint).data_aos_ref || objectValue(hint).semantic_ref) !== text(resolution.semantic_ref)) {
      result.push(mismatch(
        'step_descriptor_resolution_semantic_ref_mismatch',
        'step_descriptor.target_resolution.semantic_ref',
        'Step Descriptor target_resolution.semantic_ref must exactly match the selected candidate hint semantic identity.',
      ));
    }
  }

  const postconditionIds = new Set(arrayValue(step.postconditions)
    .map((item) => text(objectValue(item).id))
    .filter(Boolean));
  for (const [index, promotion] of arrayValue(step.claim_promotions).entries()) {
    const ref = text(objectValue(promotion).postcondition_ref);
    if (!postconditionIds.has(ref)) {
      result.push(mismatch(
        'step_descriptor_claim_postcondition_unbound',
        `step_descriptor.claim_promotions[${index}].postcondition_ref`,
        `Step Descriptor claim promotion references unknown postcondition ${ref}.`,
      ));
    }
  }
  if (arrayValue(step.claim_promotions).length !== 1) {
    result.push(mismatch(
      'step_descriptor_capture_requires_one_claim_promotion',
      'step_descriptor.claim_promotions',
      'The one-step Work Record capture supports exactly one claim promotion.',
    ));
  }
  for (const key of ['preconditions', 'postconditions']) {
    if (arrayValue(step[key]).length !== 1) {
      result.push(mismatch(
        'step_descriptor_capture_requires_one_condition',
        `step_descriptor.${key}`,
        `The one-step Work Record capture supports exactly one ${key === 'preconditions' ? 'precondition' : 'postcondition'}.`,
      ));
    }
  }
  const promotion = objectValue(arrayValue(step.claim_promotions)[0]);
  const unsupportedClaimTokens = templateTokens(promotion.claim_id_template)
    .filter((token) => token !== 'record_slug');
  if (unsupportedClaimTokens.length > 0) {
    result.push(mismatch(
      'step_descriptor_claim_id_template_unsupported',
      'step_descriptor.claim_promotions[0].claim_id_template',
      'Step Descriptor claim_id_template supports only the {{record_slug}} token.',
    ));
  }
  const unsupportedCommandTokens = templateTokens(action.command_template)
    .filter((token) => !['target_with_ref', 'before_state_id'].includes(token));
  if (unsupportedCommandTokens.length > 0) {
    result.push(mismatch(
      'step_descriptor_action_command_template_unsupported',
      'step_descriptor.action.command_template',
      'Step Descriptor action command_template supports only {{target_with_ref}} and {{before_state_id}} tokens.',
    ));
  }
  if (action.state_id_source !== undefined
    && text(action.state_id_source) !== 'before_perception.state_id') {
    result.push(mismatch(
      'step_descriptor_action_state_source_unsupported',
      'step_descriptor.action.state_id_source',
      'Step Descriptor action.state_id_source must be before_perception.state_id.',
    ));
  }

  return result;
}

export function stepDescriptorEvidenceMismatches(stepDescriptor = {}, evidenceSource = {}) {
  const step = objectValue(stepDescriptor);
  const source = objectValue(evidenceSource);
  const resolution = objectValue(step.target_resolution);
  const action = objectValue(step.action);
  const sourceAction = objectValue(source.action);
  const result = [];

  const exactBindings = [
    [source.target_dialect, step.target_dialect, 'target_dialect'],
    [source.target, resolution.target, 'target'],
    [source.target_with_ref, resolution.target_with_ref, 'target_with_ref'],
    [sourceAction.target_dialect, step.target_dialect, 'action.target_dialect'],
    [sourceAction.verb, action.verb, 'action.verb'],
    [sourceAction.target, action.target, 'action.target'],
    [objectValue(source.before_perception).target, resolution.target, 'before_perception.target'],
    [objectValue(source.after_perception).target, resolution.target, 'after_perception.target'],
  ];
  for (const [actual, expected, path] of exactBindings) {
    if (!exactValue(actual, expected)) {
      result.push(mismatch(
        'step_descriptor_evidence_binding_mismatch',
        `evidence_source.${path}`,
        `Evidence ${path} must exactly match its Step Descriptor binding.`,
      ));
    }
  }
  const phaseSources = {
    before: objectValue(source.before_perception),
    action: sourceAction,
    after: objectValue(source.after_perception),
  };
  for (const [index, requirement] of arrayValue(step.evidence_requirements).entries()) {
    const item = objectValue(requirement);
    if (item.required === true && !text(objectValue(phaseSources[text(item.phase)]).evidence_id)) {
      result.push(mismatch(
        'step_descriptor_required_evidence_missing',
        `step_descriptor.evidence_requirements[${index}]`,
        'Required Step Descriptor evidence is missing from the bound caller evidence phase.',
      ));
    }
  }
  const beforeStateId = rawText(objectValue(source.before_perception).state_id);
  if (action.state_id_source !== undefined && rawText(sourceAction.state_id) !== beforeStateId) {
    result.push(mismatch(
      'step_descriptor_action_state_binding_mismatch',
      'evidence_source.action.state_id',
      'Evidence action.state_id must exactly match the descriptor-selected before perception state.',
    ));
  }
  const renderedCommand = renderTemplate(rawText(action.command_template), {
    target_with_ref: rawText(resolution.target_with_ref),
    before_state_id: beforeStateId,
  });
  if (rawText(sourceAction.command) !== renderedCommand) {
    result.push(mismatch(
      'step_descriptor_action_command_mismatch',
      'evidence_source.action.command',
      'Evidence action.command must exactly match the rendered Step Descriptor command_template.',
    ));
  }

  const resolutionRef = text(resolution.ref);
  const resolvedTarget = arrayValue(objectValue(source.before_perception).semantic_targets)
    .find((candidate) => (
      text(objectValue(candidate).ref) === resolutionRef
      && rawText(objectValue(candidate).target) === rawText(resolution.target_with_ref)
    ));
  if (!resolvedTarget) {
    result.push(mismatch(
      'step_descriptor_resolution_evidence_missing',
      'evidence_source.before_perception.semantic_targets',
      'Before evidence must contain the exact Step Descriptor target-resolution ref and target.',
    ));
  } else {
    if (text(resolution.semantic_ref)
      && text(objectValue(resolvedTarget).data_aos_ref || objectValue(resolvedTarget).semantic_ref) !== text(resolution.semantic_ref)) {
      result.push(mismatch(
        'step_descriptor_resolution_semantic_evidence_mismatch',
        `evidence_source.before_perception.semantic_targets[ref=${resolutionRef}].data_aos_ref`,
        'Before evidence semantic identity must exactly match target_resolution.semantic_ref.',
      ));
    }
    const hint = arrayValue(resolution.candidate_hints)
      .find((candidate) => text(objectValue(candidate).ref) === resolutionRef);
    for (const key of ['role', 'name', 'data_aos_ref']) {
      if (objectValue(hint)[key] !== undefined
        && !exactValue(objectValue(resolvedTarget)[key], objectValue(hint)[key])) {
        result.push(mismatch(
          'step_descriptor_resolution_hint_mismatch',
          `evidence_source.before_perception.semantic_targets[ref=${resolutionRef}].${key}`,
          `Before evidence target-resolution ${key} must exactly match the Step Descriptor candidate hint.`,
        ));
      }
    }
    const descriptorArgs = objectValue(action.args);
    for (const [arg, targetField] of [['expected_role', 'role'], ['expected_name', 'name']]) {
      if (descriptorArgs[arg] !== undefined
        && !exactValue(descriptorArgs[arg], objectValue(resolvedTarget)[targetField])) {
        result.push(mismatch(
          'step_descriptor_action_arg_mismatch',
          `step_descriptor.action.args.${arg}`,
          `Step Descriptor action ${arg} must exactly match resolved target ${targetField}.`,
        ));
      }
    }
  }

  for (const [index, condition] of arrayValue(step.preconditions).entries()) {
    if (!conditionSatisfied(condition, source.before_perception)) {
      result.push(mismatch(
        'step_descriptor_precondition_not_observed',
        `step_descriptor.preconditions[${index}]`,
        'Before evidence does not satisfy the Step Descriptor precondition.',
      ));
    }
  }
  for (const [index, condition] of arrayValue(step.postconditions).entries()) {
    if (!conditionSatisfied(condition, source.after_perception)) {
      result.push(mismatch(
        'step_descriptor_postcondition_not_observed',
        `step_descriptor.postconditions[${index}]`,
        'After evidence does not satisfy the Step Descriptor postcondition.',
      ));
    }
  }

  const promotion = objectValue(arrayValue(step.claim_promotions)[0]);
  const template = objectValue(findById(step.postconditions, text(promotion.postcondition_ref)));
  const sourcePostcondition = objectValue(source.postcondition);
  for (const key of ['id', 'kind', 'target', 'check']) {
    if (!exactValue(sourcePostcondition[key], template[key])) {
      result.push(mismatch(
        'step_descriptor_postcondition_evidence_mismatch',
        `evidence_source.postcondition.${key}`,
        `Evidence postcondition.${key} must exactly match the promoted Step Descriptor postcondition.`,
      ));
    }
  }
  if (sourcePostcondition.passed !== true) {
    result.push(mismatch(
      'step_descriptor_postcondition_not_passed',
      'evidence_source.postcondition.passed',
      'Evidence must report the promoted Step Descriptor postcondition as passed.',
    ));
  }
  if (rawText(sourcePostcondition.state_id) !== rawText(objectValue(source.after_perception).state_id)) {
    result.push(mismatch(
      'step_descriptor_postcondition_state_binding_mismatch',
      'evidence_source.postcondition.state_id',
      'Evidence postcondition.state_id must exactly match the bound after perception state.',
    ));
  }

  return result;
}

export function evidenceDigest(value) {
  return `fnv1a32:${fnv1a32(stableJson(value))}`;
}

export function requireText(value, label) {
  const normalized = text(value);
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}

export function requireRawText(value, label) {
  const raw = rawText(value);
  if (!raw.trim()) throw new TypeError(`${label} is required`);
  return raw;
}

export function commandTarget(command) {
  return `command:${command}`;
}

export function evidenceTarget(target, fallback = '') {
  return requireRawText(target || fallback, 'evidence target');
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
    command: rawText(event.command),
    target: rawText(event.target),
    state_id: rawText(event.state_id),
    created_at: text(event.captured_at || event.executed_at),
    summary: text(event.summary),
    artifact_uri: rawText(event.artifact_uri),
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
    stale: 'The Work Record requires fresh validation before it can support another source-bound proposal.',
    repairable: 'Saved-ref validation is stale, ambiguous, or missing, but intent and immutable evidence are sufficient for a source-bound repair proposal.',
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
  const templateRepairPolicy = objectValue(templatePostcondition.repair_policy);

  return {
    id: text(templatePostcondition.id),
    kind: text(templatePostcondition.kind),
    description: text(templatePostcondition.description),
    target: rawText(templatePostcondition.target),
    state_id: rawText(sourcePostcondition.state_id),
    check: cloneJson(templateCheck),
    passed: sourcePostcondition.passed === true,
    reason: text(sourcePostcondition.reason),
    repair_policy: cloneJson(templateRepairPolicy),
  };
}

export function stepDescriptorEvidenceSource(stepDescriptor, evidenceSource) {
  const stepIntent = objectValue(stepDescriptor.intent);
  const sourceIntent = objectValue(evidenceSource.intent);
  const promotion = objectValue(arrayValue(stepDescriptor.claim_promotions)[0]);
  const recordSlug = workRecordCaptureBaseId(evidenceSource.record_id, evidenceSource.id);
  const promotedClaimId = renderTemplate(
    rawText(promotion.claim_id_template, 'claim:{{record_slug}}-post-action-state-observed'),
    { record_slug: recordSlug },
  );
  const descriptorPrecondition = objectValue(arrayValue(stepDescriptor.preconditions)[0]);

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
    precondition: {
      id: text(descriptorPrecondition.id),
      kind: text(descriptorPrecondition.kind),
      description: text(descriptorPrecondition.description),
      target: rawText(descriptorPrecondition.target),
      state_id: rawText(objectValue(evidenceSource.before_perception).state_id),
      check: cloneJson(objectValue(descriptorPrecondition.check)),
      repair_policy: cloneJson(objectValue(descriptorPrecondition.repair_policy)),
    },
    postcondition: stepDescriptorPostconditionSource(stepDescriptor, evidenceSource),
    claim_text: text(promotion.claim_text, text(evidenceSource.claim_text)),
    promoted_claim_id: requireText(promotedClaimId, 'claim_promotion.claim_id_template'),
    promoted_claim_scope: text(promotion.scope, 'run'),
    promoted_claim_metadata: cloneJson(objectValue(promotion.metadata)),
    acceptance: text(promotion.acceptance, text(evidenceSource.acceptance)),
  };
}
