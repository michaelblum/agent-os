import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createStepDescriptorWorkbenchState,
  loadStepDescriptorWorkbenchFixture,
  openStepDescriptorWorkbenchWorkRecord,
  simulateStepDescriptorWorkbench,
  stepDescriptorWorkbenchSnapshot,
  STEP_DESCRIPTOR_WORKBENCH_MESSAGE_TYPES,
  STEP_DESCRIPTOR_WORKBENCH_SCHEMA_VERSION,
  STEP_DESCRIPTOR_WORKBENCH_SURFACE,
} from '../../packages/toolkit/components/step-descriptor-workbench/model.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => JSON.parse(fs.readFileSync(path.join(repoRoot, relative), 'utf8'));

test('Step Descriptor Workbench V1 simulates and opens one read-only Work Record', () => {
  const state = createStepDescriptorWorkbenchState({
    stepDescriptor: read('shared/schemas/fixtures/aos-step-descriptor-v1/valid/browser-click-status.json'),
    evidenceSource: read('shared/schemas/fixtures/aos-work-record-v1/evidence/aos-browser-click-status.json'),
  });
  assert.equal(STEP_DESCRIPTOR_WORKBENCH_SCHEMA_VERSION, '2026-08-step-descriptor-workbench-v1');
  assert.equal(STEP_DESCRIPTOR_WORKBENCH_SURFACE, 'step-descriptor-workbench-v1');
  assert.equal(simulateStepDescriptorWorkbench(state).status, 'passed');
  assert.equal(openStepDescriptorWorkbenchWorkRecord(state).read_only, true);
  const snapshot = stepDescriptorWorkbenchSnapshot(state);
  assert.equal(snapshot.work_record_summary.health_verdict, 'valid');
  assert.equal(snapshot.forbidden_controls.replay, false);
  assert.equal(snapshot.forbidden_controls.repair, false);
  assert.deepEqual(Object.keys(STEP_DESCRIPTOR_WORKBENCH_MESSAGE_TYPES).sort(), ['load', 'simulateRequested', 'simulateResult', 'workRecordOpenRequested', 'workRecordOpenResult'].sort());
});

test('Step Descriptor Workbench source exposes no authority controls or messages', () => {
  const source = [
    'packages/toolkit/components/step-descriptor-workbench/index.js',
    'packages/toolkit/components/step-descriptor-workbench/model.js',
    'packages/toolkit/components/step-descriptor-workbench/index.html',
  ].map((relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8')).join('\n');
  assert.doesNotMatch(source, /workflowGate|workflow_gate|gate-token|gate-ref|authorization|approval_required|risk_level|allowed_operations/);
});

test('Step Descriptor Workbench rejects V0, unknown, and malformed inputs before ready state', () => {
  const evidence = read('shared/schemas/fixtures/aos-work-record-v1/evidence/aos-browser-click-status.json');
  const active = read('shared/schemas/fixtures/aos-step-descriptor-v1/valid/browser-click-status.json');
  const candidates = [
    read('shared/schemas/fixtures/aos-step-descriptor-v0/valid/browser-click-status.json'),
    { ...structuredClone(active), schema_version: '2099-01-step-descriptor-v9' },
    { type: 'aos.step_descriptor', schema_version: '2026-08-step-descriptor-v1', id: 'step-descriptor:malformed' },
  ];
  for (const stepDescriptor of candidates) {
    const initialized = createStepDescriptorWorkbenchState({ stepDescriptor, evidenceSource: evidence });
    assert.equal(initialized.status, 'rejected');
    assert.equal(initialized.fixture_loaded, false);
    assert.equal(initialized.prototype, null);
    assert.ok(initialized.diagnostics.length > 0);

    const loaded = createStepDescriptorWorkbenchState();
    const result = loadStepDescriptorWorkbenchFixture(loaded, { stepDescriptor, evidenceSource: evidence });
    assert.equal(result.status, 'rejected');
    assert.equal(loaded.status, 'rejected');
    assert.equal(loaded.fixture_loaded, false);
    assert.equal(loaded.prototype, null);
  }
});
