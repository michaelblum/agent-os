import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  finalizeWorkRecordRepair,
  guideWorkRecordRepair,
  inspectWorkRecordRepairBundle,
  lookupWorkRecordSourceSupersession,
  statusWorkRecordRepairBundles,
  writeWorkRecordRepairBundle,
} from '../../packages/toolkit/workbench/work-record.js';
import {
  attemptPlan,
  repairableWorkRecordPath,
  repoRoot,
  successfulAttemptArtifact,
} from '../lib/work-record-v1-fixtures.mjs';

function digestFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function snapshotTree(root) {
  if (!fs.existsSync(root)) return [];
  const entries = [];
  function walk(current) {
    for (const name of fs.readdirSync(current).sort()) {
      const file = path.join(current, name);
      const stat = fs.lstatSync(file);
      if (stat.isDirectory()) walk(file);
      else entries.push({
        relative_path: path.relative(root, file),
        digest: stat.isSymbolicLink() ? 'symlink' : digestFile(file),
      });
    }
  }
  walk(root);
  return entries;
}

test('neutral Work Record recovery composes non-executing plans, caller outcomes, and exact finalization', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-recovery-v1-'));
  const bundleRoot = path.join(root, 'bundle');
  const replacementRoot = path.join(root, 'replacement-records');
  const indexRoot = path.join(root, 'supersession-index');
  const attemptPlanPath = path.join(root, 'caller-inputs', 'attempt-plan.json');
  const attemptArtifactPath = path.join(root, 'caller-inputs', 'attempt-artifact.json');
  const sourceDigestBefore = digestFile(repairableWorkRecordPath);

  const initialGuide = guideWorkRecordRepair({ sourceRef: repairableWorkRecordPath, repoRoot });
  assert.equal(initialGuide.current_stage, 'ready_for_attempt_outcomes');
  assert.equal(initialGuide.stage_status, 'ready');
  assert.deepEqual(initialGuide.missing_inputs, ['caller_outcome_input']);
  assert.equal(initialGuide.safe_next_command.id, 'work-record-attempt-artifact-build');
  assert.equal(initialGuide.non_execution_flags.executes_actions, false);

  const bundle = writeWorkRecordRepairBundle({
    sourceRef: repairableWorkRecordPath,
    outputRoot: bundleRoot,
    repoRoot,
  });
  assert.equal(bundle.status, 'written');
  assert.equal(bundle.non_execution_flags.executes_actions, false);
  assert.ok(bundle.written_artifacts.some((item) => item.relative_path === 'artifacts/repair-plan.json'));
  assert.ok(bundle.written_artifacts.some((item) => item.relative_path === 'artifacts/repair-attempt-plan.json'));
  assert.equal(bundle.written_artifacts.some((item) => /execute|attempt-artifact\.json$/.test(item.relative_path)), false);

  const bundleSnapshot = snapshotTree(bundleRoot);
  const inspection = inspectWorkRecordRepairBundle({ bundleRoot });
  assert.equal(inspection.status, 'valid');
  assert.equal(inspection.lifecycle_status, 'blocked');
  assert.deepEqual(inspection.missing_inputs, ['caller_outcome_input']);
  assert.equal(inspection.inspector_ran_commands, false);
  assert.equal(inspection.inspector_mutated_bundle, false);
  assert.deepEqual(snapshotTree(bundleRoot), bundleSnapshot);

  const lifecycle = statusWorkRecordRepairBundles({ bundleRoots: [bundleRoot] });
  assert.equal(lifecycle.status, 'success');
  assert.equal(lifecycle.bundle_count, 1);
  assert.equal(lifecycle.blocked_count, 1);
  assert.deepEqual(lifecycle.bundles[0].missing_inputs, ['caller_outcome_input']);

  const plan = attemptPlan();
  const artifact = successfulAttemptArtifact(plan);
  writeJson(attemptPlanPath, plan);
  writeJson(attemptArtifactPath, artifact);

  const readyGuide = guideWorkRecordRepair({
    sourceRef: repairableWorkRecordPath,
    attemptPlanPath,
    attemptArtifactPath,
    replacementRoot,
    indexRoot,
    repoRoot,
  });
  assert.equal(readyGuide.current_stage, 'ready_to_finalize');
  assert.equal(readyGuide.stage_status, 'ready');
  assert.equal(readyGuide.safe_next_command.id, 'work-record-repair-finalize-dry-run');
  assert.equal(readyGuide.finalization_dry_run_summary.status, 'dry_run');

  const finalizationOptions = {
    sourceRef: repairableWorkRecordPath,
    attemptPlanPath,
    attemptArtifactPath,
    replacementRoot,
    indexRoot,
    proposedIdSeed: 'work-record:recovery-acceptance-v1',
    repoRoot,
  };
  const replacementBeforeDryRun = snapshotTree(replacementRoot);
  const indexBeforeDryRun = snapshotTree(indexRoot);
  const preview = finalizeWorkRecordRepair({ ...finalizationOptions, dryRun: true });
  assert.equal(preview.status, 'dry_run');
  assert.equal(preview.would_write_replacement_record, true);
  assert.equal(preview.would_write_supersession_index_entry, true);
  assert.deepEqual(snapshotTree(replacementRoot), replacementBeforeDryRun);
  assert.deepEqual(snapshotTree(indexRoot), indexBeforeDryRun);

  const finalized = finalizeWorkRecordRepair(finalizationOptions);
  assert.equal(finalized.status, 'finalized');
  assert.equal(finalized.wrote_replacement_record, true);
  assert.equal(finalized.wrote_supersession_index_entry, true);
  assert.equal(finalized.source_work_record.immutable, true);
  assert.equal(finalized.repair_attempt_plan.validation.status, 'passed');
  assert.equal(finalized.repair_attempt_artifact.validation.status, 'passed');
  assert.equal(finalized.readback.supersession_entry_validation.status, 'passed');
  assert.equal(digestFile(repairableWorkRecordPath), sourceDigestBefore);

  const replacementPath = finalized.replacement_writer_result.output.output_path;
  const indexPath = finalized.supersession_index_result.output.index_path;
  assert.ok(fs.existsSync(replacementPath));
  assert.ok(fs.existsSync(indexPath));
  assert.equal(finalizeWorkRecordRepair(finalizationOptions).status, 'already_finalized');

  const lookup = lookupWorkRecordSourceSupersession({
    sourceRef: repairableWorkRecordPath,
    indexRoot,
    replacementRoots: [replacementRoot],
    repoRoot,
  });
  assert.equal(lookup.status, 'active');
  assert.equal(lookup.entries[0].index_path, indexPath);
  assert.equal(lookup.entries[0].replacement_readback.readable, true);

  const completedGuide = guideWorkRecordRepair({
    sourceRef: repairableWorkRecordPath,
    attemptPlanPath,
    attemptArtifactPath,
    replacementRoot,
    indexRoot,
    repoRoot,
  });
  assert.equal(completedGuide.current_stage, 'superseded');
  assert.equal(completedGuide.stage_status, 'complete');
  assert.equal(digestFile(repairableWorkRecordPath), sourceDigestBefore);
  assert.doesNotMatch(
    JSON.stringify({ initialGuide, bundle, inspection, lifecycle, readyGuide, preview, finalized, lookup, completedGuide }),
    /workflow_gate|authorization|approval|required_risk|risk_level|allowlisted|allowed_operations|controlled_fixture|automatic_replay|continuation/,
  );
});

test('caller-supplied artifact fails closed when the source immutability receipt is false', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-work-record-recovery-stale-'));
  const plan = attemptPlan();
  const artifact = successfulAttemptArtifact(plan);
  artifact.source_work_record_mutation_check.after_digest = 'sha256:changed';
  const result = finalizeWorkRecordRepair({
    sourceRef: repairableWorkRecordPath,
    attemptPlanPath: writeJson(path.join(root, 'attempt-plan.json'), plan),
    attemptArtifactPath: writeJson(path.join(root, 'attempt-artifact.json'), artifact),
    replacementRoot: path.join(root, 'records'),
    indexRoot: path.join(root, 'index'),
    repoRoot,
    dryRun: true,
  });
  assert.equal(result.status, 'blocked_invalid_attempt_artifact');
});
