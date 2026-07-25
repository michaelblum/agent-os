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
})
const frameURL = 'aos://toolkit/.aos-desktop-frame/v1/11111111-1111-4111-8111-111111111111/frame'

function fakeClient() {
  let receive
  const released = []
  let requests = 0
  return {
    client: {
      request() {
        requests += 1
        return true
      },
      release(handle) {
        released.push(handle)
      },
      subscribe(receivedIdentity, displayId, handler) {
        assert.deepEqual(receivedIdentity, identity)
        assert.equal(displayId, 42)
        receive = handler
        return () => { receive = null }
      },
    },
    get receive() { return receive },
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
    captureDurationMs: 42,
    capturedAtEpochMs: 1_000,
    epochId: '22222222-2222-4222-8222-222222222222',
    frame: {
      handle: 'opaque-handle',
      height: 682,
      url: frameURL,
      width: 1092,
    },
    requestId: 'request-1',
    status: 'ok',
  })
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(source.snapshot(), {
    bounds: [0, 0, 1440, 900],
    captureDurationMs: 42,
    capturedAtEpochMs: 1_000,
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
    captureDurationMs: 9,
    capturedAtEpochMs: 1_000,
    epochId: '33333333-3333-4333-8333-333333333333',
    frame: {
      handle: 'failed-handle',
      height: 80,
      url: frameURL,
      width: 100,
    },
    requestId: 'request-2',
    status: 'ok',
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(source.snapshot().status, 'failed')
  assert.equal(source.snapshot().errorCode, 'DESKTOP_FRAME_CAPTURE_FAILED')
  assert.equal(JSON.stringify(source.snapshot()).includes('sensitive'), false)
  assert.deepEqual(fixture.released, ['failed-handle'])
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
    captureDurationMs: 12,
    capturedAtEpochMs: 1_000,
    epochId: '77777777-7777-4777-8777-777777777777',
    frame: {
      handle: 'expiring-handle',
      height: 682,
      url: frameURL,
      width: 1092,
    },
    requestId: 'request-3',
    status: 'ok',
  })
  await new Promise((resolve) => setImmediate(resolve))

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

  assert.equal(client.request(identity), true)
  const requestId = posted[0][1].request_id
  assert.deepEqual(posted[0], ['desktop_frame.acquire', {
    extension: reference,
    owner: identity.owner,
    request_id: requestId,
    resource: identity.resource,
  }])
  receive({
    type: 'desktop_frame.available',
    request_id: requestId,
    status: 'ok',
    owner: identity.owner,
    resource: identity.resource,
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
  assert.equal(observed.length, 1)
  assert.equal(observed[0].frame.handle, 'opaque')
  assert.equal(observed[0].epochId, '44444444-4444-4444-8444-444444444444')

  receive({
    type: 'desktop_frame.available',
    status: 'ok',
    owner: 'io.example.other',
    resource: identity.resource,
    extension: reference,
    epoch_id: '66666666-6666-4666-8666-666666666666',
    frames: [],
  })
  assert.equal(observed.length, 1)

  client.release('opaque')
  assert.deepEqual(posted[1], ['desktop_frame.release', { handle: 'opaque' }])
  unsubscribe()
  assert.equal(client.dispose(), true)
  assert.equal(client.dispose(), false)
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
