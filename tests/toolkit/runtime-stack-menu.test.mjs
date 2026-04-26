import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createStackMenuModel,
  stackMenuPushedStyle,
} from '../../packages/toolkit/runtime/stack-menu.js'

test('stack menu model pushes and pops cards as a deck', () => {
  const model = createStackMenuModel({ rootId: 'ctx-root' })

  assert.deepEqual(model.snapshot(), {
    rootId: 'ctx-root',
    activeId: 'ctx-root',
    stack: [],
  })

  assert.deepEqual(model.push('ctx-sub-omega'), {
    rootId: 'ctx-root',
    activeId: 'ctx-sub-omega',
    stack: ['ctx-root'],
  })

  assert.deepEqual(model.push('ctx-sub-colors'), {
    rootId: 'ctx-root',
    activeId: 'ctx-sub-colors',
    stack: ['ctx-root', 'ctx-sub-omega'],
  })

  assert.deepEqual(model.popTo('ctx-root'), {
    rootId: 'ctx-root',
    activeId: 'ctx-root',
    stack: [],
  })
})

test('stack menu model applies snapshots', () => {
  const model = createStackMenuModel({ rootId: 'ctx-root' })

  assert.deepEqual(model.set({ activeId: 'ctx-sub-omega', stack: ['ctx-root'] }), {
    rootId: 'ctx-root',
    activeId: 'ctx-sub-omega',
    stack: ['ctx-root'],
  })

  assert.deepEqual(model.reset(), {
    rootId: 'ctx-root',
    activeId: 'ctx-root',
    stack: [],
  })
})

test('stack menu pushed style compounds by depth', () => {
  assert.deepEqual(stackMenuPushedStyle(1), {
    transform: 'scale(0.9) translateY(-20%)',
    opacity: '0.55',
    zIndex: '9',
    filter: 'brightness(0.7)',
  })

  assert.deepEqual(stackMenuPushedStyle(2), {
    transform: 'scale(0.81) translateY(-40%)',
    opacity: '0.4',
    zIndex: '8',
    filter: 'brightness(0.5499999999999999)',
  })
})
