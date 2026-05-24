import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  renderInspectorEmpty,
  renderInspectorError,
  renderInspectorLoading,
  renderSessionInspector,
} from '../../packages/toolkit/components/agent-terminal/session-inspector-view.js'

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toLowerCase()
    this.ownerDocument = ownerDocument
    this.children = []
    this.className = ''
    this.textContent = ''
    this.title = ''
  }

  append(...children) {
    this.children.push(...children)
  }

  replaceChildren(...children) {
    this.children = [...children]
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

function walk(node, visit) {
  visit(node)
  for (const child of node.children) walk(child, visit)
}

function elementsByClass(root, className) {
  const matches = []
  walk(root, (node) => {
    const classes = node.className.split(/\s+/).filter(Boolean)
    if (classes.includes(className)) matches.push(node)
  })
  return matches
}

function section(root, heading) {
  return root.children.find((child) => (
    child.tagName === 'section'
    && child.children[0]?.className === 'inspector-heading'
    && child.children[0]?.textContent === heading
  ))
}

function rowPairs(root) {
  return elementsByClass(root, 'inspector-row').map((row) => [
    row.children[0]?.textContent,
    row.children[1]?.textContent,
    row.children[1]?.title,
  ])
}

const metric = (value, unit = 'tokens', source = {}) => ({
  value,
  unit,
  source: {
    stability: 'provider-local',
    precision: 'exact',
    kind: 'context_window',
    provider_version: '1.2.3',
    provider_surface: 'transcript',
    ...source,
  },
})

test('renders empty and error inspector states with existing text', () => {
  const container = createContainer()

  renderInspectorEmpty(container)
  assert.deepEqual(container.children.map((child) => [child.className, child.textContent]), [
    ['empty-state', 'Select a session'],
  ])

  renderInspectorEmpty(container, 'No session selected')
  assert.deepEqual(container.children.map((child) => [child.className, child.textContent]), [
    ['empty-state', 'No session selected'],
  ])

  renderInspectorError(container, new Error('bridge unavailable'))
  assert.equal(section(container, 'Inspector').children[1].textContent, 'bridge unavailable')
})

test('renders loading state from the selected rail record', () => {
  const container = createContainer()

  renderInspectorLoading(container, {
    provider: 'claude-code',
    session_id: 'session-123',
    cwd: '/Users/Michael/Code/agent-os',
  })

  assert.deepEqual(rowPairs(section(container, 'Session')), [
    ['provider', 'Claude', ''],
    ['id', 'session-123', ''],
    ['cwd', '/Users/Michael/Code/agent-os', '/Users/Michael/Code/agent-os'],
  ])
  assert.equal(elementsByClass(container, 'empty-state')[0].textContent, 'Loading telemetry...')
})

test('renders full session inspector sections, metric sources, lifecycle, and diagnostics', () => {
  const container = createContainer()
  const model = renderSessionInspector(
    container,
    { provider: 'codex', session_id: 'record-session', cwd: '/old' },
    {
      session: {
        provider: 'codex',
        session_id: 'payload-session',
        cwd: '/repo',
        branch: 'feature/terminal',
        source_file: '/tmp/session.jsonl',
      },
      telemetry: {
        model: { display_name: 'GPT-5 Codex' },
        context: {
          window_tokens: metric(200000),
          used_tokens: metric(50000),
          remaining_tokens: metric(150000),
          used_ratio: metric(0.25, 'ratio'),
          remaining_ratio: metric(0.75, 'ratio'),
          tokens: {
            output_tokens: metric(1200),
            input_tokens: metric(3400),
          },
        },
      },
      lifecycle_events: [
        { event: 'created', observed_at: '2026-05-23T10:00:00Z' },
        { event: 'resumed', trigger: 'user', pre_tokens: metric(50000), post_tokens: metric(42000) },
      ],
      diagnostics: [{
        code: 'codex_token_count_missing_info',
        severity: 'warn',
        provider_surface: 'agent-terminal.session-inspector',
        fallback: 'context_unavailable',
      }],
    },
  )

  assert.deepEqual(container.children.map((child) => child.children[0].textContent), [
    'Session',
    'Context',
    'Token Counters',
    'Lifecycle',
    'Diagnostics',
  ])
  assert.equal(model.sessionRows[1].value, 'payload-session')
  assert.deepEqual(rowPairs(section(container, 'Session')).slice(0, 6), [
    ['provider', 'Codex', ''],
    ['id', 'payload-session', ''],
    ['cwd', '/repo', '/repo'],
    ['branch', 'feature/terminal', ''],
    ['source', '/tmp/session.jsonl', '/tmp/session.jsonl'],
    ['model', 'GPT-5 Codex', ''],
  ])
  assert.deepEqual(rowPairs(section(container, 'Context')).slice(0, 2), [
    ['window', '200,000 tokens', 'transcript'],
    ['used', '50,000 tokens', 'transcript'],
  ])
  assert.deepEqual(elementsByClass(section(container, 'Context'), 'inspector-source')[0].textContent, 'provider-local / exact / context_window / 1.2.3')
  assert.deepEqual(rowPairs(section(container, 'Token Counters')).map(([key]) => key), [
    'input tokens',
    'output tokens',
  ])
  assert.deepEqual(rowPairs(section(container, 'Lifecycle')).map(([key, value]) => [key, value]), [
    ['created', '2026-05-23T10:00:00Z'],
    ['resumed', 'user'],
    ['pre', '50,000 tokens'],
    ['post', '42,000 tokens'],
  ])

  const diagnostic = elementsByClass(container, 'diagnostic')[0]
  assert.equal(diagnostic.className, 'diagnostic warn')
  assert.equal(diagnostic.children[0].textContent, 'codex_token_count_missing_info')
  assert.equal(diagnostic.children[1].textContent, 'warn / agent-terminal.session-inspector / fallback: context_unavailable')
})

test('renders unknown context and no diagnostics text', () => {
  const container = createContainer()

  renderSessionInspector(
    container,
    { provider: 'codex', session_id: 'session-without-context' },
    { telemetry: null },
  )

  assert.equal(elementsByClass(section(container, 'Context'), 'empty-state')[0].textContent, 'Unknown')
  assert.equal(elementsByClass(section(container, 'Diagnostics'), 'empty-state')[0].textContent, 'No diagnostics')
  assert.equal(section(container, 'Token Counters'), undefined)
  assert.equal(section(container, 'Lifecycle'), undefined)
})
