import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyWorkRecordPatchResult,
  buildWorkRecordPatchRequest,
  createWorkRecordWorkbenchState,
  evidenceArtifacts,
  executionMapJson,
  openWorkRecord,
  updateWorkRecordExecutionMapJson,
  updateWorkRecordIntent,
  workRecordDiagnostics,
  workRecordIsReadOnly,
  workRecordVerifierCheck,
  workRecordWorkbenchSnapshot,
} from '../../packages/toolkit/components/work-record-workbench/model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(repoRoot, 'docs/design/fixtures/aos-work-records');
const v0FixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0/valid');

function fixture(name, root = fixtureRoot) {
  return JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
}

test('work record workbench opens a do_step and exposes subject snapshot', () => {
  const state = createWorkRecordWorkbenchState();
  const result = openWorkRecord(state, {
    type: 'work_record.open',
    source: {
      kind: 'file',
      path: '/tmp/work-record.json',
    },
    record: fixture('browser-artifact-collection-step.json'),
  });
  const snapshot = workRecordWorkbenchSnapshot(state);

  assert.equal(result.status, 'opened');
  assert.equal(state.dirty, false);
  assert.equal(snapshot.subject.type, 'aos.workbench.subject');
  assert.equal(snapshot.subject.id, 'work-record:collect-company-careers-page');
  assert.equal(snapshot.subject.subject_type, 'aos.do_step');
  assert.deepEqual(snapshot.source, { kind: 'file', path: '/tmp/work-record.json' });
  assert.ok(snapshot.subject.capabilities.includes('work_record.patch.requested'));
  assert.equal(snapshot.diagnostics.health_state, 'stale');
  assert.equal(snapshot.diagnostics.artifact_count, 3);
});

test('work record workbench edits intent and execution-map JSON', () => {
  const state = createWorkRecordWorkbenchState({ record: fixture('canvas-toolkit-control-step.json') });

  updateWorkRecordIntent(state, {
    nl: 'Tune the panel with the updated target.',
    purpose: 'Manual repair',
  });
  assert.equal(state.dirty, true);
  assert.equal(state.record.intent.nl, 'Tune the panel with the updated target.');

  const applied = updateWorkRecordExecutionMapJson(state, JSON.stringify({
    target: 'canvas:object-transform-panel/wiki-brain',
    assertions: [{ kind: 'visible' }],
  }));
  assert.equal(applied.status, 'applied');
  assert.deepEqual(state.record.execution_map.assertions, [{ kind: 'visible' }]);

  const request = buildWorkRecordPatchRequest(state, { requestId: 'patch-1' });
  assert.equal(request.request_id, 'patch-1');
  assert.equal(request.record_id, state.record.id);
  assert.equal(request.source, null);
  assert.equal(request.patch.intent.nl, 'Tune the panel with the updated target.');
  assert.equal(request.patch.execution_map.target, 'canvas:object-transform-panel/wiki-brain');
});

test('work record patch requests preserve file source metadata', () => {
  const state = createWorkRecordWorkbenchState({
    record: fixture('browser-artifact-collection-step.json'),
    source: {
      kind: 'file',
      path: '/tmp/source-record.json',
    },
  });

  updateWorkRecordIntent(state, { purpose: 'source-preserving edit' });
  const request = buildWorkRecordPatchRequest(state, { requestId: 'source-patch' });

  assert.deepEqual(request.source, { kind: 'file', path: '/tmp/source-record.json' });
  assert.deepEqual(workRecordWorkbenchSnapshot(state).source, { kind: 'file', path: '/tmp/source-record.json' });
});

