import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aosRefForTarget,
  applySemanticTargetAttributes,
  createSemanticTargetElement,
  normalizeSemanticTarget,
  normalizeSemanticTargets,
} from '../../packages/toolkit/runtime/semantic-targets.js'
import { descriptorFromElement } from '../../packages/toolkit/browser-intent-sensor/dom-crawl.js'
import { buildLocatorCandidates } from '../../packages/toolkit/browser-intent-sensor/canonicalize.js'

function dataAttrName(name) {
  return name.replace(/^data-/, '').replace(/-([a-z])/g, (_, char) => char.toUpperCase())
}

class FakeElement {
  constructor(tagName) {
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

  getBoundingClientRect() {
    return {
      left: Number.parseFloat(this.style.left) || 0,
      top: Number.parseFloat(this.style.top) || 0,
      width: Number.parseFloat(this.style.width) || 0,
      height: Number.parseFloat(this.style.height) || 0,
    }
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName)
  }
}

test('normalizeSemanticTarget maps AX roles to web roles and keeps names concise', () => {
  const target = normalizeSemanticTarget({
    id: 'wiki-graph',
    role: 'AXButton',
    label: 'Wiki Graph',
    action: 'wikiGraph',
    frame: [10.4, 20.6, 55.2, 44.8],
    active: true,
  }, {
    surface: 'sigil-radial-menu',
    parentCanvasId: 'avatar-main',
  })

  assert.deepEqual(target, {
    id: 'wiki-graph',
    role: 'button',
    name: 'Wiki Graph',
    action: 'wikiGraph',
    enabled: true,
    current: true,
    pressed: null,
    selected: null,
    checked: null,
    expanded: null,
    value: null,
    surface: 'sigil-radial-menu',
    parentCanvasId: 'avatar-main',
    aosRef: 'sigil-radial-menu:wiki-graph',
    metadata: {},
    frame: { x: 10, y: 21, width: 55, height: 45 },
  })
})

test('normalizeSemanticTargets rejects targets without stable ids', () => {
  assert.throws(
    () => normalizeSemanticTargets([{ label: '' }]),
    /semantic target requires id/
  )
})

test('aosRefForTarget uses explicit refs before generated surface refs', () => {
  assert.equal(aosRefForTarget({ id: 'save', surface: 'toolbar' }), 'toolbar:save')
  assert.equal(aosRefForTarget({ id: 'save', aosRef: 'custom-save' }, { surface: 'toolbar' }), 'custom-save')
})

test('normalizeSemanticTarget does not default action to identity', () => {
  const target = normalizeSemanticTarget({ id: 'plain-target', name: 'Plain Target' })

  assert.equal(target.action, '')
  assert.equal(target.aosRef, 'plain-target')
})

test('createSemanticTargetElement stamps native button semantics and metadata without visible text', () => {
  const element = createSemanticTargetElement(new FakeDocument(), {
    id: 'context-menu',
    role: 'AXButton',
    name: 'Context Menu',
    action: 'contextMenu',
    frame: { x: 38, y: 38, w: 56, h: 56 },
    surface: 'sigil-radial-menu',
  })

  assert.equal(element.tagName, 'BUTTON')
  assert.equal(element.getAttribute('role'), null)
  assert.equal(element.getAttribute('type'), 'button')
  assert.equal(element.getAttribute('aria-label'), 'Context Menu')
  assert.equal(element.getAttribute('id'), 'aos-semantic-target-context-menu')
  assert.equal(element.dataset.aosRef, 'sigil-radial-menu:context-menu')
  assert.equal(element.dataset.aosAction, 'contextMenu')
  assert.equal(element.dataset.aosSurface, 'sigil-radial-menu')
  assert.equal(element.dataset.semanticTargetId, 'context-menu')
  assert.equal(element.style.left, '38px')
  assert.equal(element.style.top, '38px')
  assert.equal(element.style.width, '56px')
  assert.equal(element.style.height, '56px')
  assert.equal(element.textContent, '')
})

test('applySemanticTargetAttributes supports non-native roles and state attrs', () => {
  const element = new FakeElement('div')
  applySemanticTargetAttributes(element, {
    id: 'menu-open',
    role: 'AXMenuItem',
    name: 'Open',
    action: 'open',
    enabled: false,
    selected: true,
    expanded: false,
  }, {
    surface: 'stack-menu',
    visibleLabel: true,
  })

  assert.equal(element.getAttribute('role'), 'menuitem')
  assert.equal(element.getAttribute('aria-label'), 'Open')
  assert.equal(element.getAttribute('aria-disabled'), 'true')
  assert.equal(element.getAttribute('aria-selected'), 'true')
  assert.equal(element.getAttribute('aria-expanded'), 'false')
  assert.equal(element.dataset.aosRef, 'stack-menu:menu-open')
  assert.equal(element.dataset.aosAction, 'open')
  assert.equal(element.textContent, 'Open')
})

test('applySemanticTargetAttributes removes stale optional attrs on update', () => {
  const element = new FakeElement('button')
  applySemanticTargetAttributes(element, {
    id: 'toggle',
    name: 'Toggle',
    pressed: true,
    action: 'toggle',
    surface: 'panel',
  })
  applySemanticTargetAttributes(element, {
    id: 'toggle',
    name: 'Toggle',
    pressed: null,
    action: '',
    surface: '',
  })

  assert.equal(element.getAttribute('aria-pressed'), null)
  assert.equal(element.dataset.aosAction, undefined)
  assert.equal(element.dataset.aosSurface, undefined)
  assert.equal(element.dataset.aosRef, 'toggle')
})

test('helper-stamped elements expose role-name and ref browser intent descriptors', async () => {
  const element = createSemanticTargetElement(new FakeDocument(), {
    id: 'run',
    role: 'AXButton',
    name: 'Run',
    action: 'start',
    surface: 'run-puck',
    frame: [4, 8, 32, 24],
  })
  const descriptor = descriptorFromElement(element)
  const candidates = await buildLocatorCandidates(descriptor)

  assert.equal(descriptor.role, 'button')
  assert.equal(descriptor.name, 'Run')
  assert.equal(descriptor.ref, 'run-puck:run')
  assert.deepEqual(
    candidates.map((candidate) => candidate.id),
    ['role_name', 'css', 'ref', 'rect']
  )
})
