import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateJsonSchema } from '../lib/json-schema-validation.mjs';
import validateGeneratedWorkRecord from '../../packages/toolkit/workbench/work-record-v1-validator.generated.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-work-record-v1.schema.json');
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-work-record-v1');
const read = (relative) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, relative), 'utf8'));

test('active Work Record V1 fixtures validate', () => {
  for (const relative of ['valid/ad-hoc.json', 'valid/repairable-stale-saved-ref.json', 'valid/workflow-browser-click-status.json']) {
    assert.deepEqual(validateJsonSchema(schemaPath, read(relative)), [], relative);
    assert.equal(validateGeneratedWorkRecord(read(relative)), true, relative);
  }
});

test('Work Record V1 runtime validator is generated from current source schema', () => {
  const result = spawnSync(process.execPath, ['scripts/generate-work-record-contract-validators.mjs', '--check'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('Work Record V1 rejects incomplete execution maps', () => {
  const errors = validateJsonSchema(schemaPath, read('invalid/missing-postconditions.json'));
  assert.ok(errors.some((error) => /postconditions/.test(error.message)));
});

test('Work Record V1 schema has no authority-bearing properties', () => {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  for (const symbol of ['workflow_gates', 'authorization', 'approval', 'risk_level', 'allowed_operations', 'operation_allowlist', 'authorizes_future_attempt']) {
    assert.doesNotMatch(schema, new RegExp(`"${symbol}"`));
  }
});
