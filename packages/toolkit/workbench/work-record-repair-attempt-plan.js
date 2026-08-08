import crypto from 'node:crypto';
import {
  planWorkRecordRepair,
  repairPlanIdentity,
  validateWorkRecordRepairPlan,
  WORK_RECORD_REPAIR_PLAN_SCHEMA_VERSION,
} from './work-record-repair-plan.js';
import validateRepairAttemptPlanV1 from './work-record-repair-attempt-plan-v1-validator.generated.js';

export const WORK_RECORD_REPAIR_ATTEMPT_PLAN_SCHEMA_VERSION = '2026-08-work-record-repair-attempt-plan-v1';
export const WORK_RECORD_REPAIR_ATTEMPT_PLAN_TYPE = 'work_record.repair_attempt_plan';
export const WORK_RECORD_REPAIR_ATTEMPT_PLAN_STATUSES = [
  'ready',
  'not_required',
  'blocked_inputs',
  'not_repairable',
  'superseded',
  'retired',
  'unsupported',
];
const READY_PRECONDITION_IDS = [
  'precondition:source-work-record-bound',
  'precondition:repair-plan-validates',
  'precondition:source-remains-immutable',
  'precondition:attempt-emits-separate-artifact',
];

function text(value, fallback = '') {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function rawText(value, fallback = '') {
  const raw = String(value ?? '');
  return raw || fallback;
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

function canonicalize(value, seen = new WeakSet()) {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, seen));
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  return Object.keys(value).sort().reduce((next, key) => {
    next[key] = canonicalize(value[key], seen);
    return next;
  }, {});
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => text(value)).filter(Boolean))].sort();
}

function sourceIdentity(source = {}) {
  const value = objectValue(source);
  return {
    id: text(value.id),
    path: rawText(value.path),
    requested_ref: rawText(value.requested_ref),
    schema_version: text(value.schema_version),
    digest: text(value.digest),
  };
}

function statusFromPlan(plan = {}, validation = {}) {
  if (validation.status !== 'passed') return 'unsupported';
  if (text(plan.status) === 'planned') {
    return arrayValue(plan.candidate_patches).length === 1 ? 'ready' : 'blocked_inputs';
  }
  if (text(plan.status) === 'no_repair_needed') return 'not_required';
  if (['blocked_inputs', 'not_repairable', 'superseded', 'retired'].includes(text(plan.status))) {
    return text(plan.status);
  }
  return 'unsupported';
}

function preconditions(plan = {}) {
  const identity = repairPlanIdentity(plan);
  const source = sourceIdentity(plan.source_work_record);
  return [
    {
      id: 'precondition:source-work-record-bound',
      kind: 'source_identity',
      status: source.id && source.digest ? 'complete' : 'missing',
      check: { source_work_record: source },
    },
    {
      id: 'precondition:repair-plan-validates',
      kind: 'repair_plan_validation',
      status: validateWorkRecordRepairPlan(plan).status === 'passed' ? 'complete' : 'failed',
      check: {
        schema_version: WORK_RECORD_REPAIR_PLAN_SCHEMA_VERSION,
        digest: identity.digest,
      },
    },
    {
      id: 'precondition:source-remains-immutable',
      kind: 'source_immutability',
      status: 'complete',
      check: {
        source_work_record_immutable: true,
        expected_digest: source.digest,
      },
    },
    {
      id: 'precondition:attempt-emits-separate-artifact',
      kind: 'output_separation',
      status: 'complete',
      check: {
        accepted_outputs: ['repair_attempt_artifact', 'replacement_proposal'],
      },
    },
  ];
}

