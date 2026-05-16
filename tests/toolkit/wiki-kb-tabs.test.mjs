import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const source = await readFile(new URL('../../packages/toolkit/components/wiki-kb/index.js', import.meta.url), 'utf8')

test('default Wiki KB view tabs adopt the Zag tabs adapter hooks', () => {
  assert.match(source, /import \{ createAosZagTabs \} from '\.\.\/\.\.\/adapters\/zag\/tabs\.js'/)
  assert.match(source, /class="wiki-kb-tab-strip"[^`]*data-aos-tabs-root data-aos-tabs-list/)
  assert.match(source, /button\.dataset\.aosTabsTrigger = ''/)
  assert.match(source, /button\.dataset\.value = view\.id/)
  assert.match(source, /viewTabs \?\?= createAosZagTabs\(/)
  assert.match(source, /viewTabs\.bind\(rootEl\)/)
})

test('Wiki KB view panels expose stable tabpanel ids and matching Zag content values', () => {
  assert.match(source, /viewEl\.id = `wiki-kb-panel-\$\{id\}`/)
  assert.match(source, /viewEl\.setAttribute\('role', 'tabpanel'\)/)
  assert.match(source, /viewEl\.setAttribute\('aria-labelledby', `wiki-kb-tab-\$\{id\}`\)/)
  assert.match(source, /viewEl\.dataset\.aosTabsContent = ''/)
  assert.match(source, /viewEl\.dataset\.value = id/)
})

test('Zag tab value changes route through Wiki KB active view state', () => {
  assert.match(source, /function viewValueFromChange\(details\)/)
  assert.match(source, /onValueChange\(details\) \{[\s\S]*const nextViewId = viewValueFromChange\(details\)[\s\S]*switchView\(nextViewId\)/)
  assert.match(source, /function switchView\(id\) \{[\s\S]*ensureView\(id\)[\s\S]*activateView\(id\)[\s\S]*\}/)
  assert.match(source, /function activateView\(id\) \{[\s\S]*activeViewId = id[\s\S]*bindViewTabs\(\)/)
  assert.doesNotMatch(source, /closest\('\.wiki-kb-view-tab'\)/)
})

test('Wiki KB tab semantics remain on triggers while embedded chrome stays on select', () => {
  assert.match(source, /applyWikiKBSemanticTarget\(button, \{[\s\S]*action: 'set_view'[\s\S]*aosRef: wikiKBAosRef\('tab', button\.dataset\.view\)[\s\S]*selected: isActive/)
  assert.match(source, /const viewSelectSlot = rootEl\.querySelector\('\[data-role="wiki-kb-view-select"\]'\)/)
  assert.match(source, /addClassNames\(dom\.viewSelectEl, 'wiki-kb-view-select'\)/)
  assert.doesNotMatch(source, /dom\.viewSelectEl[\s\S]{0,200}aosTabs/)
})

test('Wiki KB details remain a synchronized sidebar instead of a duplicate detail tab', () => {
  assert.match(source, /const VIEW_DEFS = \[[\s\S]*\{ id: 'graph', label: 'Graph'[\s\S]*\{ id: 'mindmap', label: 'Mind Map'/)
  assert.doesNotMatch(source, /id: 'detail'/)
  assert.match(source, /<aside class="wiki-kb-sidebar" aria-label="Selected node details">/)
  assert.match(source, /function setSelection\(node, options = \{\}\) \{[\s\S]*renderSidebar\(selectedNode\)[\s\S]*focusActiveViewOnSelection\(\)/)
})
