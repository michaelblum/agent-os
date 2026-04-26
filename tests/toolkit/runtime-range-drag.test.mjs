import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createDesktopWorldRangeDrag,
  desktopWorldRangeValue,
  updateDesktopWorldRangeDrag,
} from '../../packages/toolkit/runtime/range-drag.js'

function eventTarget(props = {}) {
  const events = []
  return {
    min: props.min ?? '-1',
    max: props.max ?? '2',
    step: props.step ?? '0.25',
    value: props.value ?? '0',
    events,
    dispatchEvent(event) {
      events.push(event.type)
    },
    getBoundingClientRect() {
      return props.rect || { left: 40, width: 200 }
    },
  }
}

test('desktopWorldRangeValue maps DesktopWorld x to stepped range value', () => {
  const geometry = { desktopLeft: 100, desktopWidth: 200 }

  assert.equal(desktopWorldRangeValue({ x: 100 }, geometry, { min: -1, max: 2, step: 0.25 }), -1)
  assert.equal(desktopWorldRangeValue({ x: 200 }, geometry, { min: -1, max: 2, step: 0.25 }), 0.5)
  assert.equal(desktopWorldRangeValue({ x: 400 }, geometry, { min: -1, max: 2, step: 0.25 }), 2)
  assert.equal(desktopWorldRangeValue({ x: 140 }, geometry, { min: 0, max: 10, step: 2 }), 2)
})

test('createDesktopWorldRangeDrag derives DesktopWorld geometry from anchor-relative input rect', () => {
  const input = eventTarget({ rect: { left: 80, width: 160 } })
  const anchor = { getBoundingClientRect: () => ({ left: 20 }) }
  const active = createDesktopWorldRangeDrag(input, {
    anchor,
    desktopBounds: { x: 1000, y: 0, w: 300, h: 300 },
  })

  assert.deepEqual(
    { desktopLeft: active.desktopLeft, desktopWidth: active.desktopWidth },
    { desktopLeft: 1060, desktopWidth: 160 }
  )
})

test('updateDesktopWorldRangeDrag updates input and dispatches input/change events', () => {
  const input = eventTarget()
  const active = { input, desktopLeft: 100, desktopWidth: 200 }

  assert.equal(updateDesktopWorldRangeDrag(active, { x: 250 }), true)
  assert.equal(input.value, '1.25')
  assert.deepEqual(input.events, ['input'])

  assert.equal(updateDesktopWorldRangeDrag(active, { x: 300 }, { commit: true }), true)
  assert.equal(input.value, '2')
  assert.deepEqual(input.events, ['input', 'input', 'change'])
})
