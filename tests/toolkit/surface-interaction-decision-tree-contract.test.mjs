import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repoUrl = new URL('../../', import.meta.url);

async function text(path) {
  return readFile(new URL(path, repoUrl), 'utf8');
}

test('surface interaction decision tree exposes stable platform choices', async () => {
  const guide = await text('docs/guides/aos-surface-interaction-decision-tree.md');
  for (const phrase of [
    'DOM interaction inside an already interactive canvas',
    'Toolkit panel/windowing behavior',
    'Passive DesktopWorld visual with small hit areas',
    'Visual-only global decoration or diagnostic layer',
    'Full interactive surface',
    'Private app renderer or 3D stage',
    'Daemon primitive',
    'createStageAffordance',
    'createResourceScope',
    'daemon input regions',
  ]) {
    assert.match(guide, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(guide, /apps\/sigil|aos:\/\/sigil|avatar-main|Sigil radial/i);
});

test('surface interaction decision tree is discoverable from toolkit ownership docs', async () => {
  const requiredPath = 'docs/guides/aos-surface-interaction-decision-tree.md';
  for (const path of [
    'docs/api/toolkit.md',
    'docs/api/toolkit/runtime.md',
    'docs/api/toolkit/panel-window.md',
    'docs/design/aos-surface-system.md',
    'packages/toolkit/AGENTS.md',
    'packages/toolkit/runtime/AGENTS.md',
    'packages/toolkit/panel/AGENTS.md',
  ]) {
    assert.match(await text(path), new RegExp(requiredPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
