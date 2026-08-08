import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isHistoricalWorkRecordV0, normalizeWorkRecord } from '../../packages/toolkit/workbench/work-record-adapter.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-work-record-v0.schema.json');
const fixturePath = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v0/valid/workflow-origin.json');

test('Work Record V0 schema bytes remain frozen', () => {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(schemaPath)).digest('hex');
  assert.equal(digest, 'de1ee5d4f5de3532baac1dd996901f99abd0f8d077ca208963bcbe5b5ffe634e');
});

test('Work Record V0 is identifiable historical input but unsupported by the active adapter', () => {
  const record = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  assert.equal(isHistoricalWorkRecordV0(record), true);
  const normalized = normalizeWorkRecord(record);
  assert.equal(normalized.supported, false);
  assert.equal(normalized.format, 'historical_v0_unsupported');
  assert.equal(normalized.raw, null);
});
