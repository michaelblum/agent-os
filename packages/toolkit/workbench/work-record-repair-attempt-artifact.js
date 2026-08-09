import crypto from 'node:crypto';
import {
  validateWorkRecordRepairAttemptPlan,
  WORK_RECORD_REPAIR_ATTEMPT_PLAN_SCHEMA_VERSION,
} from './work-record-repair-attempt-plan.js';
import validateRepairAttemptArtifactV1 from './work-record-repair-attempt-artifact-v1-validator.generated.js';

export const WORK_RECORD_REPAIR_ATTEMPT_ARTIFACT_SCHEMA_VERSION = '2026-08-work-record-repair-attempt-artifact-v1';
export const WORK_RECORD_REPAIR_ATTEMPT_ARTIFACT_TYPE = 'work_record.repair_attempt_artifact';

export const WORK_RECORD_REPAIR_ATTEMPT_ARTIFACT_STATUSES = [
  'succeeded',
  'failed',
  'partial',
  'aborted_precondition',
  'blocked_plan_mismatch',
  'cleanup_failed',
  'rollback_failed',
  'invalid_artifact',
  'unsupported',
];

const TERMINAL_WITHOUT_OPERATION_OUTCOMES = new Set([
  'aborted_precondition',
  'blocked_plan_mismatch',
  'invalid_artifact',
  'unsupported',
]);

const OPERATION_STATUSES = new Set([
  'succeeded',
  'failed',
  'skipped',
  'aborted_precondition',
  'cleanup_failed',
  'rollback_failed',
]);

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

