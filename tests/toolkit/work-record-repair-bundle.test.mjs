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
  planWorkRecordRepair,
  planWorkRecordRepairAttempt,
  resolveWorkRecordRepairBundlePath,
  inspectWorkRecordRepairBundle,
  statusWorkRecordRepairBundles,
  writeWorkRecordRepairBundle,
  WORK_RECORD_REPAIR_BUNDLE_SCHEMA_VERSION,
  WORK_RECORD_REPAIR_BUNDLE_TYPE,
} from '../../packages/toolkit/workbench/work-record.js';
import {
  WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS,
  WORK_RECORD_REPAIR_BUNDLE_REQUIRED_MANIFEST_NON_EXECUTION_FLAGS,
} from '../../packages/toolkit/workbench/work-record-repair-bundle-policy.js';
import {
  commandHintFromArgv,
  shellQuoteArg,
} from '../../packages/toolkit/workbench/work-record-command-recommendation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0/valid');
const repairableFixture = path.join(fixtureRoot, 'repairable-stale-saved-ref.json');

function tempDir(prefix = 'aos-work-record-repair-bundle-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function digestFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeJson(dir, name, value) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function gateRecord(response = { authorization: 'approve' }, sourceRef = repairableFixture) {
  const repairPlan = planWorkRecordRepair(sourceRef, { repoRoot });
  const request = buildWorkRecordGateRequestFromRepairPlan(repairPlan);
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
    status: operation.mutates_state ? status : 'skipped',
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
      before_digest: digestFile(repairableFixture),
      after_digest: digestFile(repairableFixture),
    },
  };
}

function finalizationInputs() {
  const dir = tempDir('aos-work-record-bundle-finalization-');
  const plan = readyAttemptPlan();
  const artifact = buildWorkRecordRepairAttemptArtifact(artifactInput());
  return {
    dir,
    planPath: writeJson(dir, 'repair-attempt-plan.json', plan),
    artifactPath: writeJson(dir, 'repair-attempt-artifact.json', artifact),
    replacementRoot: path.join(dir, 'replacement-records'),
    indexRoot: path.join(dir, 'source-supersession-index'),
  };
}

