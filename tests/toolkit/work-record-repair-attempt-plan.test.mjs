import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planWorkRecordRepairAttempt,
  validateWorkRecordRepairAttemptPlan,
  WORK_RECORD_REPAIR_ATTEMPT_PLAN_SCHEMA_VERSION,
} from '../../packages/toolkit/workbench/work-record-repair-attempt-plan.js';
import { attemptPlan, repairPlan, repairableWorkRecordPath, repoRoot } from '../lib/work-record-v1-fixtures.mjs';

test('Attempt Plan V1 ready means exact proposal completeness, not authority', () => {
  const plan = attemptPlan();
  assert.equal(plan.schema_version, WORK_RECORD_REPAIR_ATTEMPT_PLAN_SCHEMA_VERSION);
  assert.equal(plan.status, 'ready');
  assert.ok(plan.attempt_identity.attempt_id);
  assert.ok(plan.attempt_identity.digest);
  for (const flag of ['executes_repair', 'executes_actions', 'applies_patches', 'mutates_source']) assert.equal(plan[flag], false);
  assert.ok(plan.planned_operations.every((operation) => operation.executes_in_plan === false));
  assert.equal(validateWorkRecordRepairAttemptPlan(plan).status, 'passed');
  assert.doesNotMatch(JSON.stringify(plan), /workflow_gate|authorization|approval|required_risk|risk_level|allowlisted|allowed_operations|controlled_fixture|automatic_replay/);
});

test('Gate-shaped extra input cannot change Attempt Plan identity or status', () => {
  const sourcePlan = repairPlan();
  const baseline = planWorkRecordRepairAttempt(repairableWorkRecordPath, { repoRoot, repairPlan: sourcePlan });
  const withUnrecognizedInput = planWorkRecordRepairAttempt(repairableWorkRecordPath, {
    repoRoot,
    repairPlan: sourcePlan,
    gateOutcome: { decision: 'approve' },
    authorization: { status: 'authorized' },
  });
  assert.deepEqual(withUnrecognizedInput, baseline);
});

test('planned Repair Plans without one exact patch remain blocked, not ready', () => {
  const sourcePlan = structuredClone(repairPlan());
  sourcePlan.candidate_patches = [];
  const plan = planWorkRecordRepairAttempt(repairableWorkRecordPath, { repoRoot, repairPlan: sourcePlan });
  assert.equal(plan.status, 'blocked_inputs');
  assert.equal(validateWorkRecordRepairAttemptPlan(plan).status, 'passed');
  assert.ok(plan.diagnostics.some((item) => item.code === 'REPAIR_ATTEMPT_PLAN_CANDIDATE_PATCH_MISSING'));
});