test('work record workbench opens a v0 fixture read-only without lossy rewriting', () => {
  const state = createWorkRecordWorkbenchState();
  const record = fixture('playbook-origin.json', v0FixtureRoot);
  const result = openWorkRecord(state, {
    type: 'work_record.open',
    source: {
      kind: 'file',
      path: '/tmp/playbook-origin.json',
    },
    record,
  });
  const snapshot = workRecordWorkbenchSnapshot(state);

  assert.equal(result.status, 'opened');
  assert.equal(state.dirty, false);
  assert.equal(workRecordIsReadOnly(state.record), true);
  assert.deepEqual(state.record.evidence, record.evidence);
  assert.equal(snapshot.subject.id, 'work-record:playbook-open-wiki-sigil-2026-05-05');
  assert.equal(snapshot.subject.subject_type, 'aos.work_record');
  assert.equal(snapshot.subject.persistence, null);
  assert.ok(snapshot.subject.views.includes('work_record.verifier_report'));
  assert.ok(!snapshot.subject.capabilities.includes('work_record.patch.requested'));
  assert.ok(!snapshot.subject.controls.includes('patch.request'));
  assert.equal(snapshot.diagnostics.health_state, 'valid');
  assert.equal(snapshot.diagnostics.claim_count, 2);
  assert.equal(snapshot.diagnostics.claim_result_count, 2);
  assert.equal(snapshot.diagnostics.postcondition_count, 3);
  assert.equal(evidenceArtifacts(state.record).length, 3);
  assert.match(executionMapJson(state.record), /postcondition:sigil-heading-visible/);
  assert.equal(workRecordVerifierCheck(state.record).status, 'passed');

  const rejectedIntent = updateWorkRecordIntent(state, { summary: 'mutate v0' });
  assert.equal(rejectedIntent.status, 'rejected');
  assert.equal(rejectedIntent.reason, 'read_only');
  assert.equal(state.dirty, false);

  const rejectedMap = updateWorkRecordExecutionMapJson(state, '{}');
  assert.equal(rejectedMap.status, 'rejected');
  assert.equal(rejectedMap.reason, 'read_only');
  assert.throws(() => buildWorkRecordPatchRequest(state), /read-only/);
});

test('work record workbench opens generated command v0 records read-only', () => {
  const state = createWorkRecordWorkbenchState();
  const record = fixture('repo-command-adapter-test.json', v0FixtureRoot);
  const result = openWorkRecord(state, {
    type: 'work_record.open',
    source: {
      kind: 'file',
      path: '/tmp/repo-command-adapter-test.json',
    },
    record,
  });
  const snapshot = workRecordWorkbenchSnapshot(state);

  assert.equal(result.status, 'opened');
  assert.equal(workRecordIsReadOnly(state.record), true);
  assert.equal(snapshot.subject.id, 'work-record:repo-command-work-record-adapter-test-2026-05-06');
  assert.equal(snapshot.subject.subject_type, 'aos.work_record');
  assert.equal(snapshot.subject.persistence, null);
  assert.ok(snapshot.subject.views.includes('work_record.verifier_report'));
  assert.ok(!snapshot.subject.capabilities.includes('work_record.patch.requested'));
  assert.ok(!snapshot.subject.controls.includes('patch.request'));
  assert.equal(snapshot.diagnostics.format, 'v0');
  assert.equal(snapshot.diagnostics.read_only, true);
  assert.equal(snapshot.diagnostics.health_state, 'valid');
  assert.equal(snapshot.diagnostics.verifier_status, 'passed');
  assert.equal(snapshot.diagnostics.claim_count, 2);
  assert.equal(snapshot.diagnostics.postcondition_count, 2);
  assert.equal(workRecordVerifierCheck(state.record).profile_id, 'aos.verifier.work-record.v0.report-only');
});

