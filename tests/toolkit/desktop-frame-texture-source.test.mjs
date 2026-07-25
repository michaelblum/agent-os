import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createDesktopFrameRequestClient,
  createDesktopFrameTextureSource,
} from '../../packages/toolkit/components/desktop-world-stage/desktop-frame-texture-source.js'

class FakeTexture {
  constructor() {
    this.image = null
    this.disposed = 0
    this.needsUpdate = false
  }

  dispose() {
    this.disposed += 1
  }
}

const THREE = {
  Texture: FakeTexture,
  LinearFilter: 'linear',
  SRGBColorSpace: 'srgb',
}
const reference = Object.freeze({
  digest: 'a'.repeat(64),
  id: 'companion-renderer',
  ownerId: 'io.ch-osctrl.sigil',
  sceneAbi: 'aos.scene.projection.v1',
  threeRevision: '183',
})
const identity = Object.freeze({
  extension: reference,
  owner: 'io.ch-osctrl.sigil',
  resource: 'companion/main',
  revision: 3,
})
const frameURL = 'aos://toolkit/.aos-desktop-frame/v1/11111111-1111-4111-8111-111111111111/frame'

function fakeClient(expectedDisplayId = 42) {
  let receive
  const released = []
  const canceled = []
  const presented = []
  const ready = []
  let requests = 0
  return {
    client: {
      request() {
        requests += 1
        return `request-${requests}`
      },
      cancel(requestId) {
        canceled.push(requestId)
        return true
      },
      ready(requestId, epochId) {
        ready.push([requestId, epochId])
        return true
      },
      presented(requestId, epochId) {
        presented.push([requestId, epochId])
        return true
      },
      release(handle) {
        released.push(handle)
      },
      subscribe(receivedIdentity, receivedDisplayId, handler) {
        assert.deepEqual(receivedIdentity, identity)
        assert.equal(receivedDisplayId, expectedDisplayId)
        receive = handler
        return () => { receive = null }
      },
    },
    canceled,
    get receive() { return receive },
    presented,
    ready,
    released,
    get requests() { return requests },
  }
}

