import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildWorkRecordGateRequestFromRepairPlan,
  executeControlledWorkRecordRepair,
  planWorkRecordRepair,
  planWorkRecordRepairAttempt,
  validateWorkRecordRepairAttemptArtifact,
  WORK_RECORD_CONTROLLED_REPAIR_EXECUTOR_RESULT_SCHEMA_VERSION,
} from '../../packages/toolkit/workbench/work-record.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const repairableFixture = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0/valid/repairable-stale-saved-ref.json');

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

function readyAttemptPlan(allowlistedOperationId = 'controlled_fixture.write_success', operationPatch = {}) {
  const repairPlan = planWorkRecordRepair(repairableFixture, { repoRoot });
  const request = buildWorkRecordGateRequestFromRepairPlan(repairPlan);
  const plan = planWorkRecordRepairAttempt(repairableFixture, {
    repoRoot,
    gateOutcome: approvedRecord(request),
  });
  const operationIndex = plan.planned_operations.findIndex((operation) => operation.mutates_state === true);
  plan.planned_operations[operationIndex] = {
    ...plan.planned_operations[operationIndex],
    allowlisted_operation_id: allowlistedOperationId,
    ...operationPatch,
  };
  return plan;
}

function writeJson(value, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-controlled-repair-plan-'))) {
  const file = path.join(dir, 'plan.json');
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function roots() {
  const executionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-controlled-repair-exec-'));
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-controlled-repair-artifacts-'));
  fs.writeFileSync(path.join(executionRoot, 'input.txt'), 'before\n');
  return { executionRoot, artifactRoot };
}

async function run(plan, options = {}) {
  const rootSet = roots();
  return executeControlledWorkRecordRepair({
    attemptPlanPath: writeJson(plan),
    executionRoot: rootSet.executionRoot,
    artifactRoot: rootSet.artifactRoot,
    repoRoot,
    ...options,
  });
}

function executedOutcome(result) {
  return result.operation_outcomes.find((outcome) => outcome.command);
}

function runAos(args) {
  return spawnSync('./aos', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

test('dry-run reports exact allowlisted command and writes no side effects', async () => {
  const plan = readyAttemptPlan();
  const sourceBefore = fs.readFileSync(repairableFixture, 'utf8');
  const rootSet = roots();
  const result = await executeControlledWorkRecordRepair({
    attemptPlanPath: writeJson(plan),
    executionRoot: rootSet.executionRoot,
    artifactRoot: rootSet.artifactRoot,
    repoRoot,
    dryRun: true,
  });

  assert.equal(result.type, 'work_record.controlled_repair_executor_result');
  assert.equal(result.schema_version, WORK_RECORD_CONTROLLED_REPAIR_EXECUTOR_RESULT_SCHEMA_VERSION);
  assert.equal(result.status, 'dry_run');
  assert.equal(result.executes_repair, false);
  assert.equal(result.would_execute_repair, true);
  assert.equal(result.mutates_source_record, false);
  assert.equal(result.execution.allowlisted_operation_id, 'controlled_fixture.write_success');
  assert.equal(result.execution.argv[0], process.execPath);
  assert.match(result.execution.argv.join(' '), /work-record-fixture-operation\.mjs/);
  assert.equal(result.execution.execution_root, fs.realpathSync(rootSet.executionRoot));
  assert.ok(result.execution.artifact_path.endsWith('.json'));
  assert.deepEqual(result.side_effects, []);
  assert.equal(fs.existsSync(path.join(rootSet.executionRoot, 'output/result.txt')), false);
  assert.deepEqual(fs.readdirSync(rootSet.artifactRoot), []);
  assert.equal(fs.readFileSync(repairableFixture, 'utf8'), sourceBefore);
});

test('non-ready, missing authorization, unsupported live surface, unsafe command, and unknown allowlist fail closed', async () => {
  const blocked = await run(planWorkRecordRepairAttempt(repairableFixture, { repoRoot }));
  assert.equal(blocked.status, 'blocked_plan_not_ready');

  const missingAuthorization = readyAttemptPlan();
  missingAuthorization.workflow_gate_authorizations = [];
  const missingAuthResult = await run(missingAuthorization);
  assert.equal(missingAuthResult.status, 'blocked_authorization');

  const live = readyAttemptPlan('controlled_fixture.write_success', { kind: 'browser_canvas_click' });
  const liveResult = await run(live);
  assert.equal(liveResult.status, 'blocked_unsupported_operation');

  const unsafe = readyAttemptPlan('controlled_fixture.write_success', { command: 'sh -c "echo unsafe"' });
  const unsafeResult = await run(unsafe);
  assert.equal(unsafeResult.status, 'blocked_unsafe_command');

  const unknown = readyAttemptPlan('controlled_fixture.unknown');
  const unknownResult = await run(unknown);
  assert.equal(unknownResult.status, 'blocked_unsupported_operation');
});

test('path traversal and symlink escape are rejected before execution', async () => {
  const plan = readyAttemptPlan();
  const rootSet = roots();
  const traversal = await executeControlledWorkRecordRepair({
    attemptPlanPath: writeJson(plan),
    executionRoot: `${rootSet.executionRoot}/../${path.basename(rootSet.executionRoot)}`,
    artifactRoot: rootSet.artifactRoot,
    repoRoot,
  });
  assert.equal(traversal.status, 'blocked_workspace_escape');

  fs.mkdirSync(path.join(rootSet.executionRoot, 'output'), { recursive: true });
  fs.symlinkSync(os.tmpdir(), path.join(rootSet.executionRoot, 'output/result.txt'));
  const escape = await executeControlledWorkRecordRepair({
    attemptPlanPath: writeJson(plan),
    executionRoot: rootSet.executionRoot,
    artifactRoot: rootSet.artifactRoot,
    repoRoot,
  });
  assert.equal(escape.status, 'blocked_workspace_escape');
});

test('successful fixture command writes and validates a Repair Attempt Artifact without mutating source Work Record', async () => {
  const sourceBefore = fs.readFileSync(repairableFixture, 'utf8');
  const rootSet = roots();
  const result = await executeControlledWorkRecordRepair({
    attemptPlanPath: writeJson(readyAttemptPlan()),
    executionRoot: rootSet.executionRoot,
    artifactRoot: rootSet.artifactRoot,
    repoRoot,
  });

  assert.equal(result.status, 'succeeded');
  assert.equal(result.executes_repair, true);
  assert.equal(result.uses_browser, false);
  assert.equal(result.uses_native_ax, false);
  assert.equal(result.uses_canvas, false);
  assert.equal(result.applies_patches, false);
  assert.equal(result.automatic_replay_allowed, false);
  assert.equal(fs.readFileSync(repairableFixture, 'utf8'), sourceBefore);
  assert.equal(fs.existsSync(path.join(rootSet.executionRoot, 'output/result.txt')), true);
  assert.equal(fs.existsSync(result.artifact.path), true);
  const artifact = JSON.parse(fs.readFileSync(result.artifact.path, 'utf8'));
  assert.equal(artifact.type, 'work_record.repair_attempt_artifact');
  assert.equal(artifact.executor.implemented, true);
  assert.equal(artifact.executor.kind, 'controlled_repair_executor');
  assert.equal(artifact.source_work_record_mutated, false);
  assert.equal(validateWorkRecordRepairAttemptArtifact(artifact).status, 'passed');
  assert.equal(result.artifact_validation.status, 'passed');
});

test('failure, timeout, cleanup, and rollback outcomes stay visible', async () => {
  const failed = await run(readyAttemptPlan('controlled_fixture.write_failure'));
  assert.equal(failed.status, 'failed');
  assert.equal(executedOutcome(failed).command.exit_code, 7);
  assert.equal(failed.artifact_validation.status, 'passed');

  const timeout = await run(readyAttemptPlan('controlled_fixture.write_timeout'));
  assert.equal(timeout.status, 'blocked_timeout');
  assert.equal(executedOutcome(timeout).command.timed_out, true);
  assert.equal(timeout.artifact_validation.status, 'passed');

  const cleanupSuccess = await run(readyAttemptPlan('controlled_fixture.cleanup_success'));
  assert.equal(cleanupSuccess.status, 'succeeded');
  assert.equal(cleanupSuccess.artifact_validation.status, 'passed');

  const cleanupFailure = await run(readyAttemptPlan('controlled_fixture.cleanup_failure'));
  assert.equal(cleanupFailure.status, 'cleanup_failed');
  assert.equal(cleanupFailure.artifact_validation.status, 'passed');
  assert.equal(executedOutcome(cleanupFailure).cleanup_required, true);

  const rollbackSuccess = await run(readyAttemptPlan('controlled_fixture.rollback_success'));
  assert.equal(rollbackSuccess.status, 'failed');
  assert.equal(rollbackSuccess.artifact_validation.status, 'passed');
  assert.equal(executedOutcome(rollbackSuccess).rollback_required, true);

  const rollbackFailure = await run(readyAttemptPlan('controlled_fixture.rollback_failure'));
  assert.equal(rollbackFailure.status, 'rollback_failed');
  assert.equal(rollbackFailure.artifact_validation.status, 'passed');
});

test('public repair execute command exposes help, dry-runs, executes, and validates artifact output', () => {
  const help = runAos(['help', 'work-record', '--json']);
  assert.equal(help.status, 0, help.stderr);
  const helpJson = JSON.parse(help.stdout);
  const form = helpJson.forms.find((item) => item.id === 'work-record-repair-execute');
  assert.ok(form, 'help should expose work-record-repair-execute');
  assert.equal(form.execution.supports_dry_run, true);
  assert.equal(form.execution.executes_repair, true);
  assert.equal(form.execution.executes_actions, false);
  assert.equal(form.execution.applies_patches, false);
  assert.equal(form.execution.mutates_source_record, false);
  assert.equal(form.execution.uses_browser, false);
  assert.equal(form.execution.uses_native_ax, false);
  assert.equal(form.execution.uses_canvas, false);
  assert.equal(form.execution.rejects_arbitrary_shell, true);

  const rootSet = roots();
  const planPath = writeJson(readyAttemptPlan());
  const dryRun = runAos([
    'work-record',
    'repair',
    'execute',
    '--attempt-plan',
    planPath,
    '--execution-root',
    rootSet.executionRoot,
    '--artifact-root',
    rootSet.artifactRoot,
    '--dry-run',
    '--json',
  ]);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(JSON.parse(dryRun.stdout).status, 'dry_run');
  assert.deepEqual(fs.readdirSync(rootSet.artifactRoot), []);

  const execute = runAos([
    'work-record',
    'repair',
    'execute',
    '--attempt-plan',
    planPath,
    '--execution-root',
    rootSet.executionRoot,
    '--artifact-root',
    rootSet.artifactRoot,
    '--json',
  ]);
  assert.equal(execute.status, 0, execute.stderr);
  const result = JSON.parse(execute.stdout);
  assert.equal(result.status, 'succeeded');
  assert.equal(fs.existsSync(result.artifact.path), true);

  const validate = runAos([
    'work-record',
    'attempt-artifact',
    'validate',
    result.artifact.path,
    '--json',
  ]);
  assert.equal(validate.status, 0, validate.stderr);
  assert.equal(JSON.parse(validate.stdout).status, 'passed');
});
