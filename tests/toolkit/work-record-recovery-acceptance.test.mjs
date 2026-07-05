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
  planWorkRecordRepair,
} from '../../packages/toolkit/workbench/work-record.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const source = 'shared/schemas/fixtures/aos-work-record-v0/valid/repairable-stale-saved-ref.json';
const sourcePath = path.join(repoRoot, source);

function proofRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aos-work-record-recovery-acceptance-${new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15)}Z-`));
}

function digestFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function parseJsonResult(result, args) {
  const text = result.stdout.trim() || result.stderr.trim();
  assert.ok(text, `missing JSON output for ./aos ${args.join(' ')}`);
  return JSON.parse(text);
}

function runAos(args, { ok = [0] } = {}) {
  const result = spawnSync('./aos', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.ok(ok.includes(result.status), [
    `./aos ${args.join(' ')}`,
    `exit ${result.status}`,
    result.stdout,
    result.stderr,
  ].join('\n'));
  return {
    result,
    json: parseJsonResult(result, args),
  };
}

function approvedGateRecord() {
  const repairPlan = planWorkRecordRepair(source, { repoRoot });
  const request = buildWorkRecordGateRequestFromRepairPlan(repairPlan);
  return {
    schema_version: 'aos.gate.record.v1',
    gate_id: request.gate_request.id,
    request_schema_version: 'aos.gate.request.v1',
    prompt_title: request.gate_request.prompt.title,
    source: { surface: 'work_record.repair_plan', session_id: null, agent: null },
    receptor: 'acceptance-test',
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
    response: { authorization: 'approve' },
  };
}

function snapshotTree(root) {
  const files = [];
  if (!fs.existsSync(root)) return files;
  function walk(current) {
    for (const name of fs.readdirSync(current)) {
      const file = path.join(current, name);
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) {
        walk(file);
      } else {
        files.push({
          relative: path.relative(root, file),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          digest: digestFile(file),
        });
      }
    }
  }
  walk(root);
  return files.sort((a, b) => a.relative.localeCompare(b.relative));
}

function assertNoForbiddenExecutionFlags(value) {
  for (const key of [
    'uses_live_ui',
    'uses_browser',
    'uses_native_ax',
    'uses_canvas',
    'applies_patches',
    'automatic_replay_allowed',
    'executes_actions',
    'mutates_source_record',
  ]) {
    if (Object.hasOwn(value, key)) assert.equal(value[key], false, key);
  }
}

function assertBundleFilesAreSafe(bundleRoot) {
  const files = snapshotTree(bundleRoot).map((item) => item.relative).sort();
  assert.ok(files.includes('bundle-manifest.json'));
  assert.ok(files.includes('guide-report.json'));
  assert.ok(files.every((file) => (
    file === 'bundle-manifest.json'
    || file === 'guide-report.json'
    || /^commands\/[^/]+\.json$/.test(file)
    || /^artifacts\/[^/]+\.json$/.test(file)
  )), files.join('\n'));
  assert.equal(files.includes('reports/finalization-dry-run.json'), false);
  assert.equal(files.includes('reports/supersession-lookup.json'), false);
}

function assertJsonArtifact(file) {
  assert.ok(fs.existsSync(file), file);
  assert.doesNotThrow(() => readJson(file), file);
}

function assertContainedPath(child, root) {
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(child));
  assert.ok(relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)), `${child} is not under ${root}`);
}

function assertSummarySafety(summary) {
  assert.equal(summary.safety.inspector_ran_command, false);
  assert.equal(summary.safety.bundle_wrote_replacement, false);
  assert.equal(summary.safety.bundle_wrote_supersession, false);
  assert.equal(summary.safety.uses_live_ui, false);
  assert.equal(summary.safety.automatic_replay_allowed, false);
}

function assertGuideRecoverySummary(envelope, state) {
  assert.equal(envelope.recovery_summary.state, state);
  assert.equal(envelope.recovery_summary.guide_stage, envelope.current_stage);
  assert.equal(envelope.recovery_summary.guide_stage_status, envelope.stage_status);
  assert.equal(envelope.recovery_summary.next.command_id, envelope.next_explicit_command?.id || '');
  assert.deepEqual(envelope.recovery_summary.next.argv, envelope.next_explicit_command?.argv || []);
  assert.deepEqual(envelope.recovery_summary.next.missing_inputs, envelope.missing_inputs || []);
  assertSummarySafety(envelope.recovery_summary);
}

function assertBundleRecoverySummary(envelope, state) {
  assert.equal(envelope.recovery_summary.state, state);
  assert.equal(envelope.recovery_summary.bundle_root, envelope.output_root);
  assert.equal(envelope.recovery_summary.next.command_id, envelope.next_recommended_command?.id || '');
  assert.deepEqual(envelope.recovery_summary.next.argv, envelope.next_recommended_command?.argv || []);
  assertSummarySafety(envelope.recovery_summary);
}

function assertInspectionRecoverySummary(envelope, state) {
  assert.equal(envelope.recovery_summary.state, state);
  assert.equal(envelope.recovery_summary.bundle_root, envelope.bundle_root);
  assert.equal(envelope.recovery_summary.next.command_id, state === 'invalid' ? '' : envelope.continuation.safe_next_descriptor_id);
  assert.deepEqual(envelope.recovery_summary.next.argv, state === 'invalid' ? [] : envelope.continuation.argv);
  assertSummarySafety(envelope.recovery_summary);
}

function assertStatusRowRecoverySummary(row) {
  assert.equal(row.recovery_summary.state, row.lifecycle_status);
  assert.equal(row.recovery_summary.bundle_root, row.bundle_root);
  assert.equal(row.recovery_summary.next.command_id, row.next_command_id || '');
  assert.deepEqual(row.recovery_summary.next.argv, row.next_argv || []);
  assert.deepEqual(row.recovery_summary.next.missing_inputs, row.missing_inputs || []);
  assertSummarySafety(row.recovery_summary);
}

test('public Work Record recovery lifecycle composes from repairable fixture to finalized bundle', () => {
  const root = proofRoot();
  const bundleParent = path.join(root, 'bundles');
  const initialBundle = path.join(bundleParent, '01-authorized');
  const readyFinalizeBundle = path.join(bundleParent, '02-ready-finalize');
  const finalizedBundle = path.join(bundleParent, '03-finalized');
  const executionRoot = path.join(root, 'execution-root');
  const artifactRoot = path.join(root, 'artifact-root');
  const replacementRoot = path.join(root, 'replacement-records');
  const indexRoot = path.join(root, 'source-supersession-index');
  const sourceBefore = digestFile(sourcePath);

  const help = runAos(['help', '--json']).json;
  assert.ok(help);
  const workRecordHelp = runAos(['help', 'work-record', '--json']).json;
  assert.ok(workRecordHelp.forms.some((form) => form.id === 'work-record-repair-bundle-status'));

  const preflightStatus = runAos(['work-record', 'status', source, '--json'], { ok: [0, 1] }).json;
  assert.equal(preflightStatus.health_verdict, 'repairable');
  assert.equal(preflightStatus.recovery.action, 'workflow_gated_repair_required');
  const preflightGuide = runAos(['work-record', 'repair', 'guide', source, '--json']).json;
  assert.equal(preflightGuide.current_stage, 'gate_required');
  assert.equal(preflightGuide.stage_status, 'blocked');
  assert.equal(preflightGuide.next_explicit_command.id, 'work-record-gate-request');
  assertGuideRecoverySummary(preflightGuide, 'blocked');

  const gateRecordPath = writeJson(path.join(root, 'gate-record.json'), approvedGateRecord());
  const authorization = runAos(['work-record', 'gate-check', source, '--gate-record', gateRecordPath, '--json']).json;
  assert.equal(authorization.status, 'authorized');
  assert.equal(authorization.result, 'approved');
  assert.equal(authorization.authorizes_future_attempt, true);
  assertNoForbiddenExecutionFlags(authorization);
  const authorizationPath = writeJson(path.join(root, 'authorization.json'), authorization);

  const initial = runAos([
    'work-record',
    'repair',
    'bundle',
    source,
    '--output-root',
    initialBundle,
    '--authorization',
    authorizationPath,
    '--json',
  ]).json;
  assert.equal(initial.status, 'written');
  assertBundleRecoverySummary(initial, 'blocked');
  assertBundleFilesAreSafe(initialBundle);
  const attemptPlanPath = path.join(initialBundle, 'artifacts/repair-attempt-plan.json');
  assertJsonArtifact(attemptPlanPath);
  const attemptPlan = readJson(attemptPlanPath);
  assert.equal(attemptPlan.status, 'ready');
  assert.ok(attemptPlan.planned_operations.some((operation) => (
    operation.allowlisted_operation_id === 'controlled_fixture.write_success'
    && operation.executes_in_plan === false
  )));

  const initialInspection = runAos(['work-record', 'repair', 'bundle', 'inspect', initialBundle, '--json']).json;
  assert.equal(initialInspection.status, 'valid');
  assert.equal(initialInspection.continuation.current_guide_stage, 'ready_to_plan_attempt');
  assertInspectionRecoverySummary(initialInspection, 'ready');
  const initialLifecycle = runAos(['work-record', 'repair', 'bundle', 'status', '--bundle-root', initialBundle, '--json']).json;
  assert.equal(initialLifecycle.bundles[0].lifecycle_status, 'ready');
  assert.deepEqual(initialLifecycle.bundles[0].missing_inputs, ['attempt_plan_path', 'execution_root', 'artifact_root']);
  assertStatusRowRecoverySummary(initialLifecycle.bundles[0]);

  fs.mkdirSync(executionRoot, { recursive: true });
  fs.mkdirSync(artifactRoot, { recursive: true });
  fs.writeFileSync(path.join(executionRoot, 'input.txt'), 'before\n');
  const dryRun = runAos([
    'work-record',
    'repair',
    'execute',
    '--attempt-plan',
    attemptPlanPath,
    '--execution-root',
    executionRoot,
    '--artifact-root',
    artifactRoot,
    '--dry-run',
    '--json',
  ]).json;
  assert.equal(dryRun.status, 'dry_run');
  assert.equal(dryRun.executes_repair, false);
  assert.equal(dryRun.would_execute_repair, true);
  assert.deepEqual(fs.readdirSync(artifactRoot), []);

  const execution = runAos([
    'work-record',
    'repair',
    'execute',
    '--attempt-plan',
    attemptPlanPath,
    '--execution-root',
    executionRoot,
    '--artifact-root',
    artifactRoot,
    '--json',
  ]).json;
  assert.equal(execution.status, 'succeeded');
  assert.equal(execution.executes_repair, true);
  assertNoForbiddenExecutionFlags(execution);
  assert.equal(digestFile(sourcePath), sourceBefore);
  assert.ok(execution.artifact.path.startsWith(fs.realpathSync(artifactRoot)));
  assertJsonArtifact(execution.artifact.path);

  const artifactValidation = runAos(['work-record', 'attempt-artifact', 'validate', execution.artifact.path, '--json']).json;
  assert.equal(artifactValidation.status, 'passed');

  fs.mkdirSync(replacementRoot, { recursive: true });
  fs.mkdirSync(indexRoot, { recursive: true });

  const readyGuide = runAos([
    'work-record',
    'repair',
    'guide',
    source,
    '--authorization',
    authorizationPath,
    '--attempt-plan',
    attemptPlanPath,
    '--attempt-artifact',
    execution.artifact.path,
    '--replacement-root',
    replacementRoot,
    '--index-root',
    indexRoot,
    '--json',
  ]).json;
  assert.equal(readyGuide.current_stage, 'ready_to_finalize');
  assert.equal(readyGuide.stage_status, 'ready');
  assert.equal(readyGuide.next_explicit_command.id, 'work-record-repair-finalize');
  assert.equal(readyGuide.next_explicit_command.not_run_by_guide, true);
  assertGuideRecoverySummary(readyGuide, 'ready');

  const readyBundle = runAos([
    'work-record',
    'repair',
    'bundle',
    source,
    '--output-root',
    readyFinalizeBundle,
    '--authorization',
    authorizationPath,
    '--attempt-plan',
    attemptPlanPath,
    '--attempt-artifact',
    execution.artifact.path,
    '--replacement-root',
    replacementRoot,
    '--index-root',
    indexRoot,
    '--json',
  ]).json;
  assert.equal(readyBundle.status, 'written');
  assertBundleRecoverySummary(readyBundle, 'ready');
  assertBundleFilesAreSafe(readyFinalizeBundle);
  assert.equal(fs.existsSync(path.join(readyFinalizeBundle, 'reports/finalization-dry-run.json')), false);
  assert.equal(fs.existsSync(path.join(readyFinalizeBundle, 'reports/supersession-lookup.json')), false);
  const readyInspection = runAos(['work-record', 'repair', 'bundle', 'inspect', readyFinalizeBundle, '--json']).json;
  assert.equal(readyInspection.status, 'valid');
  assertInspectionRecoverySummary(readyInspection, 'ready');
  const readyStatus = runAos(['work-record', 'repair', 'bundle', 'status', '--bundle-root', readyFinalizeBundle, '--json']).json;
  assert.equal(readyStatus.bundles[0].lifecycle_status, 'ready');
  assertStatusRowRecoverySummary(readyStatus.bundles[0]);

  const replacementBeforeDryRun = snapshotTree(replacementRoot);
  const indexBeforeDryRun = snapshotTree(indexRoot);
  const finalizeDryRun = runAos([
    'work-record',
    'repair',
    'finalize',
    '--source',
    source,
    '--attempt-plan',
    attemptPlanPath,
    '--attempt-artifact',
    execution.artifact.path,
    '--replacement-root',
    replacementRoot,
    '--index-root',
    indexRoot,
    '--dry-run',
    '--json',
  ]).json;
  assert.equal(finalizeDryRun.status, 'dry_run');
  assert.equal(finalizeDryRun.would_write_replacement_record, true);
  assert.equal(finalizeDryRun.would_write_supersession_index_entry, true);
  assert.equal(fs.existsSync(finalizeDryRun.replacement_writer_result.output.output_path), false);
  assert.equal(fs.existsSync(finalizeDryRun.supersession_index_result.output.index_path), false);
  assert.deepEqual(snapshotTree(replacementRoot), replacementBeforeDryRun);
  assert.deepEqual(snapshotTree(indexRoot), indexBeforeDryRun);

  const finalization = runAos([
    'work-record',
    'repair',
    'finalize',
    '--source',
    source,
    '--attempt-plan',
    attemptPlanPath,
    '--attempt-artifact',
    execution.artifact.path,
    '--replacement-root',
    replacementRoot,
    '--index-root',
    indexRoot,
    '--json',
  ]).json;
  assert.equal(finalization.status, 'finalized');
  assert.equal(finalization.wrote_replacement_record, true);
  assert.equal(finalization.wrote_supersession_index_entry, true);
  assertNoForbiddenExecutionFlags(finalization);
  assert.equal(digestFile(sourcePath), sourceBefore);
  const replacementPath = finalization.replacement_writer_result.output.output_path;
  const entryPath = finalization.supersession_index_result.output.index_path;
  assertJsonArtifact(replacementPath);
  assertJsonArtifact(entryPath);
  assertContainedPath(replacementPath, replacementRoot);
  assertContainedPath(entryPath, indexRoot);

  const repeatedFinalization = runAos([
    'work-record',
    'repair',
    'finalize',
    '--source',
    source,
    '--attempt-plan',
    attemptPlanPath,
    '--attempt-artifact',
    execution.artifact.path,
    '--replacement-root',
    replacementRoot,
    '--index-root',
    indexRoot,
    '--json',
  ]).json;
  assert.equal(repeatedFinalization.status, 'already_finalized');

  const replacementRead = runAos(['work-record', 'read', replacementPath, '--root', replacementRoot, '--json']).json;
  assert.equal(replacementRead.status, 'success');
  const replacementStatus = runAos(['work-record', 'status', replacementPath, '--root', replacementRoot, '--json']).json;
  assert.equal(replacementStatus.status, 'passed');
  assert.equal(replacementStatus.health_verdict, 'valid');
  const lookup = runAos([
    'work-record',
    'supersession',
    'lookup',
    '--source',
    source,
    '--index-root',
    indexRoot,
    '--replacement-root',
    replacementRoot,
    '--json',
  ]).json;
  assert.equal(lookup.status, 'active');
  assert.equal(lookup.entries[0].index_path, entryPath);
  assert.equal(lookup.entries[0].replacement_work_record.path, replacementPath);
  assert.equal(lookup.entries[0].replacement_work_record.id, replacementRead.record.id);
  assert.equal(runAos(['work-record', 'supersession', 'validate', entryPath, '--json']).json.status, 'passed');

  const finalizedGuide = runAos([
    'work-record',
    'repair',
    'guide',
    source,
    '--authorization',
    authorizationPath,
    '--attempt-plan',
    attemptPlanPath,
    '--attempt-artifact',
    execution.artifact.path,
    '--replacement-root',
    replacementRoot,
    '--index-root',
    indexRoot,
    '--json',
  ]).json;
  assert.equal(finalizedGuide.current_stage, 'finalized');
  assert.equal(finalizedGuide.stage_status, 'complete');
  assertGuideRecoverySummary(finalizedGuide, 'finalized');

  const finalizedBundleOutput = runAos([
    'work-record',
    'repair',
    'bundle',
    source,
    '--output-root',
    finalizedBundle,
    '--authorization',
    authorizationPath,
    '--attempt-plan',
    attemptPlanPath,
    '--attempt-artifact',
    execution.artifact.path,
    '--replacement-root',
    replacementRoot,
    '--index-root',
    indexRoot,
    '--json',
  ]).json;
  assert.equal(finalizedBundleOutput.status, 'written');
  assertBundleRecoverySummary(finalizedBundleOutput, 'finalized');
  const finalizedInspection = runAos(['work-record', 'repair', 'bundle', 'inspect', finalizedBundle, '--json']).json;
  assert.equal(finalizedInspection.status, 'valid');
  assertInspectionRecoverySummary(finalizedInspection, 'finalized');
  const finalizedStatus = runAos(['work-record', 'repair', 'bundle', 'status', '--bundle-root', finalizedBundle, '--json']).json;
  assert.equal(finalizedStatus.bundles[0].lifecycle_status, 'finalized');
  assertStatusRowRecoverySummary(finalizedStatus.bundles[0]);

  const bundlesBeforeParentStatus = snapshotTree(bundleParent);
  const parentStatus = runAos(['work-record', 'repair', 'bundle', 'status', '--bundle-parent', bundleParent, '--json']).json;
  assert.equal(parentStatus.bundle_count, 3);
  assert.equal(parentStatus.invalid_count, 0);
  assert.equal(parentStatus.missing_count, 0);
  assert.equal(parentStatus.unsupported_count, 0);
  assert.ok(parentStatus.finalized_count >= 1);
  assert.deepEqual(new Set(parentStatus.bundles.map((bundle) => path.basename(bundle.bundle_root))), new Set(['01-authorized', '02-ready-finalize', '03-finalized']));
  for (const bundle of parentStatus.bundles) assertStatusRowRecoverySummary(bundle);
  assert.deepEqual(snapshotTree(bundleParent), bundlesBeforeParentStatus);

  const tamperedBundle = readyFinalizeBundle;
  fs.writeFileSync(path.join(tamperedBundle, 'guide-report.json'), '{"tampered":true}\n');
  const tamperedInspect = runAos(['work-record', 'repair', 'bundle', 'inspect', tamperedBundle, '--json'], { ok: [1] }).json;
  assert.equal(tamperedInspect.status, 'blocked_digest_mismatch');
  assertInspectionRecoverySummary(tamperedInspect, 'invalid');
  assert.ok(tamperedInspect.artifacts.some((artifact) => (
    artifact.relative_path === 'guide-report.json'
    && artifact.status === 'digest_mismatch'
  )));

  assert.equal(digestFile(sourcePath), sourceBefore);
});
