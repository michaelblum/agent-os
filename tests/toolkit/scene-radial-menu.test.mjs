import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveSceneRadialMenuLayout,
  validateSceneRadialMenuParameters,
} from '../../packages/toolkit/scene/scene-radial-menu.js'

const parameters = {
  closeOnSelect: true,
  items: [
    { id: 'first', color: '#9b7cff' },
    { id: 'second', color: '#53f5d7' },
    { id: 'third', color: '#f2f5ff' },
  ],
  menuId: 'sample-menu',
  radius: 100,
  spreadDegrees: 120,
  startAngle: -150,
  style: { activeColor: '#ffffff', fillColor: '#201b2f', itemRadius: 20, opacity: 0.94 },
}

test('persistent radial-menu parameters reject executable-shaped and unbounded descriptors', () => {
  assert.deepEqual(validateSceneRadialMenuParameters(parameters), [])
  const invalid = structuredClone(parameters)
  invalid.items.push({ id: 'first', color: '#not-a-color', callback: 'javascript:run()' })
  invalid.radius = 5000
  const errors = validateSceneRadialMenuParameters(invalid)
  assert.ok(errors.some((entry) => entry.code === 'invalid_radial_item'))
  assert.ok(errors.some((entry) => entry.code === 'invalid_color'))
  assert.ok(errors.some((entry) => entry.code === 'invalid_radial_geometry'))
  assert.ok(errors.some((entry) => entry.code === 'unknown_field'))
})

test('persistent radial-menu layout clamps an arc to its containing display deterministically', () => {
  const layout = resolveSceneRadialMenuLayout({ ...parameters, origin: { x: 8, y: 8 } }, {
    displays: [{ displayId: 1, index: 0, bounds: [0, 0, 400, 300] }],
  })
  assert.equal(layout.items.length, 3)
  for (const item of layout.items) {
    assert.ok(item.center.x - item.hitRadius >= 0)
    assert.ok(item.center.y - item.hitRadius >= 0)
    assert.ok(item.center.x + item.hitRadius <= 400)
    assert.ok(item.center.y + item.hitRadius <= 300)
  }
  assert.deepEqual(layout, resolveSceneRadialMenuLayout({ ...parameters, origin: { x: 8, y: 8 } }, {
    displays: [{ displayId: 1, index: 0, bounds: [0, 0, 400, 300] }],
  }))
})
