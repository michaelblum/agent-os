import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkRecordRepairAttemptArtifact,
  digestJson,
  validateWorkRecordRepairAttemptArtifact,
  WORK_RECORD_REPAIR_ATTEMPT_ARTIFACT_SCHEMA_VERSION,
} from '../../packages/toolkit/workbench/work-record-repair-attempt-artifact.js';
import { attemptPlan, successfulAttemptArtifact } from '../lib/work-record-v1-fixtures.mjs';

function rebuildArtifact(plan, baseline, overrides = {}) {
  return buildWorkRecordRepairAttemptArtifact({
    repair_attempt_plan: plan,
    status: baseline.status,
    outcome_source: baseline.outcome_source,
    timing: baseline.timing,
    operation_outcomes: baseline.operation_outcomes,
    candidate_patch_outcomes: baseline.candidate_patch_outcomes,
    recommended_command_outcomes: baseline.recommended_command_outcomes,
    evidence_refs: baseline.evidence_refs,
    verifier_before: baseline.verifier_before,
    verifier_after: baseline.verifier_after,
    postcondition_results: baseline.postcondition_results,
    cleanup_results: baseline.cleanup_results,
    rollback_results: baseline.rollback_results,
    source_work_record_mutation_check: baseline.source_work_record_mutation_check,
    source_work_record_mutated: baseline.source_work_record_mutated,
    ...overrides,
  });
}

test('Attempt Artifact V1 accepts caller outcomes and retains exact mechanics', () => {
  const plan = attemptPlan();
  const artifact = successfulAttemptArtifact(plan);
  assert.equal(artifact.schema_version, WORK_RECORD_REPAIR_ATTEMPT_ARTIFACT_SCHEMA_VERSION);
  assert.equal(artifact.outcome_source.kind, 'caller_supplied');
  assert.equal(artifact.repair_attempt_plan.digest, artifact.attempt_artifact_identity.repair_attempt_plan.digest);
  assert.equal(artifact.operation_outcomes.length, plan.planned_operations.length);
  assert.equal(artifact.source_work_record_mutated, false);
  assert.equal(artifact.rewrites_historical_evidence, false);
  assert.equal(validateWorkRecordRepairAttemptArtifact(artifact).status, 'passed');
  assert.doesNotMatch(JSON.stringify(artifact), /workflow_gate|authorization|approval|required_risk|risk_level|allowlisted|allowed_operations|controlled_fixture|automatic_replay/);
});

test('successful artifacts fail closed on verifier, evidence, cleanup, and source drift', () => {
  for (const mutate of [
    (artifact) => { artifact.verifier_after = null; },
    (artifact) => { artifact.evidence_refs = []; },
    (artifact) => { artifact.postcondition_results = []; },
    (artifact) => { artifact.cleanup_results = []; },
    (artifact) => { artifact.rollback_results = []; },
    (artifact) => { artifact.source_work_record_mutation_check.after_digest = 'different'; },
    (artifact) => { artifact.operation_outcomes[0].planned_operation_id = 'missing-operation'; },
    (artifact) => { artifact.operation_outcomes[0].id = 'tampered-outcome'; },
    (artifact) => { artifact.operation_outcomes.push(structuredClone(artifact.operation_outcomes[0])); },
    (artifact) => { artifact.evidence_refs.push(structuredClone(artifact.evidence_refs[0])); },
    (artifact) => { artifact.attempt_artifact_identity.digest = 'stale'; },
  ]) {
    const artifact = structuredClone(successfulAttemptArtifact());
    mutate(artifact);
    assert.equal(validateWorkRecordRepairAttemptArtifact(artifact).status, 'failed');
  }
});

