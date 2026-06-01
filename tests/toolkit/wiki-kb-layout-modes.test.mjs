import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const source = await readFile(new URL('../../packages/toolkit/components/wiki-kb/index.js', import.meta.url), 'utf8')

test('default Wiki KB layout modes use segmented control semantics', () => {
  assert.match(source, /import \{ createButtonGroup \} from '\.\.\/\.\.\/controls\/button-group\.js'/)
  assert.match(source, /class="wiki-kb-layout-mode-bar"[^`]*aria-label="Wiki graph layout controls"/)
  assert.match(source, /layoutModeControl = createButtonGroup\(\{[\s\S]*value: activeLayoutModeId[\s\S]*options: layoutModeDefs\.map/)
  assert.match(source, /onChange\(nextLayoutModeId\) \{[\s\S]*switchLayoutMode\(nextLayoutModeId\)/)
  assert.match(source, /layoutModeControl\.el\.setAttribute\('aria-label', 'Graph layout mode'\)/)
  assert.match(source, /addClassNames\(button, 'wiki-kb-layout-mode-button'\)/)
  assert.doesNotMatch(source, /createAosZagTabs/)
  assert.doesNotMatch(source, /data-aos-tabs/)
  assert.doesNotMatch(source, /role="tablist"/)
  assert.doesNotMatch(source, /role', 'tab'/)
})

test('Wiki KB layout regions avoid tabpanel semantics', () => {
  assert.match(source, /layoutEl\.id = `wiki-kb-layout-\$\{id\}`/)
  assert.match(source, /layoutEl\.setAttribute\('role', 'region'\)/)
  assert.match(source, /layoutEl\.setAttribute\('aria-label', `\$\{definition\.label\} layout`\)/)
  assert.match(source, /layoutEl\.dataset\.value = id/)
  assert.doesNotMatch(source, /aria-labelledby/)
  assert.doesNotMatch(source, /aos-tab-content/)
})

test('layout mode changes route through Wiki KB active layout state', () => {
  assert.match(source, /function switchLayoutMode\(id\) \{[\s\S]*ensureLayoutMode\(id\)[\s\S]*activateLayoutMode\(id\)[\s\S]*\}/)
  assert.match(source, /function activateLayoutMode\(id\) \{[\s\S]*activeLayoutModeId = id[\s\S]*layoutModeControl\?\.setValue\(id, \{ emit: false \}\)/)
})

test('Wiki KB layout semantics remain on mode buttons while embedded chrome stays on select', () => {
  assert.match(source, /applyWikiKBSemanticTarget\(button, \{[\s\S]*id: `layout-mode-\$\{button\.dataset\.layoutMode\}`[\s\S]*action: 'set_layout_mode'[\s\S]*aosRef: wikiKBAosRef\('layout-mode', button\.dataset\.layoutMode\)[\s\S]*pressed: isActive/)
  assert.match(source, /const layoutModeSelectSlot = rootEl\.querySelector\('\[data-role="wiki-kb-layout-mode-select"\]'\)/)
  assert.match(source, /addClassNames\(dom\.layoutModeSelectEl, 'wiki-kb-layout-mode-select'\)/)
  assert.match(source, /dom\.layoutModeSelectControl = layoutModeSelect/)
  assert.doesNotMatch(source, /dom\.layoutModeSelectEl[\s\S]{0,200}aosTabs/)
})

test('Wiki KB details remain a synchronized sidebar instead of a duplicate detail tab', () => {
  assert.match(source, /const LAYOUT_MODE_DEFS = \[[\s\S]*\{ id: 'graph', label: 'Graph'[\s\S]*\{ id: 'radial-graph', label: 'Radial Graph'/)
  assert.doesNotMatch(source, /id: 'detail'/)
  assert.match(source, /<aside class="wiki-kb-sidebar" aria-label="Selected node details">/)
  assert.match(source, /function setSelection\(node, options = \{\}\) \{[\s\S]*renderSidebar\(selectedNode\)[\s\S]*focusActiveLayoutOnSelection\(\)/)
})
