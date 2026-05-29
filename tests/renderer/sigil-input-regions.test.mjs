import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SIGIL_AVATAR_INPUT_REGION_ID,
  SIGIL_CONTEXT_MENU_INPUT_REGION_ID,
  SIGIL_SELECTION_MODE_INPUT_REGION_ID,
  createSigilInputRegionAdapter,
  selectSigilInputRegionOwner,
} from '../../apps/sigil/renderer/live-modules/input-regions.js'

function createHost({ rejectUpdateWithNotFound = false } = {}) {
  const calls = []
  return {
    calls,
    inputRegionRegister(payload) {
      calls.push({ method: 'register', payload })
      return Promise.resolve({ status: 'ok' })
    },
    inputRegionUpdate(payload) {
      calls.push({ method: 'update', payload })
      if (rejectUpdateWithNotFound) {
        return Promise.reject(new Error('NOT_FOUND: input region missing'))
      }
      return Promise.resolve({ status: 'ok' })
    },
    inputRegionRemove(id) {
      calls.push({ method: 'remove', id })
      return Promise.resolve()
    },
  }
}

function createLiveState(overrides = {}) {
  return {
    avatarVisible: true,
    avatarPos: { x: 100, y: 120, valid: true },
    currentState: 'IDLE',
    ...overrides,
  }
}

