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
    '--aos-type-code',
    '--aos-type-code-block',
    '--aos-type-micro',
    '--aos-type-micro-label',
    '--aos-type-numeric',
    '--aos-panel-bg',
    '--aos-panel-header-bg',
    '--aos-panel-border',
    '--aos-panel-border-subtle',
    '--aos-panel-radius',
    '--aos-panel-shadow',
    '--aos-panel-titlebar-min-height',
    '--aos-panel-titlebar-padding',
    '--aos-panel-titlebar-gap',
    '--aos-panel-control-gap',
    '--aos-panel-grip-color',
    '--aos-control-height',
    '--aos-control-padding',
    '--aos-control-gap',
    '--aos-control-radius',
    '--aos-control-border',
    '--aos-control-bg',
    '--aos-control-compact-padding',
    '--aos-control-compact-radius',
    '--aos-control-compact-bg',
    '--aos-control-compact-bg-active',
    '--aos-focus-ring',
    '--aos-icon-button-size',
    '--aos-window-button-size',
    '--aos-window-button-border',
    '--aos-window-button-bg',
    '--aos-window-button-color',
  ]) {
    assert.match(theme, new RegExp(`${token}\\s*:`), `${token} should be part of the public theme contract`);
  }

  assert.match(theme, /--font-ui:\s*var\(--aos-font-ui\)/);
  assert.match(theme, /--font-mono:\s*var\(--aos-font-mono\)/);
  assert.match(theme, /--bg-panel:\s*var\(--aos-panel-bg\)/);
  assert.match(theme, /--border-panel:\s*var\(--aos-panel-border\)/);
  assert.match(theme, /--radius-panel:\s*var\(--aos-panel-radius\)/);
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
  assert.match(rule, /width:\s*var\(--aos-window-button-size/);
  assert.match(rule, /padding:\s*0/);
  assert.match(rule, /border:\s*var\(--aos-window-button-border/);
  assert.match(rule, /background:\s*var\(--aos-window-button-bg/);
  assert.match(rule, /font:\s*var\(--aos-type-window-control/);
  assert.match(rule, /line-height:\s*1/);
});

test('control defaults consume theme tokens instead of private constants', async () => {
  const controlsCss = await repoText('packages/toolkit/controls/defaults.css');

  assert.match(controlsCss, /font:\s*var\(--aos-type-label/);
  assert.match(controlsCss, /font:\s*var\(--aos-type-numeric/);
  assert.match(controlsCss, /min-height:\s*var\(--aos-control-height/);
  assert.match(controlsCss, /padding:\s*var\(--aos-control-padding/);
  assert.match(controlsCss, /border:\s*var\(--aos-control-border/);
  assert.match(controlsCss, /background:\s*var\(--aos-control-bg/);
  assert.match(controlsCss, /width:\s*var\(--aos-icon-button-size/);
  assert.match(controlsCss, /outline:\s*var\(--aos-focus-ring/);
});

test('workbench shell consumes shared panel chrome tokens', async () => {
  const workbenchCss = await repoText('packages/toolkit/workbench/defaults.css');

  assert.match(workbenchCss, /border:\s*1px solid var\(--border-panel/);
  assert.match(workbenchCss, /border-radius:\s*var\(--radius-panel/);
  assert.match(workbenchCss, /background:\s*var\(--bg-panel/);
  assert.match(workbenchCss, /box-shadow:\s*var\(--shadow-panel/);
  assert.match(workbenchCss, /min-height:\s*var\(--aos-panel-titlebar-min-height/);
  assert.match(workbenchCss, /padding:\s*var\(--aos-panel-titlebar-padding/);
  assert.match(workbenchCss, /gap:\s*var\(--aos-panel-titlebar-gap/);
  assert.match(workbenchCss, /border-block:\s*2px solid var\(--aos-panel-grip-color/);
  assert.doesNotMatch(workbenchCss, /\.aos-workbench-shell\s*\{[\s\S]*?box-shadow:\s*0 18px 46px/);
});

test('workbench and document surfaces consume shared type tokens', async () => {
  const workbenchCss = await repoText('packages/toolkit/workbench/defaults.css');
  const markdownCss = await repoText('packages/toolkit/components/markdown-workbench/styles.css');
  const workRecordCss = await repoText('packages/toolkit/components/work-record-workbench/styles.css');
  const objectTransformCss = await repoText('packages/toolkit/components/object-transform-panel/styles.css');

  assert.match(workbenchCss, /font:\s*var\(--aos-type-label/);
  assert.match(markdownCss, /font:\s*var\(--aos-type-code/);
  assert.match(markdownCss, /font:\s*var\(--aos-type-code-block/);
  assert.match(workRecordCss, /font:\s*var\(--aos-type-label/);
  assert.match(workRecordCss, /font:\s*var\(--aos-type-code/);
  assert.match(workRecordCss, /font:\s*var\(--aos-type-code-block/);
  assert.match(objectTransformCss, /font:\s*var\(--aos-type-code/);
  assert.match(objectTransformCss, /font:\s*var\(--aos-type-numeric/);
});

test('wiki graph controls consume compact toolkit tokens', async () => {
  const wikiCss = await repoText('packages/toolkit/components/wiki-kb/styles.css');

  assert.match(wikiCss, /font:\s*var\(--aos-type-micro/);
  assert.match(wikiCss, /font:\s*var\(--aos-type-micro-label/);
  assert.match(wikiCss, /padding:\s*var\(--aos-control-compact-padding/);
  assert.match(wikiCss, /border-radius:\s*var\(--aos-control-compact-radius/);
  assert.match(wikiCss, /background:\s*var\(--aos-control-compact-bg/);
  assert.match(wikiCss, /background:\s*var\(--aos-control-compact-bg-active/);
  assert.doesNotMatch(wikiCss, /font-size:\s*9px/);
  assert.doesNotMatch(wikiCss, /background:\s*rgba\(18,\s*18,\s*28,\s*0\.78\)/);
});
