import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateStepDescriptor } from '../../packages/toolkit/workbench/step-descriptor-harness.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const schemaPath = path.join(repoRoot, 'shared/schemas/aos-step-descriptor-v0.schema.json');
const fixturePath = path.join(repoRoot, 'shared/schemas/fixtures/aos-step-descriptor-v0/valid/browser-click-status.json');

test('Step Descriptor V0 schema bytes remain frozen', () => {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(schemaPath)).digest('hex');
  assert.equal(digest, 'e1dc11f52b799bf14374abf010eb3a63eeb35db10a25d3371b57e47b770169ac');
});

test('Step Descriptor V0 is rejected by the active harness validator', () => {
  const descriptor = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const diagnostics = validateStepDescriptor(descriptor);
  assert.equal(diagnostics[0].code, 'unsupported_step_descriptor_schema');
});
