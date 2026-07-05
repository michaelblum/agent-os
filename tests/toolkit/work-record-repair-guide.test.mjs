import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  buildWorkRecordGateRequestFromRepairPlan,
  buildWorkRecordRepairAttemptArtifact,
  finalizeWorkRecordRepair,
  guideWorkRecordRepair,
  planWorkRecordRepair,
  planWorkRecordRepairAttempt,
  WORK_RECORD_REPAIR_GUIDE_SCHEMA_VERSION,
  WORK_RECORD_REPAIR_GUIDE_STAGES,
  WORK_RECORD_REPAIR_GUIDE_TYPE,
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

function digestFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeTempJson(value, prefix = 'aos-work-record-repair-guide-') {
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

function gateRecord(response = { authorization: 'approve' }) {
  const repairPlan = planWorkRecordRepair(repairableFixture, { repoRoot });
  const request = buildWorkRecordGateRequestFromRepairPlan(repairPlan);
  return approvedRecord(request, response);
}

function readyAttemptPlan() {
  return planWorkRecordRepairAttempt(repairableFixture, {
    repoRoot,
    gateOutcome: gateRecord(),
  });
}

function evidenceRequirementIds(plan) {
  return [...new Set([
    ...plan.planned_operations.flatMap((operation) => operation.evidence_requirement_refs || []),
    ...plan.evidence_requirements
      .filter((requirement) => requirement.required === true)
      .map((requirement) => requirement.id),
  ].filter(Boolean))].sort();
}

function artifactInput({ status = 'succeeded' } = {}) {
  const plan = readyAttemptPlan();
  const evidenceIds = evidenceRequirementIds(plan);
  const operationOutcomes = plan.planned_operations.map((operation, index) => ({
    id: `operation-outcome:${index + 1}`,
    planned_operation_id: operation.id,
    kind: operation.kind,
    status: operation.mutates_state ? (status === 'succeeded' ? 'succeeded' : status) : 'skipped',
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
    status,
    repair_attempt_plan: plan,
    operation_outcomes: operationOutcomes,
    candidate_patch_outcomes: [{
      id: 'candidate-patch-outcome:execution-map-refs',
      candidate_patch_id: 'candidate_patch:execution_map_refs',
      status: status === 'succeeded' ? 'applied' : 'failed',
      applied: status === 'succeeded',
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
    verifier_after: status === 'succeeded' ? { status: 'passed', health_verdict: 'valid' } : null,
    postcondition_results: plan.postconditions.map((postcondition) => ({
      id: `postcondition-result:${postcondition.id}`,
      postcondition_id: postcondition.id,
      status: status === 'succeeded' ? 'passed' : 'failed',
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
      before_digest: digestFile(repairableFixture),
      after_digest: digestFile(repairableFixture),
    },
  };
}

function writeAttemptInputs(input = artifactInput()) {
  const planPath = writeTempJson(input.repair_attempt_plan, 'aos-work-record-guide-plan-');
  const artifact = buildWorkRecordRepairAttemptArtifact(input);
  const artifactPath = writeTempJson(artifact, 'aos-work-record-guide-artifact-');
  return { planPath, artifactPath, artifact };
}

function assertGuideEnvelope(report) {
  assert.equal(report.type, WORK_RECORD_REPAIR_GUIDE_TYPE);
  assert.equal(report.schema_version, WORK_RECORD_REPAIR_GUIDE_SCHEMA_VERSION);
  assert.equal(report.status, 'success');
  assert.equal(report.mutates_record, false);
  assert.equal(report.writes_replacement_record, false);
  assert.equal(report.writes_supersession_index_entry, false);
  assert.equal(report.executes_repair, false);
  assert.equal(report.executes_actions, false);
  assert.equal(report.runs_recommended_commands, false);
  assert.equal(report.applies_patches, false);
  assert.equal(report.uses_live_ui, false);
  assert.equal(report.uses_browser, false);
  assert.equal(report.uses_native_ax, false);
  assert.equal(report.uses_canvas, false);
  assert.equal(report.starts_workflow_engine, false);
  assert.equal(report.auto_resumes, false);
  assert.equal(report.automatic_replay_allowed, false);
  assert.ok(report.recovery_summary);
  assert.equal(report.recovery_summary.guide_stage, report.current_stage);
  assert.equal(report.recovery_summary.guide_stage_status, report.stage_status);
  assert.deepEqual(report.recovery_summary.next.argv, report.next_explicit_command?.argv || []);
  assert.equal(report.recovery_summary.next.command_id, report.next_explicit_command?.id || '');
  assert.deepEqual(report.recovery_summary.next.missing_inputs, report.missing_inputs || []);
  assert.deepEqual(
    report.recovery_summary.next.persistence,
    expectedPersistence(report.next_explicit_command, report.recovery_summary.next.argv.length > 0),
  );
  assert.equal(report.recovery_summary.safety.inspector_ran_command, false);
  assert.equal(report.recovery_summary.safety.bundle_wrote_replacement, false);
  assert.equal(report.recovery_summary.safety.bundle_wrote_supersession, false);
  assert.equal(report.recovery_summary.safety.uses_live_ui, false);
  assert.equal(report.recovery_summary.safety.automatic_replay_allowed, false);
}

function assertGuideSummaryState(report, state) {
  assert.equal(report.recovery_summary.state, state);
}

function allDescriptors(report) {
  return [
    report.next_explicit_command,
    ...(report.alternative_explicit_commands || []),
  ].filter(Boolean);
}

function assertDescriptorsNotRun(report) {
  for (const command of allDescriptors(report)) {
    assert.equal(command.not_run_by_guide, true, command.id);
  }
}

function descriptorById(report, id) {
  return allDescriptors(report).find((command) => command.id === id);
}

function assertStdoutArtifact(command, { kind, path: artifactPath }) {
  assert.equal(command.stdout_artifact.required, true, command.id);
  assert.equal(command.stdout_artifact.kind, kind, command.id);
  assert.equal(command.stdout_artifact.path, artifactPath, command.id);
  assert.equal(command.stdout_artifact.format, 'json', command.id);
  assert.equal(command.stdout_artifact.write_mode, 'create_or_replace', command.id);
  assert.equal(command.stdout_artifact.directory_precondition, 'create_parent_directory', command.id);
  assert.equal(command.save_stdout_to, artifactPath, command.id);
  assert.match(command.persistence_command, new RegExp(`> .*${path.basename(artifactPath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), command.id);
}

function emptyPersistence() {
  return {
    stdout_required: false,
    stdout_artifact: {},
    save_stdout_to: '',
    requires_saved_output_from: [],
    persistence_command: '',
  };
}

function expectedPersistence(command = {}, continuable = true) {
  if (continuable !== true || !command) return emptyPersistence();
  const stdoutArtifact = command.stdout_artifact || {};
  const stdoutRequired = stdoutArtifact.required === true || Boolean(stdoutArtifact.path || command.save_stdout_to);
  return {
    stdout_required: stdoutRequired,
    stdout_artifact: stdoutRequired ? stdoutArtifact : {},
    save_stdout_to: stdoutRequired ? (command.save_stdout_to || stdoutArtifact.path || '') : '',
    requires_saved_output_from: command.requires_saved_output_from || [],
    persistence_command: stdoutRequired ? (command.persistence_command || '') : '',
  };
}

function assertRequiresSavedOutput(command, { descriptorId, artifactKind, path: artifactPath }) {
  assert.deepEqual(command.requires_saved_output_from, [{
    descriptor_id: descriptorId,
    artifact_kind: artifactKind,
    path: artifactPath,
  }], command.id);
}

function assertNoMisleadingPersistencePurpose(report) {
  for (const command of allDescriptors(report)) {
    if (/\bwrite\b.*\b(path|listed path)\b/i.test(command.purpose)) {
      assert.ok(command.stdout_artifact, `${command.id} claims path persistence without stdout_artifact`);
    }
  }
}

function assertReadyToExecuteReadyRequiresInputs(report) {
  if (report.current_stage === 'ready_to_execute' && report.stage_status === 'ready') {
    assert.deepEqual(report.missing_inputs, []);
    assert.ok(report.next_explicit_command.argv.includes('--attempt-plan'));
    assert.ok(report.next_explicit_command.argv.includes('--execution-root'));
    assert.ok(report.next_explicit_command.argv.includes('--artifact-root'));
    assert.ok(!report.next_explicit_command.argv.includes(''));
  }
}

function advertisedGuideStages(text, marker) {
  const start = text.indexOf(marker);
  assert.ok(start >= 0, `missing marker ${marker}`);
  const tail = text.slice(start);
  const sentence = tail.slice(0, tail.indexOf('.'));
  return [...sentence.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

test('valid Work Record returns valid_no_repair_needed without mutating next command', () => {
  const before = fs.readFileSync(validFixture, 'utf8');
  const report = guideWorkRecordRepair({ sourceRef: validFixture, repoRoot });

  assertGuideEnvelope(report);
  assert.equal(report.current_stage, 'valid_no_repair_needed');
  assert.equal(report.stage_status, 'not_required');
  assertGuideSummaryState(report, 'finalized');
  assert.equal(report.next_explicit_command.mutates_state, false);
  assertDescriptorsNotRun(report);
  assertReadyToExecuteReadyRequiresInputs(report);
  assert.equal(fs.readFileSync(validFixture, 'utf8'), before);
});

test('repairable Work Record without authorization returns gate_required and gate-request command', () => {
  const before = fs.readFileSync(repairableFixture, 'utf8');
  const report = guideWorkRecordRepair({ sourceRef: repairableFixture, repoRoot });

  assertGuideEnvelope(report);
  assert.equal(report.current_stage, 'gate_required');
  assert.equal(report.stage_status, 'blocked');
  assertGuideSummaryState(report, 'blocked');
  assert.equal(report.next_explicit_command.id, 'work-record-gate-request');
  assert.equal(report.next_explicit_command.mutates_state, false);
  assertStdoutArtifact(report.next_explicit_command, {
    kind: 'workflow_gate_request',
    path: report.artifact_path_recommendations.gate_request_path,
  });
  assertRequiresSavedOutput(descriptorById(report, 'aos-gate-ask'), {
    descriptorId: 'work-record-gate-request',
    artifactKind: 'workflow_gate_request',
    path: report.artifact_path_recommendations.gate_request_path,
  });
  assert.ok(report.missing_inputs.includes('workflow_gate_authorization'));
  assertDescriptorsNotRun(report);
  assertNoMisleadingPersistencePurpose(report);
  assert.equal(fs.readFileSync(repairableFixture, 'utf8'), before);
});

test('denied and insufficient authorization return blocked authorization stages', () => {
  const denied = guideWorkRecordRepair({
    sourceRef: repairableFixture,
    gateOutcome: gateRecord({ authorization: 'deny' }),
    repoRoot,
  });
  assertGuideEnvelope(denied);
  assert.equal(denied.current_stage, 'authorization_denied');
  assert.equal(denied.stage_status, 'blocked');
  assertGuideSummaryState(denied, 'blocked');

  const repairPlan = planWorkRecordRepair(repairableFixture, { repoRoot });
  const request = buildWorkRecordGateRequestFromRepairPlan(repairPlan);
  const insufficient = guideWorkRecordRepair({
    sourceRef: repairableFixture,
    gateOutcome: { ...approvedRecord(request), response_stored: false },
    repoRoot,
  });
  assertGuideEnvelope(insufficient);
  assert.equal(insufficient.current_stage, 'authorization_insufficient');
  assert.equal(insufficient.stage_status, 'blocked');
  assertGuideSummaryState(insufficient, 'blocked');
  assertDescriptorsNotRun(insufficient);
});

test('authorized repairable Work Record plans attempt before execute inputs are complete', () => {
  const report = guideWorkRecordRepair({
    sourceRef: repairableFixture,
    gateOutcome: gateRecord(),
    repoRoot,
  });

  assertGuideEnvelope(report);
  assert.equal(report.current_stage, 'ready_to_plan_attempt');
  assert.equal(report.stage_status, 'blocked');
  assertGuideSummaryState(report, 'blocked');
  assert.deepEqual(report.missing_inputs, ['attempt_plan_path', 'execution_root', 'artifact_root']);
  assert.equal(report.next_explicit_command.id, 'work-record-plan-attempt');
  assertStdoutArtifact(report.next_explicit_command, {
    kind: 'repair_attempt_plan',
    path: report.artifact_path_recommendations.attempt_plan_path,
  });
  assert.equal(descriptorById(report, 'work-record-repair-execute-dry-run'), undefined);
  assertReadyToExecuteReadyRequiresInputs(report);
  assertDescriptorsNotRun(report);
  assertNoMisleadingPersistencePurpose(report);
});

test('authorized repairable Work Record blocks ready_to_execute until roots are present', () => {
  const executionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-guide-exec-'));
  const noExecutionRoot = guideWorkRecordRepair({
    sourceRef: repairableFixture,
    gateOutcome: gateRecord(),
    attemptPlanPath: '/tmp/aos-work-record-guide-ready/repair-attempt-plan.json',
    artifactRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-guide-artifacts-')),
    repoRoot,
  });
  assert.equal(noExecutionRoot.current_stage, 'ready_to_execute');
  assert.equal(noExecutionRoot.stage_status, 'blocked');
  assertGuideSummaryState(noExecutionRoot, 'blocked');
  assert.deepEqual(noExecutionRoot.missing_inputs, ['execution_root']);
  assertReadyToExecuteReadyRequiresInputs(noExecutionRoot);

  const noArtifactRoot = guideWorkRecordRepair({
    sourceRef: repairableFixture,
    gateOutcome: gateRecord(),
    attemptPlanPath: '/tmp/aos-work-record-guide-ready/repair-attempt-plan.json',
    executionRoot,
    repoRoot,
  });
  assert.equal(noArtifactRoot.current_stage, 'ready_to_execute');
  assert.equal(noArtifactRoot.stage_status, 'blocked');
  assertGuideSummaryState(noArtifactRoot, 'blocked');
  assert.deepEqual(noArtifactRoot.missing_inputs, ['artifact_root']);
  assertReadyToExecuteReadyRequiresInputs(noArtifactRoot);
});

test('authorized repairable Work Record returns ready_to_execute only with executable inputs', () => {
  const executionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-guide-exec-'));
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-guide-artifacts-'));
  const beforeExec = fs.readdirSync(executionRoot);
  const beforeArtifacts = fs.readdirSync(artifactRoot);
  const report = guideWorkRecordRepair({
    sourceRef: repairableFixture,
    gateOutcome: gateRecord(),
    attemptPlanPath: '/tmp/aos-work-record-guide-ready/repair-attempt-plan.json',
    executionRoot,
    artifactRoot,
    repoRoot,
  });

  assertGuideEnvelope(report);
  assert.equal(report.current_stage, 'ready_to_execute');
  assert.equal(report.stage_status, 'ready');
  assertGuideSummaryState(report, 'ready');
  assert.equal(report.repair_attempt_plan_summary.status, 'ready');
  assert.equal(report.next_explicit_command.id, 'work-record-repair-execute-dry-run');
  assert.equal(report.next_explicit_command.mutates_state, false);
  assert.deepEqual(report.missing_inputs, []);
  assertRequiresSavedOutput(report.next_explicit_command, {
    descriptorId: 'work-record-plan-attempt',
    artifactKind: 'repair_attempt_plan',
    path: '/tmp/aos-work-record-guide-ready/repair-attempt-plan.json',
  });
  assert.ok(report.alternative_explicit_commands.some((command) => command.id === 'work-record-repair-execute' && command.mutates_state === true));
  assertRequiresSavedOutput(descriptorById(report, 'work-record-repair-execute'), {
    descriptorId: 'work-record-plan-attempt',
    artifactKind: 'repair_attempt_plan',
    path: '/tmp/aos-work-record-guide-ready/repair-attempt-plan.json',
  });
  assertDescriptorsNotRun(report);
  assertReadyToExecuteReadyRequiresInputs(report);
  assert.deepEqual(fs.readdirSync(executionRoot), beforeExec);
  assert.deepEqual(fs.readdirSync(artifactRoot), beforeArtifacts);
});

test('valid Attempt Artifact plus roots returns ready_to_finalize after dry-run', () => {
  const replacementRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-guide-replacements-'));
  const indexRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-guide-index-'));
  const { planPath, artifactPath } = writeAttemptInputs();
  const report = guideWorkRecordRepair({
    sourceRef: repairableFixture,
    gateOutcome: gateRecord(),
    attemptPlanPath: planPath,
    attemptArtifactPath: artifactPath,
    replacementRoot,
    indexRoot,
    proposedIdSeed: 'work-record:repair-guide-ready-to-finalize',
    repoRoot,
  });

  assertGuideEnvelope(report);
  assert.equal(report.current_stage, 'ready_to_finalize');
  assert.equal(report.stage_status, 'ready');
  assertGuideSummaryState(report, 'ready');
  assert.equal(report.repair_attempt_artifact_validation.validation.status, 'passed');
  assert.equal(report.finalization_dry_run_summary.status, 'dry_run');
  assert.equal(report.next_explicit_command.id, 'work-record-repair-finalize');
  assert.equal(report.next_explicit_command.mutates_state, true);
  assertDescriptorsNotRun(report);
  assert.deepEqual(fs.readdirSync(replacementRoot), []);
  assert.deepEqual(fs.readdirSync(indexRoot), []);
});

test('invalid Attempt Artifact returns attempt_artifact_invalid', () => {
  const artifactPath = writeTempJson({ type: 'wrong' }, 'aos-work-record-guide-invalid-artifact-');
  const report = guideWorkRecordRepair({
    sourceRef: repairableFixture,
    gateOutcome: gateRecord(),
    attemptArtifactPath: artifactPath,
    repoRoot,
  });

  assertGuideEnvelope(report);
  assert.equal(report.current_stage, 'attempt_artifact_invalid');
  assert.equal(report.stage_status, 'blocked');
  assertGuideSummaryState(report, 'blocked');
  assert.equal(report.repair_attempt_artifact_validation.validation.status, 'failed');
  assert.equal(report.next_explicit_command.id, 'work-record-attempt-artifact-validate');
  assertDescriptorsNotRun(report);
});

test('existing supersession index and replacement returns finalized', () => {
  const replacementRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-guide-finalized-replacements-'));
  const indexRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-guide-finalized-index-'));
  const { planPath, artifactPath } = writeAttemptInputs();
  const finalizer = finalizeWorkRecordRepair({
    sourceRef: repairableFixture,
    attemptPlanPath: planPath,
    attemptArtifactPath: artifactPath,
    replacementRoot,
    indexRoot,
    proposedIdSeed: 'work-record:repair-guide-finalized',
    repoRoot,
  });
  assert.equal(finalizer.status, 'finalized', JSON.stringify(finalizer.diagnostics, null, 2));

  const report = guideWorkRecordRepair({
    sourceRef: repairableFixture,
    replacementRoot,
    indexRoot,
    repoRoot,
  });

  assertGuideEnvelope(report);
  assert.equal(report.current_stage, 'finalized');
  assert.equal(report.stage_status, 'complete');
  assertGuideSummaryState(report, 'finalized');
  assert.equal(report.supersession_lookup_summary.status, 'active');
  assert.equal(report.replacement_summary.read.status, 'success');
  assertDescriptorsNotRun(report);
});

test('finalization dry-run blocker returns exact recovery command without writes', () => {
  const replacementRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-guide-blocked-replacements-'));
  const indexRoot = writeTempJson({ not: 'a-directory' }, 'aos-work-record-guide-blocked-index-');
  const { planPath, artifactPath } = writeAttemptInputs();
  const report = guideWorkRecordRepair({
    sourceRef: repairableFixture,
    gateOutcome: gateRecord(),
    attemptPlanPath: planPath,
    attemptArtifactPath: artifactPath,
    replacementRoot,
    indexRoot,
    proposedIdSeed: 'work-record:repair-guide-finalization-blocked',
    repoRoot,
  });

  assertGuideEnvelope(report);
  assert.equal(report.current_stage, 'finalization_blocked');
  assert.equal(report.stage_status, 'blocked');
  assertGuideSummaryState(report, 'blocked');
  assert.equal(report.finalization_dry_run_summary.status, 'blocked_path_escape');
  assert.match(report.next_explicit_command.command, /repair finalize/);
  assertDescriptorsNotRun(report);
  assert.deepEqual(fs.readdirSync(replacementRoot), []);
});

test('advertised guide stages match implementation-supported stages', () => {
  const apiDoc = fs.readFileSync(path.join(repoRoot, 'docs/api/aos.md'), 'utf8');
  const schemaDoc = fs.readFileSync(path.join(repoRoot, 'shared/schemas/aos-work-record-v0.md'), 'utf8');
  const skill = fs.readFileSync(path.join(repoRoot, 'skills/aos-agent-workspace/SKILL.md'), 'utf8');

  assert.deepEqual(
    advertisedGuideStages(apiDoc, 'Guide stages are'),
    WORK_RECORD_REPAIR_GUIDE_STAGES,
  );
  assert.deepEqual(
    advertisedGuideStages(schemaDoc, 'Guide stages are'),
    WORK_RECORD_REPAIR_GUIDE_STAGES,
  );
  assert.deepEqual(
    advertisedGuideStages(skill, 'Guide stages are'),
    WORK_RECORD_REPAIR_GUIDE_STAGES,
  );
  for (const text of [apiDoc, schemaDoc, skill]) {
    assert.match(text, /recovery_summary/);
    assert.match(text, /next\.argv/);
    assert.match(text, /scan-first|scan\/continuation/);
  }
  for (const removed of ['attempt_artifact_missing', 'partial_recovery', 'blocked']) {
    assert.ok(!WORK_RECORD_REPAIR_GUIDE_STAGES.includes(removed));
  }
});

test('public help and command smoke expose stable JSON without hidden execution', () => {
  const help = runAos(['help', 'work-record', 'repair', 'guide', '--json']);
  assert.equal(help.status, 0, help.stderr);
  const helpJson = JSON.parse(help.stdout);
  assert.equal(helpJson.path.join(' '), 'work-record repair guide');
  assert.equal(helpJson.forms[0].execution.read_only, true);
  assert.equal(helpJson.forms[0].execution.executes_repair, false);
  assert.equal(helpJson.forms[0].execution.runs_recommended_commands, false);
  assert.equal(helpJson.forms[0].execution.starts_workflow_engine, false);
  assert.equal(helpJson.forms[0].execution.auto_resumes, false);

  const before = fs.readFileSync(repairableFixture, 'utf8');
  const smoke = runAos(['work-record', 'repair', 'guide', repairableFixture, '--json']);
  assert.equal(smoke.status, 0, smoke.stderr);
  const report = JSON.parse(smoke.stdout);
  assertGuideEnvelope(report);
  assert.equal(report.current_stage, 'gate_required');
  assertDescriptorsNotRun(report);
  assert.equal(fs.readFileSync(repairableFixture, 'utf8'), before);
});
