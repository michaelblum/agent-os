import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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
    this.localName = tagName.toLowerCase()
    this.nodeName = this.tagName
    this.nodeType = 1
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

  hasAttribute(name) {
    return this.attributes.has(name)
  }

  toggleAttribute(name, enabled) {
    if (enabled) this.setAttribute(name, '')
    else this.removeAttribute(name)
  }

  getAttribute(name) {
    if (name.startsWith('data-')) return this.dataset[dataAttrName(name)] ?? null
    return this.attributes.get(name) ?? null
  }

  matches(selector) {
    if (selector === "a[href], button[type='submit'], input[type='submit']") {
      return (this.localName === 'a' && this.hasAttribute('href'))
        || (this.localName === 'button' && this.type === 'submit')
        || (this.localName === 'input' && this.type === 'submit')
    }
    return false
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? []
    handlers.push(handler)
    this.listeners.set(type, handlers)
  }

  removeEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? []
    this.listeners.set(type, handlers.filter((candidate) => candidate !== handler))
  }

  dispatchEvent(event) {
    const normalized = event || {}
    normalized.currentTarget ??= this
    normalized.target ??= this
    normalized.defaultPrevented ??= false
    normalized.preventDefault ??= () => {
      normalized.defaultPrevented = true
    }
    for (const handler of this.listeners.get(normalized.type) ?? []) {
      handler(normalized)
    }
    return !normalized.defaultPrevented
  }

  click() {
    return this.dispatchEvent({ type: 'click' })
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
      case '[data-aos-tabs-root]':
      case '[data-aos-tabs-list]':
        return this.controls.tabsRoot ?? null
      case '[data-aos-tabs-content]':
        return this.controls.panel ?? null
      default:
        return null
    }
  }

  querySelectorAll(selector) {
    if (selector === '.integration-hub-surface-tab') return this.controls.tabs ?? []
    if (selector === '[data-aos-tabs-trigger]') return this.controls.tabs ?? []
    if (selector === '[data-aos-tabs-content]') return this.controls.panel ? [this.controls.panel] : []
    return []
  }

  parseIntegrationHubControls() {
    const inputMatch = this._innerHTML.match(/<input[^>]*id="integration-hub-command"[^>]*value="([^"]*)"[^>]*>/)
    const actionMatch = this._innerHTML.match(/<button[^>]*class="integration-hub-action"[^>]*>([^<]*)<\/button>/)
    const tabs = [...this._innerHTML.matchAll(/<button[^>]*class="([^"]*integration-hub-surface-tab[^"]*)"[^>]*data-surface="([^"]*)"[^>]*data-value="([^"]*)"[^>]*>([^<]*)<\/button>/g)]

    const tabsRoot = this._innerHTML.includes('data-aos-tabs-root')
      ? Object.assign(new FakeElement('section'), {
        className: 'integration-hub-surface-tabs aos-segmented',
        ownerDocument: this.ownerDocument,
      })
      : null
    if (tabsRoot) {
      tabsRoot.dataset.aosTabsRoot = ''
      tabsRoot.dataset.aosTabsList = ''
    }

    this.controls = {
      tabsRoot,
      refresh: this._innerHTML.includes('class="integration-hub-refresh"')
        ? Object.assign(new FakeElement('button'), { className: 'integration-hub-refresh', textContent: 'Refresh' })
        : null,
      panel: this._innerHTML.includes('class="integration-hub-grid"')
        ? Object.assign(new FakeElement('section'), {
          className: 'integration-hub-grid',
          dataset: { aosTabsContent: '', value: this._innerHTML.match(/class="integration-hub-grid"[^>]*data-value="([^"]*)"/)?.[1] || '' },
          ownerDocument: this.ownerDocument,
        })
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
        button.dataset.value = match[3]
        button.dataset.aosTabsTrigger = ''
        button.ownerDocument = this.ownerDocument
        button.textContent = match[4]
        return button
      }),
    }
  }
}

class FakeDocument {
  constructor() {
    this.defaultView = {
      document: this,
      requestAnimationFrame: (callback) => {
        callback()
        return 0
      },
      cancelAnimationFrame: () => {},
    }
  }

