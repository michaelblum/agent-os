import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { createSigilUtilityCanvasRuntime } from '../../apps/sigil/renderer/live-modules/utility-canvas-runtime.js'

const AGENT_TERMINAL_CANVAS_ID = 'sigil-agent-terminal'
const AGENT_TERMINAL_FRAME = [840, 320, 600, 480]

function createHarness({
  initialCanvas = { id: AGENT_TERMINAL_CANVAS_ID, suspended: false, at: AGENT_TERMINAL_FRAME },
  avatarMode = initialCanvas?.suspended ? 'status' : 'terminal',
  pendingCollapse = initialCanvas?.suspended ? 'status' : null,
  pendingStatusPoint = initialCanvas?.suspended ? { x: 30, y: 40 } : null,
  canvasCreate = async () => {},
  canvasSuspend = async () => {},
  canvasResume = async () => {},
} = {}) {
  const events = []
  const warnings = []
  const utilityCanvases = new Map()
  if (initialCanvas) utilityCanvases.set(initialCanvas.id, { ...initialCanvas, at: [...initialCanvas.at] })
  const liveState = {
    displays: [{ index: 0, visibleBounds: { x: 0, y: 0, w: 1512, h: 875 } }],
    utilityCanvases,
    utilityCanvasOpenPromises: new Map(),
    avatarParking: avatarMode ? { mode: avatarMode, nativePoint: { x: 30, y: 40 } } : null,
    pendingAgentTerminalCollapse: pendingCollapse,
    pendingAgentTerminalStatusPoint: pendingStatusPoint,
    prewarmingAgentTerminal: false,
    _agentTerminalPrewarmStarted: false,
  }
  const host = {
    async canvasCreate(payload) {
      events.push({ type: 'create', payload })
      return canvasCreate(payload)
    },
    canvasUpdate(payload) {
      events.push({ type: 'update', payload: { ...payload, frame: [...payload.frame] } })
    },
    async canvasSuspend(id) {
      events.push({ type: 'suspend', id })
      return canvasSuspend(id)
    },
    async canvasResume(id) {
      events.push({ type: 'resume', id })
      return canvasResume(id)
    },
  }
  const avatarParking = {
    isParkedAtStatus() {
      return liveState.avatarParking?.mode === 'status'
    },
    parkAtStatusMessage(msg) {
      events.push({ type: 'park-status', msg })
      liveState.avatarParking = {
        mode: 'status',
        nativePoint: { x: Number(msg.origin_x), y: Number(msg.origin_y) },
      }
      return true
    },
    parkInTerminal(frame) {
      events.push({ type: 'park-terminal', frame: [...frame] })
      liveState.avatarParking = { mode: 'terminal', nativePoint: { x: frame[0], y: frame[1] } }
      return true
    },
    clear(options) {
      events.push({ type: 'clear-parking', options })
      liveState.avatarParking = null
      return { restoredPosition: true, restoreVisible: options?.restoreVisible !== false }
    },
  }
  let now = 0
  const runtime = createSigilUtilityCanvasRuntime({
    host,
    liveState,
    avatarParking,
    publishStatusMenuItems: () => events.push({ type: 'publish-menu' }),
    nativePointFromMessageOrigin: (msg) => {
      const x = Number(msg?.origin_x)
      const y = Number(msg?.origin_y)
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
    },
    statusCollapseFrameFromOrigin: ({ x, y }) => [x - 14, y - 14, 28, 28],
    consoleObject: { warn: (...args) => warnings.push(args) },
    performanceObject: { now: () => now },
    requestAnimationFrameFn(callback) {
      now += 180
      callback(now)
    },
  })
  return { avatarParking, events, host, liveState, runtime, warnings }
}

function eventTypes(harness) {
  return harness.events.map((event) => event.type)
}

test('Sigil utility canvas lifecycle delegates to utility runtime and toolkit manager', async () => {
  const main = await readFile(new URL('../../apps/sigil/renderer/live-modules/main.js', import.meta.url), 'utf8')
  const runtime = await readFile(new URL('../../apps/sigil/renderer/live-modules/utility-canvas-runtime.js', import.meta.url), 'utf8')

  assert.match(main, /createSigilUtilityCanvasRuntime/)
  assert.match(main, /utilityRuntime\.handleCanvasLifecycle\(msg\)/)
  assert.doesNotMatch(main, /utilityCanvasOpenPromises\.set/)
  assert.doesNotMatch(main, /function animateUtilityCanvasFrame/)
  assert.match(runtime, /createUtilitySurfaceManager/)
  assert.match(runtime, /runAgentTerminalTransition/)
})

test('agent terminal collapse commits local state only after host suspension succeeds', async () => {
  const harness = createHarness()

  assert.equal(await harness.runtime.collapseAgentTerminalToStatus({ origin_x: 30, origin_y: 40 }), true)

  assert.deepEqual(harness.liveState.utilityCanvases.get(AGENT_TERMINAL_CANVAS_ID), {
    id: AGENT_TERMINAL_CANVAS_ID,
    suspended: true,
    at: AGENT_TERMINAL_FRAME,
  })
  assert.equal(harness.liveState.pendingAgentTerminalCollapse, 'status')
  assert.deepEqual(harness.liveState.pendingAgentTerminalStatusPoint, { x: 30, y: 40 })
  assert.equal(harness.liveState.avatarParking.mode, 'status')
  assert.ok(eventTypes(harness).indexOf('suspend') < eventTypes(harness).indexOf('park-status'))
})

