import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildWorkRecordV0FromAosActionEvidence,
  buildWorkRecordV0FromCommandEvidence,
  WORK_RECORD_AOS_ACTION_CAPTURE_BUILDER_VERSION,
  WORK_RECORD_COMMAND_CAPTURE_BUILDER_VERSION,
} from '../../packages/toolkit/workbench/work-record-capture.js';
import {
  runWorkRecordVerifierProfile,
  WORK_RECORD_REPORT_ONLY_PROFILE_ID,
} from '../../packages/toolkit/workbench/work-record-verifier.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0');

function fixture(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, relativePath), 'utf8'));
}

test('command evidence builder emits the generated Work Record v0 fixture', () => {
  const source = fixture('evidence/repo-command-adapter-test.json');
  const expected = fixture('valid/repo-command-adapter-test.json');
  const record = buildWorkRecordV0FromCommandEvidence(source);

  assert.deepEqual(record, expected);
  assert.equal(record.type, 'aos.work_record');
  assert.equal(record.metadata.generated_by, WORK_RECORD_COMMAND_CAPTURE_BUILDER_VERSION);
  assert.equal(record.verifier_report.verifier.id, WORK_RECORD_REPORT_ONLY_PROFILE_ID);
  assert.equal(record.execution_map.replay_policy.mode, 'report_only');
  assert.equal(record.execution_map.replay_policy.replay_requires_workflow_gate, true);
  assert.equal(record.execution_map.replay_policy.repair_requires_workflow_gate, true);
});

test('generated command Work Record passes the named report-only verifier profile', () => {
  const record = fixture('valid/repo-command-adapter-test.json');
  const result = runWorkRecordVerifierProfile(record, {
    profileId: WORK_RECORD_REPORT_ONLY_PROFILE_ID,
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.profile_id, WORK_RECORD_REPORT_ONLY_PROFILE_ID);
  assert.equal(result.mutates_record, false);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.derived_indexes, record.verifier_report.derived_indexes);
  assert.equal(result.summary.replay_gated, true);
  assert.equal(result.summary.repair_gated, true);
});

test('AOS action evidence builder emits the generated Work Record v0 fixture', () => {
  const source = fixture('evidence/aos-browser-click-status.json');
  const expected = fixture('valid/aos-browser-click-status.json');
  const record = buildWorkRecordV0FromAosActionEvidence(source);

  assert.deepEqual(record, expected);
  assert.equal(record.type, 'aos.work_record');
  assert.equal(record.metadata.generated_by, WORK_RECORD_AOS_ACTION_CAPTURE_BUILDER_VERSION);
  assert.equal(record.metadata.target_dialect, 'browser');
  assert.equal(record.metadata.target_with_ref, 'browser:work-record-live-action/e2');
  assert.equal(record.verifier_report.verifier.id, WORK_RECORD_REPORT_ONLY_PROFILE_ID);
  assert.equal(record.execution_map.replay_policy.mode, 'report_only');
  assert.equal(record.execution_map.replay_policy.replay_requires_workflow_gate, true);
  assert.equal(record.execution_map.replay_policy.repair_requires_workflow_gate, true);
  assert.equal(record.evidence.length, 3);
  assert.deepEqual(record.evidence.map((item) => item.kind), [
    'aos_see_capture',
    'aos_do_action',
    'aos_see_capture',
  ]);
  assert.equal(record.evidence[0].state_id, 'see_browserlive001');
  assert.equal(record.evidence[1].target, 'browser:work-record-live-action/e2');
  assert.equal(record.evidence[2].state_id, 'see_browserlive002');
});

test('generated AOS action Work Record passes the named report-only verifier profile', () => {
  const record = fixture('valid/aos-browser-click-status.json');
  const result = runWorkRecordVerifierProfile(record, {
    profileId: WORK_RECORD_REPORT_ONLY_PROFILE_ID,
  });

  assert.equal(result.status, 'passed');
  assert.equal(result.profile_id, WORK_RECORD_REPORT_ONLY_PROFILE_ID);
  assert.equal(result.mutates_record, false);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.derived_indexes, record.verifier_report.derived_indexes);
  assert.equal(result.summary.evidence, 3);
  assert.equal(result.summary.postconditions, 3);
  assert.equal(result.summary.replay_gated, true);
  assert.equal(result.summary.repair_gated, true);
});
