import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  planWorkRecordRepairBundle,
  writeWorkRecordRepairBundle,
} from '../../packages/toolkit/workbench/work-record-repair-bundle.js';
import { repairableWorkRecordPath, repoRoot } from '../lib/work-record-v1-fixtures.mjs';
import { installWorkRecordAtomicPublishTestHook } from '../../packages/toolkit/workbench/work-record-atomic-publish.js';

function withAtomicPublishHook(callback, run) {
  const restore = installWorkRecordAtomicPublishTestHook(callback);
  try {
    return run();
  } finally {
    restore();
  }
}

test('Recovery Bundle V1 plans without writing and materializes only neutral handoff artifacts', () => {
  const outputRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aos-bundle-parent-')), 'bundle');
  const preview = planWorkRecordRepairBundle({ sourceRef: repairableWorkRecordPath, outputRoot, repoRoot });
  assert.equal(preview.status, 'planned');
  assert.equal(fs.existsSync(outputRoot), false);
  const result = writeWorkRecordRepairBundle({ sourceRef: repairableWorkRecordPath, outputRoot, repoRoot });
  assert.equal(result.status, 'written');
  const paths = result.written_artifacts.map((item) => item.relative_path).sort();
  assert.ok(paths.includes('artifacts/repair-plan.json'));
  assert.ok(paths.includes('artifacts/repair-attempt-plan.json'));
  assert.ok(paths.includes('commands/work-record-attempt-artifact-build.json'));
  assert.equal(paths.some((item) => /gate|execute|repair-attempt-artifact\.json$/.test(item)), false);
  assert.equal(result.non_execution_flags.executes_actions, false);
  assert.equal(result.recovery_summary.stage, result.guide_report.current_stage);
  assert.equal(result.recovery_summary.next_command.id, 'work-record-attempt-artifact-build');
  assert.deepEqual(result.recovery_summary.missing_inputs, ['caller_outcome_input']);
  assert.ok(result.recovery_summary.why);
  assert.doesNotMatch(JSON.stringify(result), /workflow_gate|authorization|approval|required_risk|risk_level|allowlisted|controlled_fixture|continuation/);
});

test('Recovery Bundle dry-run retains the exact guide recovery handoff', () => {
  const outputRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aos-bundle-dry-run-')), 'bundle');
  const result = writeWorkRecordRepairBundle({ sourceRef: repairableWorkRecordPath, outputRoot, repoRoot, dryRun: true });
  assert.equal(result.status, 'dry_run');
  assert.equal(result.recovery_summary.stage, result.guide_report.current_stage);
  assert.deepEqual(result.recovery_summary.next_command, result.next_recommended_command);
  assert.deepEqual(result.recovery_summary.missing_inputs, ['caller_outcome_input']);
});

test('Recovery Bundle rejects traversal and conflicting bytes', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-bundle-file-root-'));
  const fileRoot = path.join(parent, 'not-a-directory');
  fs.writeFileSync(fileRoot, 'occupied');
  assert.equal(planWorkRecordRepairBundle({ sourceRef: repairableWorkRecordPath, outputRoot: fileRoot, repoRoot }).status, 'blocked_output_root');
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-bundle-conflict-'));
  fs.writeFileSync(path.join(outputRoot, 'guide-report.json'), '{}\n');
  assert.equal(writeWorkRecordRepairBundle({ sourceRef: repairableWorkRecordPath, outputRoot, repoRoot }).status, 'blocked_conflict');
});

test('Recovery Bundle preserves raced-in bytes and reports prior partial writes', () => {
  const outputRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aos-bundle-race-v1-')), 'bundle');
  const racedBytes = 'concurrent bundle bytes\n';
  let publishCount = 0;
  const result = withAtomicPublishHook((event) => {
    if (event.operation === 'publish' && event.phase === 'before_publish_link') {
      publishCount += 1;
      if (publishCount === 2) fs.writeFileSync(event.destination_path, racedBytes, { flag: 'wx' });
    }
  }, () => writeWorkRecordRepairBundle({ sourceRef: repairableWorkRecordPath, outputRoot, repoRoot }));
  assert.equal(result.status, 'blocked_conflict');
  assert.equal(result.written_artifacts.length, 1);
  assert.equal(result.written_artifacts[0].write_status, 'written');
  assert.equal(result.failed_artifact.publication_status, 'conflict');
  assert.equal(result.failed_artifact.destination_published, false);
  assert.equal(fs.readFileSync(result.failed_artifact.path, 'utf8'), racedBytes);
  assert.equal(result.failed_artifact.content_scrubbed, true);
  assert.equal(result.failed_artifact.temp_file_leftover, true);
  assert.equal(fs.existsSync(result.failed_artifact.temp_file), true);
  assert.equal(fs.statSync(result.failed_artifact.temp_file).size, 0);
  fs.rmSync(result.failed_artifact.temp_file, { force: true });
});