function quietLogger() {
  return { warn() {} }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

test('owner id falls back from canvas id to surface id to configured fallback', () => {
  assert.equal(
    selectSigilInputRegionOwner({ __aosCanvasId: 'canvas-id', __aosSurfaceCanvasId: 'surface-id' }, 'avatar-main'),
    'canvas-id'
  )
  assert.equal(
    selectSigilInputRegionOwner({ __aosSurfaceCanvasId: 'surface-id' }, 'avatar-main'),
    'surface-id'
  )
  assert.equal(selectSigilInputRegionOwner({}, 'configured-avatar'), 'configured-avatar')
})

test('avatar region registers expected payload and skips redundant updates', () => {
  const host = createHost()
  const adapter = createSigilInputRegionAdapter({
    host,
    liveState: createLiveState(),
    windowObject: { __aosSurfaceCanvasId: 'surface-owner' },
    fallbackCanvasId: 'avatar-main',
    avatarNativeFrame: () => [60, 80, 80, 80],
    contextMenuIsOpen: () => false,
    logger: quietLogger(),
  })

  assert.equal(adapter.sync(), true)
  assert.equal(adapter.sync(), false)

  assert.equal(host.calls.length, 1)
  assert.equal(host.calls[0].method, 'register')
  assert.deepEqual(host.calls[0].payload, {
    id: SIGIL_AVATAR_INPUT_REGION_ID,
    owner_canvas_id: 'surface-owner',
    frame: [60, 80, 80, 80],
    coordinate_space: 'native',
    semantic_label: 'Sigil avatar input claim',
    priority: 80,
    consume_policy: 'captured',
    remove_on_owner_suspend: true,
    enabled: true,
    metadata: {
      app: 'sigil',
      surface: 'avatar-main',
      purpose: 'avatar-pointer-capture',
    },
  })
  assert.deepEqual(adapter.snapshot().regions.avatar.frame, [60, 80, 80, 80])
})

test('frame and enabled state changes update or remove avatar region', () => {
  const host = createHost()
  const liveState = createLiveState()
  let frame = [60, 80, 80, 80]
  const adapter = createSigilInputRegionAdapter({
    host,
    liveState,
    windowObject: {},
    fallbackCanvasId: 'avatar-main',
    avatarNativeFrame: () => frame,
    contextMenuIsOpen: () => false,
    logger: quietLogger(),
  })

  adapter.sync()
  frame = [61, 80, 80, 80]
  adapter.sync()
  liveState.currentState = 'GOTO'
  adapter.sync()

  assert.deepEqual(host.calls.map((call) => call.method), ['register', 'update', 'remove'])
  assert.deepEqual(host.calls[1].payload.frame, [61, 80, 80, 80])
  assert.equal(host.calls[2].id, SIGIL_AVATAR_INPUT_REGION_ID)
  assert.equal(adapter.snapshot().regions.avatar.registered, false)
})

test('avatar region is removed while a higher-fidelity hit canvas is active', () => {
  const host = createHost()
  let hitCanvasActive = false
  const adapter = createSigilInputRegionAdapter({
    host,
    liveState: createLiveState(),
    windowObject: {},
    fallbackCanvasId: 'avatar-main',
    avatarNativeFrame: () => [60, 80, 80, 80],
    avatarRegionEnabled: () => !hitCanvasActive,
    contextMenuIsOpen: () => false,
    logger: quietLogger(),
  })

  adapter.sync()
  hitCanvasActive = true
  adapter.sync()

  assert.deepEqual(host.calls.map((call) => call.method), ['register', 'remove'])
  assert.equal(host.calls[1].id, SIGIL_AVATAR_INPUT_REGION_ID)
  assert.equal(adapter.snapshot().regions.avatar.registered, false)
})

test('context-menu region has higher priority and expected metadata', () => {
  const host = createHost()
  const adapter = createSigilInputRegionAdapter({
    host,
    liveState: createLiveState(),
    windowObject: { __aosCanvasId: 'avatar-main' },
    fallbackCanvasId: 'avatar-main',
    avatarNativeFrame: () => null,
    contextMenuIsOpen: () => true,
    contextMenuNativeFrame: () => [200, 220, 240, 160],
    logger: quietLogger(),
  })

  adapter.sync()

  assert.equal(host.calls.length, 1)
  assert.equal(host.calls[0].method, 'register')
  assert.deepEqual(host.calls[0].payload, {
    id: SIGIL_CONTEXT_MENU_INPUT_REGION_ID,
    owner_canvas_id: 'avatar-main',
    frame: [200, 220, 240, 160],
    coordinate_space: 'native',
    semantic_label: 'Sigil context menu input claim',
    priority: 120,
    consume_policy: 'captured',
    remove_on_owner_suspend: true,
    enabled: true,
    metadata: {
      app: 'sigil',
      surface: 'avatar-main',
      purpose: 'context-menu-pointer-capture',
    },
  })
})

test('update NOT_FOUND triggers a register retry', async () => {
  const host = createHost({ rejectUpdateWithNotFound: true })
  let frame = [60, 80, 80, 80]
  const adapter = createSigilInputRegionAdapter({
    host,
    liveState: createLiveState(),
    windowObject: {},
    avatarNativeFrame: () => frame,
    contextMenuIsOpen: () => false,
    logger: quietLogger(),
  })

  adapter.sync()
  frame = [70, 80, 80, 80]
  adapter.sync()
  await flushPromises()

  assert.deepEqual(host.calls.map((call) => call.method), ['register', 'update', 'register'])
  assert.deepEqual(host.calls[2].payload.frame, [70, 80, 80, 80])
})

test('selection mode registers an active-only capture region', () => {
  const host = createHost()
  const liveState = createLiveState({
    selectionMode: { active: true },
  })
  const adapter = createSigilInputRegionAdapter({
    host,
    liveState,
    windowObject: { __aosCanvasId: 'avatar-main' },
    fallbackCanvasId: 'avatar-main',
    avatarNativeFrame: () => null,
    contextMenuIsOpen: () => false,
    selectionModeIsActive: () => liveState.selectionMode.active,
    selectionModeNativeFrame: () => [0, 0, 1440, 900],
    logger: quietLogger(),
  })

  adapter.sync()
  liveState.selectionMode.active = false
  adapter.sync()

  assert.equal(host.calls[0].method, 'register')
  assert.deepEqual(host.calls[0].payload, {
    id: SIGIL_SELECTION_MODE_INPUT_REGION_ID,
    owner_canvas_id: 'avatar-main',
    frame: [0, 0, 1440, 900],
    coordinate_space: 'native',
    semantic_label: 'Sigil Selection Mode input claim',
    priority: 110,
    consume_policy: 'captured',
    remove_on_owner_suspend: true,
    enabled: true,
    metadata: {
      app: 'sigil',
      surface: 'avatar-main',
      purpose: 'selection-mode-pointer-capture',
    },
  })
  assert.equal(host.calls[1].method, 'remove')
  assert.equal(host.calls[1].id, SIGIL_SELECTION_MODE_INPUT_REGION_ID)
  assert.equal(adapter.snapshot().regions.selectionMode.registered, false)
})

test('cleanup removes all known regions', () => {
  const host = createHost()
  const liveState = createLiveState({
    selectionMode: { active: true },
  })
  const adapter = createSigilInputRegionAdapter({
    host,
    liveState,
    windowObject: {},
    avatarNativeFrame: () => [60, 80, 80, 80],
    contextMenuIsOpen: () => true,
    contextMenuNativeFrame: () => [200, 220, 240, 160],
    selectionModeIsActive: () => liveState.selectionMode.active,
    selectionModeNativeFrame: () => [0, 0, 1440, 900],
    logger: quietLogger(),
  })

  adapter.sync()
  adapter.removeAll()

  assert.deepEqual(host.calls.map((call) => call.method), ['register', 'register', 'register', 'remove', 'remove', 'remove'])
  assert.deepEqual(host.calls.slice(3).map((call) => call.id), [
    SIGIL_AVATAR_INPUT_REGION_ID,
    SIGIL_CONTEXT_MENU_INPUT_REGION_ID,
    SIGIL_SELECTION_MODE_INPUT_REGION_ID,
  ])
  assert.equal(adapter.snapshot().regions.avatar.registered, false)
  assert.equal(adapter.snapshot().regions.contextMenu.registered, false)
  assert.equal(adapter.snapshot().regions.selectionMode.registered, false)
})

test('non-primary segments do not register regions', () => {
  const host = createHost()
  const adapter = createSigilInputRegionAdapter({
    host,
    liveState: createLiveState(),
    windowObject: {},
    isPrimarySegment: () => false,
    avatarNativeFrame: () => [60, 80, 80, 80],
    contextMenuIsOpen: () => true,
    contextMenuNativeFrame: () => [200, 220, 240, 160],
    logger: quietLogger(),
  })

  assert.equal(adapter.sync(), false)
  assert.equal(host.calls.length, 0)
  assert.equal(adapter.snapshot().regions.avatar.registered, false)
  assert.equal(adapter.snapshot().regions.contextMenu.registered, false)
  assert.equal(adapter.snapshot().regions.selectionMode.registered, false)
})
