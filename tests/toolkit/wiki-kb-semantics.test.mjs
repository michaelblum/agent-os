import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyWikiKBSemanticTarget,
  wikiKBAosRef,
} from '../../packages/toolkit/components/wiki-kb/semantics.js'

function dataAttrName(name) {
  return name.replace(/^data-/, '').replace(/-([a-z])/g, (_, char) => char.toUpperCase())
}

class FakeElement {
  constructor(tagName = 'button') {
    this.tagName = tagName.toUpperCase()
    this.attributes = new Map()
    this.dataset = {}
    this.style = {}
    this.textContent = ''
    this.disabled = false
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
    if (name === 'id') this.id = String(value)
    if (name === 'type') this.type = String(value)
  }

  removeAttribute(name) {
    this.attributes.delete(name)
    if (name === 'id') delete this.id
    if (name === 'type') delete this.type
  }

  getAttribute(name) {
    if (name.startsWith('data-')) return this.dataset[dataAttrName(name)] ?? null
    return this.attributes.get(name) ?? null
  }
}

test('wikiKBAosRef scopes refs to the Wiki KB surface', () => {
  assert.equal(wikiKBAosRef('graph', 'depth range'), 'wiki-kb:graph:depth-range')
  assert.equal(wikiKBAosRef('sidebar', ''), 'wiki-kb:sidebar:unknown')
})

test('applyWikiKBSemanticTarget preserves visible button text while stamping metadata', () => {
  const button = new FakeElement('button')
  button.textContent = 'x'

  applyWikiKBSemanticTarget(button, {
    id: 'sidebar-close',
    name: 'Close details',
    action: 'close_details',
    aosRef: wikiKBAosRef('sidebar', 'close'),
  })

  assert.equal(button.getAttribute('role'), null)
  assert.equal(button.getAttribute('type'), 'button')
  assert.equal(button.getAttribute('aria-label'), 'Close details')
  assert.equal(button.dataset.aosRef, 'wiki-kb:sidebar:close')
  assert.equal(button.dataset.aosAction, 'close_details')
  assert.equal(button.dataset.aosSurface, 'wiki-kb')
  assert.equal(button.dataset.semanticTargetId, 'sidebar-close')
  assert.equal(button.textContent, 'x')
})

test('applyWikiKBSemanticTarget exposes checkbox and slider state without generated ids', () => {
  const checkbox = new FakeElement('input')
  applyWikiKBSemanticTarget(checkbox, {
    id: 'highlight-neighbors',
    role: 'AXCheckBox',
    name: 'Highlight neighbors',
    action: 'toggle_highlight_neighbors',
    checked: true,
  })

  assert.equal(checkbox.getAttribute('id'), null)
  assert.equal(checkbox.getAttribute('role'), 'checkbox')
  assert.equal(checkbox.getAttribute('aria-checked'), 'true')
  assert.equal(checkbox.dataset.aosRef, 'wiki-kb:highlight-neighbors')

  const range = new FakeElement('input')
  range.id = 'wiki-kb-depth-input'
  applyWikiKBSemanticTarget(range, {
    id: 'depth',
    role: 'AXSlider',
    name: 'Graph depth',
    action: 'set_depth',
    value: '2',
    aosRef: wikiKBAosRef('graph', 'depth'),
  })

  assert.equal(range.getAttribute('id'), 'wiki-kb-depth-input')
  assert.equal(range.getAttribute('role'), 'slider')
  assert.equal(range.getAttribute('aria-valuetext'), '2')
  assert.equal(range.dataset.aosRef, 'wiki-kb:graph:depth')
})