test('builder does not execute and unsupported status fails validation', () => {
  assert.equal(validateWorkRecordRepairAttemptArtifact({}).status, 'failed');
  const artifact = buildWorkRecordRepairAttemptArtifact({ repair_attempt_plan: attemptPlan(), status: 'authorized' });
  assert.equal(validateWorkRecordRepairAttemptArtifact(artifact).status, 'failed');

  const blockedPlan = structuredClone(attemptPlan());
  blockedPlan.status = 'blocked_inputs';
  const blockedArtifact = successfulAttemptArtifact(blockedPlan);
  assert.equal(validateWorkRecordRepairAttemptArtifact(blockedArtifact).status, 'failed');

  const authorityExtra = structuredClone(successfulAttemptArtifact());
  authorityExtra.authorization = { status: 'approved' };
  assert.equal(validateWorkRecordRepairAttemptArtifact(authorityExtra).status, 'failed');

  const planAuthorityExtra = structuredClone(attemptPlan());
  planAuthorityExtra.candidate_patches[0].authorization = { status: 'approved' };
  planAuthorityExtra.candidate_patches[0].allowed_operations = ['replace_execution_map'];
  const artifactWithPlanAuthority = rebuildArtifact(
    planAuthorityExtra,
    successfulAttemptArtifact(),
  );
  assert.equal(validateWorkRecordRepairAttemptArtifact(artifactWithPlanAuthority).status, 'failed');
  const nestedPolicyValue = structuredClone(successfulAttemptArtifact());
  nestedPolicyValue.planned_candidate_patches[0].failure_classes.push({ policy: 'caller-owned' });
  nestedPolicyValue.source_work_record.summary.policy = { decision: 'proceed' };
  assert.equal(validateWorkRecordRepairAttemptArtifact(nestedPolicyValue).status, 'failed');
  const outcomePolicy = structuredClone(successfulAttemptArtifact());
  outcomePolicy.operation_outcomes[0].authorization = { status: 'approved' };
  outcomePolicy.operation_outcomes[0].allowed_operations = ['replace_execution_map'];
  const rebuiltOutcomePolicy = rebuildArtifact(
    attemptPlan(),
    successfulAttemptArtifact(),
    { operation_outcomes: outcomePolicy.operation_outcomes },
  );
  assert.equal(validateWorkRecordRepairAttemptArtifact(rebuiltOutcomePolicy).status, 'failed');

  const plan = attemptPlan();
  const missingPatchOutcome = rebuildArtifact(plan, successfulAttemptArtifact(plan), { candidate_patch_outcomes: [] });
  const missingPatchValidation = validateWorkRecordRepairAttemptArtifact(missingPatchOutcome);
  assert.equal(missingPatchValidation.status, 'failed');
  assert.ok(missingPatchValidation.diagnostics.some((item) => item.code === 'CANDIDATE_PATCH_OUTCOME_REQUIRED_FOR_SUCCESS'));
});

test('successful Artifact requires exact evidence-backed produced-map postcondition coverage', () => {
  const baseline = successfulAttemptArtifact();
  const producedIds = new Set(baseline.candidate_patch_outcomes[0].proposed_execution_map.postconditions.map((item) => item.id));
  const missing = structuredClone(baseline);
  missing.postcondition_results = missing.postcondition_results
    .filter((item) => item.id !== [...producedIds][0]);
  assert.ok(validateWorkRecordRepairAttemptArtifact(missing).diagnostics
    .some((item) => item.code === 'POSTCONDITION_RESULT_COVERAGE_MISMATCH'));

  const extra = structuredClone(baseline);
  extra.postcondition_results.push({
    id: 'postcondition:unplanned-extra',
    status: 'passed',
    evidence_ref_ids: [extra.evidence_refs[0].id],
  });
  assert.ok(validateWorkRecordRepairAttemptArtifact(extra).diagnostics
    .some((item) => item.code === 'POSTCONDITION_RESULT_COVERAGE_MISMATCH'));

  const noEvidence = structuredClone(baseline);
  noEvidence.postcondition_results.find((item) => producedIds.has(item.id)).evidence_ref_ids = [];
  assert.ok(validateWorkRecordRepairAttemptArtifact(noEvidence).diagnostics
    .some((item) => item.code === 'PRODUCED_MAP_POSTCONDITION_EVIDENCE_MISSING'));
});

