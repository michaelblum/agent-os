import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const repo = new URL('../../', import.meta.url);

async function repoText(path) {
  return readFile(new URL(path, repo), 'utf8');
}

test('toolkit theme exposes semantic typography and control tokens', async () => {
  const theme = await repoText('packages/toolkit/components/_base/theme.css');

  for (const token of [
    '--aos-font-ui',
    '--aos-font-mono',
    '--aos-type-body',
    '--aos-type-caption',
    '--aos-type-label',
    '--aos-type-toolbar',
    '--aos-type-title',
    '--aos-type-window-control',
    '--aos-control-height',
    '--aos-control-radius',
    '--aos-window-button-size',
  ]) {
    assert.match(theme, new RegExp(`${token}\\s*:`), `${token} should be part of the public theme contract`);
  }

  assert.match(theme, /--font-ui:\s*var\(--aos-font-ui\)/);
  assert.match(theme, /--font-mono:\s*var\(--aos-font-mono\)/);
});

test('workbench toolbar defaults do not restyle protected button primitives', async () => {
  const workbenchCss = await repoText('packages/toolkit/workbench/defaults.css');
  const markdownCss = await repoText('packages/toolkit/components/markdown-workbench/styles.css');

  assert.doesNotMatch(workbenchCss, /\.aos-workbench-toolbar\s+button\s*\{/);
  assert.doesNotMatch(workbenchCss, /\.aos-workbench-actions\s+button\s*\{/);
  assert.doesNotMatch(workbenchCss, /\.aos-workbench-pane-toolbar\s+button\s*\{/);
  assert.match(workbenchCss, /button:not\(\.aos-window-button,\s*\.aos-icon-button\)/);
  assert.match(markdownCss, /\.markdown-workbench-document-toolbar\s+button:not\(\.aos-window-button,\s*\.aos-icon-button\)/);
});

test('window button primitive owns its own alignment contract', async () => {
  const panelCss = await repoText('packages/toolkit/panel/defaults.css');
  const rule = panelCss.match(/\.aos-window-button\s*\{[\s\S]*?\n\}/)?.[0] || '';

  assert.match(rule, /display:\s*grid/);
  assert.match(rule, /place-items:\s*center/);
  assert.match(rule, /padding:\s*0/);
  assert.match(rule, /font:\s*var\(--aos-type-window-control/);
  assert.match(rule, /line-height:\s*1/);
});
