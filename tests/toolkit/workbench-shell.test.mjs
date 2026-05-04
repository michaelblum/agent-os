import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repo = new URL('../../', import.meta.url);

async function repoText(path) {
  return readFile(new URL(path, repo), 'utf8');
}

test('workbench defaults define shell, toolbar, and pane primitives', async () => {
  const css = await repoText('packages/toolkit/workbench/defaults.css');

  for (const selector of [
    '.aos-workbench-shell',
    '.aos-workbench-titlebar',
    '.aos-workbench-toolbar',
    '.aos-workbench-pane-toolbar',
    '.aos-workbench-preview-pane',
    '.aos-workbench-controls-pane',
  ]) {
    assert.match(css, new RegExp(`${selector.replace('.', '\\.')}\\s*\\{`));
  }
});

test('Sigil radial item workbench keeps editor controls out of titlebar chrome', async () => {
  const html = await repoText('apps/sigil/radial-item-workbench/index.html');
  const titlebar = html.match(/<header class="aos-workbench-titlebar"[\s\S]*?<\/header>/)?.[0] || '';
  const toolbar = html.match(/<div class="aos-workbench-toolbar"[\s\S]*?<\/div>\s*<main/)?.[0] || '';

  assert.match(titlebar, /aos-workbench-title/);
  assert.doesNotMatch(titlebar, /id="item-select"|id="axes-toggle"|id="lock-in"/);

  assert.match(toolbar, /id="item-select"/);
  assert.match(toolbar, /id="axes-toggle"/);
  assert.match(toolbar, /id="lock-in"/);
});