test('desktop frame source swaps one epoch into a stable texture and clears pixels explicitly', async () => {
  const fixture = fakeClient()
  const image = { height: 682, width: 1092 }
  const source = createDesktopFrameTextureSource({
    THREE,
    bounds: [0, 0, 1440, 900],
    client: fixture.client,
    decode: async () => image,
    displayId: 42,
    identity,
    now: () => 125,
  })

  assert.equal(source.request(), true)
  assert.equal(source.request(), false)
  fixture.receive({
    kind: 'started',
    requestId: 'request-1',
    status: 'ok',
  })
  fixture.receive({
    captureDurationMs: 42,
    capturedAtEpochMs: 1_000,
    epochId: '22222222-2222-4222-8222-222222222222',
    frame: {
      handle: 'opaque-handle',
      height: 682,
      url: frameURL,
      width: 1092,
    },
    kind: 'available',
    requestId: 'request-1',
    status: 'ok',
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(source.texture.image, null)
  assert.equal(source.snapshot().status, 'staging')
  assert.deepEqual(fixture.ready, [[
    'request-1',
    '22222222-2222-4222-8222-222222222222',
  ]])
  fixture.receive({
    committedAtEpochMs: 1_100,
    epochId: '22222222-2222-4222-8222-222222222222',
    kind: 'commit',
    requestId: 'request-1',
    status: 'ok',
  })
  assert.deepEqual(fixture.presented, [[
    'request-1',
    '22222222-2222-4222-8222-222222222222',
  ]])
  fixture.receive({
    epochId: '22222222-2222-4222-8222-222222222222',
    kind: 'complete',
    requestId: 'request-1',
    status: 'ok',
  })

  assert.deepEqual(source.snapshot(), {
    bounds: [0, 0, 1440, 900],
    captureDurationMs: 42,
    capturedAtEpochMs: 1_000,
    committedAtEpochMs: 1_100,
    epochId: '22222222-2222-4222-8222-222222222222',
    errorCode: null,
    generation: 1,
    height: 682,
    readyAtMs: 125,
    status: 'ready',
    width: 1092,
  })
  assert.equal(Object.hasOwn(source.snapshot(), 'url'), false)
  assert.equal(source.texture.image, image)
  assert.equal(source.texture.generateMipmaps, false)
  assert.equal(source.texture.needsUpdate, true)
  assert.deepEqual(fixture.released, ['opaque-handle'])
  assert.equal(source.clear(), true)
  assert.equal(source.texture.image, null)
  assert.equal(source.snapshot().status, 'empty')
  assert.equal(source.texture.disposed, 1)
  assert.equal(source.dispose(), true)
  assert.equal(source.dispose(), false)
  assert.equal(source.texture.disposed, 2)
})

test('partial cross-display presentation rolls back every staged or visible frame', async () => {
  const first = fakeClient(42)
  const second = fakeClient(43)
  const firstSource = createDesktopFrameTextureSource({
    THREE,
    bounds: [0, 0, 1440, 900],
    client: first.client,
    decode: async () => ({ display: 42 }),
    displayId: 42,
    identity,
  })
  const secondSource = createDesktopFrameTextureSource({
    THREE,
    bounds: [1440, 0, 1440, 900],
    client: second.client,
    decode: async () => ({ display: 43 }),
    displayId: 43,
    identity,
  })
  const epochId = '23232323-2323-4232-8232-232323232323'
  for (const fixture of [first, second]) {
    assert.equal(fixture === first ? firstSource.request() : secondSource.request(), true)
    fixture.receive({ kind: 'started', requestId: 'request-1', status: 'ok' })
  }
  first.receive({
    captureDurationMs: 8,
    capturedAtEpochMs: 1_000,
    epochId,
    frame: { handle: 'first-frame', height: 900, url: frameURL, width: 1440 },
    kind: 'available',
    requestId: 'request-1',
    status: 'ok',
  })
  second.receive({
    captureDurationMs: 8,
    capturedAtEpochMs: 1_000,
    epochId,
    frame: { handle: 'second-frame', height: 900, url: frameURL, width: 1440 },
    kind: 'available',
    requestId: 'request-1',
    status: 'ok',
  })
  await new Promise((resolve) => setImmediate(resolve))
  first.receive({
    committedAtEpochMs: 1_100,
    epochId,
    kind: 'commit',
    requestId: 'request-1',
    status: 'ok',
  })
  assert.notEqual(firstSource.texture.image, null)
  assert.equal(secondSource.texture.image, null)

  const abort = { epochId, kind: 'abort', requestId: 'request-1', status: 'ok' }
  first.receive(abort)
  second.receive(abort)
  assert.equal(firstSource.texture.image, null)
  assert.equal(secondSource.texture.image, null)
  assert.equal(firstSource.snapshot().status, 'empty')
  assert.equal(secondSource.snapshot().status, 'empty')
  firstSource.dispose()
  secondSource.dispose()
})

test('desktop frame source releases failed decode handles without exposing payloads', async () => {
  const fixture = fakeClient()
  const source = createDesktopFrameTextureSource({
    THREE,
    bounds: [-100, 20, 100, 80],
    client: fixture.client,
    decode: async () => {
      throw new Error('decode included sensitive source details')
    },
    displayId: 42,
    identity,
  })

  assert.equal(source.request(), true)
  fixture.receive({
    kind: 'started',
    requestId: 'request-1',
    status: 'ok',
  })
  fixture.receive({
    captureDurationMs: 9,
    capturedAtEpochMs: 1_000,
    epochId: '33333333-3333-4333-8333-333333333333',
    frame: {
      handle: 'failed-handle',
      height: 80,
      url: frameURL,
      width: 100,
    },
    kind: 'available',
    requestId: 'request-1',
    status: 'ok',
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(source.snapshot().status, 'failed')
  assert.equal(source.snapshot().errorCode, 'DESKTOP_FRAME_CAPTURE_FAILED')
  assert.equal(JSON.stringify(source.snapshot()).includes('sensitive'), false)
  assert.deepEqual(fixture.released, ['failed-handle'])
  assert.deepEqual(fixture.canceled, ['request-1'])
  source.dispose()
})

test('desktop frame source projects missing consent as a quiet recoverable state', () => {
  const fixture = fakeClient()
  const source = createDesktopFrameTextureSource({
    THREE,
    bounds: [0, 0, 100, 100],
    client: fixture.client,
    displayId: 42,
    identity,
  })

  assert.equal(source.request(), true)
  fixture.receive({
    code: 'DESKTOP_FRAME_CONSENT_REQUIRED',
    kind: 'error',
    requestId: 'request-1',
    status: 'error',
  })

  assert.equal(source.snapshot().status, 'consent_required')
  assert.equal(source.snapshot().errorCode, 'DESKTOP_FRAME_CONSENT_REQUIRED')
  assert.equal(source.texture.image, null)
  source.dispose()
})

test('desktop frame source reports lost consent while retaining the last texture', async () => {
  const fixture = fakeClient()
  const image = { height: 80, width: 100 }
  const source = createDesktopFrameTextureSource({
    THREE,
    bounds: [0, 0, 100, 80],
    client: fixture.client,
    decode: async () => image,
    displayId: 42,
    identity,
  })

  assert.equal(source.request(), true)
  fixture.receive({
    kind: 'started',
    requestId: 'request-1',
    status: 'ok',
  })
  fixture.receive({
    captureDurationMs: 4,
    capturedAtEpochMs: 1_000,
    epochId: '44444444-4444-4444-8444-444444444444',
    frame: {
      handle: 'retained-handle',
      height: 80,
      url: frameURL,
      width: 100,
    },
    kind: 'available',
    requestId: 'request-1',
    status: 'ok',
  })
  await new Promise((resolve) => setImmediate(resolve))
  fixture.receive({
    committedAtEpochMs: 1_100,
    epochId: '44444444-4444-4444-8444-444444444444',
    kind: 'commit',
    requestId: 'request-1',
    status: 'ok',
  })
  fixture.receive({
    epochId: '44444444-4444-4444-8444-444444444444',
    kind: 'complete',
    requestId: 'request-1',
    status: 'ok',
  })
  assert.equal(source.texture.image, image)

  assert.equal(source.request(), true)
  fixture.receive({
    code: 'DESKTOP_FRAME_PERMISSION_DENIED',
    kind: 'error',
    requestId: 'request-2',
    status: 'error',
  })

  assert.equal(source.snapshot().status, 'consent_required')
  assert.equal(source.snapshot().errorCode, 'DESKTOP_FRAME_PERMISSION_DENIED')
  assert.equal(source.texture.image, image)
  source.dispose()
})

test('desktop frame source clears its GPU allocation at the bounded lease deadline', async () => {
  const fixture = fakeClient()
  const scheduled = []
  const source = createDesktopFrameTextureSource({
    THREE,
    bounds: [0, 0, 1440, 900],
    cancelScheduledClear() {},
    client: fixture.client,
    decode: async () => ({ height: 682, width: 1092 }),
    displayId: 42,
    identity,
    retentionMs: 5_000,
    scheduleClear(callback, delay) {
      scheduled.push({ callback, delay })
      return scheduled.length
    },
  })

  assert.equal(source.request(), true)
  fixture.receive({
    kind: 'started',
    requestId: 'request-1',
    status: 'ok',
  })
  fixture.receive({
    captureDurationMs: 12,
    capturedAtEpochMs: 1_000,
    epochId: '77777777-7777-4777-8777-777777777777',
    frame: {
      handle: 'expiring-handle',
      height: 682,
      url: frameURL,
      width: 1092,
    },
    kind: 'available',
    requestId: 'request-1',
    status: 'ok',
  })
  await new Promise((resolve) => setImmediate(resolve))
  fixture.receive({
    committedAtEpochMs: 1_100,
    epochId: '77777777-7777-4777-8777-777777777777',
    kind: 'commit',
    requestId: 'request-1',
    status: 'ok',
  })
  fixture.receive({
    epochId: '77777777-7777-4777-8777-777777777777',
    kind: 'complete',
    requestId: 'request-1',
    status: 'ok',
  })

  assert.equal(source.snapshot().status, 'ready')
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].delay, 5_000)
  scheduled[0].callback()
  assert.equal(source.snapshot().status, 'empty')
  assert.equal(source.texture.image, null)
  assert.equal(source.texture.disposed, 1)
  source.dispose()
})

test('desktop frame request client broadcasts one exact epoch to matching display subscribers', () => {
  const posted = []
  const observed = []
  let receive
  const client = createDesktopFrameRequestClient({
    emitMessage: (type, payload) => posted.push([type, payload]),
    listen: (handler) => {
      receive = handler
      return () => { receive = null }
    },
    timeoutMs: 100,
  })
  const unsubscribe = client.subscribe(identity, 42, (message) => observed.push(message))

  const requested = client.request(identity)
  assert.equal(typeof requested, 'string')
  const requestId = posted[0][1].request_id
  assert.deepEqual(posted[0], ['desktop_frame.acquire', {
    extension: reference,
    owner: identity.owner,
    request_id: requestId,
    resource: identity.resource,
    revision: identity.revision,
  }])
  receive({
    type: 'desktop_frame.started',
    request_id: requestId,
    status: 'ok',
    owner: identity.owner,
    resource: identity.resource,
    revision: identity.revision,
    extension: reference,
  })
  receive({
    type: 'desktop_frame.available',
    request_id: requestId,
    status: 'ok',
    owner: identity.owner,
    resource: identity.resource,
    revision: identity.revision,
    extension: reference,
    epoch_id: '44444444-4444-4444-8444-444444444444',
    capture_duration_ms: 17,
    captured_at_epoch_ms: 2_000,
    frames: [
      {
        display_id: 42,
        handle: 'opaque',
        height: 720,
        url: frameURL,
        width: 1280,
      },
      {
        display_id: 99,
        handle: 'other-display',
        height: 720,
        url: 'aos://toolkit/.aos-desktop-frame/v1/55555555-5555-4555-8555-555555555555/frame',
        width: 1280,
      },
    ],
  })
  assert.equal(observed[0].kind, 'started')
  assert.equal(observed.length, 2)
  assert.equal(observed[1].frame.handle, 'opaque')
  assert.equal(observed[1].epochId, '44444444-4444-4444-8444-444444444444')

  receive({
    type: 'desktop_frame.available',
    status: 'ok',
    owner: 'io.example.other',
    resource: identity.resource,
    revision: identity.revision,
    extension: reference,
    epoch_id: '66666666-6666-4666-8666-666666666666',
    frames: [],
  })
  assert.equal(observed.length, 2)

  assert.equal(client.ready(requestId, '44444444-4444-4444-8444-444444444444'), true)
  client.release('opaque')
  assert.deepEqual(posted[1], ['desktop_frame.ready', {
    epoch_id: '44444444-4444-4444-8444-444444444444',
    request_id: requestId,
  }])
  assert.deepEqual(posted[2], ['desktop_frame.release', { handle: 'opaque' }])
  receive({
    type: 'desktop_frame.commit',
    request_id: requestId,
    status: 'ok',
    owner: identity.owner,
    resource: identity.resource,
    revision: identity.revision,
    extension: reference,
    committed_at_epoch_ms: 2_100,
    epoch_id: '44444444-4444-4444-8444-444444444444',
  })
  assert.equal(observed.at(-1).kind, 'commit')
  assert.equal(client.presented(requestId, '44444444-4444-4444-8444-444444444444'), true)
  assert.deepEqual(posted[3], ['desktop_frame.presented', {
    epoch_id: '44444444-4444-4444-8444-444444444444',
    request_id: requestId,
  }])
  receive({
    type: 'desktop_frame.complete',
    request_id: requestId,
    status: 'ok',
    owner: identity.owner,
    resource: identity.resource,
    revision: identity.revision,
    extension: reference,
    epoch_id: '44444444-4444-4444-8444-444444444444',
  })
  assert.equal(observed.at(-1).kind, 'complete')
  unsubscribe()
  assert.equal(client.dispose(), true)
  assert.equal(client.dispose(), false)
})

test('desktop frame request client preserves the content-free consent error', () => {
  const observed = []
  let receive
  const client = createDesktopFrameRequestClient({
    emitMessage() {},
    listen(handler) {
      receive = handler
      return () => {}
    },
  })
  client.subscribe(identity, 42, (event) => observed.push(event))
  const requestId = client.request(identity)
  receive({
    code: 'DESKTOP_FRAME_CONSENT_REQUIRED',
    extension: reference,
    owner: identity.owner,
    request_id: requestId,
    resource: identity.resource,
    revision: identity.revision,
    status: 'error',
    type: 'desktop_frame.available',
  })

  assert.equal(observed.at(-1).code, 'DESKTOP_FRAME_CONSENT_REQUIRED')
  assert.equal(observed.at(-1).kind, 'error')
  client.dispose()
})

test('display clients adopt one admitted request and retire competing local requests', () => {
  const createHarness = (displayId) => {
    const posted = []
    const observed = []
    let receive
    const client = createDesktopFrameRequestClient({
      emitMessage: (type, payload) => posted.push([type, payload]),
      listen(handler) {
        receive = handler
        return () => {}
      },
    })
    client.subscribe(identity, displayId, (event) => observed.push(event))
    return { client, observed, posted, receive: (message) => receive(message) }
  }
  const first = createHarness(42)
  const second = createHarness(43)
  const winner = first.client.request(identity)
  const loser = second.client.request(identity)
  assert.notEqual(winner, loser)
  const started = {
    extension: reference,
    owner: identity.owner,
    request_id: winner,
    resource: identity.resource,
    revision: identity.revision,
    status: 'ok',
    type: 'desktop_frame.started',
  }
  first.receive(started)
  second.receive(started)

  assert.equal(first.observed.at(-1).requestId, winner)
  assert.equal(second.observed.at(-1).requestId, winner)
  assert.deepEqual(second.posted.at(-1), [
    'desktop_frame.cancel',
    { request_id: loser },
  ])
  first.client.dispose()
  second.client.dispose()
})

test('clearing a source cancels its request and rejects a late frame', async () => {
  const fixture = fakeClient()
  const source = createDesktopFrameTextureSource({
    THREE,
    bounds: [0, 0, 100, 100],
    client: fixture.client,
    decode: async () => ({ height: 100, width: 100 }),
    displayId: 42,
    identity,
  })

  assert.equal(source.request(), true)
  fixture.receive({ kind: 'started', requestId: 'request-1', status: 'ok' })
  assert.equal(source.clear(), true)
  fixture.receive({
    captureDurationMs: 1,
    capturedAtEpochMs: 1,
    epochId: '88888888-8888-4888-8888-888888888888',
    frame: { handle: 'late', height: 100, url: frameURL, width: 100 },
    kind: 'available',
    requestId: 'request-1',
    status: 'ok',
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(fixture.canceled, ['request-1'])
  assert.equal(source.texture.image, null)
  assert.equal(source.snapshot().status, 'empty')
  source.dispose()
})

test('request client rejects unrelated and canceled responses while releasing late handles', () => {
  const posted = []
  const observed = []
  let receive
  const client = createDesktopFrameRequestClient({
    emitMessage: (type, payload) => posted.push([type, payload]),
    listen(handler) {
      receive = handler
      return () => {}
    },
  })
  client.subscribe(identity, 42, (message) => observed.push(message))
  const requestId = client.request(identity)
  assert.equal(client.cancel(requestId), true)
  receive({
    type: 'desktop_frame.started',
    request_id: requestId,
    status: 'ok',
    owner: identity.owner,
    resource: identity.resource,
    revision: identity.revision,
    extension: reference,
  })
  receive({
    type: 'desktop_frame.available',
    request_id: requestId,
    status: 'ok',
    owner: identity.owner,
    resource: identity.resource,
    revision: identity.revision,
    extension: reference,
    epoch_id: '99999999-9999-4999-8999-999999999999',
    frames: [{
      display_id: 42,
      handle: 'late-handle',
      height: 100,
      url: frameURL,
      width: 100,
    }],
  })
  receive({
    type: 'desktop_frame.started',
    request_id: 'wrong-revision',
    status: 'ok',
    owner: identity.owner,
    resource: identity.resource,
    revision: identity.revision + 1,
    extension: reference,
  })

  assert.deepEqual(observed, [])
  assert.deepEqual(posted.slice(1), [
    ['desktop_frame.cancel', { request_id: requestId }],
    ['desktop_frame.release', { handle: 'late-handle' }],
  ])
  client.dispose()
})

test('desktop frame sources reject widened scene identities before bridge admission', () => {
  const fixture = fakeClient()
  assert.throws(() => createDesktopFrameTextureSource({
    THREE,
    bounds: [0, 0, 100, 100],
    client: fixture.client,
    displayId: 42,
    identity: { ...identity, extra: 'widened' },
  }), /exact scene and display identity/iu)
})