test('Attempt Artifact binds caller receipts to exact planned command and cleanup/rollback references', () => {
  const plan = attemptPlan();
  const baseline = successfulAttemptArtifact(plan);
  const unplanned = rebuildArtifact(plan, baseline, {
    recommended_command_outcomes: [{
      id: 'recommended-command-outcome:unplanned',
      command: 'not in the exact Attempt Plan',
      status: 'succeeded',
      evidence_ref_ids: ['missing-evidence'],
    }],
    cleanup_results: [
      ...baseline.cleanup_results,
      {
        id: 'cleanup-result:unplanned',
        operation_outcome_id: baseline.operation_outcomes[0].id,
        cleanup_ref_id: 'cleanup_expectation:not-in-plan',
        status: 'passed',
        evidence_ref_ids: ['missing-evidence'],
      },
    ],
    rollback_results: [
      ...baseline.rollback_results,
      {
        id: 'rollback-result:unplanned',
        operation_outcome_id: baseline.operation_outcomes[0].id,
        rollback_ref_id: 'rollback_expectation:not-in-plan',
        status: 'passed',
        evidence_ref_ids: ['missing-evidence'],
      },
    ],
  });
  const validation = validateWorkRecordRepairAttemptArtifact(unplanned);
  assert.equal(validation.status, 'failed');
  for (const code of [
    'RECOMMENDED_COMMAND_OUTCOME_PLAN_MISMATCH',
    'RECOMMENDED_COMMAND_OUTCOME_EVIDENCE_REF_MISSING',
    'CLEANUP_RESULT_REF_UNPLANNED',
    'CLEANUP_RESULT_EVIDENCE_REF_MISSING',
    'ROLLBACK_RESULT_REF_UNPLANNED',
    'ROLLBACK_RESULT_EVIDENCE_REF_MISSING',
  ]) assert.ok(validation.diagnostics.some((item) => item.code === code), code);

  const duplicate = rebuildArtifact(plan, baseline, {
    cleanup_results: [
      ...baseline.cleanup_results,
      { ...baseline.cleanup_results[0], id: 'cleanup-result:duplicate-tuple' },
    ],
    rollback_results: [
      ...baseline.rollback_results,
      { ...baseline.rollback_results[0], id: 'rollback-result:duplicate-tuple' },
    ],
  });
  const duplicateValidation = validateWorkRecordRepairAttemptArtifact(duplicate);
  assert.ok(duplicateValidation.diagnostics.some((item) => item.code === 'CLEANUP_RESULT_MAPPING_DUPLICATE'));
  assert.ok(duplicateValidation.diagnostics.some((item) => item.code === 'ROLLBACK_RESULT_MAPPING_DUPLICATE'));
});

test('Attempt Artifact rejects malformed proposed execution-map structure before proposal use', () => {
  const artifact = structuredClone(successfulAttemptArtifact());
  const outcome = artifact.candidate_patch_outcomes[0];
  outcome.proposed_execution_map = { postconditions: {} };
  outcome.proposed_execution_map_digest = digestJson(outcome.proposed_execution_map);
  const validation = validateWorkRecordRepairAttemptArtifact(artifact);
  assert.equal(validation.status, 'failed');
  assert.ok(validation.diagnostics.some((item) => item.code === 'REPAIR_ATTEMPT_ARTIFACT_V1_SCHEMA_INVALID'));
});

test('successful Artifact requires every Attempt Plan evidence requirement marked required', () => {
  const baseline = successfulAttemptArtifact();
  const missingId = 'evidence_requirement:before-after-verifier-reports';
  const missing = structuredClone(baseline);
  missing.evidence_refs = missing.evidence_refs.filter((item) => item.id !== missingId);
  const validation = validateWorkRecordRepairAttemptArtifact(missing);
  assert.equal(validation.status, 'failed');
  assert.ok(validation.diagnostics.some((item) => item.code === 'PLANNED_REQUIRED_EVIDENCE_MISSING'));
});

test('successful Artifact rejects produced candidate patch when its planned operation was skipped', () => {
  const plan = attemptPlan();
  const baseline = successfulAttemptArtifact(plan);
  const candidatePatchOperation = plan.planned_operations.find((operation) => operation.source_candidate_patch_id === 'candidate_patch:execution_map_refs');
  const contradictoryOutcomes = baseline.operation_outcomes.map((outcome) => (
    outcome.planned_operation_id === candidatePatchOperation.id
      ? { ...outcome, status: 'skipped' }
      : outcome
  ));
  const artifact = rebuildArtifact(plan, baseline, { operation_outcomes: contradictoryOutcomes });
  const validation = validateWorkRecordRepairAttemptArtifact(artifact);
  assert.equal(validation.status, 'failed');
  assert.ok(validation.diagnostics.some((item) => item.code === 'CANDIDATE_PATCH_OPERATION_NOT_SUCCEEDED'));
});

test('standalone Artifact validation binds planned payloads to the exact claimed Attempt Plan', () => {
  const artifact = structuredClone(successfulAttemptArtifact());
  artifact.planned_operations[0].description = 'fabricated operation description';
  const validation = validateWorkRecordRepairAttemptArtifact(artifact);
  assert.equal(validation.status, 'failed');
  assert.ok(validation.diagnostics.some((item) => item.code === 'REPAIR_ATTEMPT_PLAN_PAYLOAD_PROJECTION_MISMATCH'));
});
