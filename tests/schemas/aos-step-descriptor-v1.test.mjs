import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateJsonSchema } from '../lib/json-schema-validation.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-step-descriptor-v1.schema.json');
const fixtureRoot = path.join(repoRoot, 'shared/schemas/fixtures/aos-step-descriptor-v1');
const read = (relative) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, relative), 'utf8'));

test('active Step Descriptor V1 fixture validates without Gate input', () => {
  assert.deepEqual(validateJsonSchema(schemaPath, read('valid/browser-click-status.json')), []);
});

test('Step Descriptor V1 rejects missing target resolution', () => {
  const errors = validateJsonSchema(schemaPath, read('invalid/missing-target-resolution.json'));
  assert.ok(errors.some((error) => /target_resolution/.test(error.message)));
});

test('Step Descriptor V1 schema has no authority-bearing properties', () => {
  const schema = fs.readFileSync(schemaPath, 'utf8');
  for (const symbol of ['workflow_gates', 'authorization', 'approval_required', 'risk_level', 'allowed_operations', 'operation_allowlist']) {
    assert.doesNotMatch(schema, new RegExp(`"${symbol}"`));
  }
});
