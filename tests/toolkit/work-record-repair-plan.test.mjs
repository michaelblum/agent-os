import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateWorkRecordRepairPlan,
  WORK_RECORD_REPAIR_PLAN_SCHEMA_VERSION,
} from '../../packages/toolkit/workbench/work-record-repair-plan.js';
import { repairPlan } from '../lib/work-record-v1-fixtures.mjs';

test('Repair Plan V1 is a source-bound non-executing mechanical proposal', () => {
  const plan = repairPlan();
  assert.equal(plan.schema_version, WORK_RECORD_REPAIR_PLAN_SCHEMA_VERSION);
  assert.equal(plan.status, 'planned');
  assert.equal(plan.source_work_record.schema_version, '2026-08-work-record-v1');
  assert.ok(plan.source_work_record.digest);
  assert.equal(plan.mutates_source, false);
  assert.equal(plan.executes_actions, false);
  assert.ok(plan.plan_steps.every((step) => step.executes_in_plan === false));
  assert.equal(validateWorkRecordRepairPlan(plan).status, 'passed');
  assert.doesNotMatch(JSON.stringify(plan), /workflow_gate|authorization|approval|required_risk|risk_level|allowlisted|allowed_operations|controlled_fixture|automatic_replay/);
});

test('Repair Plan validation rejects source or execution drift', () => {
  const missingSource = structuredClone(repairPlan());
  delete missingSource.source_work_record.digest;
  assert.equal(validateWorkRecordRepairPlan(missingSource).status, 'failed');
  const executing = structuredClone(repairPlan());
  executing.plan_steps[0].executes_in_plan = true;
  assert.equal(validateWorkRecordRepairPlan(executing).status, 'failed');
  const authorityExtra = structuredClone(repairPlan());
  authorityExtra.approval_required = true;
  assert.equal(validateWorkRecordRepairPlan(authorityExtra).status, 'failed');
  const nestedAuthorityExtra = structuredClone(repairPlan());
  nestedAuthorityExtra.candidate_patches[0].authorization = { status: 'approved' };
  nestedAuthorityExtra.candidate_patches[0].allowed_operations = ['replace_execution_map'];
  assert.equal(validateWorkRecordRepairPlan(nestedAuthorityExtra).status, 'failed');
  const nestedPolicyValue = structuredClone(repairPlan());
  nestedPolicyValue.failure_classes.push({ policy: 'caller-owned' });
  nestedPolicyValue.candidate_patches[0].failure_classes.push({ policy: 'caller-owned' });
  nestedPolicyValue.source_work_record.summary.policy = { decision: 'proceed' };
  assert.equal(validateWorkRecordRepairPlan(nestedPolicyValue).status, 'failed');
});
