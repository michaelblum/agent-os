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
  assert.deepEqual(result.definitions.normalizeDisplays, ['packages/toolkit/runtime/spatial.js']);
  assert.deepEqual(result.definitions.computeDisplayUnion, ['packages/toolkit/runtime/spatial.js']);
  assert.deepEqual(result.definitions.findDisplayForPoint, ['packages/toolkit/runtime/spatial.js']);
  assert.deepEqual(result.definitions.clampPointToDisplays, ['packages/toolkit/runtime/spatial.js']);
  assert.equal(result.definitions.cgToScreen?.[0], 'src/shared/types.swift');
  assert.equal(result.definitions.computeMinimapLayout?.[0], 'packages/toolkit/runtime/spatial.js');
  assert.equal(result.definitions.desktopPointToStageLocal?.[0], 'apps/sigil/renderer/live-modules/display-utils.js');
});