test('work record workbench opens generated AOS action v0 records read-only', () => {
  const state = createWorkRecordWorkbenchState();
  const record = fixture('aos-browser-click-status.json', v0FixtureRoot);
  const result = openWorkRecord(state, {
    type: 'work_record.open',
    source: {
      kind: 'file',
      path: '/tmp/aos-browser-click-status.json',
    },
    record,
  });
  const snapshot = workRecordWorkbenchSnapshot(state);

  assert.equal(result.status, 'opened');
  assert.equal(workRecordIsReadOnly(state.record), true);
  assert.equal(snapshot.subject.id, 'work-record:aos-browser-click-status-2026-05-06');
  assert.equal(snapshot.subject.subject_type, 'aos.work_record');
  assert.equal(snapshot.subject.persistence, null);
  assert.ok(snapshot.subject.views.includes('work_record.verifier_report'));
  assert.ok(!snapshot.subject.capabilities.includes('work_record.patch.requested'));
  assert.ok(!snapshot.subject.controls.includes('patch.request'));
  assert.equal(snapshot.diagnostics.format, 'v0');
  assert.equal(snapshot.diagnostics.read_only, true);
  assert.equal(snapshot.diagnostics.health_state, 'valid');
  assert.equal(snapshot.diagnostics.verifier_status, 'passed');
  assert.equal(snapshot.diagnostics.claim_count, 2);
  assert.equal(snapshot.diagnostics.postcondition_count, 3);
  assert.equal(evidenceArtifacts(state.record).length, 3);
  assert.ok(executionMapJson(state.record).includes('browser:work-record-live-action/e2'));
  assert.equal(workRecordVerifierCheck(state.record).profile_id, 'aos.verifier.work-record.v0.report-only');

  const rejectedIntent = updateWorkRecordIntent(state, { summary: 'mutate action record' });
  assert.equal(rejectedIntent.status, 'rejected');
  assert.equal(rejectedIntent.reason, 'read_only');
  assert.equal(state.dirty, false);
  assert.throws(() => buildWorkRecordPatchRequest(state), /read-only/);
});

test('work record workbench opens generated Playbook-origin v0 records read-only', () => {
  const state = createWorkRecordWorkbenchState();
  const record = fixture('playbook-browser-click-status.json', v0FixtureRoot);
  const result = openWorkRecord(state, {
    type: 'work_record.open',
    source: {
      kind: 'file',
      path: '/tmp/playbook-browser-click-status.json',
    },
    record,
  });
  const snapshot = workRecordWorkbenchSnapshot(state);

  assert.equal(result.status, 'opened');
  assert.equal(workRecordIsReadOnly(state.record), true);
  assert.equal(snapshot.subject.id, 'work-record:aos-browser-click-status-2026-05-06');
  assert.equal(snapshot.subject.source.origin.kind, 'playbook');
  assert.equal(snapshot.subject.source.origin.ref, 'playbook:browser-live-action-status');
  assert.equal(snapshot.subject.persistence, null);
  assert.ok(snapshot.subject.views.includes('work_record.verifier_report'));
  assert.ok(!snapshot.subject.controls.includes('patch.request'));
  assert.equal(snapshot.diagnostics.verifier_status, 'passed');
  assert.equal(snapshot.diagnostics.postcondition_count, 3);
  assert.ok(executionMapJson(state.record).includes('playbook-step:browser-click-status'));
  assert.equal(workRecordVerifierCheck(state.record).status, 'passed');

  const rejectedIntent = updateWorkRecordIntent(state, { summary: 'mutate playbook record' });
  assert.equal(rejectedIntent.status, 'rejected');
  assert.equal(rejectedIntent.reason, 'read_only');
  assert.equal(state.dirty, false);
  assert.throws(() => buildWorkRecordPatchRequest(state), /read-only/);
});

test('invalid execution-map JSON is rejected without mutating current map', () => {
  const state = createWorkRecordWorkbenchState({ record: fixture('browser-artifact-collection-step.json') });
  const before = executionMapJson(state.record);
  const result = updateWorkRecordExecutionMapJson(state, '{bad');

  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'invalid_json');
  assert.equal(executionMapJson(state.record), before);
});

test('recipe health records expose evidence and saved patch results', () => {
  const state = createWorkRecordWorkbenchState({ record: fixture('recipe-health-retirement.json') });
  const diagnostics = workRecordDiagnostics(state.record);
  const artifacts = evidenceArtifacts(state.record);

  assert.equal(diagnostics.health_state, 'impossible');
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].kind, 'trace');

  updateWorkRecordIntent(state, { nl: 'Keep the retired record searchable.' });
  assert.equal(state.dirty, true);
  const saved = applyWorkRecordPatchResult(state, {
    type: 'work_record.patch.result',
    status: 'saved',
    message: 'saved fixture',
  });
  assert.equal(saved.status, 'saved');
  assert.equal(state.dirty, false);
});
