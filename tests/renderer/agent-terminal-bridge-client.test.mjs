import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createAgentTerminalBridgeClient,
  createBridgeUrl,
  createTerminalWebSocketUrl,
  formatResizeFrame,
} from '../../packages/toolkit/components/agent-terminal/bridge-client.js'

function jsonResponse(body, init = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    json: async () => body,
    text: async () => init.text ?? JSON.stringify(body),
  }
}

test('constructs bridge HTTP and terminal WebSocket URLs from the configured port', () => {
  assert.equal(createBridgeUrl({ port: 17762 }), 'http://127.0.0.1:17762')
  assert.equal(
    createTerminalWebSocketUrl({ port: '17762', session: 'agent session' }),
    'ws://127.0.0.1:17762/terminal?session=agent+session',
  )
})

test('loads the session catalog with cwd and provider query parameters', async () => {
  const calls = []
  const client = createAgentTerminalBridgeClient({
    port: 17763,
    fetchImpl: async (...args) => {
      calls.push(args)
      return jsonResponse({ sessions: [{ session_id: 'codex-session' }] })
    },
  })

  const payload = await client.loadSessions({ cwd: '/tmp/agent-os', provider: 'codex' })

  assert.deepEqual(payload.sessions, [{ session_id: 'codex-session' }])
  assert.equal(calls.length, 1)
  assert.equal(
    calls[0][0],
    'http://127.0.0.1:17763/sessions?cwd=%2Ftmp%2Fagent-os&provider=codex',
  )
})

test('omits provider filtering when loading all agent sessions', async () => {
  const calls = []
  const client = createAgentTerminalBridgeClient({
    port: 17764,
    fetchImpl: async (...args) => {
      calls.push(args)
      return jsonResponse({ sessions: [] })
    },
  })

  await client.loadSessions({ cwd: '/tmp/agent-os', provider: 'all' })

  assert.equal(calls[0][0], 'http://127.0.0.1:17764/sessions?cwd=%2Ftmp%2Fagent-os')
})

test('loads sanitized inspector data for a selected provider session', async () => {
  const calls = []
  const client = createAgentTerminalBridgeClient({
    port: 17765,
    fetchImpl: async (...args) => {
      calls.push(args)
      return jsonResponse({ session: { provider: 'codex', session_id: 'abc' } })
    },
  })

  const payload = await client.loadInspector({
    cwd: '/tmp/agent-os',
    provider: 'codex',
    sessionId: 'abc',
  })

  assert.deepEqual(payload.session, { provider: 'codex', session_id: 'abc' })
  assert.equal(
    calls[0][0],
    'http://127.0.0.1:17765/session-inspector?provider=codex&session_id=abc&cwd=%2Ftmp%2Fagent-os',
  )
})

test('ensures a terminal session with the expected bridge payload', async () => {
  const calls = []
  const command = ['codex', '--no-alt-screen']
  const client = createAgentTerminalBridgeClient({
    port: 17766,
    fetchImpl: async (...args) => {
      calls.push(args)
      return jsonResponse({ ok: true, driver: 'process' })
    },
  })

  const payload = await client.ensureSession({
    session: 'aos-agent-terminal',
    cwd: '/tmp/agent-os',
    command,
    force: true,
  })

  assert.equal(payload.ok, true)
  assert.equal(calls[0][0], 'http://127.0.0.1:17766/ensure')
  assert.deepEqual(calls[0][1], {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      session: 'aos-agent-terminal',
      cwd: '/tmp/agent-os',
      command,
      force: true,
    }),
  })
})

test('opens terminal WebSocket connections through an injected constructor', () => {
  const opened = []
  class FakeWebSocket {
    constructor(url) {
      this.url = url
      opened.push(url)
    }
  }
  const client = createAgentTerminalBridgeClient({
    port: 17767,
    WebSocketImpl: FakeWebSocket,
  })

  const socket = client.openTerminalSocket({ session: 'aos-agent-terminal' })

  assert.equal(socket.url, 'ws://127.0.0.1:17767/terminal?session=aos-agent-terminal')
  assert.deepEqual(opened, ['ws://127.0.0.1:17767/terminal?session=aos-agent-terminal'])
})

test('formats resize control frames for the terminal WebSocket', () => {
  assert.equal(formatResizeFrame({ cols: 100, rows: 31 }), '\u0000{"type":"resize","cols":100,"rows":31}')
})

test('surfaces bridge response text on non-2xx responses', async () => {
  const client = createAgentTerminalBridgeClient({
    port: 17768,
    fetchImpl: async () => jsonResponse({}, { ok: false, status: 500, text: 'bridge failed' }),
  })

  await assert.rejects(
    () => client.loadSessions({ cwd: '/tmp/agent-os' }),
    /bridge failed/,
  )
})