function evidenceRequirements(plan = {}) {
  const sourceId = text(plan.source_work_record?.id, 'work-record');
  const base = sourceId.replace(/^work-record:/, '').replace(/[^A-Za-z0-9._-]+/g, '-');
  const requirements = [
    {
      id: 'evidence_requirement:attempt-artifact',
      kind: 'repair_attempt_artifact',
      required: text(plan.status) === 'planned',
      description: 'A caller-run attempt records outcomes separately and leaves the source bytes unchanged.',
      expected_artifact_ref: `artifact:artifacts/work-records/${base}/repair-attempt-artifact.json`,
    },
    {
      id: 'evidence_requirement:before-after-verifier-reports',
      kind: 'verifier_report_pair',
      required: text(plan.status) === 'planned',
      profile_id: text(plan.depends_on?.verifier_profile_id),
    },
  ];
  for (const patch of arrayValue(plan.candidate_patches)) {
    const item = objectValue(patch);
    requirements.push({
      id: `evidence_requirement:patch:${text(item.id, requirements.length)}`,
      kind: 'patch_digest',
      required: true,
      candidate_patch_id: text(item.id),
      target: rawText(item.target),
      applied_in_plan: false,
    });
  }
  return requirements;
}

function plannedStepOperation(step = {}) {
  const item = objectValue(step);
  return {
    id: text(item.id),
    kind: text(item.kind),
    source_step_id: text(item.id),
    proposes_mutation: item.proposes_mutation === true,
    declared_mutation_paths: uniqueStrings(arrayValue(item.declared_mutation_paths)),
    target_boundary: item.proposes_mutation === true ? 'caller_attempt' : 'read_only_validation',
    precondition_refs: ['precondition:source-work-record-bound', 'precondition:repair-plan-validates'],
    evidence_requirement_refs: [
      'evidence_requirement:attempt-artifact',
      'evidence_requirement:before-after-verifier-reports',
    ],
    postcondition_refs: ['postcondition:source-work-record-unchanged'],
    cleanup_refs: ['cleanup_expectation:caller-reports-cleanup'],
    rollback_refs: item.proposes_mutation === true ? ['rollback_expectation:caller-reports-rollback'] : [],
    executes_in_plan: false,
    description: text(item.description),
  };
}

function plannedCandidatePatchOperation(patch = {}) {
  const item = objectValue(patch);
  return {
    id: `planned_operation:${text(item.id)}`,
    kind: 'candidate_patch',
    source_candidate_patch_id: text(item.id),
    proposes_mutation: true,
    declared_mutation_paths: uniqueStrings(arrayValue(item.declared_mutation_paths)),
    target_boundary: text(item.target),
    precondition_refs: [
      'precondition:source-work-record-bound',
      'precondition:repair-plan-validates',
      'precondition:source-remains-immutable',
    ],
    evidence_requirement_refs: [
      'evidence_requirement:attempt-artifact',
      'evidence_requirement:before-after-verifier-reports',
      `evidence_requirement:patch:${text(item.id)}`,
    ],
    postcondition_refs: ['postcondition:source-work-record-unchanged', 'postcondition:attempt-artifact-validates'],
    cleanup_refs: ['cleanup_expectation:caller-reports-cleanup'],
    rollback_refs: ['rollback_expectation:caller-reports-rollback'],
    executes_in_plan: false,
  };
}

function plannedOperations(plan = {}) {
  return [
    ...arrayValue(plan.plan_steps)
      .slice()
      .sort((left, right) => text(objectValue(left).id).localeCompare(text(objectValue(right).id)))
      .map(plannedStepOperation),
    ...arrayValue(plan.candidate_patches)
      .slice()
      .sort((left, right) => text(objectValue(left).id).localeCompare(text(objectValue(right).id)))
      .map(plannedCandidatePatchOperation),
  ].filter((operation) => text(operation.id));
}

function candidatePatches(plan = {}) {
  return arrayValue(plan.candidate_patches).slice().sort((left, right) => text(objectValue(left).id).localeCompare(text(objectValue(right).id))).map((patch) => ({
    ...cloneJson(objectValue(patch)),
    applied: false,
    executes_in_plan: false,
    validation_expectations: [
      'caller-supplied outcome maps to this exact plan',
      'attempt artifact includes required evidence and verifier-after health',
    ],
    rollback_expectation_refs: ['rollback_expectation:caller-reports-rollback'],
  }));
}

function recommendedCommands(plan = {}) {
  return arrayValue(plan.recommended_commands).map((command) => ({
    ...cloneJson(objectValue(command)),
    executes_in_plan: false,
    required_preconditions: ['precondition:source-work-record-bound'],
    expected_evidence_artifact: 'caller-supplied command outcome artifact',
  }));
}

