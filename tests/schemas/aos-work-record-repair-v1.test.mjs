import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { validateJsonSchema } from '../lib/json-schema-validation.mjs';
import { attemptPlan, repairPlan, repoRoot, successfulAttemptArtifact } from '../lib/work-record-v1-fixtures.mjs';

test('active neutral Repair Plan, Attempt Plan, and Attempt Artifact schemas validate producers', () => {
  const cases = [
    ['shared/schemas/aos-work-record-repair-plan-v1.schema.json', repairPlan()],
    ['shared/schemas/aos-work-record-repair-attempt-plan-v1.schema.json', attemptPlan()],
    ['shared/schemas/aos-work-record-repair-attempt-artifact-v1.schema.json', successfulAttemptArtifact()],
  ];
  for (const [relative, value] of cases) assert.deepEqual(validateJsonSchema(path.join(repoRoot, relative), value), [], relative);
});

test('active repair schemas reject nested authority policy fields in plan mechanics', () => {
  const plan = repairPlan();
  plan.candidate_patches[0].authorization = { status: 'approved' };
  plan.candidate_patches[0].allowed_operations = ['replace_execution_map'];
  assert.notDeepEqual(
    validateJsonSchema(path.join(repoRoot, 'shared/schemas/aos-work-record-repair-plan-v1.schema.json'), plan),
    [],
  );
  const planNestedValues = repairPlan();
  planNestedValues.failure_classes.push({ policy: 'caller-owned' });
  planNestedValues.candidate_patches[0].failure_classes.push({ policy: 'caller-owned' });
  planNestedValues.source_work_record.summary.policy = { decision: 'proceed' };
  assert.notDeepEqual(
    validateJsonSchema(path.join(repoRoot, 'shared/schemas/aos-work-record-repair-plan-v1.schema.json'), planNestedValues),
    [],
  );

  const attempt = attemptPlan();
  attempt.candidate_patches[0].authorization = { status: 'approved' };
  attempt.candidate_patches[0].allowed_operations = ['replace_execution_map'];
  assert.notDeepEqual(
    validateJsonSchema(path.join(repoRoot, 'shared/schemas/aos-work-record-repair-attempt-plan-v1.schema.json'), attempt),
    [],
  );
  const attemptNestedValues = attemptPlan();
  attemptNestedValues.candidate_patches[0].failure_classes.push({ policy: 'caller-owned' });
  attemptNestedValues.source_work_record.summary.policy = { decision: 'proceed' };
  assert.notDeepEqual(
    validateJsonSchema(path.join(repoRoot, 'shared/schemas/aos-work-record-repair-attempt-plan-v1.schema.json'), attemptNestedValues),
    [],
  );
  const attemptPrecondition = attemptPlan();
  attemptPrecondition.preconditions[0].authorization = { status: 'approved' };
  assert.notDeepEqual(
    validateJsonSchema(path.join(repoRoot, 'shared/schemas/aos-work-record-repair-attempt-plan-v1.schema.json'), attemptPrecondition),
    [],
  );

  const artifact = successfulAttemptArtifact();
  artifact.repair_attempt_plan.payload.candidate_patches[0].authorization = { status: 'approved' };
  artifact.planned_candidate_patches[0].authorization = { status: 'approved' };
  assert.notDeepEqual(
    validateJsonSchema(path.join(repoRoot, 'shared/schemas/aos-work-record-repair-attempt-artifact-v1.schema.json'), artifact),
    [],
  );
  const artifactNestedValues = successfulAttemptArtifact();
  artifactNestedValues.planned_candidate_patches[0].failure_classes.push({ policy: 'caller-owned' });
  artifactNestedValues.source_work_record.summary.policy = { decision: 'proceed' };
  artifactNestedValues.operation_outcomes[0].policy = { decision: 'proceed' };
  assert.notDeepEqual(
    validateJsonSchema(path.join(repoRoot, 'shared/schemas/aos-work-record-repair-attempt-artifact-v1.schema.json'), artifactNestedValues),
    [],
  );
  const artifactOutcomeValues = successfulAttemptArtifact();
  artifactOutcomeValues.operation_outcomes[0].policy = { decision: 'proceed' };
  assert.notDeepEqual(
    validateJsonSchema(path.join(repoRoot, 'shared/schemas/aos-work-record-repair-attempt-artifact-v1.schema.json'), artifactOutcomeValues),
    [],
  );
});
