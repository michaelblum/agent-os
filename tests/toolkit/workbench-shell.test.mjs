import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repo = new URL('../../', import.meta.url);

async function repoText(path) {
  return readFile(new URL(path, repo), 'utf8');
}

test('workbench defaults define shell, toolbar, and pane primitives', async () => {
  const css = await repoText('packages/toolkit/workbench/defaults.css');
  const panelCss = await repoText('packages/toolkit/panel/defaults.css');
  const panelChrome = await repoText('packages/toolkit/panel/chrome.js');
  const themeCss = await repoText('packages/toolkit/components/_base/theme.css');

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
  assert.match(panelChrome, /aos-panel-grip/);
  assert.match(panelCss, /\.aos-panel-grip\s*\{/);
  assert.match(themeCss, /--aos-panel-bg:\s*rgba\(5,\s*10,\s*14,\s*0\.96\)/);
  assert.match(themeCss, /--bg-panel:\s*var\(--aos-panel-bg\)/);
  assert.match(themeCss, /--accent-blue:\s*#7af1ff/);
});

test('workbench shell smoke stays a neutral toolkit fixture', async () => {
  const html = await repoText('packages/toolkit/workbench/_smoke/index.html');

  assert.match(html, /AOS Workbench Shell Smoke/);
  assert.doesNotMatch(html, /<strong class="aos-workbench-title">3D Radial Item Workbench<\/strong>/);
  assert.match(html, /id="close-smoke"/);
  assert.match(html, /type: 'canvas\.remove'/);
});
