import crypto from 'node:crypto';

export const WORK_RECORD_REPAIR_ATTEMPT_ARTIFACT_SCHEMA_VERSION = '2026-07-work-record-repair-attempt-artifact-v0';
export const WORK_RECORD_REPAIR_ATTEMPT_ARTIFACT_TYPE = 'work_record.repair_attempt_artifact';

export const WORK_RECORD_REPAIR_ATTEMPT_ARTIFACT_STATUSES = [
  'succeeded',
  'failed',
  'partial',
  'aborted_precondition',
  'blocked_authorization',
  'blocked_plan_mismatch',
  'cleanup_failed',
  'rollback_failed',
  'invalid_artifact',
  'unsupported',
];

const TERMINAL_NON_REPAIR_STATUSES = new Set([
  'aborted_precondition',
  'blocked_authorization',
  'blocked_plan_mismatch',
  'invalid_artifact',
  'unsupported',
]);

const OPERATION_STATUSES = new Set([
  'succeeded',
  'failed',
  'skipped',
  'aborted_precondition',
  'blocked_authorization',
  'cleanup_failed',
  'rollback_failed',
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
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function uniqueStrings(values = []) {
  return [...new Set(values.map((value) => text(value)).filter(Boolean))].sort();
}

function sourceIdentity(source = {}) {
  const value = objectValue(source);
  return {
    id: text(value.id),
    path: text(value.path),
    requested_ref: text(value.requested_ref),
    schema_version: text(value.schema_version),
  };
}

function evidenceRefId(ref = {}) {
  if (typeof ref === 'string') return ref;
  return text(objectValue(ref).id || objectValue(ref).ref || objectValue(ref).uri);
}

function normalizeEvidenceRefs(refs = []) {
  return arrayValue(refs)
    .map((ref) => (typeof ref === 'string' ? { id: ref } : cloneJson(objectValue(ref))))
    .filter((ref) => evidenceRefId(ref))
    .sort((left, right) => evidenceRefId(left).localeCompare(evidenceRefId(right)));
}

function verifierHealth(report = {}) {
  const value = objectValue(report);
  return text(value.health_verdict
    || value.report?.health_verdict
    || value.report?.summary?.health_verdict
    || value.status);
}

function authorizationIdentity(authorization = {}) {
  const value = objectValue(authorization);
  return {
    type: text(value.type),
    schema_version: text(value.schema_version),
    status: text(value.status || value.authorization_status),
    workflow_gate_id: text(value.workflow_gate?.id),
    terminal_gate_record_or_resume_event_id: text(value.terminal_gate_record_or_resume_event_id),
    digest: digestJson(value),
  };
}

function operationRequiredEvidenceIds(operation = {}) {
  return uniqueStrings([
    ...arrayValue(operation.evidence_requirement_refs),
    ...arrayValue(operation.evidence_ref_ids),
  ]);
}

function artifactIdentity({
  repairAttemptPlan = {},
  operationOutcomes = [],
  evidenceRefs = [],
} = {}) {
  const plan = objectValue(repairAttemptPlan);
  const identity = {
    source_work_record: sourceIdentity(plan.source_work_record),
    repair_plan: {
      schema_version: text(plan.repair_plan?.schema_version),
      digest: text(plan.repair_plan?.digest),
    },
    workflow_gate_authorizations: arrayValue(plan.workflow_gate_authorizations).map(authorizationIdentity),
    repair_attempt_plan: {
      schema_version: text(plan.schema_version),
      digest: digestJson(plan),
      attempt_id: text(plan.attempt_identity?.attempt_id),
      attempt_digest: text(plan.attempt_identity?.digest),
    },
    planned_operation_ids: uniqueStrings(arrayValue(plan.planned_operations).map((operation) => objectValue(operation).id)),
    operation_outcome_ids: uniqueStrings(arrayValue(operationOutcomes).map((outcome) => objectValue(outcome).id)),
    evidence_ref_digests: uniqueStrings(normalizeEvidenceRefs(evidenceRefs).map((ref) => (
      text(ref.digest) || digestJson(ref)
    ))),
  };
  const digest = digestJson(identity);
  return {
    id: `work-record-repair-attempt-artifact:${digest.slice(0, 24)}`,
    digest,
    ...identity,
  };
}

function finalHealthFrom({ status = '', verifierAfter = null, inputFinalHealth = {} } = {}) {
  const afterHealth = verifierAfter ? verifierHealth(verifierAfter) : '';
  const classification = afterHealth || text(inputFinalHealth.classification || inputFinalHealth.health_verdict || inputFinalHealth.status, status);
  return {
    classification,
    derived_from: afterHealth ? 'verifier_after' : 'fixture_input',
    verifier_after_health: afterHealth,
  };
}

function recommendedNext(status = '') {
  if (status === 'succeeded') {
    return {
      action: 'record_attempt_artifact',
      note: 'This artifact records the attempted repair outcome; replacement Work Record minting remains separate.',
    };
  }
  if (status === 'invalid_artifact') {
    return {
      action: 'fix_artifact_payload',
      note: 'Do not treat this artifact as repair proof until validation passes.',
    };
  }
  return {
    action: 'inspect_attempt_evidence',
    note: `Repair Attempt Artifact status is ${status}; do not replay or repair automatically.`,
  };
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
  const identity = artifactIdentity({
    repairAttemptPlan,
    operationOutcomes,
    evidenceRefs,
  });
  return {
    type: WORK_RECORD_REPAIR_ATTEMPT_ARTIFACT_TYPE,
    schema_version: WORK_RECORD_REPAIR_ATTEMPT_ARTIFACT_SCHEMA_VERSION,
    status,
    source_work_record: cloneJson(repairAttemptPlan.source_work_record || value.source_work_record || {}),
    repair_plan: cloneJson(repairAttemptPlan.repair_plan || value.repair_plan || {}),
    workflow_gate_authorizations: cloneJson(arrayValue(repairAttemptPlan.workflow_gate_authorizations)),
    repair_attempt_plan: {
      schema_version: text(repairAttemptPlan.schema_version),
      digest: digestJson(repairAttemptPlan),
      attempt_identity: cloneJson(repairAttemptPlan.attempt_identity || {}),
    },
    attempt_artifact_identity: identity,
    executor: {
      id: text(value.executor?.id, 'fixture-outcome-input'),
      kind: text(value.executor?.kind, 'fixture_builder'),
      version: text(value.executor?.version, WORK_RECORD_REPAIR_ATTEMPT_ARTIFACT_SCHEMA_VERSION),
      implemented: value.executor?.implemented === true,
      description: text(value.executor?.description, 'Descriptive fixture/outcome metadata; no executor is implemented by this builder.'),
    },
    timing: {
      started_at: text(value.timing?.started_at || value.started_at, '2026-07-04T00:00:00.000Z'),
      finished_at: text(value.timing?.finished_at || value.finished_at, '2026-07-04T00:00:00.000Z'),
      source: text(value.timing?.source, 'fixture'),
    },
    planned_operations: cloneJson(arrayValue(repairAttemptPlan.planned_operations)),
    operation_outcomes: operationOutcomes,
    candidate_patch_outcomes: cloneJson(arrayValue(value.candidate_patch_outcomes)),
    recommended_command_outcomes: cloneJson(arrayValue(value.recommended_command_outcomes)),
    evidence_refs: evidenceRefs,
    verifier_before: verifierBefore,
    verifier_after: verifierAfter,
    final_health: finalHealthFrom({
      status,
      verifierAfter,
      inputFinalHealth: objectValue(value.final_health),
    }),
    postcondition_results: cloneJson(arrayValue(value.postcondition_results)),
    cleanup_results: cloneJson(arrayValue(value.cleanup_results)),
    rollback_results: cloneJson(arrayValue(value.rollback_results)),
    source_work_record_mutation_check: cloneJson(objectValue(value.source_work_record_mutation_check)),
    source_work_record_mutated: value.source_work_record_mutated === true,
    rewrites_historical_evidence: false,
    automatic_replay_allowed: false,
    executor_implemented: value.executor?.implemented === true,
    diagnostics: cloneJson(arrayValue(value.diagnostics)),
    recommended_next: recommendedNext(status),
  };
}

export function validateWorkRecordRepairAttemptArtifact(artifact = {}) {
  const value = objectValue(artifact);
  const diagnostics = [];
  function add(code, message, path, extra = {}) {
    diagnostics.push({
      severity: 'error',
      code,
      message,
      path,
      ...extra,
    });
  }

  if (text(value.type) !== WORK_RECORD_REPAIR_ATTEMPT_ARTIFACT_TYPE) {
    add('INVALID_REPAIR_ATTEMPT_ARTIFACT_TYPE', 'Repair Attempt Artifact type must be work_record.repair_attempt_artifact.', 'type');
  }
  if (text(value.schema_version) !== WORK_RECORD_REPAIR_ATTEMPT_ARTIFACT_SCHEMA_VERSION) {
    add('INVALID_REPAIR_ATTEMPT_ARTIFACT_SCHEMA_VERSION', 'Repair Attempt Artifact schema_version is not supported.', 'schema_version');
  }
  if (!WORK_RECORD_REPAIR_ATTEMPT_ARTIFACT_STATUSES.includes(text(value.status))) {
    add('INVALID_REPAIR_ATTEMPT_ARTIFACT_STATUS', 'Repair Attempt Artifact status is not supported.', 'status');
  }
  for (const field of ['source_work_record_mutated', 'rewrites_historical_evidence', 'automatic_replay_allowed']) {
    if (value[field] !== false) add('REPAIR_ATTEMPT_ARTIFACT_NON_EXECUTION_FLAG_NOT_FALSE', `${field} must be false.`, field);
  }
  const executor = objectValue(value.executor);
  if (executor.implemented === true) {
    if (text(executor.kind) !== 'controlled_repair_executor') {
      add('REPAIR_ATTEMPT_ARTIFACT_EXECUTOR_KIND_UNSUPPORTED', 'Implemented Repair Attempt Artifacts must be produced by the Controlled Repair Executor.', 'executor.kind');
    }
    if (value.executor_implemented !== true) {
      add('REPAIR_ATTEMPT_ARTIFACT_EXECUTOR_FLAG_MISMATCH', 'executor_implemented must match executor.implemented.', 'executor_implemented');
    }
  } else if (executor.implemented !== false) {
    add('REPAIR_ATTEMPT_ARTIFACT_EXECUTOR_IMPLEMENTED_FLAG_INVALID', 'executor.implemented must be a boolean.', 'executor.implemented');
  } else if (value.executor_implemented !== false) {
    add('REPAIR_ATTEMPT_ARTIFACT_EXECUTOR_FLAG_MISMATCH', 'executor_implemented must match executor.implemented.', 'executor_implemented');
  }

  const plannedOperations = arrayValue(value.planned_operations).map(objectValue);
  const plannedById = new Map(plannedOperations.map((operation) => [text(operation.id), operation]).filter(([id]) => id));
  const outcomeByPlannedId = new Map();
  arrayValue(value.operation_outcomes).forEach((outcome, index) => {
    const item = objectValue(outcome);
    const status = text(item.status);
    const plannedId = text(item.planned_operation_id);
    if (!OPERATION_STATUSES.has(status)) {
      add('INVALID_OPERATION_OUTCOME_STATUS', 'Operation outcome status is not supported.', `operation_outcomes[${index}].status`);
    }
    if (!plannedById.has(plannedId)) {
      add('OPERATION_OUTCOME_PLAN_MISMATCH', 'Operation outcome does not map to a planned operation.', `operation_outcomes[${index}].planned_operation_id`, {
        planned_operation_id: plannedId,
      });
    } else {
      outcomeByPlannedId.set(plannedId, item);
    }
    if (item.cleanup_required === true && status === 'succeeded') {
      const cleanupPassed = arrayValue(value.cleanup_results).some((result) => (
        text(objectValue(result).operation_outcome_id) === text(item.id)
        && text(objectValue(result).status) === 'passed'
      ));
      if (!cleanupPassed) add('CLEANUP_RESULT_REQUIRED', 'Succeeded operation requiring cleanup must have a passed cleanup result.', `operation_outcomes[${index}]`);
    }
    if (item.rollback_required === true && (status === 'failed' || status === 'cleanup_failed')) {
      const rollbackReported = arrayValue(value.rollback_results).some((result) => (
        text(objectValue(result).operation_outcome_id) === text(item.id)
      ));
      if (!rollbackReported) add('ROLLBACK_RESULT_REQUIRED', 'Failed operation requiring rollback must report a rollback result.', `operation_outcomes[${index}]`);
    }
  });

  plannedOperations.forEach((operation, index) => {
    const plannedId = text(operation.id);
    if (!outcomeByPlannedId.has(plannedId) && !TERMINAL_NON_REPAIR_STATUSES.has(text(value.status))) {
      add('PLANNED_OPERATION_OUTCOME_MISSING', 'Every planned operation needs an outcome unless the artifact is terminally blocked or aborted.', `planned_operations[${index}].id`, {
        planned_operation_id: plannedId,
      });
    }
  });

  const evidenceIds = new Set(normalizeEvidenceRefs(value.evidence_refs).map(evidenceRefId));
  const outcomeEvidenceIds = new Set(arrayValue(value.operation_outcomes).flatMap((outcome) => arrayValue(objectValue(outcome).evidence_ref_ids).map(text)).filter(Boolean));
  for (const id of outcomeEvidenceIds) {
    if (!evidenceIds.has(id)) add('OPERATION_EVIDENCE_REF_MISSING', 'Operation outcome references evidence not present in evidence_refs.', 'evidence_refs', { evidence_ref_id: id });
  }

  arrayValue(value.candidate_patch_outcomes).forEach((patch, index) => {
    const item = objectValue(patch);
    const claimsApplied = item.applied === true || text(item.status) === 'applied';
    if (claimsApplied && arrayValue(item.evidence_ref_ids).length === 0) {
      add('CANDIDATE_PATCH_APPLIED_WITHOUT_EVIDENCE', 'Applied candidate patch outcomes require evidence refs.', `candidate_patch_outcomes[${index}].evidence_ref_ids`);
    }
    for (const id of arrayValue(item.evidence_ref_ids).map(text).filter(Boolean)) {
      if (!evidenceIds.has(id)) add('CANDIDATE_PATCH_EVIDENCE_REF_MISSING', 'Candidate patch outcome references evidence not present in evidence_refs.', `candidate_patch_outcomes[${index}].evidence_ref_ids`, { evidence_ref_id: id });
    }
  });

  arrayValue(value.recommended_command_outcomes).forEach((command, index) => {
    const item = objectValue(command);
    const executed = item.executed === true || text(item.status) === 'executed';
    if (executed) {
      for (const field of ['command_ref', 'stdout_ref', 'stderr_ref', 'exit_status']) {
        if (item[field] === undefined || item[field] === null || text(item[field]) === '') {
          add('RECOMMENDED_COMMAND_EXECUTION_ARTIFACT_MISSING', 'Executed recommended command outcomes require command identity, stdout, stderr, and exit status artifacts.', `recommended_command_outcomes[${index}].${field}`);
        }
      }
    }
  });

  const postconditions = arrayValue(value.postcondition_results).map(objectValue);
  const cleanup = arrayValue(value.cleanup_results).map(objectValue);
  const rollback = arrayValue(value.rollback_results).map(objectValue);
  if (text(value.status) === 'succeeded') {
    if (value.source_work_record_mutated !== false) add('SOURCE_WORK_RECORD_MUTATED_ON_SUCCESS', 'Successful artifacts require source_work_record_mutated:false.', 'source_work_record_mutated');
    if (!value.verifier_after) add('VERIFIER_AFTER_REQUIRED_FOR_SUCCESS', 'Successful artifacts require verifier_after.', 'verifier_after');
    if (verifierHealth(value.verifier_after) !== text(value.final_health?.classification)) {
      add('FINAL_HEALTH_NOT_DERIVED_FROM_VERIFIER_AFTER', 'final_health.classification must match verifier_after health when verifier_after is present.', 'final_health.classification', {
        expected: verifierHealth(value.verifier_after),
        actual: text(value.final_health?.classification),
      });
    }
    for (const requirement of plannedOperations.flatMap(operationRequiredEvidenceIds)) {
      if (!evidenceIds.has(requirement) && !outcomeEvidenceIds.has(requirement)) {
        add('REQUIRED_EVIDENCE_REF_MISSING', 'Success requires all required evidence refs to be present.', 'evidence_refs', { evidence_ref_id: requirement });
      }
    }
    if (postconditions.some((result) => text(result.status) !== 'passed')) {
      add('POSTCONDITION_FAILED_ON_SUCCESS', 'Successful artifacts require all postcondition results to pass.', 'postcondition_results');
    }
    if (cleanup.some((result) => !['passed', 'not_required'].includes(text(result.status)))) {
      add('CLEANUP_FAILED_ON_SUCCESS', 'Successful artifacts require cleanup to pass or be not_required.', 'cleanup_results');
    }
    if (arrayValue(value.operation_outcomes).some((outcome) => !['succeeded', 'skipped'].includes(text(objectValue(outcome).status)))) {
      add('OPERATION_FAILED_ON_SUCCESS', 'Successful artifacts require operation outcomes to be succeeded or skipped.', 'operation_outcomes');
    }
  }

  if (cleanup.some((result) => text(result.status) === 'failed') && text(value.status) === 'succeeded') {
    add('CLEANUP_FAILURE_MUST_FAIL_CLOSED', 'Cleanup failure cannot be reported as succeeded.', 'status');
  }
  if (rollback.some((result) => text(result.status) === 'failed') && !['rollback_failed', 'failed', 'partial'].includes(text(value.status))) {
    add('ROLLBACK_FAILURE_MUST_FAIL_CLOSED', 'Rollback failure must fail closed.', 'status');
  }
  if (value.verifier_after && verifierHealth(value.verifier_after) !== text(value.final_health?.classification)) {
    add('OPTIMISTIC_FINAL_HEALTH_CONTRADICTS_VERIFIER_AFTER', 'final_health cannot override verifier_after health.', 'final_health.classification', {
      expected: verifierHealth(value.verifier_after),
      actual: text(value.final_health?.classification),
    });
  }

  const identity = objectValue(value.attempt_artifact_identity);
  if (identity.repair_attempt_plan?.digest && text(value.repair_attempt_plan?.digest) && identity.repair_attempt_plan.digest !== text(value.repair_attempt_plan.digest)) {
    add('REPAIR_ATTEMPT_PLAN_IDENTITY_MISMATCH', 'Attempt artifact identity does not match repair_attempt_plan digest.', 'attempt_artifact_identity.repair_attempt_plan.digest');
  }
  const identitySource = sourceIdentity(identity.source_work_record);
  const artifactSource = sourceIdentity(value.source_work_record);
  if (identitySource.id && artifactSource.id && identitySource.id !== artifactSource.id) {
    add('SOURCE_WORK_RECORD_IDENTITY_MISMATCH', 'Attempt artifact source Work Record identity does not match the artifact identity.', 'attempt_artifact_identity.source_work_record');
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
    automatic_replay_allowed: false,
    diagnostics,
  };
}
