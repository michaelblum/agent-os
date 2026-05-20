import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const source = await readFile(new URL('../../packages/toolkit/components/wiki-kb/index.js', import.meta.url), 'utf8')

test('default Wiki KB layout modes use segmented control semantics', () => {
  assert.match(source, /import \{ createButtonGroup \} from '\.\.\/\.\.\/controls\/button-group\.js'/)
  assert.match(source, /class="wiki-kb-layout-mode-bar"[^`]*aria-label="Wiki graph layout controls"/)
  assert.match(source, /viewModeGroup = createButtonGroup\(\{[\s\S]*value: activeViewId[\s\S]*options: viewDefs\.map/)
  assert.match(source, /onChange\(nextViewId\) \{[\s\S]*switchView\(nextViewId\)/)
  assert.match(source, /viewModeGroup\.el\.setAttribute\('aria-label', 'Graph layout mode'\)/)
  assert.match(source, /addClassNames\(button, 'wiki-kb-view-mode-button'\)/)
  assert.doesNotMatch(source, /createAosZagTabs/)
  assert.doesNotMatch(source, /data-aos-tabs/)
  assert.doesNotMatch(source, /role="tablist"/)
  assert.doesNotMatch(source, /role', 'tab'/)
})

test('Wiki KB layout regions avoid tabpanel semantics', () => {
  assert.match(source, /viewEl\.id = `wiki-kb-view-\$\{id\}`/)
  assert.match(source, /viewEl\.setAttribute\('role', 'region'\)/)
  assert.match(source, /viewEl\.setAttribute\('aria-label', `\$\{definition\.label\} graph layout`\)/)
  assert.match(source, /viewEl\.dataset\.value = id/)
  assert.doesNotMatch(source, /aria-labelledby/)
  assert.doesNotMatch(source, /aos-tab-content/)
})

test('layout mode changes route through Wiki KB active view state', () => {
  assert.match(source, /function switchView\(id\) \{[\s\S]*ensureView\(id\)[\s\S]*activateView\(id\)[\s\S]*\}/)
  assert.match(source, /function activateView\(id\) \{[\s\S]*activeViewId = id[\s\S]*viewModeGroup\?\.setValue\(id, \{ emit: false \}\)/)
  assert.doesNotMatch(source, /closest\('\.wiki-kb-view-tab'\)/)
})

test('Wiki KB layout semantics remain on mode buttons while embedded chrome stays on select', () => {
  assert.match(source, /applyWikiKBSemanticTarget\(button, \{[\s\S]*id: `layout-mode-\$\{button\.dataset\.view\}`[\s\S]*action: 'set_layout_mode'[\s\S]*aosRef: wikiKBAosRef\('layout-mode', button\.dataset\.view\)[\s\S]*pressed: isActive/)
  assert.match(source, /const viewSelectSlot = rootEl\.querySelector\('\[data-role="wiki-kb-view-select"\]'\)/)
  assert.match(source, /addClassNames\(dom\.viewSelectEl, 'wiki-kb-view-select'\)/)
  assert.doesNotMatch(source, /dom\.viewSelectEl[\s\S]{0,200}aosTabs/)
})

test('Wiki KB details remain a synchronized sidebar instead of a duplicate detail tab', () => {
  assert.match(source, /const VIEW_DEFS = \[[\s\S]*\{ id: 'graph', label: 'Graph'[\s\S]*\{ id: 'mindmap', label: 'Radial Graph'/)
  assert.doesNotMatch(source, /id: 'detail'/)
  assert.match(source, /<aside class="wiki-kb-sidebar" aria-label="Selected node details">/)
  assert.match(source, /function setSelection\(node, options = \{\}\) \{[\s\S]*renderSidebar\(selectedNode\)[\s\S]*focusActiveViewOnSelection\(\)/)
})