test('Recovery Bundle receipts survive a conflict appearing between artifact publications', () => {
  const outputRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aos-bundle-between-race-v1-')), 'bundle');
  const preview = planWorkRecordRepairBundle({ sourceRef: repairableWorkRecordPath, outputRoot, repoRoot });
  const racedArtifactPath = preview.planned_artifacts[1].path;
  const racedBytes = 'between-publications bundle bytes\n';
  let publishCount = 0;
  const result = withAtomicPublishHook((event) => {
    if (event.operation === 'publish' && event.phase === 'after_publish_link') {
      publishCount += 1;
      if (publishCount === 1) fs.writeFileSync(racedArtifactPath, racedBytes, { flag: 'wx' });
    }
  }, () => writeWorkRecordRepairBundle({ sourceRef: repairableWorkRecordPath, outputRoot, repoRoot }));
  assert.equal(result.status, 'blocked_conflict');
  assert.equal(result.written_artifacts.length, 0);
  assert.equal(result.failed_artifact.relative_path, preview.planned_artifacts[0].relative_path);
  assert.equal(result.failed_artifact.destination_published, false);
  assert.equal(result.failed_artifact.content_scrubbed, true);
  assert.equal(result.failed_artifact.destination_file_leftover, true);
  assert.equal(fs.existsSync(result.failed_artifact.path), true);
  assert.equal(fs.statSync(result.failed_artifact.path).size, 0);
  assert.equal(fs.readFileSync(racedArtifactPath, 'utf8'), racedBytes);
});

test('Recovery Bundle retains partial receipts when later artifact I/O throws', () => {
  const outputRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aos-bundle-io-failure-v1-')), 'bundle');
  let publicationCalls = 0;
  const result = withAtomicPublishHook((event) => {
    if (event.operation === 'publish' && event.phase === 'before_temp_open') {
      publicationCalls += 1;
      if (publicationCalls === 3) return { fail_operation: 'open_temp' };
    }
    return undefined;
  }, () => writeWorkRecordRepairBundle({ sourceRef: repairableWorkRecordPath, outputRoot, repoRoot }));
  assert.equal(result.status, 'blocked_write_failed');
  assert.ok(result.written_artifacts.length >= 1);
  assert.equal(result.written_artifacts[0].write_status, 'written');
  assert.equal(fs.existsSync(result.written_artifacts[0].path), true);
  assert.equal(result.failed_artifact.publication_status, 'write_failed');
  assert.ok(result.diagnostics.some((item) => item.code === 'WORK_RECORD_REPAIR_BUNDLE_WRITE_FAILED'));
});

test('Recovery Bundle receipts a scrubbed staged file when publication fails', () => {
  const outputRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aos-bundle-cleanup-v1-')), 'bundle');
  let injected = false;
  const result = withAtomicPublishHook((event) => {
    if (!injected && event.operation === 'publish' && event.phase === 'before_publish_link') {
      injected = true;
      return { fail_operation: 'link_destination' };
    }
    return undefined;
  }, () => writeWorkRecordRepairBundle({ sourceRef: repairableWorkRecordPath, outputRoot, repoRoot }));
  assert.equal(result.status, 'blocked_write_failed');
  assert.equal(result.failed_artifact.publication_status, 'write_failed');
  assert.equal(result.failed_artifact.destination_published, false);
  assert.equal(result.failed_artifact.content_scrubbed, true);
  assert.equal(result.failed_artifact.temp_file_leftover, true);
  assert.equal(result.failed_artifact.destination_file_leftover, false);
  assert.equal(result.failed_artifact.digest, '');
  assert.equal(result.written_artifacts.length, 0);
  assert.equal(fs.existsSync(result.failed_artifact.path), false);
  assert.equal(fs.existsSync(result.failed_artifact.temp_file), true);
  assert.equal(fs.statSync(result.failed_artifact.temp_file).size, 0);
  fs.rmSync(result.failed_artifact.temp_file, { force: true });
});
