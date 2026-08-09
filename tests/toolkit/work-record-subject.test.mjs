import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkRecordSubject } from '../../packages/toolkit/workbench/work-record-subject.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => JSON.parse(fs.readFileSync(path.join(repoRoot, relative), 'utf8'));

test('Work Record V1 subject projects evidence facets without authority state', () => {
  const record = read('shared/schemas/fixtures/aos-work-record-v1/valid/workflow-browser-click-status.json');
  const subject = createWorkRecordSubject(record);
  assert.equal(subject.id, record.id);
  assert.equal(subject.source.format, 'v1');
  assert.equal(subject.state.read_only, true);
  assert.ok(subject.facets.some((facet) => facet.key === 'work_record.evidence'));
  assert.equal(subject.persistence, null);
  assert.equal('automatic_replay_allowed' in subject.state, false);
  assert.equal('replay_policy' in subject.state, false);
});

test('Work Record subject does not project discriminator-only malformed V1 as active', () => {
  const subject = createWorkRecordSubject({
    type: 'aos.work_record',
    schema_version: '2026-08-work-record-v1',
    id: 'work-record:malformed',
  });
  assert.equal(subject.source.format, 'unsupported');
  assert.equal(subject.state.read_only, true);
  assert.equal(subject.facets.length, 0);
});
