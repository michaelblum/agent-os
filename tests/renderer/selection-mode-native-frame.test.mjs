import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSelectionModeNativeFrameResolver } from '../../apps/sigil/renderer/live-modules/selection-mode-native-frame.js'

test('selection mode native frame resolver retains the last valid frame across transient nulls', () => {
  const frames = [
    [10, 20, 300, 400],
    null,
    [12, 24, 320, 420],
  ]
  const resolver = createSelectionModeNativeFrameResolver(() => frames.shift() || null)

  assert.deepEqual(resolver.resolve(), [10, 20, 300, 400])
  assert.deepEqual(resolver.resolve(), [10, 20, 300, 400])
  assert.deepEqual(resolver.resolve(), [12, 24, 320, 420])
  assert.deepEqual(resolver.snapshot(), [12, 24, 320, 420])
})

test('selection mode native frame resolver resets cached state on exit', () => {
  const resolver = createSelectionModeNativeFrameResolver(() => [10, 20, 300, 400])

  assert.deepEqual(resolver.resolve(), [10, 20, 300, 400])
  resolver.reset()
  assert.equal(resolver.snapshot(), null)
  assert.deepEqual(resolver.resolve(), [10, 20, 300, 400])
})
