import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  inspectWorkRecordRepairBundle,
  writeWorkRecordRepairBundle,
} from '../../packages/toolkit/workbench/work-record.js';
import { repairableWorkRecordPath, repoRoot } from '../lib/work-record-v1-fixtures.mjs';

function bundle() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-inspect-v1-'));
  assert.equal(writeWorkRecordRepairBundle({ sourceRef: repairableWorkRecordPath, outputRoot: root, repoRoot }).status, 'written');
  return root;
}

test('Bundle Inspector V1 verifies digests, descriptors, bounds, and missing caller input read-only', () => {
  const result = inspectWorkRecordRepairBundle({ bundleRoot: bundle() });
  assert.equal(result.status, 'valid');
  assert.equal(result.lifecycle_status, 'blocked');
  assert.equal(result.safe_next_command.id, 'work-record-attempt-artifact-build');
  assert.deepEqual(result.missing_inputs, ['caller_outcome_input']);
  assert.equal(result.inspector_ran_commands, false);
  assert.equal(result.inspector_mutated_bundle, false);
  assert.ok(result.descriptors.every((descriptor) => descriptor.status === 'valid'));
  assert.equal('continuation' in result, false);
});

test('Bundle Inspector preserves repeated-space bundle roots', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-inspect-spaced-v1-'));
  const root = path.join(parent, 'repair  bundle');
  assert.equal(writeWorkRecordRepairBundle({ sourceRef: repairableWorkRecordPath, outputRoot: root, repoRoot }).status, 'written');
  const result = inspectWorkRecordRepairBundle({ bundleRoot: root });
  assert.equal(result.status, 'valid');
  assert.equal(result.bundle_root, root);
  assert.equal(result.canonical_bundle_root, fs.realpathSync(root));
});

test('Bundle Inspector fails closed on digest mismatch, missing manifest, and symlinked artifact', () => {
  const digestRoot = bundle();
  fs.writeFileSync(path.join(digestRoot, 'guide-report.json'), '{}\n');
  assert.equal(inspectWorkRecordRepairBundle({ bundleRoot: digestRoot }).status, 'blocked_digest_mismatch');
  const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-inspect-missing-'));
  assert.equal(inspectWorkRecordRepairBundle({ bundleRoot: missingRoot }).status, 'blocked_missing_manifest');
  const symlinkRoot = bundle();
  const guide = path.join(symlinkRoot, 'guide-report.json');
  const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'aos-inspect-outside-')), 'guide.json');
  fs.renameSync(guide, outside);
  fs.symlinkSync(outside, guide);
  assert.equal(inspectWorkRecordRepairBundle({ bundleRoot: symlinkRoot }).status, 'blocked_path_escape');

  const pathTamperRoot = bundle();
  const manifestPath = path.join(pathTamperRoot, 'bundle-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.artifacts[0].path = path.join(os.tmpdir(), 'outside-bundle.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const pathTamper = inspectWorkRecordRepairBundle({ bundleRoot: pathTamperRoot });
  assert.equal(pathTamper.status, 'blocked_path_escape');
  assert.ok(pathTamper.diagnostics.some((item) => item.code === 'WORK_RECORD_REPAIR_BUNDLE_INSPECT_MANIFEST_PATH_ESCAPE'));
});

test('Bundle Inspector rejects guide command fields that differ from the verified descriptor', () => {
  const root = bundle();
  const guidePath = path.join(root, 'guide-report.json');
  const manifestPath = path.join(root, 'bundle-manifest.json');
  const guide = JSON.parse(fs.readFileSync(guidePath, 'utf8'));
  guide.safe_next_command.argv = ['/tmp/unverified-command'];
  fs.writeFileSync(guidePath, `${JSON.stringify(guide, null, 2)}\n`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const guideEntry = manifest.artifacts.find((entry) => entry.relative_path === 'guide-report.json');
  guideEntry.digest = `sha256:${crypto.createHash('sha256').update(fs.readFileSync(guidePath)).digest('hex')}`;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const result = inspectWorkRecordRepairBundle({ bundleRoot: root });
  assert.equal(result.status, 'blocked_descriptor_mismatch');
  assert.equal(result.safe_next_command, null);
  assert.ok(result.diagnostics.some((item) => item.code === 'WORK_RECORD_REPAIR_BUNDLE_INSPECT_NEXT_DESCRIPTOR_MISMATCH'));
});
