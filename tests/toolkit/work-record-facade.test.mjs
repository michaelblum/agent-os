import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as facade from '../../packages/toolkit/workbench/work-record.js';
import * as workbench from '../../packages/toolkit/workbench/index.js';

const required = [
  'buildWorkRecordV1FromAosActionEvidence',
  'buildWorkRecordV1FromCommandEvidence',
  'buildWorkRecordV1FromStepDescriptorEvidence',
  'planWorkRecordRepair',
  'planWorkRecordRepairAttempt',
  'buildWorkRecordRepairAttemptArtifact',
  'buildWorkRecordReplacementProposal',
  'writeReplacementWorkRecord',
  'finalizeWorkRecordRepair',
  'writeWorkRecordSourceSupersessionIndex',
];

test('public Work Record facade exposes neutral V1 mechanics', () => {
  for (const name of required) assert.equal(typeof facade[name], 'function', name);
  for (const name of ['buildWorkRecordGateRequest', 'checkWorkRecordGateAuthorization', 'executeControlledWorkRecordRepair', 'controlledRepairFixtureRegistry']) {
    assert.equal(name in facade, false, name);
  }
});

test('Workbench aggregate exposes the same Work Record V1 facade', () => {
  for (const name of required) assert.equal(workbench[name], facade[name], name);
});
