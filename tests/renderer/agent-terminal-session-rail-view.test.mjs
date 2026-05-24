import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createSessionRailButton,
  renderSessionRail,
  renderSessionRailEmpty,
} from '../../packages/toolkit/components/agent-terminal/session-rail-view.js'

class FakeClassList {
  constructor(element) {
    this.element = element
  }

  add(...classes) {
    const current = new Set(this.element.className.split(/\s+/).filter(Boolean))
    for (const className of classes) current.add(className)
    this.element.className = [...current].join(' ')
  }

  contains(className) {
    return this.element.className.split(/\s+/).includes(className)
  }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toLowerCase()
    this.ownerDocument = ownerDocument
    this.children = []
    this.attributes = new Map()
    this.listeners = new Map()
    this.className = ''
    this.textContent = ''
    this.type = ''
    this.classList = new FakeClassList(this)
  }

  append(...children) {
    this.children.push(...children)
  }

  replaceChildren(...children) {
    this.children = [...children]
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value))
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener)
  }

  click() {
    this.listeners.get('click')?.({ type: 'click', currentTarget: this })
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName, this)
  }
}

function createContainer() {
  const document = new FakeDocument()
  return document.createElement('div')
}

const row = {
  record: {
    provider: 'claude-code',
    session_id: 'claude-session-123',
    cwd: '/Users/Michael/Code/agent-os',
    resume_command: ['claude', '--resume', 'claude-session-123'],
  },
  provider: 'claude-code',
  providerLabel: 'Claude',
  workspaceLabel: 'agent-os',
  metadataText: 'main / May 23, 12:08 PM',
  shortId: 'claude-s',
  ariaLabel: 'Resume Claude session claude-session-123 in /Users/Michael/Code/agent-os',
  selected: true,
  resumeLabel: 'Claude agent-os',
}

test('renders the existing empty session rail state', () => {
  const container = createContainer()

  renderSessionRailEmpty(container)
  assert.deepEqual(container.children.map((child) => [child.tagName, child.className, child.textContent]), [
    ['div', 'empty-state', 'No sessions'],
  ])

  renderSessionRail(container, [])
  assert.deepEqual(container.children.map((child) => [child.tagName, child.className, child.textContent]), [
    ['div', 'empty-state', 'No sessions'],
  ])
})

test('creates a selected session button with existing classes, labels, and text', () => {
  const container = createContainer()
  const [button] = renderSessionRail(container, [row])

  assert.equal(button.tagName, 'button')
  assert.equal(button.type, 'button')
  assert.equal(button.className, 'session-button selected')
  assert.equal(button.getAttribute('aria-current'), 'true')
  assert.equal(button.getAttribute('role'), 'listitem')
  assert.equal(button.getAttribute('aria-label'), row.ariaLabel)

  const [main, meta, id] = button.children
  assert.equal(main.className, 'session-main')
  assert.deepEqual(main.children.map((child) => [child.tagName, child.className, child.textContent]), [
    ['span', 'provider-badge claude-code', 'Claude'],
    ['span', 'session-name', 'agent-os'],
  ])
  assert.deepEqual([meta.className, meta.textContent], ['session-meta', row.metadataText])
  assert.deepEqual([id.className, id.textContent], ['session-id', row.shortId])
})

test('omits selected state and aria-current for unselected rows', () => {
  const button = createSessionRailButton(
    { ...row, provider: 'codex', providerLabel: 'Codex', selected: false },
    { document: createContainer().ownerDocument },
  )

  assert.equal(button.className, 'session-button')
  assert.equal(button.getAttribute('aria-current'), null)
  assert.equal(button.children[0].children[0].className, 'provider-badge codex')
  assert.equal(button.children[0].children[0].textContent, 'Codex')
})

test('session click callback receives the row for page orchestration', () => {
  const container = createContainer()
  const clicked = []
  const [button] = renderSessionRail(container, [row], {
    onSessionClick(clickedRow) {
      clicked.push(clickedRow)
    },
  })

  button.click()
  assert.deepEqual(clicked, [row])
})
