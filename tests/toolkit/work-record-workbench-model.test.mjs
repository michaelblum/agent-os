import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createWorkRecordWorkbenchState,
  openWorkRecord,
  updateWorkRecordExecutionMapJson,
  updateWorkRecordIntent,
  workRecordWorkbenchSnapshot,
} from '../../packages/toolkit/components/work-record-workbench/model.js';
import { isValidWorkRecordV1 } from '../../packages/toolkit/workbench/work-record-adapter.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => JSON.parse(fs.readFileSync(path.join(repoRoot, relative), 'utf8'));

test('Work Record workbench opens active V1 read-only and preserves source evidence', () => {
  const record = read('shared/schemas/fixtures/aos-work-record-v1/valid/workflow-browser-click-status.json');
  const state = createWorkRecordWorkbenchState();
  const opened = openWorkRecord(state, { record, source: { kind: 'file', path: '/tmp/work-record-v1.json' } });
  assert.equal(opened.status, 'opened');
  const snapshot = workRecordWorkbenchSnapshot(state);
  assert.equal(snapshot.diagnostics.format, 'v1');
  assert.equal(snapshot.diagnostics.read_only, true);
  assert.equal(snapshot.source.path, '/tmp/work-record-v1.json');
  assert.equal(updateWorkRecordIntent(state, { summary: 'mutate' }).status, 'rejected');
  assert.equal(updateWorkRecordExecutionMapJson(state, '{}').status, 'rejected');
});

test('Work Record workbench rejects frozen V0 at construction and open boundaries', () => {
  const historical = read('shared/schemas/fixtures/aos-work-record-v0/valid/workflow-origin.json');
  const state = createWorkRecordWorkbenchState({ record: historical });
  assert.equal(state.lastResult.status, 'rejected');
  assert.equal(state.lastResult.reason, 'historical_work_record_v0_unsupported');
  assert.equal(state.record.schema_version, '2026-08-work-record-v1');
  assert.equal(isValidWorkRecordV1(state.record), true);
  const before = structuredClone(state.record);
  const opened = openWorkRecord(state, { record: historical });
  assert.equal(opened.status, 'rejected');
  assert.equal(opened.reason, 'historical_work_record_v0_unsupported');
  assert.deepEqual(state.record, before);
});

test('Work Record workbench rejects malformed V1 before projection', () => {
  const state = createWorkRecordWorkbenchState();
  const result = openWorkRecord(state, {
    record: {
      type: 'aos.work_record',
      schema_version: '2026-08-work-record-v1',
      id: 'work-record:malformed',
    },
  });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'invalid_work_record_v1');
  assert.notEqual(state.record.id, 'work-record:malformed');
});

test('Work Record workbench rejects every unsupported schema without projection', () => {
  const unsupported = {
    type: 'aos.work_record',
    schema_version: '2099-01-work-record-v9',
    id: 'work-record:unknown',
  };
  const state = createWorkRecordWorkbenchState({ record: unsupported });
  assert.equal(state.lastResult.status, 'rejected');
  assert.equal(state.lastResult.reason, 'unsupported_work_record_schema');
  assert.notEqual(state.record.id, unsupported.id);
  assert.equal(isValidWorkRecordV1(state.record), true);
  const before = structuredClone(state.record);
  const result = openWorkRecord(state, { record: unsupported });
  assert.equal(result.status, 'rejected');
  assert.equal(result.reason, 'unsupported_work_record_schema');
  assert.deepEqual(state.record, before);
});
