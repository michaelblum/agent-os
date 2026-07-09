import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createCanvasHostRuntime,
  createCanvasResponseError,
} from '../../packages/toolkit/runtime/canvas-host-runtime.js'

function encode(message) {
  return Buffer.from(JSON.stringify(message), 'utf8').toString('base64')
}

function hostGlobal(posts = []) {
  return {
    atob(value) {
      return Buffer.from(value, 'base64').toString('utf8')
    },
    webkit: {
      messageHandlers: {
        headsup: {
          postMessage(body) {
            posts.push(body)
          },
        },
      },
    },
  }
}

test('CanvasHostRuntime installs a receive bridge and dispatches subscriptions', () => {
  const posts = []
  const globalObject = hostGlobal(posts)
  const received = []
  const runtime = createCanvasHostRuntime({
    globalObject,
    requestId: () => 'req-1',
    loggerLabel: 'test-host',
  })

  const unsubscribeHandler = runtime.onMessage((message) => received.push(message))
  const unsubscribe = runtime.subscribe(['canvas_lifecycle'], { snapshot: true })
  globalObject.headsup.receive(encode({ type: 'canvas_lifecycle', canvas_id: 'panel-a' }))
  unsubscribe()
  unsubscribeHandler()
  globalObject.headsup.receive(encode({ type: 'ignored' }))

  assert.equal(globalObject.headsup.statusItemReady, false)
  assert.deepEqual(received, [{ type: 'canvas_lifecycle', canvas_id: 'panel-a' }])
  assert.deepEqual(posts, [
    { type: 'subscribe', payload: { events: ['canvas_lifecycle'], snapshot: true } },
    { type: 'unsubscribe', payload: { events: ['canvas_lifecycle'] } },
  ])
})

test('CanvasHostRuntime correlates request success and helper results', async () => {
  const posts = []
  const globalObject = hostGlobal(posts)
  const runtime = createCanvasHostRuntime({
    globalObject,
    requestId: () => 'req-create',
  })

  const promise = runtime.canvasCreate({ id: 'panel-a', frame: [1, 2, 3, 4] })
  assert.deepEqual(posts[0], {
    type: 'canvas.create',
    payload: {
      id: 'panel-a',
      frame: [1, 2, 3, 4],
      request_id: 'req-create',
    },
  })
  globalObject.headsup.receive(encode({ type: 'canvas.response', request_id: 'req-create', status: 'ok' }))

  assert.deepEqual(await promise, { id: 'panel-a' })
})

test('CanvasHostRuntime rejects request errors and timeouts', async () => {
  const posts = []
  const globalObject = hostGlobal(posts)
  let nextId = 'req-error'
  const runtime = createCanvasHostRuntime({
    globalObject,
    requestId: () => nextId,
  })

  const failed = runtime.canvasRemove({ id: 'missing' })
  globalObject.headsup.receive(encode({
    type: 'canvas.response',
    request_id: 'req-error',
    status: 'error',
    code: 'NOT_FOUND',
    message: 'missing canvas',
  }))
  await assert.rejects(failed, /NOT_FOUND: missing canvas/)

  nextId = 'req-timeout'
  await assert.rejects(
    runtime.request('slow.request', {}, { timeoutMs: 1 }),
    /TIMEOUT: slow.request/
  )
})

test('CanvasHostRuntime exposes status, input region, capture, and action helpers', async () => {
  const posts = []
  const globalObject = hostGlobal(posts)
  let requestCounter = 0
  const runtime = createCanvasHostRuntime({
    globalObject,
    requestId: () => `req-${++requestCounter}`,
  })

  runtime.setStatusMenuItems([{ id: 'toggle', title: 'Toggle' }])
  runtime.canvasUpdate({ id: 'panel-a', frame: [1, 2, 3, 4] })
  const capture = runtime.captureRegion({ x: 1, y: 2, w: 3, h: 4 })
  globalObject.headsup.receive(encode({
    type: 'canvas.response',
    request_id: 'req-1',
    status: 'ok',
    base64: 'abc',
    mime_type: 'image/jpeg',
  }))

  assert.deepEqual(await capture, {
    base64: 'abc',
    mimeType: 'image/jpeg',
    region: { x: 1, y: 2, w: 3, h: 4 },
  })
  assert.deepEqual(posts.map((post) => post.type), [
    'set_menu_items',
    'canvas.update',
    'capture.region',
  ])
})

test('createCanvasResponseError preserves response metadata', () => {
  const error = createCanvasResponseError({ status: 'error', code: 'NOPE', message: 'failed' })
  assert.equal(error.message, 'NOPE: failed')
  assert.equal(error.code, 'NOPE')
  assert.equal(error.status, 'error')
  assert.equal(error.responseMessage, 'failed')
})