test('Attempt Plan validation rejects execution or source drift', () => {
  const plan = structuredClone(attemptPlan());
  plan.executes_actions = true;
  assert.equal(validateWorkRecordRepairAttemptPlan(plan).status, 'failed');
  const missing = structuredClone(attemptPlan());
  delete missing.source_work_record.digest;
  assert.equal(validateWorkRecordRepairAttemptPlan(missing).status, 'failed');
  const staleAttemptIdentity = structuredClone(attemptPlan());
  staleAttemptIdentity.attempt_identity.digest = 'stale';
  assert.equal(validateWorkRecordRepairAttemptPlan(staleAttemptIdentity).status, 'failed');
  const staleRepairPlanIdentity = structuredClone(attemptPlan());
  staleRepairPlanIdentity.repair_plan.identity.digest = 'stale';
  assert.equal(validateWorkRecordRepairAttemptPlan(staleRepairPlanIdentity).status, 'failed');
  const incompleteReady = structuredClone(attemptPlan());
  incompleteReady.preconditions = [];
  assert.equal(validateWorkRecordRepairAttemptPlan(incompleteReady).status, 'failed');
  const authorityExtra = structuredClone(attemptPlan());
  authorityExtra.workflow_gate = { authorization: 'approved', allowed_operations: ['mutation'] };
  assert.equal(validateWorkRecordRepairAttemptPlan(authorityExtra).status, 'failed');
  const nestedAuthorityExtra = structuredClone(attemptPlan());
  nestedAuthorityExtra.candidate_patches[0].authorization = { status: 'approved' };
  nestedAuthorityExtra.candidate_patches[0].allowed_operations = ['replace_execution_map'];
  assert.equal(validateWorkRecordRepairAttemptPlan(nestedAuthorityExtra).status, 'failed');
  const preconditionAuthorityExtra = structuredClone(attemptPlan());
  preconditionAuthorityExtra.preconditions[0].authorization = { status: 'approved' };
  assert.equal(validateWorkRecordRepairAttemptPlan(preconditionAuthorityExtra).status, 'failed');
  const nestedPolicyValue = structuredClone(attemptPlan());
  nestedPolicyValue.candidate_patches[0].failure_classes.push({ policy: 'caller-owned' });
  nestedPolicyValue.source_work_record.summary.policy = { decision: 'proceed' };
  assert.equal(validateWorkRecordRepairAttemptPlan(nestedPolicyValue).status, 'failed');
  const failedExtraPrecondition = structuredClone(attemptPlan());
  failedExtraPrecondition.preconditions.push({ id: 'precondition:external-prerequisite', status: 'failed' });
  assert.equal(validateWorkRecordRepairAttemptPlan(failedExtraPrecondition).status, 'failed');
  const duplicatePrecondition = structuredClone(attemptPlan());
  duplicatePrecondition.preconditions.unshift({ ...duplicatePrecondition.preconditions[0], status: 'failed' });
  assert.equal(validateWorkRecordRepairAttemptPlan(duplicatePrecondition).status, 'failed');

  const inventedPatch = structuredClone(attemptPlan());
  inventedPatch.candidate_patches.unshift({
    ...structuredClone(inventedPatch.candidate_patches[0]),
    id: 'candidate_patch:unplanned-replace-all',
    target: 'everything',
  });
  inventedPatch.attempt_identity = structuredClone(inventedPatch.attempt_identity);
  inventedPatch.attempt_identity.candidate_patch_ids = inventedPatch.candidate_patches.map((item) => item.id).sort();
  const inventedPatchValidation = validateWorkRecordRepairAttemptPlan(inventedPatch);
  assert.equal(inventedPatchValidation.status, 'failed');
  assert.ok(inventedPatchValidation.diagnostics.some((item) => item.code === 'REPAIR_ATTEMPT_PLAN_CANDIDATE_PATCH_IDENTITY_MISMATCH'));

  const reorderedOperation = structuredClone(attemptPlan());
  reorderedOperation.planned_operations.reverse();
  assert.ok(validateWorkRecordRepairAttemptPlan(reorderedOperation).diagnostics
    .some((item) => item.code === 'REPAIR_ATTEMPT_PLAN_OPERATION_IDENTITY_MISMATCH'));

  const substitutedPatchPayload = structuredClone(attemptPlan());
  substitutedPatchPayload.candidate_patches[0].target = 'everything';
  assert.ok(validateWorkRecordRepairAttemptPlan(substitutedPatchPayload).diagnostics
    .some((item) => item.code === 'REPAIR_ATTEMPT_PLAN_CANDIDATE_PATCH_PAYLOAD_MISMATCH'));

  for (const mutate of [
    (operation) => { operation.target_boundary = 'unbound-caller-boundary'; },
    (operation) => { operation.precondition_refs = ['precondition:source-work-record-bound']; },
    (operation) => { operation.evidence_requirement_refs = ['evidence_requirement:attempt-artifact']; },
    (operation) => { operation.postcondition_refs = ['postcondition:source-work-record-unchanged', 'postcondition:attempt-artifact-validates']; },
    (operation) => { operation.cleanup_refs = ['cleanup_expectation:unplanned']; },
    (operation) => { operation.rollback_refs = ['rollback_expectation:unplanned']; },
  ]) {
    const noncanonicalMechanics = structuredClone(attemptPlan());
    mutate(noncanonicalMechanics.planned_operations[0]);
    assert.ok(validateWorkRecordRepairAttemptPlan(noncanonicalMechanics).diagnostics
      .some((item) => item.code === 'REPAIR_ATTEMPT_PLAN_OPERATION_MECHANICS_NONCANONICAL'));
  }
});
