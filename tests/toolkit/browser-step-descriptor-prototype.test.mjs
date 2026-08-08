import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createBrowserStepDescriptorPrototype,
  runBrowserStepDescriptorPrototype,
} from '../../packages/toolkit/workbench/browser-step-descriptor-prototype.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => JSON.parse(fs.readFileSync(path.join(repoRoot, relative), 'utf8'));

test('browser prototype V1 is a report-only one-step saved-evidence bridge', () => {
  const prototype = createBrowserStepDescriptorPrototype({
    stepDescriptor: read('shared/schemas/fixtures/aos-step-descriptor-v1/valid/browser-click-status.json'),
    evidenceSource: read('shared/schemas/fixtures/aos-work-record-v1/evidence/aos-browser-click-status.json'),
  });
  assert.equal(prototype.schema_version, '2026-08-browser-step-descriptor-prototype-v1');
  assert.deepEqual(prototype.run_policy, {
    mode: 'simulate',
    one_step_only: true,
    verifier_profile_id: 'aos.verifier.work-record.v1.report-only',
    evidence_source_required: true,
  });
  const result = runBrowserStepDescriptorPrototype(prototype);
  assert.equal(result.status, 'passed');
  assert.equal(result.record.schema_version, '2026-08-work-record-v1');
  assert.equal(result.workbench_open_message.record.id, result.record.id);
  assert.equal(result.subject.metadata.emits_work_record_v1, true);
  assert.doesNotMatch(JSON.stringify(result), /workflow_gate|authorization|approval|required_risk|risk_level|allowlisted|automatic_replay/);
});

test('browser prototype does not open a Work Record when postcondition state identity drifts', () => {
  const stepDescriptor = read('shared/schemas/fixtures/aos-step-descriptor-v1/valid/browser-click-status.json');
  const evidenceSource = read('shared/schemas/fixtures/aos-work-record-v1/evidence/aos-browser-click-status.json');
  evidenceSource.postcondition.state_id = 'see_unrelated_after_state';
  const result = runBrowserStepDescriptorPrototype(createBrowserStepDescriptorPrototype({
    stepDescriptor,
    evidenceSource,
  }));
  assert.equal(result.status, 'rejected');
  assert.equal(result.record, null);
  assert.equal(result.workbench_open_message, null);
  assert.equal(result.harness.reason, 'step_descriptor_postcondition_state_binding_mismatch');
});