test('agent terminal collapse restores host frame and preserves local state when suspension fails', async () => {
  const failure = new Error('suspend IPC failed')
  const harness = createHarness({ canvasSuspend: async () => { throw failure } })
  const before = { ...harness.liveState.utilityCanvases.get(AGENT_TERMINAL_CANVAS_ID) }

  await assert.rejects(
    harness.runtime.collapseAgentTerminalToStatus({ origin_x: 30, origin_y: 40 }),
    failure,
  )

  assert.deepEqual(harness.liveState.utilityCanvases.get(AGENT_TERMINAL_CANVAS_ID), before)
  assert.equal(harness.liveState.pendingAgentTerminalCollapse, null)
  assert.equal(harness.liveState.pendingAgentTerminalStatusPoint, null)
  assert.equal(harness.liveState.avatarParking.mode, 'terminal')
  assert.equal(eventTypes(harness).includes('park-status'), false)
  assert.equal(eventTypes(harness).filter((type) => type === 'resume').length, 1)
  assert.deepEqual(harness.events.filter((event) => event.type === 'update').at(-1).payload.frame, AGENT_TERMINAL_FRAME)
})

test('agent terminal restore commits local state only after host resume succeeds', async () => {
  const harness = createHarness({
    initialCanvas: { id: AGENT_TERMINAL_CANVAS_ID, suspended: true, at: AGENT_TERMINAL_FRAME },
  })

  assert.equal(await harness.runtime.restoreAgentTerminalFromStatus(), true)

  assert.equal(harness.liveState.utilityCanvases.get(AGENT_TERMINAL_CANVAS_ID).suspended, false)
  assert.equal(harness.liveState.pendingAgentTerminalCollapse, null)
  assert.equal(harness.liveState.pendingAgentTerminalStatusPoint, null)
  assert.equal(harness.liveState.avatarParking.mode, 'terminal')
  assert.ok(eventTypes(harness).indexOf('resume') < eventTypes(harness).indexOf('park-terminal'))
})

test('agent terminal restore preserves collapsed state when host resume fails', async () => {
  const failure = new Error('resume IPC failed')
  const harness = createHarness({
    initialCanvas: { id: AGENT_TERMINAL_CANVAS_ID, suspended: true, at: AGENT_TERMINAL_FRAME },
    canvasResume: async () => { throw failure },
  })

  await assert.rejects(harness.runtime.restoreAgentTerminalFromStatus(), failure)

  assert.equal(harness.liveState.utilityCanvases.get(AGENT_TERMINAL_CANVAS_ID).suspended, true)
  assert.equal(harness.liveState.pendingAgentTerminalCollapse, 'status')
  assert.deepEqual(harness.liveState.pendingAgentTerminalStatusPoint, { x: 30, y: 40 })
  assert.equal(harness.liveState.avatarParking.mode, 'status')
  assert.equal(eventTypes(harness).includes('park-terminal'), false)
  assert.equal(eventTypes(harness).filter((type) => type === 'suspend').length, 1)
})

test('agent terminal prewarm releases its latch after failure and retries once', async () => {
  let createAttempts = 0
  const failure = new Error('create IPC failed')
  const harness = createHarness({
    initialCanvas: null,
    avatarMode: null,
    canvasCreate: async () => {
      createAttempts += 1
      if (createAttempts === 1) throw failure
    },
  })

  assert.equal(await harness.runtime.prewarmAgentTerminalCanvas(), null)
  assert.equal(harness.liveState._agentTerminalPrewarmStarted, false)
  assert.equal(harness.liveState.prewarmingAgentTerminal, false)
  assert.equal(harness.warnings.length, 1)

  const result = await harness.runtime.prewarmAgentTerminalCanvas()
  assert.equal(result.created, true)
  assert.equal(harness.liveState._agentTerminalPrewarmStarted, true)
  assert.equal(harness.liveState.utilityCanvases.get(AGENT_TERMINAL_CANVAS_ID).suspended, true)

  await harness.runtime.prewarmAgentTerminalCanvas()
  assert.equal(createAttempts, 2)
})

test('agent terminal lifecycle messages reconcile parking and clear removed state', () => {
  const harness = createHarness({
    initialCanvas: { id: AGENT_TERMINAL_CANVAS_ID, suspended: false, at: AGENT_TERMINAL_FRAME },
    pendingCollapse: 'status',
    pendingStatusPoint: { x: 70, y: 80 },
  })

  assert.equal(harness.runtime.handleCanvasLifecycle({
    canvas_id: AGENT_TERMINAL_CANVAS_ID,
    suspended: true,
    at: AGENT_TERMINAL_FRAME,
  }), true)
  assert.equal(harness.liveState.avatarParking.mode, 'status')
  assert.deepEqual(harness.liveState.avatarParking.nativePoint, { x: 70, y: 80 })

  assert.equal(harness.runtime.handleCanvasLifecycle({
    action: 'removed',
    canvas_id: AGENT_TERMINAL_CANVAS_ID,
  }), true)
  assert.equal(harness.liveState.utilityCanvases.has(AGENT_TERMINAL_CANVAS_ID), false)
  assert.equal(harness.liveState.avatarParking, null)
  assert.equal(harness.liveState.pendingAgentTerminalCollapse, null)
  assert.equal(harness.liveState.pendingAgentTerminalStatusPoint, null)
})
