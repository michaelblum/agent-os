import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isHistoricalWorkRecordV0,
  isWorkRecordV1,
  normalizeWorkRecord,
  workRecordEvidenceArtifacts,
  workRecordIsReadOnly,
} from '../../packages/toolkit/workbench/work-record-adapter.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => JSON.parse(fs.readFileSync(path.join(repoRoot, relative), 'utf8'));

test('adapter projects active Work Record V1 as read-only evidence', () => {
  const record = read('shared/schemas/fixtures/aos-work-record-v1/valid/workflow-browser-click-status.json');
  const normalized = normalizeWorkRecord(record);
  assert.equal(isWorkRecordV1(record), true);
  assert.equal(normalized.supported, true);
  assert.equal(normalized.format, 'v1');
  assert.equal(normalized.readOnly, true);
  assert.equal(workRecordIsReadOnly(record), true);
  assert.equal(workRecordEvidenceArtifacts(record).length, record.evidence.length);
  assert.equal('replayPolicy' in normalized, false);
  assert.equal('automaticReplayAllowed' in normalized, false);
});

test('adapter preserves raw evidence URI carriers', () => {
  const record = read('shared/schemas/fixtures/aos-work-record-v1/valid/workflow-browser-click-status.json');
  const rawUri = '/tmp/aos  evidence  artifact.json';
  record.evidence[0].uri = rawUri;
  const normalized = normalizeWorkRecord(record);
  assert.equal(normalized.supported, true);
  assert.equal(normalized.evidence[0].uri, rawUri);
  assert.equal(normalized.artifacts[0].uri, rawUri);
  assert.equal(normalized.artifacts[0].path, rawUri);
});

test('adapter preserves raw source-owned labels', () => {
  const record = read('shared/schemas/fixtures/aos-work-record-v1/valid/workflow-browser-click-status.json');
  record.label = 'Workflow  evidence  label';
  record.evidence[0].summary = 'Before  perception  evidence';
  const normalized = normalizeWorkRecord(record);
  assert.equal(normalized.label, record.label);
  assert.equal(normalized.artifacts[0].label, record.evidence[0].summary);
});

test('adapter rejects frozen V0 and unknown records without adapting their bytes', () => {
  const historical = read('shared/schemas/fixtures/aos-work-record-v0/valid/workflow-origin.json');
  assert.equal(isHistoricalWorkRecordV0(historical), true);
  assert.equal(normalizeWorkRecord(historical).format, 'historical_v0_unsupported');
  assert.equal(normalizeWorkRecord({ type: 'aos.work_record', schema_version: 'future', id: 'x' }).format, 'unsupported');
});
