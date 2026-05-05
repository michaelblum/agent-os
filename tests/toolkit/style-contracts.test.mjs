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
    '--aos-control-padding',
    '--aos-control-gap',
    '--aos-control-radius',
    '--aos-control-border',
    '--aos-control-bg',
    '--aos-focus-ring',
    '--aos-icon-button-size',
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

test('control defaults consume theme tokens instead of private constants', async () => {
  const controlsCss = await repoText('packages/toolkit/controls/defaults.css');

  assert.match(controlsCss, /font:\s*var\(--aos-type-label/);
  assert.match(controlsCss, /min-height:\s*var\(--aos-control-height/);
  assert.match(controlsCss, /padding:\s*var\(--aos-control-padding/);
  assert.match(controlsCss, /border:\s*var\(--aos-control-border/);
  assert.match(controlsCss, /background:\s*var\(--aos-control-bg/);
  assert.match(controlsCss, /width:\s*var\(--aos-icon-button-size/);
  assert.match(controlsCss, /outline:\s*var\(--aos-focus-ring/);
});
