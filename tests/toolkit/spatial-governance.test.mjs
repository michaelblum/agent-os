import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSpatialAudit } from '../../scripts/spatial-audit.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

test('spatial governance audit passes with the current allowlist', async () => {
  const result = await runSpatialAudit(repoRoot);
  assert.deepEqual(result.violations, []);
  assert.ok(result.definitions.normalizeDisplays?.length >= 3);
  assert.equal(result.definitions.cgToScreen?.[0], 'src/shared/types.swift');
});
