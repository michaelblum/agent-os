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
    '.aos-workbench-stage-actions',
    '.aos-workbench-preview-pane',
    '.aos-workbench-controls-pane',
    '.aos-workbench-main.aos-split-pane',
  ]) {
    assert.match(css, new RegExp(`${selector.replace('.', '\\.')}\\s*\\{`));
  }
});

test('Sigil radial item workbench keeps editor controls out of titlebar chrome', async () => {
  const html = await repoText('apps/sigil/radial-item-workbench/index.html');
  const titlebar = html.match(/<header class="aos-workbench-titlebar"[\s\S]*?<\/header>/)?.[0] || '';
  const toolbar = html.match(/<div class="aos-workbench-toolbar"[\s\S]*?<\/div>\s*<main/)?.[0] || '';

  assert.match(titlebar, /aos-workbench-title/);
  assert.match(titlebar, /Sigil \/ Radial Menu \/ Item Editor/);
  assert.match(titlebar, /id="minimize-workbench"/);
  assert.match(titlebar, /id="maximize-workbench"/);
  assert.match(titlebar, /id="close-workbench"/);
  assert.match(html, /id="workbench-main"/);
  assert.match(html, /id="preview-pane"/);
  assert.match(html, /id="controls-pane"/);
  assert.doesNotMatch(titlebar, /id="item-select"|id="axes-toggle"|id="lock-in"/);

  assert.match(toolbar, /id="item-select"/);
  assert.match(toolbar, /id="axes-toggle"/);
  assert.match(toolbar, /id="lock-in"/);
  assert.doesNotMatch(toolbar, /id="pulse-control"/);
});

test('Sigil radial item workbench is focused on object transforms only', async () => {
  const html = await repoText('apps/sigil/radial-item-workbench/index.html');

  assert.doesNotMatch(html, /Part Material/);
  assert.doesNotMatch(html, /id="material-controls"/);
  assert.doesNotMatch(html, /id="status"/);
  assert.match(html, /id="undo-change"/);
  assert.match(html, /id="redo-change"/);
});

test('workbench shell smoke does not masquerade as the Sigil editor', async () => {
  const html = await repoText('packages/toolkit/workbench/_smoke/index.html');

  assert.match(html, /AOS Workbench Shell Smoke/);
  assert.doesNotMatch(html, /<strong class="aos-workbench-title">3D Radial Item Workbench<\/strong>/);
  assert.match(html, /id="close-smoke"/);
  assert.match(html, /type: 'canvas\.remove'/);
});
