import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  statusWorkRecordRepairBundles,
  writeWorkRecordRepairBundle,
} from '../../packages/toolkit/workbench/work-record.js';
import { repairableWorkRecordPath, repoRoot } from '../lib/work-record-v1-fixtures.mjs';

test('Bundle lifecycle status scans only explicit roots and immediate parent children', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-status-v1-'));
  const root = path.join(parent, 'bundle');
  assert.equal(writeWorkRecordRepairBundle({ sourceRef: repairableWorkRecordPath, outputRoot: root, repoRoot }).status, 'written');
  const result = statusWorkRecordRepairBundles({ bundleRoots: [root], bundleParents: [parent] });
  assert.equal(result.status, 'success');
  assert.equal(result.bundle_count, 1);
  assert.equal(result.blocked_count, 1);
  assert.equal(result.bundles[0].guide_stage, 'ready_for_attempt_outcomes');
  assert.deepEqual(result.bundles[0].missing_inputs, ['caller_outcome_input']);
  assert.equal(result.bundles[0].next_command, null);
  assert.equal(result.roots.discovery.parent_scan_depth, 1);
  assert.equal('requires_user_approval' in result.bundles[0], false);
});

test('Bundle lifecycle status requires explicit scan roots', () => {
  const result = statusWorkRecordRepairBundles();
  assert.equal(result.status, 'failed');
  assert.equal(result.bundle_count, 0);
});

test('Bundle lifecycle status preserves repeated-space roots', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'aos-status-spaced-v1-'));
  const root = path.join(parent, 'repair  bundle');
  assert.equal(writeWorkRecordRepairBundle({ sourceRef: repairableWorkRecordPath, outputRoot: root, repoRoot }).status, 'written');
  const result = statusWorkRecordRepairBundles({ bundleRoots: [root] });
  assert.equal(result.status, 'success');
  assert.equal(result.roots.supplied_bundle_roots[0], root);
  assert.equal(result.bundles[0].bundle_root, root);
});
