import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applySemanticTargetAttributes,
  createSemanticTargetElement,
  normalizeAgentUiTarget,
  normalizeSemanticTarget,
  normalizeSemanticTargets,
  refForTarget,
  semanticTargetAttributeEntries,
  semanticTargetAttrString,
} from '../../packages/toolkit/runtime/semantic-targets.js'

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
    parent_canvas_id: 'avatar-main',
  })

  assert.deepEqual(target, {
    id: 'wiki-graph',
    role: 'button',
    name: 'Wiki Graph',
    action: 'wikiGraph',
    actions: [],
    enabled: true,
    current: true,
    pressed: null,
    selected: null,
    checked: null,
    expanded: null,
    value: null,
    surface: 'sigil-radial-menu',
    parent_canvas_id: 'avatar-main',
    ref: 'sigil-radial-menu:wiki-graph',
    metadata: {},
    frame: { x: 10, y: 21, width: 55, height: 45 },
  })
})

test('normalizeSemanticTarget maps form control AX aliases to canonical web roles', () => {
  assert.equal(normalizeSemanticTarget({ id: 'mode', role: 'AXRadioGroup' }).role, 'radiogroup')
  assert.equal(normalizeSemanticTarget({ id: 'toggles', role: 'AXCheckBoxGroup' }).role, 'group')
  assert.equal(normalizeSemanticTarget({ id: 'shape', role: 'AXPopUpButton' }).role, 'combobox')
})

test('normalizeSemanticTargets rejects targets without stable ids', () => {
  assert.throws(
    () => normalizeSemanticTargets([{ label: '' }]),
    /semantic target requires id/
  )
  assert.throws(
    () => normalizeSemanticTarget({ ref: 'state-scoped-ref', name: 'State Scoped Ref' }),
    /semantic target requires id/
  )
})

test('refForTarget uses explicit refs before generated surface refs', () => {
  assert.equal(refForTarget({ id: 'save', surface: 'toolbar' }), 'toolbar:save')
  assert.equal(refForTarget({ id: 'save', ref: 'custom-save' }, { surface: 'toolbar' }), 'custom-save')
})

test('normalizeSemanticTarget does not default action to identity', () => {
  const target = normalizeSemanticTarget({ id: 'plain-target', name: 'Plain Target' })

  assert.equal(target.action, '')
  assert.equal(target.ref, 'plain-target')
})

test('normalizeAgentUiTarget composes canonical producer records without alternate identity fields', () => {
  const target = normalizeAgentUiTarget({
    id: 'opacity',
    role: 'AXSlider',
    name: 'Opacity',
    value: 0.55,
    surface: 'toolkit.panel.form',
    frame: { x: 10, y: 72, width: 160, height: 28 },
    metadata: { aosFieldId: 'opacity' },
  }, {
    kind: 'slider',
    actions: ['drag', 'set-value'],
    extension: {
      descriptor_id: 'avatar-opacity',
      field_id: 'opacity',
      options: [],
      hidden: false,
    },
  })

  assert.deepEqual(target, {
    ref: 'toolkit.panel.form:opacity',
    surface: 'toolkit.panel.form',
    role: 'slider',
    name: 'Opacity',
    kind: 'slider',
    enabled: true,
    state: {
      value: 0.55,
      current: null,
      pressed: null,
      selected: null,
      checked: null,
      expanded: null,
    },
    actions: ['drag', 'set-value'],
    extension: {
      descriptor_id: 'avatar-opacity',
      field_id: 'opacity',
      options: [],
      hidden: false,
      source: { path: null, line_start: null, line_end: null },
    },
    provenance: {
      source_payload_id: 'opacity',
      metadata: { aosFieldId: 'opacity' },
      frame: { x: 10, y: 72, width: 160, height: 28 },
      parent_canvas_id: '',
    },
  })
  assert.equal(Object.hasOwn(target, 'id'), false)
  assert.equal(Object.hasOwn(target, 'aosRef'), false)
})

test('semanticTargetAttributeEntries serializes standard semantic target refs', () => {
  const entries = semanticTargetAttributeEntries({
    id: 'save',
    role: 'AXButton',
    name: 'Save',
    action: 'save_markdown',
    actions: ['click'],
    surface: 'markdown-workbench',
    parent_canvas_id: 'avatar-main',
    pressed: false,
  }, {
    nativeRole: 'button',
  })

  assert.deepEqual(entries, [
    ['aria-label', 'Save'],
    ['data-aos-ref', 'markdown-workbench:save'],
    ['data-aos-surface', 'markdown-workbench'],
    ['data-semantic-target-id', 'save'],
    ['data-aos-parent-canvas', 'avatar-main'],
    ['data-aos-action', 'save_markdown'],
    ['data-aos-actions', 'click'],
    ['aria-pressed', 'false'],
  ])
})

test('semantic target attributes serialize primitive actions and metadata separately from app action', () => {
  const entries = semanticTargetAttributeEntries({
    id: 'opacity',
    role: 'slider',
    name: 'Opacity',
    action: 'edit_opacity',
    actions: ['drag', 'set-value'],
    surface: 'panel',
    metadata: { descriptor_id: 'avatar-opacity' },
    value: 0.5,
  })

  assert.deepEqual(entries.filter(([name]) => name.startsWith('data-aos')), [
    ['data-aos-ref', 'panel:opacity'],
    ['data-aos-surface', 'panel'],
    ['data-aos-action', 'edit_opacity'],
    ['data-aos-actions', 'drag set-value'],
    ['data-aos-metadata', '{"descriptor_id":"avatar-opacity"}'],
  ])
})

test('semanticTargetAttrString escapes attrs and supports custom order', () => {
  const attrs = semanticTargetAttrString({
    id: 'visibility-<tree>',
    role: 'AXCheckBox',
    name: 'Hide "Tree" & children',
    action: 'toggle_visibility',
    ref: 'object-transform-panel:visibility:avatar-main:<tree>',
    surface: 'object-transform-panel',
    checked: 'mixed',
  }, {
    attributeOrder: [
      'aria-label',
      'data-aos-ref',
      'data-aos-surface',
      'data-semantic-target-id',
      'data-aos-action',
      'aria-checked',
      'role',
    ],
    nativeRole: 'checkbox',
  })

  assert.equal(
    attrs,
    'aria-label="Hide &quot;Tree&quot; &amp; children" data-aos-ref="object-transform-panel:visibility:avatar-main:&lt;tree&gt;" data-aos-surface="object-transform-panel" data-semantic-target-id="visibility-&lt;tree&gt;" data-aos-action="toggle_visibility" aria-checked="mixed"',
  )
})

test('createSemanticTargetElement stamps native button semantics and metadata without visible text', () => {
  const element = createSemanticTargetElement(new FakeDocument(), {
    id: 'context-menu',
    role: 'AXButton',
    name: 'Context Menu',
    action: 'contextMenu',
    actions: ['click'],
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
  assert.equal(element.dataset.aosActions, 'click')
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
