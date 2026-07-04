import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildWorkRecordGateRequestFromRepairPlan,
  buildWorkRecordRepairAttemptArtifact,
  planWorkRecordRepair,
  planWorkRecordRepairAttempt,
  validateWorkRecordRepairAttemptArtifact,
  WORK_RECORD_REPAIR_ATTEMPT_ARTIFACT_SCHEMA_VERSION,
  WORK_RECORD_REPAIR_ATTEMPT_ARTIFACT_STATUSES,
} from '../../packages/toolkit/workbench/work-record.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const repairableFixture = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0/valid/repairable-stale-saved-ref.json');

function runAos(args) {
  return spawnSync('./aos', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function writeTempJson(value, prefix = 'aos-work-record-attempt-artifact-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const file = path.join(dir, 'payload.json');
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
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

function readyAttemptPlan() {
  const repairPlan = planWorkRecordRepair(repairableFixture, { repoRoot });
  const request = buildWorkRecordGateRequestFromRepairPlan(repairPlan);
  return planWorkRecordRepairAttempt(repairableFixture, {
    repoRoot,
    gateOutcome: approvedRecord(request),
  });
}

function evidenceRequirementIds(plan) {
  return [...new Set(plan.planned_operations
    .flatMap((operation) => operation.evidence_requirement_refs || [])
    .filter(Boolean))]
    .sort();
}

function successInput(overrides = {}) {
  const plan = readyAttemptPlan();
  const evidenceIds = evidenceRequirementIds(plan);
  const operationOutcomes = plan.planned_operations.map((operation, index) => ({
    id: `operation-outcome:${index + 1}`,
    planned_operation_id: operation.id,
    kind: operation.kind,
    status: operation.mutates_state ? 'succeeded' : 'skipped',
    started_at: '2026-07-04T00:00:00.000Z',
    finished_at: '2026-07-04T00:00:01.000Z',
    mutated_state: operation.mutates_state,
    target_boundary: operation.target_boundary,
    authorization_ref: operation.authorization_ref,
    evidence_ref_ids: operation.evidence_requirement_refs || [],
    cleanup_required: operation.mutates_state,
    rollback_required: false,
  }));
  return {
    status: 'succeeded',
    repair_attempt_plan: plan,
    operation_outcomes: operationOutcomes,
    candidate_patch_outcomes: [{
      id: 'candidate-patch-outcome:execution-map-refs',
      candidate_patch_id: 'candidate_patch:execution_map_refs',
      status: 'applied',
      applied: true,
      evidence_ref_ids: ['evidence_requirement:patch:candidate_patch:execution_map_refs'],
    }],
    recommended_command_outcomes: plan.recommended_commands.map((command, index) => ({
      id: `recommended-command-outcome:${index + 1}`,
      command_ref: command.command,
      status: 'skipped',
      executed: false,
    })),
    evidence_refs: evidenceIds.map((id) => ({ id, uri: `artifact:${id}.json`, digest: `digest:${id}` })),
    verifier_before: { status: 'failed', health_verdict: 'repairable' },
    verifier_after: { status: 'passed', health_verdict: 'valid' },
    postcondition_results: plan.postconditions.map((postcondition) => ({
      id: `postcondition-result:${postcondition.id}`,
      postcondition_id: postcondition.id,
      status: 'passed',
      evidence_ref_ids: evidenceIds,
    })),
    cleanup_results: operationOutcomes
      .filter((outcome) => outcome.cleanup_required)
      .map((outcome) => ({
        id: `cleanup:${outcome.id}`,
        operation_outcome_id: outcome.id,
        status: 'passed',
        evidence_ref_ids: outcome.evidence_ref_ids,
      })),
    rollback_results: [],
    source_work_record_mutation_check: {
      status: 'passed',
      before_digest: 'source-before',
      after_digest: 'source-before',
    },
    ...overrides,
  };
}

function assertValid(artifact) {
  const validation = validateWorkRecordRepairAttemptArtifact(artifact);
  assert.equal(validation.status, 'passed', JSON.stringify(validation.diagnostics, null, 2));
  assert.equal(validation.read_only, true);
  assert.equal(validation.mutates_state, false);
  assert.equal(validation.executes_repair, false);
  assert.equal(validation.executes_actions, false);
  assert.equal(validation.applies_patches, false);
  assert.equal(validation.automatic_replay_allowed, false);
}

function assertInvalid(artifact, code) {
  const validation = validateWorkRecordRepairAttemptArtifact(artifact);
  assert.equal(validation.status, 'failed');
  assert.ok(validation.diagnostics.some((diagnostic) => diagnostic.code === code), JSON.stringify(validation.diagnostics, null, 2));
}

test('fixture builder emits deterministic non-executing Repair Attempt Artifact V0', () => {
  const input = successInput();
  const first = buildWorkRecordRepairAttemptArtifact(input);
  const second = buildWorkRecordRepairAttemptArtifact(input);

  assert.deepEqual(first, second);
  assert.equal(first.type, 'work_record.repair_attempt_artifact');
  assert.equal(first.schema_version, WORK_RECORD_REPAIR_ATTEMPT_ARTIFACT_SCHEMA_VERSION);
  assert.equal(first.status, 'succeeded');
  assert.equal(first.source_work_record_mutated, false);
  assert.equal(first.rewrites_historical_evidence, false);
  assert.equal(first.automatic_replay_allowed, false);
  assert.equal(first.executor_implemented, false);
  assert.equal(first.executor.implemented, false);
  assert.equal(first.final_health.derived_from, 'verifier_after');
  assert.equal(first.final_health.classification, 'valid');
  assert.ok(first.attempt_artifact_identity.id.startsWith('work-record-repair-attempt-artifact:'));
  assertValid(first);
});

test('supported terminal and failure statuses validate when evidence semantics match the status', () => {
  for (const status of WORK_RECORD_REPAIR_ATTEMPT_ARTIFACT_STATUSES) {
    const input = successInput({ status });
    if (status === 'failed') input.operation_outcomes[0].status = 'failed';
    if (status === 'partial') {
      input.operation_outcomes[0].status = 'failed';
      input.operation_outcomes[0].rollback_required = true;
      input.rollback_results = [{
        id: 'rollback:partial',
        operation_outcome_id: input.operation_outcomes[0].id,
        status: 'passed',
      }];
    }
    if (status === 'cleanup_failed') {
      input.operation_outcomes[1].status = 'cleanup_failed';
      input.cleanup_results[0].status = 'failed';
    }
    if (status === 'rollback_failed') {
      input.operation_outcomes[1].status = 'failed';
      input.operation_outcomes[1].rollback_required = true;
      input.rollback_results = [{
        id: 'rollback:failed',
        operation_outcome_id: input.operation_outcomes[1].id,
        status: 'failed',
      }];
    }
    if (['aborted_precondition', 'blocked_authorization', 'blocked_plan_mismatch', 'invalid_artifact', 'unsupported'].includes(status)) {
      input.operation_outcomes = [];
      input.candidate_patch_outcomes = [];
      input.postcondition_results = [];
      input.cleanup_results = [];
      input.verifier_after = null;
    }
    assertValid(buildWorkRecordRepairAttemptArtifact(input));
  }
});

test('validator fails closed for mismatches, missing proof, and optimistic health', () => {
  const base = buildWorkRecordRepairAttemptArtifact(successInput());
  const cases = [
    ['REPAIR_ATTEMPT_PLAN_IDENTITY_MISMATCH', { repair_attempt_plan: { ...base.repair_attempt_plan, digest: 'wrong' } }],
    ['SOURCE_WORK_RECORD_IDENTITY_MISMATCH', { attempt_artifact_identity: { ...base.attempt_artifact_identity, source_work_record: { ...base.attempt_artifact_identity.source_work_record, id: 'work-record:wrong' } } }],
    ['OPERATION_OUTCOME_PLAN_MISMATCH', { operation_outcomes: [{ ...base.operation_outcomes[0], planned_operation_id: 'planned_operation:wrong' }] }],
    ['OPERATION_EVIDENCE_REF_MISSING', { evidence_refs: base.evidence_refs.slice(1) }],
    ['OPTIMISTIC_FINAL_HEALTH_CONTRADICTS_VERIFIER_AFTER', { final_health: { ...base.final_health, classification: 'valid' }, verifier_after: { status: 'failed', health_verdict: 'repairable' } }],
    ['SOURCE_WORK_RECORD_MUTATED_ON_SUCCESS', { source_work_record_mutated: true }],
    ['CANDIDATE_PATCH_APPLIED_WITHOUT_EVIDENCE', { candidate_patch_outcomes: [{ ...base.candidate_patch_outcomes[0], evidence_ref_ids: [] }] }],
    ['RECOMMENDED_COMMAND_EXECUTION_ARTIFACT_MISSING', { recommended_command_outcomes: [{ id: 'command:missing', status: 'executed', executed: true, command_ref: './aos status' }] }],
    ['CLEANUP_FAILED_ON_SUCCESS', { cleanup_results: [{ ...base.cleanup_results[0], status: 'failed' }] }],
    ['ROLLBACK_FAILURE_MUST_FAIL_CLOSED', { status: 'succeeded', rollback_results: [{ id: 'rollback:failed', operation_outcome_id: base.operation_outcomes[0].id, status: 'failed' }] }],
  ];

  for (const [code, patch] of cases) {
    assertInvalid({ ...base, ...patch }, code);
  }
});

test('public attempt-artifact build and validate commands are read-only and non-executing', () => {
  const help = runAos(['help', 'work-record', '--json']);
  assert.equal(help.status, 0, help.stderr);
  const helpJson = JSON.parse(help.stdout);
  for (const id of ['work-record-attempt-artifact-build', 'work-record-attempt-artifact-validate']) {
    const form = helpJson.forms.find((item) => item.id === id);
    assert.ok(form, `${id} should be in help`);
    assert.equal(form.execution.read_only, true);
    assert.equal(form.execution.mutates_state, false);
    assert.equal(form.execution.executes_repair, false);
    assert.equal(form.execution.executes_actions, false);
    assert.equal(form.execution.applies_patches, false);
    assert.equal(form.execution.automatic_replay_allowed, false);
  }

  const before = fs.readFileSync(repairableFixture, 'utf8');
  const inputPath = writeTempJson(successInput(), 'aos-work-record-attempt-artifact-input-');
  const build = runAos(['work-record', 'attempt-artifact', 'build', '--input', inputPath, '--json']);
  assert.equal(build.status, 0, build.stderr);
  const artifact = JSON.parse(build.stdout);
  assert.equal(artifact.type, 'work_record.repair_attempt_artifact');

  const artifactPath = writeTempJson(artifact);
  const validate = runAos(['work-record', 'attempt-artifact', 'validate', artifactPath, '--json']);
  assert.equal(validate.status, 0, validate.stderr);
  assert.equal(JSON.parse(validate.stdout).status, 'passed');
  assert.equal(fs.readFileSync(repairableFixture, 'utf8'), before);
});
