import { test } from 'node:test'
import assert from 'node:assert/strict'
import IntegrationHub from '../../packages/toolkit/components/integration-hub/index.js'
import {
  applyIntegrationHubSemanticTarget,
  applyIntegrationHubSemantics,
  integrationHubAosRef,
} from '../../packages/toolkit/components/integration-hub/semantics.js'

function dataAttrName(name) {
  return name.replace(/^data-/, '').replace(/-([a-z])/g, (_, char) => char.toUpperCase())
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase()
    this.attributes = new Map()
    this.dataset = {}
    this.style = {}
    this.listeners = new Map()
    this.disabled = false
    this.className = ''
    this.value = ''
    this._textContent = ''
    this._innerHTML = ''
    this.controls = {}
    this.classList = {
      contains: (className) => this.className.split(/\s+/).includes(className),
    }
  }

  set textContent(value) {
    this._textContent = String(value ?? '')
    if (!this.classList.contains('integration-hub-root')) {
      this._innerHTML = escapeHtml(this._textContent)
    }
  }

  get textContent() {
    return this._textContent
  }

  set innerHTML(value) {
    this._innerHTML = String(value ?? '')
    if (this.classList.contains('integration-hub-root')) this.parseIntegrationHubControls()
  }

  get innerHTML() {
    return this._innerHTML
  }

  setAttribute(name, value) {
    const normalized = String(value)
    this.attributes.set(name, normalized)
    if (name === 'id') this.id = normalized
    if (name === 'type') this.type = normalized
    if (name === 'class') this.className = normalized
    if (name.startsWith('data-')) this.dataset[dataAttrName(name)] = normalized
  }

  removeAttribute(name) {
    this.attributes.delete(name)
    if (name === 'id') delete this.id
    if (name === 'type') delete this.type
    if (name.startsWith('data-')) delete this.dataset[dataAttrName(name)]
  }

  getAttribute(name) {
    if (name.startsWith('data-')) return this.dataset[dataAttrName(name)] ?? null
    return this.attributes.get(name) ?? null
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? []
    handlers.push(handler)
    this.listeners.set(type, handlers)
  }

  querySelector(selector) {
    switch (selector) {
      case '#integration-hub-command':
        return this.controls.input ?? null
      case '.integration-hub-action':
        return this.controls.action ?? null
      case '.integration-hub-refresh':
        return this.controls.refresh ?? null
      case '.integration-hub-grid':
        return this.controls.panel ?? null
      default:
        return null
    }
  }

  querySelectorAll(selector) {
    if (selector === '.integration-hub-surface-tab') return this.controls.tabs ?? []
    return []
  }

  parseIntegrationHubControls() {
    const inputMatch = this._innerHTML.match(/<input[^>]*id="integration-hub-command"[^>]*value="([^"]*)"[^>]*>/)
    const actionMatch = this._innerHTML.match(/<button[^>]*class="integration-hub-action"[^>]*>([^<]*)<\/button>/)
    const tabs = [...this._innerHTML.matchAll(/<button[^>]*class="([^"]*integration-hub-surface-tab[^"]*)"[^>]*data-surface="([^"]*)"[^>]*>([^<]*)<\/button>/g)]

    this.controls = {
      refresh: this._innerHTML.includes('class="integration-hub-refresh"')
        ? Object.assign(new FakeElement('button'), { className: 'integration-hub-refresh', textContent: 'Refresh' })
        : null,
      panel: this._innerHTML.includes('class="integration-hub-grid"')
        ? Object.assign(new FakeElement('section'), { className: 'integration-hub-grid' })
        : null,
      input: inputMatch
        ? Object.assign(new FakeElement('input'), { id: 'integration-hub-command', value: inputMatch[1] })
        : null,
      action: actionMatch
        ? Object.assign(new FakeElement('button'), { className: 'integration-hub-action', textContent: actionMatch[1] })
        : null,
      tabs: tabs.map((match) => {
        const button = new FakeElement('button')
        button.className = match[1]
        button.dataset.surface = match[2]
        button.textContent = match[3]
        return button
      }),
    }
  }
}

class FakeDocument {
  createElement(tagName) {
    return new FakeElement(tagName)
  }
}

test('integration hub refs are scoped to the surface', () => {
  assert.equal(integrationHubAosRef('command-send'), 'integration-hub:command-send')
  assert.equal(integrationHubAosRef('surface tab/jobs'), 'integration-hub:surface-tab-jobs')
})

test('command send semantics preserve the visible button label', () => {
  const button = new FakeElement('button')
  button.textContent = 'Send'

  applyIntegrationHubSemanticTarget(button, {
    id: 'command-send',
    name: 'Send command',
    action: 'send_command',
  }, {
    preserveText: true,
  })

  assert.equal(button.getAttribute('id'), 'integration-hub-command-send')
  assert.equal(button.getAttribute('role'), null)
  assert.equal(button.getAttribute('type'), 'button')
  assert.equal(button.getAttribute('aria-label'), 'Send command')
  assert.equal(button.dataset.aosRef, 'integration-hub:command-send')
  assert.equal(button.dataset.aosAction, 'send_command')
  assert.equal(button.dataset.aosSurface, 'integration-hub')
  assert.equal(button.dataset.semanticTargetId, 'command-send')
  assert.equal(button.textContent, 'Send')
})

