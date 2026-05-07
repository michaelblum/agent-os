import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isWorkRecordV0,
  normalizeWorkRecord,
  workRecordEvidenceArtifacts,
  workRecordIsReadOnly,
  workRecordSubjectId,
} from '../../packages/toolkit/workbench/work-record-adapter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const legacyFixtureRoot = path.join(repoRoot, 'docs/design/fixtures/aos-work-records');
const v0FixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0/valid');

function fixture(root, name) {
  return JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
}

test('adapter preserves legacy work-record read behavior', () => {
  const record = fixture(legacyFixtureRoot, 'browser-artifact-collection-step.json');
  const normalized = normalizeWorkRecord(record);

  assert.equal(isWorkRecordV0(record), false);
  assert.equal(normalized.format, 'legacy');
  assert.equal(normalized.readOnly, false);
  assert.equal(workRecordIsReadOnly(record), false);
  assert.equal(normalized.type, 'aos.do_step');
  assert.equal(normalized.id, 'collect-company-careers-page');
  assert.equal(normalized.health.state, 'stale');
  assert.equal(normalized.surface, 'browser');
  assert.equal(normalized.action.verb, 'navigate');
  assert.equal(normalized.artifacts.length, 3);
  assert.equal(workRecordSubjectId(normalized.id), 'work-record:collect-company-careers-page');
});

test('adapter reads v0 records without rewriting evidence or claim arrays', () => {
  const record = fixture(v0FixtureRoot, 'playbook-origin.json');
  const normalized = normalizeWorkRecord(record);

  assert.equal(isWorkRecordV0(record), true);
  assert.equal(normalized.format, 'v0');
  assert.equal(normalized.readOnly, true);
  assert.equal(workRecordIsReadOnly(record), true);
  assert.equal(normalized.id, 'work-record:playbook-open-wiki-sigil-2026-05-05');
  assert.equal(workRecordSubjectId(normalized.id), normalized.id);
  assert.equal(normalized.intent.nl, record.intent.summary);
  assert.equal(normalized.evidence.length, record.evidence.length);
  assert.equal(normalized.claims.length, record.claims.length);
  assert.equal(normalized.claimResults.length, record.claim_results.length);
  assert.equal(normalized.health.state, 'valid');
  assert.deepEqual(normalized.raw.evidence, record.evidence);
  assert.equal(workRecordEvidenceArtifacts(record)[0].path, 'artifact:artifacts/work-records/playbook-open-wiki-sigil/before-see.json');
});

test('adapter formats Work Record subject ids through Subject Entry Handles', () => {
  assert.equal(workRecordSubjectId('collect-company-careers-page'), 'work-record:collect-company-careers-page');
  assert.equal(workRecordSubjectId('work-record:collect-company-careers-page'), 'work-record:collect-company-careers-page');
  assert.equal(workRecordSubjectId('work-record:example:with-colon'), 'work-record:example:with-colon');
  assert.equal(workRecordSubjectId('wiki:aos/concepts/runtime-modes.md'), 'work-record:wiki:aos/concepts/runtime-modes.md');
  assert.equal(workRecordSubjectId(''), '');
});
