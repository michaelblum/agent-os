import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createAosActionPayload,
  dispatchAosAction,
} from '../../packages/toolkit/runtime/action.js'

function encodeMessage(msg) {
  return Buffer.from(JSON.stringify(msg), 'utf8').toString('base64')
}

test('createAosActionPayload preserves source canvas, control metadata, and desktop-world pointer', () => {
  const element = {
    id: 'open-docs',
    dataset: {
      aosRef: 'demo:open-docs',
      aosSurface: 'demo',
      descriptorId: 'demo-open-docs',
    },
  }
  const payload = createAosActionPayload('macos.open_url', {
    url: 'https://www.example.com/',
    event: {
      desktop_world: { x: 120, y: 240 },
      currentTarget: element,
    },
    element,
    globalObject: {
      __aosCanvasId: 'source-canvas',
      __aosSegmentDisplayId: 7,
    },
  })

  assert.equal(payload.action, 'macos.open_url')
  assert.equal(payload.url, 'https://www.example.com/')
  assert.deepEqual(payload.anchor, {
    coordinate_space: 'desktop_world',
    x: 120,
    y: 240,
  })
  assert.deepEqual(payload.source, {
    source_origin: 'canvas',
    source_canvas_id: 'source-canvas',
    owner_canvas_id: 'source-canvas',
    segment_display_id: 7,
  })
  assert.equal(payload.control.id, 'open-docs')
  assert.equal(payload.control.descriptor_id, 'demo-open-docs')
  assert.equal(payload.control.surface, 'demo')
  assert.equal(payload.control.aos_ref, 'demo:open-docs')
})

test('dispatchAosAction posts aos.action and resolves canvas response', async (t) => {
  const previousWindow = globalThis.window
  const previousAtob = globalThis.atob
  const outbound = []

  globalThis.window = {
    __aosCanvasId: 'action-source',
    webkit: {
      messageHandlers: {
        headsup: {
          postMessage(message) {
            outbound.push(message)
          },
        },
      },
    },
  }
  globalThis.atob = (value) => Buffer.from(value, 'base64').toString('utf8')

  t.after(() => {
    globalThis.window = previousWindow
    globalThis.atob = previousAtob
  })

  const promise = dispatchAosAction('panel.toggle', {
    id: 'demo-panel',
    url: 'aos://toolkit/components/aos-action-demo/index.html',
    anchor: { coordinate_space: 'desktop_world', x: 10, y: 20 },
    width: 320,
    height: 180,
    timeoutMs: 100,
  })

  assert.equal(outbound.length, 1)
  assert.equal(outbound[0].type, 'aos.action')
  assert.equal(outbound[0].payload.action, 'panel.toggle')
  assert.equal(outbound[0].payload.id, 'demo-panel')
  assert.equal(outbound[0].payload.source.source_canvas_id, 'action-source')
  assert.ok(outbound[0].payload.request_id)

  window.headsup.receive(encodeMessage({
    type: 'canvas.response',
    request_id: outbound[0].payload.request_id,
    status: 'ok',
    action: 'panel.toggle',
    panel: { id: 'demo-panel', operation: 'open' },
  }))

  assert.equal((await promise).panel.operation, 'open')
})

