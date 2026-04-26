import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DesktopWorldSurfaceAdapter } from '../../packages/toolkit/runtime/desktop-world-surface.js'

class StubAdapter extends DesktopWorldSurfaceAdapter {
  constructor(options = {}) {
    super(options)
    this.pickIndex = options.pickIndex ?? 0
  }

  _identifyOwnSegment(topology) {
    return topology[this.pickIndex] || null
  }
}

const segments = [
  { display_id: 10, index: 0, dw_bounds: [0, 0, 100, 100], native_bounds: [-20, 0, 100, 100] },
  { display_id: 11, index: 1, dw_bounds: [100, 0, 100, 100], native_bounds: [80, 0, 100, 100] },
]

test('isPrimary reflects index === 0 and runOnPrimary gates work', async () => {
  const adapter = new StubAdapter({
    canvasId: 'avatar',
    host: {
      subscribe: () => ({
        on: (handler) => {
          handler({ event: 'canvas_topology_settled', data: { canvas_id: 'avatar', segments } })
        },
      }),
    },
  })

  await adapter.start({})

  assert.equal(adapter.isPrimary, true)
  assert.equal(adapter.runOnPrimary(() => 42), 42)
})

test('runOnPrimary returns undefined for followers', () => {
  const adapter = new StubAdapter({ canvasId: 'avatar', pickIndex: 1 })
  adapter.segment = { index: 1 }

  assert.equal(adapter.runOnPrimary(() => 42), undefined)
})

test('start ignores other surfaces and resolves on matching topology', async () => {
  const callbacks = []
  const adapter = new StubAdapter({
    canvasId: 'avatar',
    host: {
      subscribe: () => ({ on: (handler) => callbacks.push(handler) }),
    },
  })

  const started = adapter.start({})
  callbacks[0]({ type: 'canvas_lifecycle', event: 'canvas_topology_settled', canvas_id: 'other', segments })
  callbacks[0]({ type: 'canvas_lifecycle', event: 'canvas_topology_settled', canvas_id: 'avatar', segments })
  await started

  assert.equal(adapter.segment.display_id, 10)
})

test('topology changes call re-election callbacks after initial boot', async () => {
  const callbacks = []
  const calls = []
  const adapter = new StubAdapter({
    canvasId: 'avatar',
    pickIndex: 1,
    host: {
      subscribe: () => ({ on: (handler) => callbacks.push(handler) }),
    },
  })

  const started = adapter.start({
    onTopologyChange: () => calls.push('topology'),
    becamePrimary: () => calls.push('became'),
    lostPrimary: () => calls.push('lost'),
  })
  callbacks[0]({ type: 'canvas_lifecycle', event: 'canvas_topology_settled', canvas_id: 'avatar', segments })
  await started

  adapter.pickIndex = 0
  callbacks[0]({ type: 'canvas_lifecycle', event: 'canvas_topology_settled', canvas_id: 'avatar', segments })

  assert.deepEqual(calls, ['topology', 'became'])
})

test('feedInput maps native input into DesktopWorld coordinates', () => {
  const seen = []
  const adapter = new StubAdapter({ canvasId: 'avatar' })
  adapter.topology = segments
  adapter._appHandlers = { onInput: (event) => seen.push(event) }

  const event = adapter.feedInput({ type: 'mouseMoved', x: 85, y: 5 })

  assert.equal(event.dwX, 105)
  assert.equal(event.dwY, 5)
  assert.equal(seen.length, 1)
})

