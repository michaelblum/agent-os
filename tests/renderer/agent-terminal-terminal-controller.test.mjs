import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createAgentTerminalController,
  createDefaultTerminalOptions,
} from '../../packages/toolkit/components/agent-terminal/terminal-controller.js'

class FakeSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  constructor() {
    this.readyState = FakeSocket.CONNECTING
    this.listeners = new Map()
    this.sent = []
    this.closed = false
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  async dispatch(type, event = {}) {
    if (type === 'open') this.readyState = FakeSocket.OPEN
    if (type === 'close') this.readyState = FakeSocket.CLOSED
    for (const listener of this.listeners.get(type) || []) {
      await listener(event)
    }
  }

  send(data) {
    this.sent.push(data)
  }

  close() {
    this.closed = true
    this.readyState = FakeSocket.CLOSED
  }
}

function createFakeTerminal({ cols = 80, rows = 24 } = {}) {
  return {
    cols,
    rows,
    cleared: 0,
    focused: 0,
    writes: [],
    writelns: [],
    clear() {
      this.cleared += 1
    },
    focus() {
      this.focused += 1
    },
    write(value) {
      this.writes.push(value)
    },
    writeln(value) {
      this.writelns.push(value)
    },
  }
}

function createHarness(options = {}) {
  const sockets = []
  const statuses = []
  const attached = []
  const inspectorEmpty = []
  const loadSessionCalls = []
  const ensureCalls = []
  const terminal = createFakeTerminal(options.terminal)
  const fitAddon = {
    fits: 0,
    fit() {
      this.fits += 1
      if (options.onFit) options.onFit(terminal, this.fits)
    },
  }
  const bridgeClient = {
    formatResizeFrame({ cols, rows }) {
      return `resize:${cols}x${rows}`
    },
    openTerminalSocket({ session }) {
      const socket = new FakeSocket()
      socket.session = session
      sockets.push(socket)
      return socket
    },
    async ensureSession(payload) {
      ensureCalls.push(payload)
      if (options.ensureError) throw options.ensureError
      return { ok: true }
    },
  }
  const controller = createAgentTerminalController({
    bridgeClient,
    terminal,
    fitAddon,
    session: 'agent-session',
    setStatus(kind, text) {
      statuses.push({ kind, text })
    },
    setAttached(value) {
      attached.push(value)
    },
    renderInspectorEmpty(text) {
      inspectorEmpty.push(text)
    },
    loadSessions() {
      loadSessionCalls.push(true)
    },
    requestAnimationFrameImpl(callback) {
      callback()
      return 1
    },
    cancelAnimationFrameImpl() {},
    setTimeoutImpl(callback) {
      callback()
      return 1
    },
    WebSocketImpl: FakeSocket,
  })
  return {
    attached,
    controller,
    ensureCalls,
    fitAddon,
    inspectorEmpty,
    loadSessionCalls,
    sockets,
    statuses,
    terminal,
  }
}

test('constructs the existing xterm defaults', () => {
  assert.deepEqual(createDefaultTerminalOptions(), {
    cursorBlink: true,
    convertEol: false,
    fontFamily: 'SF Mono, Menlo, Consolas, monospace',
    fontSize: 12,
    lineHeight: 1.15,
    scrollback: 5000,
    theme: {
      background: '#050708',
      foreground: '#d8e6df',
      cursor: '#86ddff',
      selectionBackground: '#264d62',
    },
  })
})

test('attaches terminal sockets with status, attached state, clear, refit, and focus behavior', async () => {
  const harness = createHarness()

  const socket = harness.controller.connectTerminal('Agent terminal')
  await socket.dispatch('open')

  assert.equal(socket.session, 'agent-session')
  assert.deepEqual(harness.statuses[0], {
    kind: 'ready',
    text: 'Agent terminal - attached',
  })
  assert.deepEqual(harness.attached, [true])
  assert.equal(harness.terminal.cleared, 1)
  assert.equal(harness.terminal.focused, 1)
  assert.equal(harness.fitAddon.fits, 3)
  assert.deepEqual(socket.sent, ['resize:80x24'])
})

test('writes string and Blob-like socket messages to the terminal', async () => {
  const harness = createHarness()
  const socket = harness.controller.connectTerminal()
  await socket.dispatch('message', { data: 'plain text' })
  await socket.dispatch('message', { data: { text: async () => 'blob text' } })

  assert.deepEqual(harness.terminal.writes, ['plain text', 'blob text'])
})

test('updates attached state and status for close and error events', async () => {
  const harness = createHarness()
  const socket = harness.controller.connectTerminal('Codex')

  await socket.dispatch('close')
  await socket.dispatch('error')

  assert.deepEqual(harness.attached, [false])
  assert.deepEqual(harness.statuses, [
    { kind: 'error', text: 'Codex - detached' },
    { kind: 'error', text: 'terminal bridge error' },
  ])
})

test('forwards terminal input only while the active socket is open', async () => {
  const harness = createHarness()
  const socket = harness.controller.connectTerminal()

  harness.controller.forwardInput('before-open')
  await socket.dispatch('open')
  harness.controller.forwardInput('after-open')
  await socket.dispatch('close')
  harness.controller.forwardInput('after-close')

  assert.deepEqual(socket.sent, ['resize:80x24', 'after-open'])
})

test('sends resize frames only when terminal dimensions change and socket is open', async () => {
  const harness = createHarness({
    terminal: { cols: 80, rows: 24 },
    onFit(terminal, count) {
      if (count === 2) {
        terminal.cols = 100
        terminal.rows = 31
      }
    },
  })
  const socket = harness.controller.connectTerminal()
  await socket.dispatch('open')

  assert.deepEqual(socket.sent, ['resize:80x24', 'resize:100x31'])
})

test('replaces stale sockets and ignores stale socket events', async () => {
  const harness = createHarness()
  const first = harness.controller.connectTerminal('First')
  const second = harness.controller.connectTerminal('Second')

  await first.dispatch('open')
  await second.dispatch('open')

  assert.equal(first.closed, true)
  assert.deepEqual(harness.statuses, [
    { kind: 'ready', text: 'Second - attached' },
  ])
})

test('runs agent commands through the bridge and reconnects on success', async () => {
  const harness = createHarness()
  harness.controller.setCurrentCwd('/repo')

  await harness.controller.runAgentCommand({
    command: ['codex', '--no-alt-screen'],
    cwd: '/repo',
    label: 'New Codex',
    hasSelectedSession: false,
  })

  assert.deepEqual(harness.inspectorEmpty, ['Telemetry pending'])
  assert.deepEqual(harness.statuses[0], { kind: '', text: 'Starting New Codex' })
  assert.deepEqual(harness.terminal.writelns, ['Starting New Codex...'])
  assert.deepEqual(harness.ensureCalls, [{
    session: 'agent-session',
    cwd: '/repo',
    command: ['codex', '--no-alt-screen'],
    force: true,
  }])
  assert.equal(harness.sockets.length, 1)
  assert.deepEqual(harness.loadSessionCalls, [true])
})

test('writes launch errors without opening a terminal socket', async () => {
  const harness = createHarness({ ensureError: new Error('bridge unavailable') })

  await harness.controller.runAgentCommand({
    command: ['claude'],
    cwd: '/repo',
    label: 'New Claude Code',
  })

  assert.deepEqual(harness.statuses, [
    { kind: '', text: 'Starting New Claude Code' },
    { kind: 'error', text: 'launch failed' },
  ])
  assert.deepEqual(harness.terminal.writelns, [
    'Starting New Claude Code...',
    '\r\nbridge unavailable',
  ])
  assert.equal(harness.sockets.length, 0)
})