test('command input keeps its existing DOM id for the label binding', () => {
  const input = new FakeElement('input')
  input.id = 'integration-hub-command'
  input.value = 'status'

  applyIntegrationHubSemanticTarget(input, {
    id: 'command-input',
    role: 'AXTextField',
    name: 'Integration command',
    action: 'edit_command',
    value: input.value,
  }, {
    idPrefix: null,
  })

  assert.equal(input.getAttribute('id'), 'integration-hub-command')
  assert.equal(input.getAttribute('role'), 'textbox')
  assert.equal(input.getAttribute('aria-label'), 'Integration command')
  assert.equal(input.getAttribute('aria-valuetext'), 'status')
  assert.equal(input.dataset.aosRef, 'integration-hub:command-input')
  assert.equal(input.dataset.aosAction, 'edit_command')
})

test('surface tabs receive tab state and AOS metadata without label changes', () => {
  const input = new FakeElement('input')
  input.id = 'integration-hub-command'
  input.value = 'features'
  const action = new FakeElement('button')
  action.textContent = 'Send'
  const refresh = new FakeElement('button')
  refresh.textContent = 'Refresh'
  const panel = new FakeElement('section')
  const jobsTab = new FakeElement('button')
  jobsTab.className = 'integration-hub-surface-tab active'
  jobsTab.dataset.surface = 'jobs'
  jobsTab.textContent = 'Jobs'
  const activityTab = new FakeElement('button')
  activityTab.className = 'integration-hub-surface-tab'
  activityTab.dataset.surface = 'activity'
  activityTab.textContent = 'Activity'
  const root = new FakeElement('div')
  root.controls = {
    input,
    action,
    refresh,
    panel,
    tabs: [jobsTab, activityTab],
  }

  applyIntegrationHubSemantics(root, {
    activeSurface: 'jobs',
    simulateText: 'features',
    sending: false,
  })

  assert.equal(refresh.dataset.aosAction, 'refresh_snapshot')
  assert.equal(action.textContent, 'Send')
  assert.equal(action.getAttribute('aria-label'), 'Send command')
  assert.equal(panel.getAttribute('id'), 'integration-hub-surface-panel')
  assert.equal(panel.getAttribute('role'), 'tabpanel')
  assert.equal(jobsTab.getAttribute('role'), 'tab')
  assert.equal(jobsTab.getAttribute('aria-selected'), 'true')
  assert.equal(jobsTab.getAttribute('aria-controls'), 'integration-hub-surface-panel')
  assert.equal(jobsTab.dataset.aosAction, 'select_surface')
  assert.equal(jobsTab.dataset.aosRef, 'integration-hub:surface-tab-jobs')
  assert.equal(jobsTab.textContent, 'Jobs')
  assert.equal(activityTab.getAttribute('aria-selected'), 'false')
  assert.equal(activityTab.textContent, 'Activity')
})

test('rendered integration hub stamps actionable controls with semantic metadata', (t) => {
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  const previousFetch = globalThis.fetch
  const intervals = new Set()
  globalThis.document = new FakeDocument()
  globalThis.window = {
    setInterval(handler, ms) {
      const id = { handler, ms }
      intervals.add(id)
      return id
    },
    clearInterval(id) {
      intervals.delete(id)
    },
  }
  globalThis.fetch = () => new Promise(() => {})
  let hub = null
  t.after(() => {
    hub?.teardown()
    globalThis.document = previousDocument
    globalThis.window = previousWindow
    globalThis.fetch = previousFetch
  })

  hub = IntegrationHub({ pollMs: 60000 })
  hub.restore({ activeSurface: 'activity', simulateText: 'status' })
  const titles = []
  const root = hub.render({ setTitle: (title) => titles.push(title) })

  const input = root.querySelector('#integration-hub-command')
  const send = root.querySelector('.integration-hub-action')
  const refresh = root.querySelector('.integration-hub-refresh')
  const activityTab = root.querySelectorAll('.integration-hub-surface-tab')
    .find((button) => button.dataset.surface === 'activity')

  assert.equal(input.getAttribute('id'), 'integration-hub-command')
  assert.equal(input.dataset.aosAction, 'edit_command')
  assert.equal(send.textContent, 'Send')
  assert.equal(send.getAttribute('aria-label'), 'Send command')
  assert.equal(send.dataset.aosRef, 'integration-hub:command-send')
  assert.equal(refresh.dataset.aosAction, 'refresh_snapshot')
  assert.equal(activityTab.getAttribute('role'), 'tab')
  assert.equal(activityTab.getAttribute('aria-selected'), 'true')
  assert.equal(activityTab.dataset.aosAction, 'select_surface')
  assert.deepEqual(titles, ['Ops', 'Ops'])
})