function attemptPlanPayload(attemptPlan = {}) {
  const payload = cloneJson(objectValue(attemptPlan));
  delete payload.attempt_identity;
  return payload;
}

function expectedAttemptIdentity(attemptPlan = {}) {
  const value = objectValue(attemptPlan);
  const identity = {
    source_work_record: sourceIdentity(value.source_work_record),
    repair_plan: {
      schema_version: text(value.repair_plan?.schema_version),
      digest: text(value.repair_plan?.digest),
    },
    candidate_patch_ids: uniqueStrings(arrayValue(value.candidate_patches).map((patch) => objectValue(patch).id)),
    planned_operation_ids: uniqueStrings(arrayValue(value.planned_operations).map((operation) => objectValue(operation).id)),
    payload_digest: digest(attemptPlanPayload(value)),
  };
  const identityDigest = digest(identity);
  return {
    ...identity,
    digest: identityDigest,
    attempt_id: `work-record-repair-attempt:${identityDigest.slice(0, 24)}`,
  };
}

function expectedRepairPlanIdentitySnapshot(snapshot = {}) {
  const value = objectValue(snapshot);
  const identity = {
    schema_version: text(value.schema_version),
    source_work_record: sourceIdentity(value.source_work_record),
    health_verdict: text(value.health_verdict),
    plan_step_ids: uniqueStrings(arrayValue(value.plan_step_ids)),
    plan_step_bindings: cloneJson(arrayValue(value.plan_step_bindings)),
    candidate_patch_ids: uniqueStrings(arrayValue(value.candidate_patch_ids)),
    candidate_patch_bindings: cloneJson(arrayValue(value.candidate_patch_bindings)),
    evidence_refs: uniqueStrings(arrayValue(value.evidence_refs)),
    payload_digest: text(value.payload_digest),
  };
  return { ...identity, digest: digest(identity) };
}

function recommendedNext(status = '') {
  if (status === 'ready') {
    return {
      action: 'collect_caller_supplied_outcomes',
      note: 'Ready means the proposal inputs are complete, exact, and source-bound; no action has run.',
    };
  }
  if (status === 'not_required') {
    return { action: 'no_attempt_needed', reason: 'The Repair Plan proposes no repair attempt.' };
  }
  return { action: 'resolve_plan_inputs', reason: `Repair Attempt Plan status is ${status}.` };
}

function envelope(plan = {}, status = '', diagnostics = []) {
  const operations = plannedOperations(plan);
  const planIdentity = repairPlanIdentity(plan);
  const attemptPlan = {
    type: WORK_RECORD_REPAIR_ATTEMPT_PLAN_TYPE,
    schema_version: WORK_RECORD_REPAIR_ATTEMPT_PLAN_SCHEMA_VERSION,
    status,
    source_work_record: cloneJson(plan.source_work_record || {}),
    repair_plan: {
      schema_version: text(plan.schema_version),
      digest: planIdentity.digest,
      identity: planIdentity,
    },
    preconditions: preconditions(plan),
    planned_operations: operations,
    candidate_patches: candidatePatches(plan),
    recommended_commands: recommendedCommands(plan),
    evidence_requirements: evidenceRequirements(plan),
    postconditions: [
      {
        id: 'postcondition:source-work-record-unchanged',
        kind: 'immutability',
        required: true,
        expected_digest: text(plan.source_work_record?.digest),
        description: 'Any later outcome must prove the source Work Record stayed unchanged.',
      },
      {
        id: 'postcondition:attempt-artifact-validates',
        kind: 'validation',
        required: status === 'ready',
        description: 'A caller-supplied Attempt Artifact must validate before finalization.',
      },
    ],
    cleanup_expectations: [{
      id: 'cleanup_expectation:caller-reports-cleanup',
      kind: 'record_cleanup_result',
      executes_in_plan: false,
      description: 'The caller records cleanup outcomes in the Attempt Artifact.',
    }],
    rollback_expectations: [{
      id: 'rollback_expectation:caller-reports-rollback',
      kind: 'record_rollback_result',
      executes_in_plan: false,
      description: 'The caller records rollback outcomes or failure in the Attempt Artifact.',
    }],
    known_limits: [
      'Repair Attempt Plans do not execute actions or apply patches.',
      'Caller-supplied outcomes must map to the exact plan and source digest.',
      'Source Work Records stay immutable.',
    ],
    executes_repair: false,
    executes_actions: false,
    applies_patches: false,
    mutates_source: false,
    diagnostics,
    recommended_next: recommendedNext(status),
  };
  attemptPlan.attempt_identity = expectedAttemptIdentity(attemptPlan);
  return attemptPlan;
}

