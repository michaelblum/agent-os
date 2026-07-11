import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildWorkRecordGateRequestFromRepairPlan,
  planWorkRecordRepair,
  planWorkRecordRepairAttempt,
  validateWorkRecordRepairAttemptPlan,
  WORK_RECORD_REPAIR_ATTEMPT_PLAN_SCHEMA_VERSION,
} from '../../packages/toolkit/workbench/work-record.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0/valid');
const repairableFixture = path.join(fixtureRoot, 'repairable-stale-saved-ref.json');
const validFixture = path.join(fixtureRoot, 'workflow-origin.json');

function runAos(args) {
  return spawnSync('./aos', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function approvedRecord(request, response = { authorization: 'approve' }) {
  return {
    schema_version: 'aos.gate.record.v1',
    gate_id: request.gate_request.id,
    request_schema_version: 'aos.gate.request.v1',
    prompt_title: request.gate_request.prompt.title,
    source: { surface: 'work_record.repair_plan', session_id: null, agent: null },
    receptor: 'test',
    ui_variant: 'approve_deny',
    field_kinds: ['exclusive_choice'],
    timeout_ms: 0,
    created_at: '2026-07-04T00:00:00.000Z',
    presented_at: '2026-07-04T00:00:00.000Z',
    resolved_at: '2026-07-04T00:00:01.000Z',
    elapsed_ms: 1000,
    resolution: 'answered',
    status: null,
    response_stored: true,
    response,
  };
}

function assertNonExecutingAttempt(plan) {
  assert.equal(plan.type, 'work_record.repair_attempt_plan');
  assert.equal(plan.schema_version, WORK_RECORD_REPAIR_ATTEMPT_PLAN_SCHEMA_VERSION);
  assert.equal(plan.executes_repair, false);
  assert.equal(plan.executes_actions, false);
  assert.equal(plan.applies_patches, false);
  assert.equal(plan.mutates_record, false);
  assert.equal(plan.automatic_replay_allowed, false);
  assert.equal(validateWorkRecordRepairAttemptPlan(plan).status, 'passed');
  assert.ok(plan.planned_operations.every((operation) => operation.executes_in_plan === false));
  assert.ok(plan.candidate_patches.every((patch) => patch.applied === false));
  assert.ok(plan.recommended_commands.every((command) => command.executes_in_plan === false));
}

test('valid Work Record produces not_required Repair Attempt Plan without executable-style mutation', () => {
  const before = fs.readFileSync(validFixture, 'utf8');
  const attempt = planWorkRecordRepairAttempt(validFixture, { repoRoot });

  assert.equal(attempt.status, 'not_required');
  assert.equal(attempt.workflow_gate_authorizations.length, 0);
  assert.equal(attempt.attempt_identity.source_work_record.id, 'work-record:workflow-open-wiki-runtime-modes-2026-05-05');
  assert.equal(attempt.recommended_next.action, 'no_future_repair_attempt_required');
  assertNonExecutingAttempt(attempt);
  assert.equal(fs.readFileSync(validFixture, 'utf8'), before);
});

test('repairable Work Record without authorization fails closed and names future attempt requirements', () => {
  const before = fs.readFileSync(repairableFixture, 'utf8');
  const attempt = planWorkRecordRepairAttempt(repairableFixture, { repoRoot });

  assert.equal(attempt.status, 'blocked_authorization_required');
  assert.equal(attempt.repair_plan.schema_version, '2026-07-work-record-repair-plan-v0');
  assert.ok(attempt.repair_plan.digest);
  assert.ok(attempt.attempt_identity.attempt_id.startsWith('work-record-repair-attempt:'));
  assert.ok(attempt.planned_operations.some((operation) => (
    operation.source_candidate_patch_id === 'candidate_patch:execution_map_refs'
    && operation.requires_workflow_gate === true
    && operation.authorization_status === 'missing'
    && operation.executes_in_plan === false
  )));
  assert.ok(attempt.preconditions.some((precondition) => precondition.id === 'precondition:authorization-matches-current-plan'));
  assert.ok(attempt.evidence_requirements.some((requirement) => requirement.id === 'evidence_requirement:new-work-record-or-patch-artifact'));
  assert.ok(attempt.postconditions.some((postcondition) => postcondition.id === 'postcondition:source-work-record-unchanged'));
  assert.ok(attempt.cleanup_expectations.length > 0);
  assert.ok(attempt.rollback_expectations.length > 0);
  assertNonExecutingAttempt(attempt);
  assert.equal(fs.readFileSync(repairableFixture, 'utf8'), before);
});

test('matching authorization makes attempt ready without claiming repair execution', () => {
  const repairPlan = planWorkRecordRepair(repairableFixture, { repoRoot });
  const request = buildWorkRecordGateRequestFromRepairPlan(repairPlan);
  const attempt = planWorkRecordRepairAttempt(repairableFixture, {
    repoRoot,
    gateOutcome: approvedRecord(request),
  });

  assert.equal(attempt.status, 'ready');
  assert.equal(attempt.workflow_gate_authorizations[0].status, 'authorized');
  assert.equal(attempt.workflow_gate_authorizations[0].authorizes_future_attempt, true);
  assert.equal(attempt.recommended_next.action, 'hand_to_future_explicit_executor');
  assert.match(attempt.recommended_next.note, /future explicit executor/);
  assert.ok(attempt.planned_operations
    .filter((operation) => operation.requires_workflow_gate)
    .every((operation) => operation.authorization_status === 'authorized'));
  const executableOperation = attempt.planned_operations.find((operation) => operation.allowlisted_operation_id);
  assert.equal(executableOperation.source_candidate_patch_id, 'candidate_patch:execution_map_refs');
  assert.equal(executableOperation.allowlisted_operation_id, 'controlled_fixture.write_success');
  assert.equal(executableOperation.controlled_repair_executor.allowlisted_operation_id, 'controlled_fixture.write_success');
  assert.equal(executableOperation.controlled_repair_executor.registry_kind, 'controlled_repair_fixture_registry');
  assert.equal(executableOperation.command, undefined);
  assert.equal(executableOperation.argv, undefined);
  assertNonExecutingAttempt(attempt);
});

test('attempt plan copies executor provenance from candidate metadata instead of patch id', () => {
  const repairPlan = planWorkRecordRepair(repairableFixture, { repoRoot });
  assert.equal(
    repairPlan.candidate_patches[0].controlled_repair_executor.allowlisted_operation_id,
    'controlled_fixture.write_success',
  );

  const renamedPlan = JSON.parse(JSON.stringify(repairPlan));
  renamedPlan.candidate_patches[0].id = 'candidate_patch:renamed_execution_map_refs';
  const renamedAttempt = planWorkRecordRepairAttempt(repairableFixture, {
    repoRoot,
    repairPlan: renamedPlan,
  });
  const renamedOperation = renamedAttempt.planned_operations.find((operation) => (
    operation.source_candidate_patch_id === 'candidate_patch:renamed_execution_map_refs'
  ));
  assert.equal(renamedOperation.allowlisted_operation_id, 'controlled_fixture.write_success');
  assert.equal(renamedOperation.controlled_repair_executor.registry_kind, 'controlled_repair_fixture_registry');

  const missingMetadataPlan = JSON.parse(JSON.stringify(repairPlan));
  delete missingMetadataPlan.candidate_patches[0].controlled_repair_executor;
  const missingMetadataAttempt = planWorkRecordRepairAttempt(repairableFixture, {
    repoRoot,
    repairPlan: missingMetadataPlan,
  });
  const originalIdOperation = missingMetadataAttempt.planned_operations.find((operation) => (
    operation.source_candidate_patch_id === 'candidate_patch:execution_map_refs'
  ));
  assert.equal(originalIdOperation.allowlisted_operation_id, undefined);
  assert.equal(originalIdOperation.controlled_repair_executor, undefined);

  const source = fs.readFileSync(
    path.join(repoRoot, 'packages/toolkit/workbench/work-record-repair-attempt-plan.js'),
    'utf8',
  );
  assert.equal(source.includes('candidate_patch:execution_map_refs'), false);
});

test('denied, timeout, insufficient, stale, mismatch, and unsupported authorization inputs fail closed', () => {
  const repairPlan = planWorkRecordRepair(repairableFixture, { repoRoot });
  const request = buildWorkRecordGateRequestFromRepairPlan(repairPlan);
  const cases = [
    {
      name: 'denied',
      authorizationInput: { gateOutcome: approvedRecord(request, { authorization: 'deny' }) },
      status: 'blocked_authorization_denied',
    },
    {
      name: 'timeout',
      authorizationInput: { gateOutcome: { ...approvedRecord(request), resolution: 'timeout', status: 'timeout', response_stored: false } },
      status: 'blocked_authorization_denied',
    },
    {
      name: 'insufficient',
      authorizationInput: { gateOutcome: { ...approvedRecord(request), response_stored: false } },
      status: 'blocked_authorization_insufficient',
    },
    {
      name: 'stale',
      authorizationInput: { gateOutcome: { ...approvedRecord(request), gate_id: 'work-record-gate:aaaaaaaaaaaaaaaaaaaaaaaa' } },
      status: 'stale',
    },
    {
      name: 'mismatch',
      authorizationInput: { gateOutcome: { ...approvedRecord(request), gate_id: 'gate:wrong' } },
      status: 'mismatch',
    },
    {
      name: 'unsupported',
      authorizationInput: { authorization: { type: 'wrong', schema_version: 'unknown', status: 'authorized' } },
      status: 'unsupported',
    },
    {
      name: 'missing repair plan identity',
      authorizationInput: {
        authorization: {
          type: 'work_record.workflow_gate_authorization',
          schema_version: '2026-07-work-record-workflow-gate-authorization-v0',
          status: 'authorized',
          source_work_record: repairPlan.source_work_record,
          repair_plan: {},
          workflow_gate: { id: 'workflow_gate_required:repair_work_record_execution_map' },
        },
      },
      status: 'blocked_authorization_insufficient',
    },
    {
      name: 'not required authorization against gated plan',
      authorizationInput: {
        authorization: {
          type: 'work_record.workflow_gate_authorization',
          schema_version: '2026-07-work-record-workflow-gate-authorization-v0',
          status: 'not_required',
          source_work_record: repairPlan.source_work_record,
          repair_plan: { digest: request.repair_plan.digest },
          workflow_gate: { id: 'workflow_gate_required:repair_work_record_execution_map' },
        },
      },
      status: 'mismatch',
    },
  ];

  for (const item of cases) {
    const attempt = planWorkRecordRepairAttempt(repairableFixture, {
      repoRoot,
      ...item.authorizationInput,
    });
    assert.equal(attempt.status, item.status, item.name);
    assert.equal(attempt.executes_repair, false);
    assert.equal(attempt.applies_patches, false);
    assertNonExecutingAttempt(attempt);
  }
});

test('aos work-record plan-attempt exposes read-only public JSON and accepts authorization files', () => {
  const help = runAos(['help', 'work-record', '--json']);
  assert.equal(help.status, 0, help.stderr);
  const helpJson = JSON.parse(help.stdout);
  const form = helpJson.forms.find((item) => item.id === 'work-record-plan-attempt');
  assert.ok(form, 'help should expose work-record-plan-attempt');
  assert.equal(form.execution.read_only, true);
  assert.equal(form.execution.mutates_state, false);
  assert.equal(form.execution.executes_repair, false);
  assert.equal(form.execution.executes_actions, false);
  assert.equal(form.execution.applies_patches, false);
  assert.equal(form.execution.automatic_replay_allowed, false);

  const before = fs.readFileSync(repairableFixture, 'utf8');
  const blockedResult = runAos(['work-record', 'plan-attempt', repairableFixture, '--json']);
  assert.equal(blockedResult.status, 0, blockedResult.stderr);
  const blocked = JSON.parse(blockedResult.stdout);
  assert.equal(blocked.status, 'blocked_authorization_required');
  assert.equal(blocked.executes_repair, false);

  const repairPlan = planWorkRecordRepair(repairableFixture, { repoRoot });
  const request = buildWorkRecordGateRequestFromRepairPlan(repairPlan);
  const readyFromGate = runAos([
    'work-record',
    'plan-attempt',
    repairableFixture,
    '--gate-record',
    writeTempJson(approvedRecord(request)),
    '--json',
  ]);
  assert.equal(readyFromGate.status, 0, readyFromGate.stderr);
  const readyFromGateJson = JSON.parse(readyFromGate.stdout);
  assert.equal(readyFromGateJson.status, 'ready');
  assert.ok(readyFromGateJson.planned_operations.some((operation) => (
    operation.allowlisted_operation_id === 'controlled_fixture.write_success'
    && operation.executes_in_plan === false
  )));

  const authorizationPath = writeTempJson(JSON.parse(runAos([
    'work-record',
    'gate-check',
    repairableFixture,
    '--gate-record',
    writeTempJson(approvedRecord(request)),
    '--json',
  ]).stdout));
  const readyFromAuthorization = runAos([
    'work-record',
    'plan-attempt',
    repairableFixture,
    '--authorization',
    authorizationPath,
    '--json',
  ]);
  assert.equal(readyFromAuthorization.status, 0, readyFromAuthorization.stderr);
  assert.equal(JSON.parse(readyFromAuthorization.stdout).status, 'ready');
  assert.equal(fs.readFileSync(repairableFixture, 'utf8'), before);
});

function writeTempJson(value) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-attempt-plan-'));
  const file = path.join(dir, 'payload.json');
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}
