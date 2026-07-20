import assert from 'node:assert/strict'
import test from 'node:test'

import {
  handleDesktopWorldStageLifecycle,
} from '../../packages/toolkit/components/desktop-world-stage/lifecycle.js'

test('DesktopWorld stage acknowledges renderer suspend and resume lifecycle messages', () => {
  const completed = []
  const complete = (action) => completed.push(action)

  assert.equal(handleDesktopWorldStageLifecycle({ type: 'lifecycle', action: 'suspend' }, complete), true)
  assert.equal(handleDesktopWorldStageLifecycle({ type: 'lifecycle', action: 'resume' }, complete), true)
  assert.deepEqual(completed, ['suspend', 'resume'])
})

test('DesktopWorld stage ignores unrelated and unsupported lifecycle messages', () => {
  const completed = []
  const complete = (action) => completed.push(action)

  assert.equal(handleDesktopWorldStageLifecycle({ type: 'canvas_lifecycle', action: 'resume' }, complete), false)
  assert.equal(handleDesktopWorldStageLifecycle({ type: 'lifecycle', action: 'reload' }, complete), false)
  assert.equal(handleDesktopWorldStageLifecycle(null, complete), false)
  assert.deepEqual(completed, [])
})

test('DesktopWorld stage fails closed when an accepted lifecycle message has no completion sink', () => {
  assert.throws(
    () => handleDesktopWorldStageLifecycle({ type: 'lifecycle', action: 'resume' }),
    /requires a callback/,
  )
})