export function planWorkRecordRepairAttempt(ref, options = {}) {
  const plan = options.repairPlan || planWorkRecordRepair(ref, options);
  if (text(plan.status) === 'failed' || !text(plan.schema_version)) {
    return envelope(plan, 'blocked_inputs', arrayValue(plan.diagnostics));
  }
  const validation = validateWorkRecordRepairPlan(plan);
  const diagnostics = arrayValue(validation.diagnostics);
  if (validation.status === 'passed'
    && text(plan.status) === 'planned'
    && arrayValue(plan.candidate_patches).length !== 1) {
    diagnostics.push({
      severity: 'error',
      code: 'REPAIR_ATTEMPT_PLAN_CANDIDATE_PATCH_MISSING',
      message: 'A ready Attempt Plan requires one exact source-bound candidate patch.',
      path: 'candidate_patches',
    });
  }
  return envelope(
    plan,
    statusFromPlan(plan, validation),
    diagnostics,
  );
}

export function validateWorkRecordRepairAttemptPlan(attemptPlan = {}) {
  const value = objectValue(attemptPlan);
  const diagnostics = [];
  const add = (code, message, path) => diagnostics.push({ severity: 'error', code, message, path });
  if (!validateRepairAttemptPlanV1(value)) {
    for (const error of arrayValue(validateRepairAttemptPlanV1.errors)) {
      add('REPAIR_ATTEMPT_PLAN_V1_SCHEMA_INVALID', `Repair Attempt Plan V1 schema validation failed: ${text(objectValue(error).message, 'invalid value')}`, text(objectValue(error).instancePath, 'repair_attempt_plan'));
    }
  }
  if (text(value.type) !== WORK_RECORD_REPAIR_ATTEMPT_PLAN_TYPE) add('INVALID_REPAIR_ATTEMPT_PLAN_TYPE', 'Repair Attempt Plan type must be work_record.repair_attempt_plan.', 'type');
  if (text(value.schema_version) !== WORK_RECORD_REPAIR_ATTEMPT_PLAN_SCHEMA_VERSION) add('INVALID_REPAIR_ATTEMPT_PLAN_SCHEMA_VERSION', 'Repair Attempt Plan schema_version is not supported.', 'schema_version');
  if (!WORK_RECORD_REPAIR_ATTEMPT_PLAN_STATUSES.includes(text(value.status))) add('INVALID_REPAIR_ATTEMPT_PLAN_STATUS', 'Repair Attempt Plan status is not supported.', 'status');
  for (const field of ['executes_repair', 'executes_actions', 'applies_patches', 'mutates_source']) {
    if (value[field] !== false) add('REPAIR_ATTEMPT_PLAN_EXECUTION_FLAG_NOT_FALSE', `${field} must be false.`, field);
  }
  const source = sourceIdentity(value.source_work_record);
  if (!source.id || !source.digest) add('REPAIR_ATTEMPT_PLAN_SOURCE_IDENTITY_INCOMPLETE', 'Repair Attempt Plans require exact source id and digest.', 'source_work_record');
  if (text(value.repair_plan?.schema_version) !== WORK_RECORD_REPAIR_PLAN_SCHEMA_VERSION || !text(value.repair_plan?.digest)) {
    add('REPAIR_ATTEMPT_PLAN_REPAIR_PLAN_IDENTITY_INCOMPLETE', 'Repair Attempt Plans require the exact Repair Plan schema and digest.', 'repair_plan');
  }
  const expectedPlanIdentity = expectedRepairPlanIdentitySnapshot(value.repair_plan?.identity);
  if (digest(expectedPlanIdentity) !== digest(objectValue(value.repair_plan?.identity))
    || text(value.repair_plan?.digest) !== expectedPlanIdentity.digest) {
    add('REPAIR_ATTEMPT_PLAN_REPAIR_PLAN_IDENTITY_MISMATCH', 'Repair Attempt Plan repair_plan identity or digest is internally inconsistent.', 'repair_plan.identity');
  }
  const expectedIdentity = expectedAttemptIdentity(value);
  if (digest(expectedIdentity) !== digest(objectValue(value.attempt_identity))) {
    add('REPAIR_ATTEMPT_PLAN_IDENTITY_MISMATCH', 'Repair Attempt Plan identity does not match its source, Repair Plan, patches, and operations.', 'attempt_identity');
  }
  const repairIdentity = objectValue(value.repair_plan?.identity);
  if (digest(sourceIdentity(repairIdentity.source_work_record)) !== digest(source)) {
    add('REPAIR_ATTEMPT_PLAN_SOURCE_REPAIR_PLAN_MISMATCH', 'Attempt Plan source identity must exactly match the Repair Plan source identity.', 'source_work_record');
  }
  const candidatePatchList = arrayValue(value.candidate_patches).map(objectValue);
  const candidatePatchIds = candidatePatchList.map((patch) => text(patch.id));
  if (new Set(candidatePatchIds).size !== candidatePatchIds.length) {
    add('REPAIR_ATTEMPT_PLAN_CANDIDATE_PATCH_IDS_NOT_UNIQUE', 'Attempt Plan candidate patch ids must be unique.', 'candidate_patches');
  }
  if (text(value.status) === 'ready' && candidatePatchIds.length !== 1) {
    add('REPAIR_ATTEMPT_PLAN_READY_REQUIRES_ONE_CANDIDATE_PATCH', 'Ready Attempt Plan V1 requires exactly one atomic candidate patch.', 'candidate_patches');
  }
  if (digest(candidatePatchIds) !== digest(arrayValue(repairIdentity.candidate_patch_ids))) {
    add('REPAIR_ATTEMPT_PLAN_CANDIDATE_PATCH_IDENTITY_MISMATCH', 'Attempt Plan candidate patches must exactly match Repair Plan candidate patch identity and order.', 'candidate_patches');
  }
  const actualPatchBindings = candidatePatchList.map((patch) => {
    const projected = cloneJson(patch);
    delete projected.validation_expectations;
    delete projected.rollback_expectation_refs;
    return { id: text(projected.id), digest: digest(projected) };
  });
  if (digest(actualPatchBindings) !== digest(arrayValue(repairIdentity.candidate_patch_bindings))) {
    add('REPAIR_ATTEMPT_PLAN_CANDIDATE_PATCH_PAYLOAD_MISMATCH', 'Attempt Plan candidate patch payload must exactly match the Repair Plan committed patch payload.', 'candidate_patches');
  }
  const expectedOperationIds = [
    ...arrayValue(repairIdentity.plan_step_ids),
    ...arrayValue(repairIdentity.candidate_patch_ids).map((id) => `planned_operation:${text(id)}`),
  ];
  const plannedOperationList = arrayValue(value.planned_operations).map(objectValue);
  const plannedOperationIds = plannedOperationList.map((operation) => text(operation.id));
  if (new Set(plannedOperationIds).size !== plannedOperationIds.length
    || digest(plannedOperationIds) !== digest(expectedOperationIds)) {
    add('REPAIR_ATTEMPT_PLAN_OPERATION_IDENTITY_MISMATCH', 'Attempt Plan operations must exactly match the canonical Repair Plan steps and candidate patch order.', 'planned_operations');
  }
  const actualStepBindings = plannedOperationList
    .filter((operation) => text(operation.source_step_id))
    .map((operation) => {
      const projected = {
        id: text(operation.source_step_id),
        kind: text(operation.kind),
        proposes_mutation: operation.proposes_mutation === true,
        declared_mutation_paths: uniqueStrings(arrayValue(operation.declared_mutation_paths)),
        description: text(operation.description),
      };
      return { id: projected.id, digest: digest(projected) };
    });
  if (digest(actualStepBindings) !== digest(arrayValue(repairIdentity.plan_step_bindings))) {
    add('REPAIR_ATTEMPT_PLAN_STEP_PAYLOAD_MISMATCH', 'Attempt Plan derived step operations must exactly match Repair Plan committed step payloads.', 'planned_operations');
  }
  const stepOperationBySourceId = new Map(plannedOperationList
    .filter((operation) => text(operation.source_step_id))
    .map((operation) => [text(operation.source_step_id), operation]));
  const candidatePatchById = new Map(candidatePatchList.map((patch) => [text(patch.id), patch]));
  const canonicalOperations = [
    ...arrayValue(repairIdentity.plan_step_ids).map((stepId) => {
      const operation = objectValue(stepOperationBySourceId.get(text(stepId)));
      return plannedStepOperation({
        id: text(stepId),
        kind: operation.kind,
        proposes_mutation: operation.proposes_mutation,
        declared_mutation_paths: operation.declared_mutation_paths,
        description: operation.description,
      });
    }),
    ...arrayValue(repairIdentity.candidate_patch_ids)
      .map((patchId) => plannedCandidatePatchOperation(candidatePatchById.get(text(patchId)))),
  ];
  if (digest(plannedOperationList) !== digest(canonicalOperations)) {
    add('REPAIR_ATTEMPT_PLAN_OPERATION_MECHANICS_NONCANONICAL', 'Attempt Plan operations must exactly match the canonical mechanics derived from Repair Plan steps and candidate patches.', 'planned_operations');
  }
  for (const patchId of candidatePatchIds) {
    const operation = plannedOperationList.find((item) => text(item.id) === `planned_operation:${patchId}`);
    if (text(operation?.source_candidate_patch_id) !== patchId) {
      add('REPAIR_ATTEMPT_PLAN_PATCH_OPERATION_MISMATCH', 'Each candidate patch requires one exact derived planned operation.', 'planned_operations');
    }
  }
  arrayValue(value.planned_operations).forEach((operation, index) => {
    if (objectValue(operation).executes_in_plan !== false) add('PLANNED_OPERATION_EXECUTES_IN_PLAN', 'Planned operations must not execute inside the Repair Attempt Plan.', `planned_operations[${index}].executes_in_plan`);
  });
  arrayValue(value.candidate_patches).forEach((patch, index) => {
    const item = objectValue(patch);
    if (item.applied !== false) add('CANDIDATE_PATCH_APPLIED_IN_ATTEMPT_PLAN', 'Candidate patches must remain unapplied.', `candidate_patches[${index}].applied`);
    if (item.executes_in_plan !== false) add('CANDIDATE_PATCH_EXECUTES_IN_ATTEMPT_PLAN', 'Candidate patches must not execute inside the Repair Attempt Plan.', `candidate_patches[${index}].executes_in_plan`);
  });
  arrayValue(value.recommended_commands).forEach((command, index) => {
    if (objectValue(command).executes_in_plan !== false) add('RECOMMENDED_COMMAND_EXECUTES_IN_ATTEMPT_PLAN', 'Recommended commands must not execute inside the Repair Attempt Plan.', `recommended_commands[${index}].executes_in_plan`);
  });
  if (text(value.status) === 'ready') {
    const preconditionList = arrayValue(value.preconditions).map((item) => objectValue(item));
    const preconditionIds = preconditionList.map((item) => text(item.id));
    if (new Set(preconditionIds).size !== preconditionIds.length) {
      add('REPAIR_ATTEMPT_PLAN_READY_PRECONDITION_DUPLICATE', 'Ready Attempt Plan precondition ids must be unique.', 'preconditions');
    }
    if (preconditionList.some((item) => text(item.status) !== 'complete')) {
      add('REPAIR_ATTEMPT_PLAN_READY_PRECONDITION_INCOMPLETE', 'Every declared precondition in a ready Attempt Plan must be complete.', 'preconditions');
    }
    const preconditions = new Map(preconditionList.map((item) => [text(item.id), item]));
    for (const id of READY_PRECONDITION_IDS) {
      if (text(preconditions.get(id)?.status) !== 'complete') {
        add('REPAIR_ATTEMPT_PLAN_READY_PRECONDITION_INCOMPLETE', 'Ready Attempt Plans require every canonical precondition to be present and complete.', 'preconditions');
        break;
      }
    }
    if (arrayValue(value.planned_operations).length === 0) {
      add('REPAIR_ATTEMPT_PLAN_READY_OPERATIONS_MISSING', 'Ready Attempt Plans require at least one exact planned operation.', 'planned_operations');
    }
    const evidenceRequirements = new Map(arrayValue(value.evidence_requirements).map((item) => [text(objectValue(item).id), objectValue(item)]));
    const evidenceRequirementIds = new Set(evidenceRequirements.keys());
    for (const id of ['evidence_requirement:attempt-artifact', 'evidence_requirement:before-after-verifier-reports']) {
      if (evidenceRequirements.get(id)?.required !== true) add('REPAIR_ATTEMPT_PLAN_READY_EVIDENCE_REQUIREMENT_MISSING', 'Ready Attempt Plans require the canonical caller artifact and verifier report evidence requirements.', 'evidence_requirements');
    }
    const postconditions = new Map(arrayValue(value.postconditions).map((item) => [text(objectValue(item).id), objectValue(item)]));
    const postconditionIds = new Set(postconditions.keys());
    for (const id of ['postcondition:source-work-record-unchanged', 'postcondition:attempt-artifact-validates']) {
      if (postconditions.get(id)?.required !== true) add('REPAIR_ATTEMPT_PLAN_READY_POSTCONDITION_MISSING', 'Ready Attempt Plans require source immutability and artifact validation postconditions.', 'postconditions');
    }
    const cleanupIds = new Set(arrayValue(value.cleanup_expectations).map((item) => text(objectValue(item).id)).filter(Boolean));
    const rollbackIds = new Set(arrayValue(value.rollback_expectations).map((item) => text(objectValue(item).id)).filter(Boolean));
    if (!cleanupIds.has('cleanup_expectation:caller-reports-cleanup')) add('REPAIR_ATTEMPT_PLAN_READY_CLEANUP_EXPECTATION_MISSING', 'Ready Attempt Plans require the caller cleanup receipt expectation.', 'cleanup_expectations');
    if (!rollbackIds.has('rollback_expectation:caller-reports-rollback')) add('REPAIR_ATTEMPT_PLAN_READY_ROLLBACK_EXPECTATION_MISSING', 'Ready Attempt Plans require the caller rollback receipt expectation.', 'rollback_expectations');
    arrayValue(value.planned_operations).forEach((operation, index) => {
      const item = objectValue(operation);
      if (arrayValue(item.precondition_refs).length === 0
        || arrayValue(item.evidence_requirement_refs).length === 0
        || arrayValue(item.postcondition_refs).length === 0
        || arrayValue(item.cleanup_refs).length === 0
        || (item.proposes_mutation === true && arrayValue(item.rollback_refs).length === 0)) {
        add('REPAIR_ATTEMPT_PLAN_OPERATION_REQUIREMENTS_INCOMPLETE', 'Ready planned operations require exact precondition, evidence, postcondition, cleanup, and mutation rollback references.', `planned_operations[${index}]`);
      }
      for (const [field, known] of [
        ['precondition_refs', new Set(preconditions.keys())],
        ['evidence_requirement_refs', evidenceRequirementIds],
        ['postcondition_refs', postconditionIds],
        ['cleanup_refs', cleanupIds],
        ['rollback_refs', rollbackIds],
      ]) {
        for (const ref of arrayValue(item[field]).map(text).filter(Boolean)) {
          if (!known.has(ref)) add('REPAIR_ATTEMPT_PLAN_OPERATION_REF_UNKNOWN', 'Ready planned operations may reference only declared mechanical requirements.', `planned_operations[${index}].${field}`);
        }
      }
    });
  }
  return {
    type: 'work_record.repair_attempt_plan.validation',
    schema_version: WORK_RECORD_REPAIR_ATTEMPT_PLAN_SCHEMA_VERSION,
    status: diagnostics.length > 0 ? 'failed' : 'passed',
    diagnostics,
  };
}