function runAos(args) {
  return spawnSync('./aos', args, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function artifactPaths(envelope) {
  return envelope.planned_artifacts.map((artifact) => artifact.relative_path).sort();
}

function bundleFileExists(root, relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function assertNoCoreBundleFiles(root) {
  assert.equal(bundleFileExists(root, 'guide-report.json'), false);
  assert.equal(bundleFileExists(root, 'bundle-manifest.json'), false);
  assert.equal(bundleFileExists(root, 'commands/work-record-gate-request.json'), false);
  assert.equal(bundleFileExists(root, 'artifacts/gate-request.json'), false);
}

function assertBundleEnvelope(envelope, status) {
  assert.equal(envelope.type, WORK_RECORD_REPAIR_BUNDLE_TYPE);
  assert.equal(envelope.schema_version, WORK_RECORD_REPAIR_BUNDLE_SCHEMA_VERSION);
  assert.equal(envelope.status, status);
  assert.deepEqual(envelope.non_execution_flags, WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS);
  assert.ok(envelope.recovery_summary);
  assert.equal(envelope.recovery_summary.bundle_root, envelope.output_root);
  assert.equal(envelope.recovery_summary.next.command_id, envelope.next_recommended_command?.id || '');
  assert.deepEqual(envelope.recovery_summary.next.argv, envelope.next_recommended_command?.argv || []);
  assert.equal(envelope.recovery_summary.safety.inspector_ran_command, false);
  assert.equal(envelope.recovery_summary.safety.bundle_wrote_replacement, false);
  assert.equal(envelope.recovery_summary.safety.bundle_wrote_supersession, false);
  assert.equal(envelope.recovery_summary.safety.uses_live_ui, false);
  assert.equal(envelope.recovery_summary.safety.automatic_replay_allowed, false);
  for (const artifact of envelope.planned_artifacts) {
    assert.ok(artifact.relative_path);
    assert.ok(artifact.path);
    assert.match(artifact.digest, /^sha256:[a-f0-9]{64}$/);
    assert.ok(artifact.producer);
    assert.ok(Array.isArray(artifact.downstream_consumers));
  }
}

function canonicalFlagKeys() {
  return Object.keys(WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS).sort();
}

test('dry-run plans bundle artifacts and writes nothing', () => {
  const outputRoot = tempDir();
  const before = fs.readdirSync(outputRoot);
  const envelope = writeWorkRecordRepairBundle({
    sourceRef: repairableFixture,
    outputRoot,
    dryRun: true,
    repoRoot,
  });

  assertBundleEnvelope(envelope, 'dry_run');
  assert.equal(envelope.recovery_summary.state, 'blocked');
  assert.deepEqual(fs.readdirSync(outputRoot), before);
  assert.deepEqual(artifactPaths(envelope), [
    'artifacts/gate-request.json',
    'bundle-manifest.json',
    'commands/aos-gate-ask.json',
    'commands/work-record-gate-check.json',
    'commands/work-record-gate-request.json',
    'guide-report.json',
  ]);
});

test('write materializes guide, manifest, descriptors, and gate request only under output root', () => {
  const outputRoot = tempDir();
  const beforeDigest = digestFile(repairableFixture);
  const envelope = writeWorkRecordRepairBundle({
    sourceRef: repairableFixture,
    outputRoot,
    repoRoot,
  });

  assertBundleEnvelope(envelope, 'written');
  assert.equal(envelope.recovery_summary.state, 'blocked');
  assert.equal(digestFile(repairableFixture), beforeDigest);
  for (const artifact of envelope.written_artifacts) {
    assert.ok(artifact.path.startsWith(outputRoot));
    assert.ok(fs.existsSync(artifact.path), artifact.relative_path);
  }
  assert.deepEqual(artifactPaths(envelope), [
    'artifacts/gate-request.json',
    'bundle-manifest.json',
    'commands/aos-gate-ask.json',
    'commands/work-record-gate-check.json',
    'commands/work-record-gate-request.json',
    'guide-report.json',
  ]);
  assert.ok(!fs.existsSync(path.join(outputRoot, 'repair-attempt-artifact.json')));
  assert.ok(!fs.existsSync(path.join(outputRoot, 'replacement-records')));
  assert.ok(!fs.existsSync(path.join(outputRoot, 'source-supersession-index')));
});

test('writer output uses shared canonical non-execution policy and inspects as valid', () => {
  const outputRoot = tempDir();
  const envelope = writeWorkRecordRepairBundle({
    sourceRef: repairableFixture,
    outputRoot,
    repoRoot,
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(outputRoot, 'bundle-manifest.json'), 'utf8'));
  const inspection = inspectWorkRecordRepairBundle({ bundleRoot: outputRoot });

  assertBundleEnvelope(envelope, 'written');
  assert.deepEqual(Object.keys(envelope.non_execution_flags).sort(), canonicalFlagKeys());
  assert.deepEqual(Object.keys(manifest.non_execution_flags).sort(), canonicalFlagKeys());
  assert.deepEqual(WORK_RECORD_REPAIR_BUNDLE_REQUIRED_MANIFEST_NON_EXECUTION_FLAGS.slice().sort(), canonicalFlagKeys());
  assert.deepEqual(manifest.non_execution_flags, WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS);
  assert.equal(inspection.status, 'valid');
});

test('authorization materializes a ready repair attempt plan and rebundled descriptors', () => {
  const sourceDir = tempDir("aos bundle source ; quoted '$SOURCE-");
  const sourcePath = path.join(sourceDir, "repairable ; quoted '$SOURCE.json");
  fs.copyFileSync(repairableFixture, sourcePath);
  const outputRoot = tempDir("aos bundle root ; quoted '$BUNDLE-");
  const envelope = writeWorkRecordRepairBundle({
    sourceRef: sourcePath,
    outputRoot,
    gateOutcome: gateRecord({ authorization: 'approve' }, sourcePath),
    repoRoot,
  });

  assertBundleEnvelope(envelope, 'written');
  assert.ok(fs.existsSync(path.join(outputRoot, 'artifacts/repair-attempt-plan.json')));
  const descriptor = JSON.parse(fs.readFileSync(path.join(outputRoot, 'commands/work-record-plan-attempt.json'), 'utf8'));
  assert.equal(descriptor.not_run_by_bundle, true);
  assert.equal(descriptor.not_run_by_guide, true);
  assert.equal(descriptor.bundle_artifact_status, 'materialized');
  assert.equal(descriptor.stdout_artifact.path, 'artifacts/repair-attempt-plan.json');
  assert.equal(descriptor.save_stdout_to, 'artifacts/repair-attempt-plan.json');
  assert.equal(
    descriptor.persistence_command,
    `${commandHintFromArgv(descriptor.argv)} > ${shellQuoteArg(descriptor.stdout_artifact.path)}`,
  );
  assert.ok(!descriptor.persistence_command.includes(`${descriptor.argv.join(' ')} > ${descriptor.stdout_artifact.path}`));
  assert.ok(descriptor.persistence_command.includes(shellQuoteArg(sourcePath)));
  assert.ok(!descriptor.persistence_command.includes(`--source ${sourcePath} `));
});

test('attempt artifact and finalization roots remain descriptor-only follow-up commands', () => {
  const input = finalizationInputs();
  const outputRoot = path.join(input.dir, 'bundle');
  const envelope = writeWorkRecordRepairBundle({
    sourceRef: repairableFixture,
    outputRoot,
    gateOutcome: gateRecord(),
    attemptPlanPath: input.planPath,
    attemptArtifactPath: input.artifactPath,
    replacementRoot: input.replacementRoot,
    indexRoot: input.indexRoot,
    repoRoot,
  });

  assertBundleEnvelope(envelope, 'written');
  assert.equal(fs.existsSync(path.join(outputRoot, 'reports/finalization-dry-run.json')), false);
  assert.equal(fs.existsSync(path.join(outputRoot, 'reports/supersession-lookup.json')), false);
  assert.ok(!fs.existsSync(input.replacementRoot));
  assert.ok(!fs.existsSync(input.indexRoot));
  const descriptor = JSON.parse(fs.readFileSync(path.join(outputRoot, 'commands/work-record-repair-finalize-dry-run.json'), 'utf8'));
  assert.equal(descriptor.not_run_by_bundle, true);
  assert.equal(descriptor.bundle_artifact_status, 'not_applicable');
  assert.deepEqual(descriptor.argv.slice(0, 5), ['./aos', 'work-record', 'repair', 'finalize', '--source']);
});

test('finalized bundle preserves finalized guide lifecycle from explicit roots', () => {
  const input = finalizationInputs();
  fs.mkdirSync(input.replacementRoot, { recursive: true });
  fs.mkdirSync(input.indexRoot, { recursive: true });
  const finalization = finalizeWorkRecordRepair({
    sourceRef: repairableFixture,
    attemptPlanPath: input.planPath,
    attemptArtifactPath: input.artifactPath,
    replacementRoot: input.replacementRoot,
    indexRoot: input.indexRoot,
    repoRoot,
  });
  assert.equal(finalization.status, 'finalized', JSON.stringify(finalization.diagnostics, null, 2));

  const outputRoot = path.join(input.dir, 'finalized-bundle');
  const envelope = writeWorkRecordRepairBundle({
    sourceRef: repairableFixture,
    outputRoot,
    gateOutcome: gateRecord(),
    attemptPlanPath: input.planPath,
    attemptArtifactPath: input.artifactPath,
    replacementRoot: input.replacementRoot,
    indexRoot: input.indexRoot,
    repoRoot,
  });
  assertBundleEnvelope(envelope, 'written');
  assert.equal(envelope.recovery_summary.state, 'finalized');
  const guide = JSON.parse(fs.readFileSync(path.join(outputRoot, 'guide-report.json'), 'utf8'));
  assert.equal(guide.current_stage, 'finalized');
  assert.equal(guide.stage_status, 'complete');
  const lifecycle = statusWorkRecordRepairBundles({ bundleRoots: [outputRoot] });
  assert.equal(lifecycle.bundles[0].lifecycle_status, 'finalized');
  assert.equal(lifecycle.finalized_count, 1);
});

test('identical existing files are accepted and conflicting files fail closed', () => {
  const outputRoot = tempDir();
  const first = writeWorkRecordRepairBundle({ sourceRef: repairableFixture, outputRoot, repoRoot });
  assertBundleEnvelope(first, 'written');
  const second = writeWorkRecordRepairBundle({ sourceRef: repairableFixture, outputRoot, repoRoot });
  assertBundleEnvelope(second, 'written');
  assert.ok(second.written_artifacts.every((artifact) => artifact.write_status === 'already_exists'));

  fs.writeFileSync(path.join(outputRoot, 'guide-report.json'), '{"conflict":true}\n');
  const conflict = writeWorkRecordRepairBundle({ sourceRef: repairableFixture, outputRoot, repoRoot });
  assert.equal(conflict.status, 'blocked_conflict');
  assert.equal(conflict.recovery_summary.state, 'blocked');
  assert.ok(conflict.conflicts.some((artifact) => artifact.relative_path === 'guide-report.json'));
});

test('symlink escape under output root fails closed', () => {
  const outputRoot = tempDir();
  fs.symlinkSync('/tmp', path.join(outputRoot, 'artifacts'));
  const envelope = writeWorkRecordRepairBundle({
    sourceRef: repairableFixture,
    outputRoot,
    repoRoot,
  });

  assert.equal(envelope.status, 'blocked_path_escape');
  assert.equal(envelope.recovery_summary.state, 'invalid');
  assert.ok(envelope.diagnostics.some((item) => item.code === 'WORK_RECORD_REPAIR_BUNDLE_SYMLINK_ESCAPE'));
  assertNoCoreBundleFiles(outputRoot);
});

test('symlinked output-root ancestor fails closed and writes nothing', () => {
  const root = tempDir('aos-work-record-bundle-symlink-ancestor-');
  const container = path.join(root, 'container');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(container);
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(container, 'link'));
  const outputRoot = path.join(container, 'link', 'bundle');
  const envelope = writeWorkRecordRepairBundle({
    sourceRef: repairableFixture,
    outputRoot,
    repoRoot,
  });

  assert.equal(envelope.status, 'blocked_output_root');
  assert.ok(envelope.diagnostics.some((item) => item.code === 'WORK_RECORD_REPAIR_BUNDLE_OUTPUT_ROOT_SYMLINK_ANCESTOR'));
  assert.equal(fs.existsSync(outputRoot), false);
  assert.equal(fs.existsSync(path.join(outside, 'bundle')), false);
});

test('existing output root below symlinked ancestor fails closed and writes nothing', () => {
  const root = tempDir('aos-work-record-bundle-existing-symlink-ancestor-');
  const container = path.join(root, 'container');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(container);
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(container, 'link'));
  const outputRoot = path.join(container, 'link', 'bundle');
  fs.mkdirSync(path.join(outside, 'bundle'));
  const envelope = writeWorkRecordRepairBundle({
    sourceRef: repairableFixture,
    outputRoot,
    repoRoot,
  });

  assert.equal(envelope.status, 'blocked_output_root');
  assert.ok(envelope.diagnostics.some((item) => item.code === 'WORK_RECORD_REPAIR_BUNDLE_OUTPUT_ROOT_SYMLINK_ANCESTOR'));
  assertNoCoreBundleFiles(path.join(outside, 'bundle'));
});

test('existing output-root symlink fails closed and writes nothing', () => {
  const root = tempDir('aos-work-record-bundle-root-symlink-');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  const outputRoot = path.join(root, 'bundle-link');
  fs.symlinkSync(outside, outputRoot);
  const envelope = writeWorkRecordRepairBundle({
    sourceRef: repairableFixture,
    outputRoot,
    repoRoot,
  });

  assert.equal(envelope.status, 'blocked_output_root');
  assert.ok(envelope.diagnostics.some((item) => item.code === 'WORK_RECORD_REPAIR_BUNDLE_OUTPUT_ROOT_SYMLINK'));
  assertNoCoreBundleFiles(outside);
});

test('existing artifact-file symlink fails closed and writes nothing', () => {
  const outputRoot = tempDir('aos-work-record-bundle-file-symlink-');
  const outside = path.join(tempDir('aos-work-record-bundle-file-target-'), 'guide-report.json');
  fs.writeFileSync(outside, '{}\n');
  fs.symlinkSync(outside, path.join(outputRoot, 'guide-report.json'));
  const envelope = writeWorkRecordRepairBundle({
    sourceRef: repairableFixture,
    outputRoot,
    repoRoot,
  });

  assert.equal(envelope.status, 'blocked_path_escape');
  assert.ok(envelope.diagnostics.some((item) => item.code === 'WORK_RECORD_REPAIR_BUNDLE_SYMLINK_ESCAPE'));
  assert.equal(bundleFileExists(outputRoot, 'bundle-manifest.json'), false);
  assert.equal(bundleFileExists(outputRoot, 'commands/work-record-gate-request.json'), false);
  assert.equal(fs.readFileSync(outside, 'utf8'), '{}\n');
});

test('non-directory artifact parent fails closed and writes nothing', () => {
  const outputRoot = tempDir('aos-work-record-bundle-file-parent-');
  fs.writeFileSync(path.join(outputRoot, 'artifacts'), 'not a directory\n');
  const envelope = writeWorkRecordRepairBundle({
    sourceRef: repairableFixture,
    outputRoot,
    repoRoot,
  });

  assert.equal(envelope.status, 'blocked_path_escape');
  assert.ok(envelope.diagnostics.some((item) => item.code === 'WORK_RECORD_REPAIR_BUNDLE_SYMLINK_ESCAPE'));
  assert.equal(bundleFileExists(outputRoot, 'bundle-manifest.json'), false);
  assert.equal(bundleFileExists(outputRoot, 'guide-report.json'), false);
  assert.equal(fs.readFileSync(path.join(outputRoot, 'artifacts'), 'utf8'), 'not a directory\n');
});

test('path traversal in bundle-relative artifact paths fails closed', () => {
  const outputRoot = tempDir('aos-work-record-bundle-path-traversal-');
  const traversal = resolveWorkRecordRepairBundlePath(outputRoot, '../outside.json');

  assert.equal(traversal.ok, false);
  assert.ok(traversal.diagnostics.some((item) => item.code === 'WORK_RECORD_REPAIR_BUNDLE_PATH_TRAVERSAL'));
});

test('public CLI dry-run and write return structured JSON; invalid source exits nonzero', () => {
  const dryRoot = tempDir();
  const dry = runAos(['work-record', 'repair', 'bundle', repairableFixture, '--output-root', dryRoot, '--dry-run', '--json']);
  assert.equal(dry.status, 0, dry.stderr);
  const dryJson = JSON.parse(dry.stdout);
  assertBundleEnvelope(dryJson, 'dry_run');
  assert.deepEqual(fs.readdirSync(dryRoot), []);

  const writeRoot = tempDir();
  const written = runAos(['work-record', 'repair', 'bundle', repairableFixture, '--output-root', writeRoot, '--json']);
  assert.equal(written.status, 0, written.stderr);
  assertBundleEnvelope(JSON.parse(written.stdout), 'written');

  const invalid = runAos(['work-record', 'repair', 'bundle', '/tmp/does-not-exist', '--output-root', tempDir(), '--json']);
  assert.notEqual(invalid.status, 0);
  assert.equal(JSON.parse(invalid.stderr).status, 'blocked_invalid_source');
});

test('docs, schema, and skill describe bundle as a handoff artifact, not executor', () => {
  const apiDoc = fs.readFileSync(path.join(repoRoot, 'docs/api/aos.md'), 'utf8');
  const schemaDoc = fs.readFileSync(path.join(repoRoot, 'shared/schemas/aos-work-record-v0.md'), 'utf8');
  const skill = fs.readFileSync(path.join(repoRoot, 'skills/aos-agent-workspace/SKILL.md'), 'utf8');
  const bundleSource = fs.readFileSync(path.join(repoRoot, 'packages/toolkit/workbench/work-record-repair-bundle.js'), 'utf8');
  for (const text of [apiDoc, schemaDoc, skill]) {
    assert.match(text, /repair bundle/);
    assert.match(text, /--output-root/);
    assert.match(text, /handoff/);
    assert.match(text, /not\s+(a\s+)?repair execution|not a\s+repair executor/);
    assert.match(text, /not .*finalization|never run.*repair finalization|never runs .*repair finalize|not .*finalizer/s);
    assert.doesNotMatch(text, /bundle (may write|writes|materializes?)[\s\S]{0,240}reports\/finalization-dry-run\.json/);
    assert.doesNotMatch(text, /bundle (may write|writes|materializes?)[\s\S]{0,240}reports\/supersession-lookup\.json/);
    assert.match(text, /gate submission|aos gate ask\/defer\/submit|`aos gate`\s+submission\s+commands|`aos gate\s+commands/s);
    assert.match(text, /replay/);
    assert.match(text, /auto-resume/);
    assert.match(text, /greenfield/);
    assert.match(text, /no legacy compatibility contract/);
    assert.match(text, /current writer\s+output is the contract/i);
    assert.match(text, /missing canonical\s+required[\s\S]{0,180}non_execution_flags/);
    assert.match(text, /old generated smoke\/test bundle directories\s+should be regenerated/i);
    assert.match(text, /schema\/versioned migration stance/);
  }
  assert.doesNotMatch(bundleSource, /work-record-repair-finalizer/);
  assert.doesNotMatch(bundleSource, /work-record-supersession-index/);
  assert.doesNotMatch(bundleSource, /finalizeWorkRecordRepair/);
  assert.doesNotMatch(bundleSource, /lookupWorkRecordSourceSupersession/);
});

test('bundle policy is shared instead of hand-duplicated in writer and inspector', () => {
  const writerSource = fs.readFileSync(path.join(repoRoot, 'packages/toolkit/workbench/work-record-repair-bundle.js'), 'utf8');
  const inspectorSource = fs.readFileSync(path.join(repoRoot, 'packages/toolkit/workbench/work-record-repair-bundle-inspector.js'), 'utf8');
  const policySource = fs.readFileSync(path.join(repoRoot, 'packages/toolkit/workbench/work-record-repair-bundle-policy.js'), 'utf8');

  assert.match(writerSource, /work-record-repair-bundle-policy\.js/);
  assert.match(inspectorSource, /work-record-repair-bundle-policy\.js/);
  assert.doesNotMatch(writerSource, /const\s+NON_EXECUTION_FLAGS\s*=\s*Object\.freeze/);
  assert.doesNotMatch(inspectorSource, /const\s+NON_EXECUTION_FLAGS\s*=\s*Object\.freeze/);
  assert.match(policySource, /WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS\s*=\s*Object\.freeze/);
  assert.match(policySource, /WORK_RECORD_REPAIR_BUNDLE_REQUIRED_MANIFEST_NON_EXECUTION_FLAGS\s*=\s*Object\.freeze\(\s*Object\.keys\(WORK_RECORD_REPAIR_BUNDLE_NON_EXECUTION_FLAGS\)/s);
});
