import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  applyRunPuckSemanticTarget,
  runPuckAosRef,
} from '../../packages/toolkit/run-puck/semantics.js'

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
    return this.attributes.get(name) ?? null
  }
}

test('run puck refs carry session identity as metadata', () => {
  assert.equal(runPuckAosRef('session-1', 'primary'), 'run-puck:session-1:primary')
  assert.equal(runPuckAosRef('', 'primary'), 'run-puck:unknown:primary')
})

test('primary command preserves visible label and stamps action metadata', () => {
  const button = new FakeElement('button')
  applyRunPuckSemanticTarget(button, {
    id: 'primary',
    name: 'Pause',
    action: 'pause',
    sessionId: 'run-7',
  }, { visibleLabel: true })

  assert.equal(button.getAttribute('id'), 'run-puck-primary')
  assert.equal(button.getAttribute('role'), null)
  assert.equal(button.getAttribute('type'), 'button')
  assert.equal(button.getAttribute('aria-label'), 'Pause')
  assert.equal(button.dataset.aosRef, 'run-puck:run-7:primary')
  assert.equal(button.dataset.aosAction, 'pause')
  assert.equal(button.dataset.aosSurface, 'run-puck')
  assert.equal(button.dataset.semanticTargetId, 'primary')
  assert.equal(button.textContent, 'Pause')
})

test('menu toggle exposes expanded state and lets caller restore icon text', () => {
  const button = new FakeElement('button')
  button.textContent = '...'
  applyRunPuckSemanticTarget(button, {
    id: 'menu-toggle',
    name: 'More run controls',
    action: 'toggle_menu',
    sessionId: 'run-7',
    expanded: true,
  })

  assert.equal(button.getAttribute('aria-label'), 'More run controls')
  assert.equal(button.getAttribute('aria-expanded'), 'true')
  assert.equal(button.dataset.aosAction, 'toggle_menu')
  assert.equal(button.textContent, '')
})

test('menu commands can expose menuitem roles with visible labels', () => {
  const button = new FakeElement('button')
  applyRunPuckSemanticTarget(button, {
    id: 'menu-open_timeline',
    role: 'AXMenuItem',
    name: 'Open timeline',
    action: 'open_timeline',
    sessionId: 'run-7',
  }, { visibleLabel: true })

  assert.equal(button.getAttribute('role'), 'menuitem')
  assert.equal(button.getAttribute('aria-label'), 'Open timeline')
  assert.equal(button.dataset.aosRef, 'run-puck:run-7:menu-open_timeline')
  assert.equal(button.dataset.aosAction, 'open_timeline')
  assert.equal(button.textContent, 'Open timeline')
})