export function digestJson(value) {
  const serialized = JSON.stringify(canonicalize(value));
  return crypto.createHash('sha256').update(serialized === undefined ? 'undefined' : serialized).digest('hex');
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

function evidenceRefId(ref = {}) {
  if (typeof ref === 'string') return ref;
  const value = objectValue(ref);
  return text(value.id || value.ref) || rawText(value.uri);
}

function normalizeEvidenceRefs(refs = []) {
  return arrayValue(refs)
    .map((ref) => (typeof ref === 'string' ? { id: ref } : cloneJson(objectValue(ref))))
    .filter((ref) => evidenceRefId(ref))
    .sort((left, right) => evidenceRefId(left).localeCompare(evidenceRefId(right)));
}

function verifierHealth(report = {}) {
  const value = objectValue(report);
  return text(value.health_verdict || value.report?.health_verdict || value.report?.summary?.health_verdict || value.status);
}

function operationRequiredEvidenceIds(operation = {}) {
  return uniqueStrings([
    ...arrayValue(operation.evidence_requirement_refs),
    ...arrayValue(operation.evidence_ref_ids),
  ]);
}

function artifactPayload(artifact = {}) {
  const payload = cloneJson(objectValue(artifact));
  delete payload.attempt_artifact_identity;
  return payload;
}

function expectedArtifactIdentity(artifact = {}) {
  const value = objectValue(artifact);
  const identity = {
    source_work_record: sourceIdentity(value.source_work_record),
    repair_plan: {
      schema_version: text(value.repair_plan?.schema_version),
      digest: text(value.repair_plan?.digest),
    },
    repair_attempt_plan: {
      schema_version: text(value.repair_attempt_plan?.schema_version),
      status: text(value.repair_attempt_plan?.status),
      validation_status: text(value.repair_attempt_plan?.validation_status),
      digest: text(value.repair_attempt_plan?.digest),
      attempt_id: text(value.repair_attempt_plan?.attempt_identity?.attempt_id),
      attempt_digest: text(value.repair_attempt_plan?.attempt_identity?.digest),
    },
    planned_operation_ids: uniqueStrings(arrayValue(value.planned_operations).map((operation) => objectValue(operation).id)),
    operation_outcome_ids: uniqueStrings(arrayValue(value.operation_outcomes).map((outcome) => objectValue(outcome).id)),
    evidence_ref_digests: uniqueStrings(normalizeEvidenceRefs(value.evidence_refs).map((ref) => text(ref.digest) || digestJson(ref))),
    payload_digest: digestJson(artifactPayload(value)),
  };
  const identityDigest = digestJson(identity);
  return { id: `work-record-repair-attempt-artifact:${identityDigest.slice(0, 24)}`, digest: identityDigest, ...identity };
}

function finalHealthFrom({ status = '', verifierAfter = null, inputFinalHealth = {} } = {}) {
  const afterHealth = verifierAfter ? verifierHealth(verifierAfter) : '';
  return {
    classification: afterHealth || text(inputFinalHealth.classification || inputFinalHealth.health_verdict || inputFinalHealth.status, status),
    derived_from: afterHealth ? 'verifier_after' : 'caller_outcome',
    verifier_after_health: afterHealth,
  };
}

function recommendedNext(status = '') {
  if (status === 'succeeded') {
    return { action: 'inspect_replacement_proposal', note: 'The outcome is recorded; replacement proposal and finalization remain separate.' };
  }
  if (status === 'invalid_artifact') {
    return { action: 'fix_artifact_payload', note: 'Do not use this artifact until validation passes.' };
  }
  return { action: 'inspect_attempt_evidence', note: `Repair Attempt Artifact status is ${status}.` };
}

export function buildWorkRecordRepairAttemptArtifact(input = {}) {
  const value = objectValue(input);
  const repairAttemptPlan = objectValue(value.repair_attempt_plan);
  const operationOutcomes = arrayValue(value.operation_outcomes)
    .map((outcome) => cloneJson(objectValue(outcome)))
    .sort((left, right) => text(left.planned_operation_id || left.id).localeCompare(text(right.planned_operation_id || right.id)));
  const evidenceRefs = normalizeEvidenceRefs(value.evidence_refs);
  const status = text(value.status, 'unsupported');
  const verifierBefore = value.verifier_before ? cloneJson(value.verifier_before) : null;
  const verifierAfter = value.verifier_after ? cloneJson(value.verifier_after) : null;
  const attemptPlanValidation = validateWorkRecordRepairAttemptPlan(repairAttemptPlan);
  const artifact = {
    type: WORK_RECORD_REPAIR_ATTEMPT_ARTIFACT_TYPE,
    schema_version: WORK_RECORD_REPAIR_ATTEMPT_ARTIFACT_SCHEMA_VERSION,
    status,
    source_work_record: cloneJson(repairAttemptPlan.source_work_record || value.source_work_record || {}),
    repair_plan: cloneJson(repairAttemptPlan.repair_plan || value.repair_plan || {}),
    repair_attempt_plan: {
      schema_version: text(repairAttemptPlan.schema_version),
      status: text(repairAttemptPlan.status),
      validation_status: attemptPlanValidation.status,
      digest: digestJson(repairAttemptPlan),
      attempt_identity: cloneJson(repairAttemptPlan.attempt_identity || {}),
      payload: cloneJson(repairAttemptPlan),
    },
    outcome_source: {
      id: text(value.outcome_source?.id, 'caller-supplied-outcomes'),
      kind: text(value.outcome_source?.kind, 'caller_supplied'),
      version: text(value.outcome_source?.version),
      description: text(value.outcome_source?.description, 'Caller-supplied execution outcomes; this builder does not execute operations.'),
    },
    timing: {
      started_at: text(value.timing?.started_at || value.started_at),
      finished_at: text(value.timing?.finished_at || value.finished_at),
      source: text(value.timing?.source, 'caller_supplied'),
    },
    planned_operations: cloneJson(arrayValue(repairAttemptPlan.planned_operations)),
    planned_candidate_patches: cloneJson(arrayValue(repairAttemptPlan.candidate_patches)),
    planned_evidence_requirements: cloneJson(arrayValue(repairAttemptPlan.evidence_requirements)),
    operation_outcomes: operationOutcomes,
    candidate_patch_outcomes: cloneJson(arrayValue(value.candidate_patch_outcomes)),
    recommended_command_outcomes: cloneJson(arrayValue(value.recommended_command_outcomes)),
    evidence_refs: evidenceRefs,
    verifier_before: verifierBefore,
    verifier_after: verifierAfter,
    final_health: finalHealthFrom({ status, verifierAfter, inputFinalHealth: objectValue(value.final_health) }),
    postcondition_results: cloneJson(arrayValue(value.postcondition_results)),
    cleanup_results: cloneJson(arrayValue(value.cleanup_results)),
    rollback_results: cloneJson(arrayValue(value.rollback_results)),
    source_work_record_mutation_check: cloneJson(objectValue(value.source_work_record_mutation_check)),
    source_work_record_mutated: value.source_work_record_mutated === true,
    rewrites_historical_evidence: false,
    diagnostics: cloneJson(arrayValue(value.diagnostics)),
    recommended_next: recommendedNext(status),
  };
  artifact.attempt_artifact_identity = expectedArtifactIdentity(artifact);
  return artifact;
}

export function validateWorkRecordRepairAttemptArtifact(artifact = {}) {
  const value = objectValue(artifact);
  const diagnostics = [];
  const add = (code, message, path, extra = {}) => diagnostics.push({ severity: 'error', code, message, path, ...extra });
  if (!validateRepairAttemptArtifactV1(value)) {
    for (const error of arrayValue(validateRepairAttemptArtifactV1.errors)) {
      add('REPAIR_ATTEMPT_ARTIFACT_V1_SCHEMA_INVALID', `Repair Attempt Artifact V1 schema validation failed: ${text(objectValue(error).message, 'invalid value')}`, text(objectValue(error).instancePath, 'repair_attempt_artifact'));
    }
  }

  if (text(value.type) !== WORK_RECORD_REPAIR_ATTEMPT_ARTIFACT_TYPE) add('INVALID_REPAIR_ATTEMPT_ARTIFACT_TYPE', 'Repair Attempt Artifact type must be work_record.repair_attempt_artifact.', 'type');
  if (text(value.schema_version) !== WORK_RECORD_REPAIR_ATTEMPT_ARTIFACT_SCHEMA_VERSION) add('INVALID_REPAIR_ATTEMPT_ARTIFACT_SCHEMA_VERSION', 'Repair Attempt Artifact schema_version is not supported.', 'schema_version');
  if (!WORK_RECORD_REPAIR_ATTEMPT_ARTIFACT_STATUSES.includes(text(value.status))) add('INVALID_REPAIR_ATTEMPT_ARTIFACT_STATUS', 'Repair Attempt Artifact status is not supported.', 'status');
  for (const field of ['source_work_record_mutated', 'rewrites_historical_evidence']) {
    if (value[field] !== false) add('REPAIR_ATTEMPT_ARTIFACT_IMMUTABILITY_FLAG_NOT_FALSE', `${field} must be false.`, field);
  }
  if (text(value.outcome_source?.kind) !== 'caller_supplied') {
    add('REPAIR_ATTEMPT_ARTIFACT_OUTCOME_SOURCE_INVALID', 'Attempt outcomes must be identified as caller_supplied.', 'outcome_source.kind');
  }
  if (!text(value.timing?.started_at) || !text(value.timing?.finished_at)) {
    add('REPAIR_ATTEMPT_ARTIFACT_TIMING_INCOMPLETE', 'Attempt Artifacts require caller-supplied start and finish timestamps.', 'timing');
  }
  if (text(value.repair_attempt_plan?.schema_version) !== WORK_RECORD_REPAIR_ATTEMPT_PLAN_SCHEMA_VERSION || !text(value.repair_attempt_plan?.digest)) {
    add('REPAIR_ATTEMPT_PLAN_IDENTITY_INCOMPLETE', 'Attempt Artifacts require the exact Attempt Plan schema and digest.', 'repair_attempt_plan');
  }
  if (text(value.status) === 'succeeded' && text(value.repair_attempt_plan?.status) !== 'ready') {
    add('REPAIR_ATTEMPT_PLAN_NOT_READY', 'Successful Attempt Artifacts require an exact ready Attempt Plan.', 'repair_attempt_plan.status');
  }
  if (text(value.status) === 'succeeded' && text(value.repair_attempt_plan?.validation_status) !== 'passed') {
    add('REPAIR_ATTEMPT_PLAN_VALIDATION_FAILED', 'Successful Attempt Artifacts require a fully validated Attempt Plan.', 'repair_attempt_plan.validation_status');
  }
  const claimedAttemptPlan = objectValue(value.repair_attempt_plan?.payload);
  const claimedAttemptPlanValidation = validateWorkRecordRepairAttemptPlan(claimedAttemptPlan);
  if (claimedAttemptPlanValidation.status !== 'passed') {
    add('REPAIR_ATTEMPT_PLAN_PAYLOAD_INVALID', 'Attempt Artifact must carry a fully valid exact Attempt Plan payload.', 'repair_attempt_plan.payload');
  }
  if (digestJson(claimedAttemptPlan) !== text(value.repair_attempt_plan?.digest)
    || digestJson(claimedAttemptPlan.attempt_identity) !== digestJson(value.repair_attempt_plan?.attempt_identity)) {
    add('REPAIR_ATTEMPT_PLAN_PAYLOAD_IDENTITY_MISMATCH', 'Attempt Plan payload, digest, and identity mirror must match exactly.', 'repair_attempt_plan');
  }
  if (digestJson(sourceIdentity(claimedAttemptPlan.source_work_record)) !== digestJson(sourceIdentity(value.source_work_record))
    || digestJson(claimedAttemptPlan.repair_plan) !== digestJson(value.repair_plan)
    || digestJson(claimedAttemptPlan.planned_operations) !== digestJson(value.planned_operations)
    || digestJson(claimedAttemptPlan.candidate_patches) !== digestJson(value.planned_candidate_patches)
    || digestJson(claimedAttemptPlan.evidence_requirements) !== digestJson(value.planned_evidence_requirements)) {
    add('REPAIR_ATTEMPT_PLAN_PAYLOAD_PROJECTION_MISMATCH', 'Artifact source, Repair Plan, operations, patches, and evidence requirements must exactly project the claimed Attempt Plan payload.', 'repair_attempt_plan.payload');
  }

  const plannedOperations = arrayValue(value.planned_operations).map(objectValue);
  const plannedOperationIds = plannedOperations.map((operation) => text(operation.id)).filter(Boolean);
  if (new Set(plannedOperationIds).size !== plannedOperationIds.length) {
    add('PLANNED_OPERATION_IDS_NOT_UNIQUE', 'Planned operation ids must be unique.', 'planned_operations');
  }
  const plannedById = new Map(plannedOperations.map((operation) => [text(operation.id), operation]).filter(([id]) => id));
  const outcomeByPlannedId = new Map();
  const operationOutcomeIds = arrayValue(value.operation_outcomes).map((outcome) => text(objectValue(outcome).id)).filter(Boolean);
  if (new Set(operationOutcomeIds).size !== operationOutcomeIds.length) {
    add('OPERATION_OUTCOME_IDS_NOT_UNIQUE', 'Operation outcome ids must be unique.', 'operation_outcomes');
  }
  arrayValue(value.operation_outcomes).forEach((outcome, index) => {
    const item = objectValue(outcome);
    const status = text(item.status);
    const plannedId = text(item.planned_operation_id);
    if (!OPERATION_STATUSES.has(status)) add('INVALID_OPERATION_OUTCOME_STATUS', 'Operation outcome status is not supported.', `operation_outcomes[${index}].status`);
    if (!plannedById.has(plannedId)) {
      add('OPERATION_OUTCOME_PLAN_MISMATCH', 'Operation outcome does not map to a planned operation.', `operation_outcomes[${index}].planned_operation_id`, { planned_operation_id: plannedId });
    } else {
      if (outcomeByPlannedId.has(plannedId)) {
        add('DUPLICATE_OPERATION_OUTCOME_MAPPING', 'Each planned operation may have only one outcome.', `operation_outcomes[${index}].planned_operation_id`);
      }
      outcomeByPlannedId.set(plannedId, item);
    }
    if (item.cleanup_required === true && status === 'succeeded') {
      const cleanupPassed = arrayValue(value.cleanup_results).some((result) => (
        text(objectValue(result).operation_outcome_id) === text(item.id)
        && text(objectValue(result).status) === 'passed'
      ));
      if (!cleanupPassed) add('CLEANUP_RESULT_REQUIRED', 'Succeeded operations requiring cleanup need a passed cleanup result.', `operation_outcomes[${index}]`);
    }
    if (item.rollback_required === true && ['failed', 'cleanup_failed'].includes(status)) {
      const rollbackReported = arrayValue(value.rollback_results).some((result) => text(objectValue(result).operation_outcome_id) === text(item.id));
      if (!rollbackReported) add('ROLLBACK_RESULT_REQUIRED', 'Failed operations requiring rollback need a rollback result.', `operation_outcomes[${index}]`);
    }
  });
  plannedOperations.forEach((operation, index) => {
    const plannedId = text(operation.id);
    if (!outcomeByPlannedId.has(plannedId) && !TERMINAL_WITHOUT_OPERATION_OUTCOMES.has(text(value.status))) {
      add('PLANNED_OPERATION_OUTCOME_MISSING', 'Every planned operation needs a caller-supplied outcome unless the artifact is terminally aborted.', `planned_operations[${index}].id`, { planned_operation_id: plannedId });
    }
  });

  const cleanupResults = arrayValue(value.cleanup_results).map(objectValue);
  const rollbackResults = arrayValue(value.rollback_results).map(objectValue);
  const outcomeIds = new Set(operationOutcomeIds);
  const outcomeById = new Map(arrayValue(value.operation_outcomes)
    .map(objectValue)
    .map((outcome) => [text(outcome.id), outcome])
    .filter(([id]) => id));
  const normalizedEvidenceIds = normalizeEvidenceRefs(value.evidence_refs).map(evidenceRefId);
  if (new Set(normalizedEvidenceIds).size !== normalizedEvidenceIds.length) {
    add('EVIDENCE_REF_IDS_NOT_UNIQUE', 'Attempt Artifact evidence ref ids must be unique.', 'evidence_refs');
  }
  const evidenceIds = new Set(normalizedEvidenceIds);
  for (const [kind, results] of [['cleanup', cleanupResults], ['rollback', rollbackResults]]) {
    const resultIds = results.map((result) => text(result.id)).filter(Boolean);
    if (new Set(resultIds).size !== resultIds.length) add(`${kind.toUpperCase()}_RESULT_IDS_NOT_UNIQUE`, `${kind} result ids must be unique.`, `${kind}_results`);
    const tupleIds = new Set();
    const refField = `${kind}_ref_id`;
    results.forEach((result, index) => {
      const operationOutcomeId = text(result.operation_outcome_id);
      const operationOutcome = outcomeById.get(operationOutcomeId);
      const refId = rawText(result[refField]);
      if (!outcomeIds.has(operationOutcomeId)) {
        add(`${kind.toUpperCase()}_RESULT_OUTCOME_UNKNOWN`, `${kind} results must map to an exact operation outcome.`, `${kind}_results[${index}].operation_outcome_id`);
      } else {
        const plannedOperation = plannedById.get(text(operationOutcome.planned_operation_id));
        const plannedRefs = arrayValue(plannedOperation?.[`${kind}_refs`]).map(rawText);
        if (!plannedRefs.includes(refId)) {
          add(`${kind.toUpperCase()}_RESULT_REF_UNPLANNED`, `${kind} results must map to a reference declared by the exact planned operation.`, `${kind}_results[${index}].${refField}`, {
            operation_outcome_id: operationOutcomeId,
            [`${kind}_ref_id`]: refId,
          });
        }
      }
      const tupleId = `${operationOutcomeId}\0${refId}`;
      if (tupleIds.has(tupleId)) {
        add(`${kind.toUpperCase()}_RESULT_MAPPING_DUPLICATE`, `${kind} results may contain only one row for each exact operation-outcome/reference tuple.`, `${kind}_results[${index}]`);
      }
      tupleIds.add(tupleId);
      for (const evidenceId of arrayValue(result.evidence_ref_ids).map(text).filter(Boolean)) {
        if (!evidenceIds.has(evidenceId)) {
          add(`${kind.toUpperCase()}_RESULT_EVIDENCE_REF_MISSING`, `${kind} results may reference only evidence present in evidence_refs.`, `${kind}_results[${index}].evidence_ref_ids`, { evidence_ref_id: evidenceId });
        }
      }
    });
  }

  const recommendedCommandOutcomes = arrayValue(value.recommended_command_outcomes).map(objectValue);
  const recommendedCommandOutcomeIds = recommendedCommandOutcomes.map((outcome) => text(outcome.id)).filter(Boolean);
  if (new Set(recommendedCommandOutcomeIds).size !== recommendedCommandOutcomeIds.length) {
    add('RECOMMENDED_COMMAND_OUTCOME_IDS_NOT_UNIQUE', 'Recommended command outcome ids must be unique.', 'recommended_command_outcomes');
  }
  const plannedRecommendedCommandBytes = new Set(arrayValue(claimedAttemptPlan.recommended_commands)
    .map((command) => rawText(objectValue(command).command))
    .filter(Boolean));
  const reportedRecommendedCommandBytes = new Set();
  recommendedCommandOutcomes.forEach((outcome, index) => {
    const command = rawText(outcome.command);
    if (!plannedRecommendedCommandBytes.has(command)) {
      add('RECOMMENDED_COMMAND_OUTCOME_PLAN_MISMATCH', 'Recommended command outcomes must quote exact command bytes from the claimed Attempt Plan.', `recommended_command_outcomes[${index}].command`);
    }
    if (reportedRecommendedCommandBytes.has(command)) {
      add('RECOMMENDED_COMMAND_OUTCOME_MAPPING_DUPLICATE', 'Each exact planned command may have only one reported outcome.', `recommended_command_outcomes[${index}].command`);
    }
    reportedRecommendedCommandBytes.add(command);
    for (const evidenceId of arrayValue(outcome.evidence_ref_ids).map(text).filter(Boolean)) {
      if (!evidenceIds.has(evidenceId)) {
        add('RECOMMENDED_COMMAND_OUTCOME_EVIDENCE_REF_MISSING', 'Recommended command outcomes may reference only evidence present in evidence_refs.', `recommended_command_outcomes[${index}].evidence_ref_ids`, { evidence_ref_id: evidenceId });
      }
    }
  });

  const plannedEvidenceRequirements = arrayValue(value.planned_evidence_requirements).map(objectValue);
  const plannedEvidenceRequirementIds = plannedEvidenceRequirements.map((item) => text(item.id)).filter(Boolean);
  if (new Set(plannedEvidenceRequirementIds).size !== plannedEvidenceRequirementIds.length) {
    add('PLANNED_EVIDENCE_REQUIREMENT_IDS_NOT_UNIQUE', 'Planned evidence requirement ids must be unique.', 'planned_evidence_requirements');
  }
  const outcomeEvidenceIds = new Set(arrayValue(value.operation_outcomes).flatMap((outcome) => arrayValue(objectValue(outcome).evidence_ref_ids).map(text)).filter(Boolean));
  for (const id of outcomeEvidenceIds) {
    if (!evidenceIds.has(id)) add('OPERATION_EVIDENCE_REF_MISSING', 'Operation outcome references evidence not present in evidence_refs.', 'evidence_refs', { evidence_ref_id: id });
  }
  const plannedCandidatePatches = arrayValue(value.planned_candidate_patches).map(objectValue);
  const plannedCandidatePatchIds = plannedCandidatePatches.map((patch) => text(patch.id)).filter(Boolean);
  if (new Set(plannedCandidatePatchIds).size !== plannedCandidatePatchIds.length) {
    add('PLANNED_CANDIDATE_PATCH_IDS_NOT_UNIQUE', 'Planned candidate patch ids must be unique.', 'planned_candidate_patches');
  }
  const plannedCandidatePatchById = new Map(plannedCandidatePatches.map((patch) => [text(patch.id), patch]).filter(([id]) => id));
  const candidatePatchOutcomes = arrayValue(value.candidate_patch_outcomes).map(objectValue);
  const candidatePatchOutcomeIds = candidatePatchOutcomes.map((patch) => text(patch.id)).filter(Boolean);
  if (new Set(candidatePatchOutcomeIds).size !== candidatePatchOutcomeIds.length) {
    add('CANDIDATE_PATCH_OUTCOME_IDS_NOT_UNIQUE', 'Candidate patch outcome ids must be unique.', 'candidate_patch_outcomes');
  }
  const candidatePatchOutcomeByPlanId = new Map();
  candidatePatchOutcomes.forEach((patch, index) => {
    const item = objectValue(patch);
    const candidatePatchId = text(item.candidate_patch_id);
    if (!plannedCandidatePatchById.has(candidatePatchId)) {
      add('CANDIDATE_PATCH_OUTCOME_PLAN_MISMATCH', 'Candidate patch outcomes must map to an exact planned candidate patch.', `candidate_patch_outcomes[${index}].candidate_patch_id`, { candidate_patch_id: candidatePatchId });
    } else if (candidatePatchOutcomeByPlanId.has(candidatePatchId)) {
      add('DUPLICATE_CANDIDATE_PATCH_OUTCOME_MAPPING', 'Each planned candidate patch may have only one outcome.', `candidate_patch_outcomes[${index}].candidate_patch_id`, { candidate_patch_id: candidatePatchId });
    } else {
      candidatePatchOutcomeByPlanId.set(candidatePatchId, item);
    }
    if (item.applied_to_source !== false) {
      add('CANDIDATE_PATCH_SOURCE_APPLICATION_FORBIDDEN', 'Attempt Artifacts may carry proposed patch data but must not apply it to the source Work Record.', `candidate_patch_outcomes[${index}].applied_to_source`);
    }
    if (text(item.source_work_record_digest) !== text(value.source_work_record?.digest)) {
      add('CANDIDATE_PATCH_SOURCE_DIGEST_MISMATCH', 'Candidate patch outcomes must bind the exact source Work Record digest.', `candidate_patch_outcomes[${index}].source_work_record_digest`);
    }
    if (text(item.proposed_execution_map_digest) !== digestJson(item.proposed_execution_map)) {
      add('CANDIDATE_PATCH_EXECUTION_MAP_DIGEST_MISMATCH', 'Candidate patch outcomes must bind the exact proposed execution-map payload.', `candidate_patch_outcomes[${index}].proposed_execution_map_digest`);
    }
    if (text(item.status) === 'produced' && arrayValue(item.evidence_ref_ids).length === 0) {
      add('CANDIDATE_PATCH_PRODUCED_WITHOUT_EVIDENCE', 'Produced candidate patch outcomes require exact evidence refs.', `candidate_patch_outcomes[${index}].evidence_ref_ids`);
    }
    for (const id of arrayValue(item.evidence_ref_ids).map(text).filter(Boolean)) {
      if (!evidenceIds.has(id)) add('CANDIDATE_PATCH_EVIDENCE_REF_MISSING', 'Candidate patch outcome references missing evidence.', `candidate_patch_outcomes[${index}].evidence_ref_ids`, { evidence_ref_id: id });
    }
  });

  const postconditions = arrayValue(value.postcondition_results).map(objectValue);
  postconditions.forEach((result, index) => {
    for (const id of arrayValue(result.evidence_ref_ids).map(text).filter(Boolean)) {
      if (!evidenceIds.has(id)) {
        add('POSTCONDITION_EVIDENCE_REF_MISSING', 'Postcondition results may reference only evidence present in evidence_refs.', `postcondition_results[${index}].evidence_ref_ids`, { evidence_ref_id: id });
      }
    }
  });
  const cleanup = cleanupResults;
  const rollback = rollbackResults;
  const mutationCheck = objectValue(value.source_work_record_mutation_check);
  if (text(value.status) === 'succeeded') {
    if (plannedCandidatePatchIds.length !== 1 || candidatePatchOutcomes.length !== 1) {
      add('SUCCESS_REQUIRES_ONE_CANDIDATE_PATCH_OUTCOME', 'Successful Attempt Artifact V1 requires exactly one planned candidate patch and one outcome.', 'candidate_patch_outcomes');
    }
    if (!value.verifier_after) add('VERIFIER_AFTER_REQUIRED_FOR_SUCCESS', 'Successful artifacts require verifier_after.', 'verifier_after');
    if (verifierHealth(value.verifier_after) !== text(value.final_health?.classification)) {
      add('FINAL_HEALTH_NOT_DERIVED_FROM_VERIFIER_AFTER', 'final_health.classification must match verifier_after health.', 'final_health.classification');
    }
    if (text(mutationCheck.status) !== 'passed'
      || !text(mutationCheck.before_digest)
      || text(mutationCheck.before_digest) !== text(mutationCheck.after_digest)
      || (text(value.source_work_record?.digest) && text(mutationCheck.before_digest) !== text(value.source_work_record.digest))) {
      add('SOURCE_WORK_RECORD_MUTATION_CHECK_FAILED', 'Successful artifacts require matching source before/after digests.', 'source_work_record_mutation_check');
    }
    for (const requirement of plannedOperations.flatMap(operationRequiredEvidenceIds)) {
      if (!evidenceIds.has(requirement) && !outcomeEvidenceIds.has(requirement)) {
        add('REQUIRED_EVIDENCE_REF_MISSING', 'Success requires all planned evidence refs.', 'evidence_refs', { evidence_ref_id: requirement });
      }
    }
    for (const requirement of plannedEvidenceRequirements.filter((item) => item.required === true)) {
      const requirementId = text(requirement.id);
      if (!evidenceIds.has(requirementId)) {
        add('PLANNED_REQUIRED_EVIDENCE_MISSING', 'Successful Artifacts require every Attempt Plan evidence requirement marked required.', 'evidence_refs', { evidence_ref_id: requirementId });
      }
    }
    for (const plannedPatchId of plannedCandidatePatchIds) {
      const patchOutcome = candidatePatchOutcomeByPlanId.get(plannedPatchId);
      if (text(patchOutcome?.status) !== 'produced') {
        add('CANDIDATE_PATCH_OUTCOME_REQUIRED_FOR_SUCCESS', 'Successful Artifacts require a produced caller-supplied outcome for every planned candidate patch.', 'candidate_patch_outcomes', { candidate_patch_id: plannedPatchId });
      }
      const patchOperation = plannedOperations.find((operation) => text(operation.source_candidate_patch_id) === plannedPatchId);
      const patchOperationOutcome = patchOperation
        ? outcomeByPlannedId.get(text(patchOperation.id))
        : null;
      if (text(patchOutcome?.status) === 'produced' && text(patchOperationOutcome?.status) !== 'succeeded') {
        add(
          'CANDIDATE_PATCH_OPERATION_NOT_SUCCEEDED',
          'A produced candidate patch in a successful Artifact requires its exact planned candidate-patch operation to have succeeded.',
          'operation_outcomes',
          {
            candidate_patch_id: plannedPatchId,
            planned_operation_id: text(patchOperation?.id),
          },
        );
      }
    }
    const postconditionIds = postconditions.map((result) => text(result.id)).filter(Boolean);
    if (new Set(postconditionIds).size !== postconditionIds.length) {
      add('POSTCONDITION_RESULT_IDS_NOT_UNIQUE', 'Postcondition result ids must be unique.', 'postcondition_results');
    }
    const postconditionById = new Map(postconditions.map((result) => [text(result.id), result]).filter(([id]) => id));
    const mechanicalPostconditionIds = uniqueStrings(plannedOperations.flatMap((operation) => arrayValue(operation.postcondition_refs)));
    const producedMapPostconditionIds = uniqueStrings(candidatePatchOutcomes
      .filter((outcome) => text(outcome.status) === 'produced')
      .flatMap((outcome) => arrayValue(objectValue(outcome.proposed_execution_map).postconditions))
      .map((postcondition) => text(objectValue(postcondition).id)));
    const requiredPostconditionIds = uniqueStrings([
      ...mechanicalPostconditionIds,
      ...producedMapPostconditionIds,
    ]);
    if (digestJson(postconditionIds.slice().sort()) !== digestJson(requiredPostconditionIds)) {
      add('POSTCONDITION_RESULT_COVERAGE_MISMATCH', 'Successful artifacts require exactly one result for every mechanical and produced execution-map postcondition, with no extras.', 'postcondition_results');
    }
    for (const requiredId of requiredPostconditionIds) {
      if (text(postconditionById.get(requiredId)?.status) !== 'passed') {
        add('REQUIRED_POSTCONDITION_RESULT_MISSING', 'Successful artifacts require a passed result for every planned postcondition.', 'postcondition_results', { postcondition_id: requiredId });
      }
    }
    for (const producedId of producedMapPostconditionIds) {
      if (arrayValue(postconditionById.get(producedId)?.evidence_ref_ids).map(text).filter(Boolean).length === 0) {
        add('PRODUCED_MAP_POSTCONDITION_EVIDENCE_MISSING', 'Every produced execution-map postcondition requires caller evidence in a successful Artifact.', 'postcondition_results', { postcondition_id: producedId });
      }
    }
    for (const operation of plannedOperations) {
      const outcome = outcomeByPlannedId.get(text(operation.id));
      if (!outcome) continue;
      for (const cleanupRef of uniqueStrings(arrayValue(operation.cleanup_refs))) {
        const result = cleanup.find((item) => text(item.operation_outcome_id) === text(outcome.id) && text(item.cleanup_ref_id) === cleanupRef);
        if (!result || !['passed', 'not_required'].includes(text(result.status))) {
          add('PLANNED_CLEANUP_RESULT_MISSING', 'Successful artifacts require a passed or not_required cleanup receipt for every planned cleanup reference.', 'cleanup_results', { cleanup_ref_id: cleanupRef, planned_operation_id: text(operation.id) });
        }
      }
      for (const rollbackRef of uniqueStrings(arrayValue(operation.rollback_refs))) {
        const result = rollback.find((item) => text(item.operation_outcome_id) === text(outcome.id) && text(item.rollback_ref_id) === rollbackRef);
        if (!result || !['passed', 'not_required'].includes(text(result.status))) {
          add('PLANNED_ROLLBACK_RESULT_MISSING', 'Successful artifacts require a passed or not_required rollback receipt for every planned rollback reference.', 'rollback_results', { rollback_ref_id: rollbackRef, planned_operation_id: text(operation.id) });
        }
      }
    }
    if (postconditions.some((result) => text(result.status) !== 'passed')) add('POSTCONDITION_FAILED_ON_SUCCESS', 'Successful artifacts require all postconditions to pass.', 'postcondition_results');
    if (cleanup.some((result) => !['passed', 'not_required'].includes(text(result.status)))) add('CLEANUP_FAILED_ON_SUCCESS', 'Successful artifacts require cleanup to pass or be not_required.', 'cleanup_results');
    if (arrayValue(value.operation_outcomes).some((outcome) => !['succeeded', 'skipped'].includes(text(objectValue(outcome).status)))) add('OPERATION_FAILED_ON_SUCCESS', 'Successful artifacts require operation outcomes to succeed or be skipped.', 'operation_outcomes');
  }
  if (cleanup.some((result) => text(result.status) === 'failed') && text(value.status) === 'succeeded') add('CLEANUP_FAILURE_MUST_FAIL_CLOSED', 'Cleanup failure cannot be reported as succeeded.', 'status');
  if (rollback.some((result) => text(result.status) === 'failed') && !['rollback_failed', 'failed', 'partial'].includes(text(value.status))) add('ROLLBACK_FAILURE_MUST_FAIL_CLOSED', 'Rollback failure must fail closed.', 'status');
  if (value.verifier_after && verifierHealth(value.verifier_after) !== text(value.final_health?.classification)) {
    add('OPTIMISTIC_FINAL_HEALTH_CONTRADICTS_VERIFIER_AFTER', 'final_health cannot override verifier_after health.', 'final_health.classification');
  }

  const identity = objectValue(value.attempt_artifact_identity);
  const expectedIdentity = expectedArtifactIdentity(value);
  if (digestJson(expectedIdentity) !== digestJson(identity)) {
    add('REPAIR_ATTEMPT_ARTIFACT_IDENTITY_MISMATCH', 'Attempt Artifact identity does not match its source, plans, operations, outcomes, and evidence.', 'attempt_artifact_identity');
  }
  if (text(identity.repair_attempt_plan?.digest) !== text(value.repair_attempt_plan?.digest)) {
    add('REPAIR_ATTEMPT_PLAN_IDENTITY_MISMATCH', 'Attempt artifact identity does not match repair_attempt_plan digest.', 'attempt_artifact_identity.repair_attempt_plan.digest');
  }
  const identitySource = sourceIdentity(identity.source_work_record);
  const artifactSource = sourceIdentity(value.source_work_record);
  if (identitySource.id !== artifactSource.id || identitySource.digest !== artifactSource.digest) {
    add('SOURCE_WORK_RECORD_IDENTITY_MISMATCH', 'Attempt artifact source id or digest does not match its identity.', 'attempt_artifact_identity.source_work_record');
  }

  return {
    type: 'work_record.repair_attempt_artifact.validation',
    schema_version: WORK_RECORD_REPAIR_ATTEMPT_ARTIFACT_SCHEMA_VERSION,
    status: diagnostics.length > 0 ? 'failed' : 'passed',
    read_only: true,
    mutates_state: false,
    executes_repair: false,
    executes_actions: false,
    applies_patches: false,
    diagnostics,
  };
}
