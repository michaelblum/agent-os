import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as adapter from '../../packages/toolkit/workbench/work-record-adapter.js';
import * as capture from '../../packages/toolkit/workbench/work-record-capture.js';
import * as evidenceAdapters from '../../packages/toolkit/workbench/work-record-evidence-adapters.js';
import * as facade from '../../packages/toolkit/workbench/work-record.js';
import * as subject from '../../packages/toolkit/workbench/work-record-subject.js';
import * as verifier from '../../packages/toolkit/workbench/work-record-verifier.js';
import * as workbench from '../../packages/toolkit/workbench/index.js';

test('Work Record facade re-exports current build, verify, evidence, adapter, and projection operations', () => {
  assert.equal(facade.WORK_RECORD_V0_SCHEMA_VERSION, adapter.WORK_RECORD_V0_SCHEMA_VERSION);
  assert.equal(facade.isWorkRecordV0, adapter.isWorkRecordV0);
  assert.equal(facade.normalizeWorkRecord, adapter.normalizeWorkRecord);
  assert.equal(facade.workRecordEvidenceArtifacts, adapter.workRecordEvidenceArtifacts);

  assert.equal(facade.buildWorkRecordV0FromCommandEvidence, capture.buildWorkRecordV0FromCommandEvidence);
  assert.equal(facade.buildWorkRecordV0FromAosActionEvidence, capture.buildWorkRecordV0FromAosActionEvidence);
  assert.equal(facade.buildWorkRecordV0FromPlaybookStepEvidence, capture.buildWorkRecordV0FromPlaybookStepEvidence);

  assert.equal(facade.checkWorkRecordEvidenceAdapters, evidenceAdapters.checkWorkRecordEvidenceAdapters);
  assert.equal(facade.workRecordEvidenceAdapters, evidenceAdapters.workRecordEvidenceAdapters);

  assert.equal(facade.createWorkRecordSubject, subject.createWorkRecordSubject);
  assert.equal(facade.createWorkRecordSubjects, subject.createWorkRecordSubjects);

  assert.equal(facade.runWorkRecordVerifierProfile, verifier.runWorkRecordVerifierProfile);
  assert.equal(facade.checkWorkRecordReportOnly, verifier.checkWorkRecordReportOnly);
  assert.equal(facade.deriveWorkRecordClaimIndexes, verifier.deriveWorkRecordClaimIndexes);
  assert.equal(facade.WORK_RECORD_REPORT_ONLY_PROFILE_ID, verifier.WORK_RECORD_REPORT_ONLY_PROFILE_ID);
});

test('Workbench aggregate exposes the Work Record facade contract', () => {
  assert.equal(workbench.buildWorkRecordV0FromCommandEvidence, facade.buildWorkRecordV0FromCommandEvidence);
  assert.equal(workbench.buildWorkRecordV0FromPlaybookStepEvidence, facade.buildWorkRecordV0FromPlaybookStepEvidence);
  assert.equal(workbench.createWorkRecordSubject, facade.createWorkRecordSubject);
  assert.equal(workbench.normalizeWorkRecord, facade.normalizeWorkRecord);
  assert.equal(workbench.runWorkRecordVerifierProfile, facade.runWorkRecordVerifierProfile);
  assert.equal(workbench.checkWorkRecordEvidenceAdapters, facade.checkWorkRecordEvidenceAdapters);
});
