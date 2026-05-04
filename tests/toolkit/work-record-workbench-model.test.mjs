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
  workRecordWorkbenchSnapshot,
} from '../../packages/toolkit/components/work-record-workbench/model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixtureRoot = path.join(repoRoot, 'docs/design/fixtures/aos-work-records');

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), 'utf8'));
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