  createElement(tagName) {
    const element = new FakeElement(tagName)
    element.ownerDocument = this
    return element
  }

  getElementById() {
    return null
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

test('default integration hub surface contract uses Providers, Workflows, and Jobs', async () => {
  const source = await readFile(new URL('../../packages/toolkit/components/integration-hub/index.js', import.meta.url), 'utf8')
  const css = await readFile(new URL('../../packages/toolkit/components/integration-hub/styles.css', import.meta.url), 'utf8')

  assert.match(source, /activeSurface: 'providers'/)
  assert.match(source, /const DEFAULT_SURFACES = Object\.freeze\(\[[\s\S]*\{ id: 'providers', label: 'Providers' \}/)
  assert.match(source, /surface\.id === 'integrations' \? 'providers' : surface\.id/)
  assert.match(source, /if \(id === 'activity'\) return null/)
  assert.match(source, /<label>providers<\/label>/)
  assert.doesNotMatch(source, /\{ id: 'integrations', label: 'Integrations' \}/)
  assert.doesNotMatch(source, /activeSurface: 'activity'/)
  assert.match(css, /html,\nbody\s*\{[^}]*background:/s)
  assert.match(css, /\.integration-hub-root\s*\{[^}]*background:/s)
  assert.match(css, /\.integration-hub-grid\s*\{[^}]*background:/s)
})

test('rendered integration hub stamps actionable controls with semantic metadata', async (t) => {
  const previousDocument = globalThis.document
  const previousWindow = globalThis.window
  const previousFetch = globalThis.fetch
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame
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
  globalThis.requestAnimationFrame = (callback) => {
    callback()
    return 0
  }
  globalThis.cancelAnimationFrame = () => {}
  let hub = null
  t.after(() => {
    hub?.teardown()
    globalThis.document = previousDocument
    globalThis.window = previousWindow
    globalThis.fetch = previousFetch
    globalThis.requestAnimationFrame = previousRequestAnimationFrame
    globalThis.cancelAnimationFrame = previousCancelAnimationFrame
  })

  hub = IntegrationHub({ pollMs: 60000 })
  hub.restore({ activeSurface: 'providers', simulateText: 'status' })
  const titles = []
  const root = hub.render({ setTitle: (title) => titles.push(title) })

  const input = root.querySelector('#integration-hub-command')
  const send = root.querySelector('.integration-hub-action')
  const refresh = root.querySelector('.integration-hub-refresh')
  const providersTab = root.querySelectorAll('.integration-hub-surface-tab')
    .find((button) => button.dataset.surface === 'providers')
  const jobsTab = root.querySelectorAll('.integration-hub-surface-tab')
    .find((button) => button.dataset.surface === 'jobs')

  assert.equal(input.getAttribute('id'), 'integration-hub-command')
  assert.equal(input.dataset.aosAction, 'edit_command')
  assert.equal(send.textContent, 'Send')
  assert.equal(send.getAttribute('aria-label'), 'Send command')
  assert.equal(send.dataset.aosRef, 'integration-hub:command-send')
  assert.equal(refresh.dataset.aosAction, 'refresh_snapshot')
  assert.equal(providersTab.getAttribute('role'), 'tab')
  assert.equal(providersTab.getAttribute('aria-selected'), 'true')
  assert.equal(providersTab.dataset.aosTabsTrigger, '')
  assert.equal(providersTab.dataset.aosAction, 'select_surface')
  assert.equal(providersTab.dataset.aosRef, 'integration-hub:surface-tab-providers')
  assert.equal(jobsTab.dataset.aosTabsTrigger, '')
  assert.equal(jobsTab.dataset.aosAction, 'select_surface')
  assert.equal(jobsTab.dataset.aosRef, 'integration-hub:surface-tab-jobs')
  jobsTab.click()
  await Promise.resolve()
  assert.equal(hub.serialize().activeSurface, 'jobs')
  assert.equal(
    root.querySelectorAll('.integration-hub-surface-tab')
      .find((button) => button.dataset.surface === 'jobs')
      .getAttribute('aria-selected'),
    'true',
  )
  assert.deepEqual(titles, ['Ops', 'Ops', 'Ops'])
})
