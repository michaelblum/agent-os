import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSigilRadialItemActionDispatcher } from '../../apps/sigil/renderer/live-modules/radial-item-action-dispatch.js'

function createDispatcherHarness() {
  const calls = []
  const dispatcher = createSigilRadialItemActionDispatcher({
    agentTerminalCanvasId: 'agent-canvas',
    wikiWorkbenchCanvasId: 'wiki-canvas',
    wikiPath: 'aos/example.md',
    getPointer: () => ({ x: 10, y: 11, valid: true }),
    getAvatarPos: () => ({ x: 88, y: 99, valid: true }),
    setLastRadialActivation(activation) {
      calls.push(['last', activation.item_id])
    },
    post(type, payload) {
      calls.push(['post', type, payload.item_id || payload.action || null])
    },
    createActivationRequest({ item, input }) {
      return {
        item_id: item.id,
        action: item.action,
        input_source: input,
        transition: { preset: 'test' },
      }
    },
    startActivationTransition() {
      calls.push(['transition'])
      return true
    },
    sendActivationUpdate(activation, phase, extra) {
      calls.push(['update', phase, extra?.result || extra?.transition || null])
      return { ...activation, phase }
    },
    enterAnnotationReticle(pointer, reason) {
      calls.push(['reticle', pointer, reason])
      return { entry_source: reason, active: true }
    },
    requestAnnotationSnapshot(reason) {
      calls.push(['snapshot', reason])
      return { requested: true, reason }
    },
    openAvatarControlsAt(x, y, options) {
      calls.push(['context', x, y, options])
      return true
    },
    toggleUtilityCanvas(kind) {
      calls.push(['toggle', kind])
      return { visible: true }
    },
    openWikiWorkbench(path, activation) {
      calls.push(['wiki', path, activation.item_id])
      return Promise.resolve({ visible: true })
    },
  })
  return { calls, dispatcher }
}

test('radial item dispatcher shares avatar-controls item behavior between direct dispatch and command handlers', () => {
  const item = { id: 'avatar-controls', action: 'avatarControls' }
  const snapshot = { pointer: { x: 44, y: 55, valid: true } }
  const { calls, dispatcher } = createDispatcherHarness()

  assert.deepEqual(
    dispatcher.dispatch(item, snapshot, { input: { kind: 'gesture' } }),
    { action: 'avatar_controls_opened', opened: true }
  )
  assert.deepEqual(
    dispatcher.commandHandlers.avatarControlsOpen({ x: 1, y: 2, valid: true }, {
      context: { item, snapshot, input: { kind: 'click' } },
    }),
    { action: 'avatar_controls_opened', opened: true }
  )

  assert.equal(calls.filter((call) => call[0] === 'context').length, 2)
  assert.deepEqual(calls.filter((call) => call[0] === 'context').map((call) => call.slice(1, 3)), [
    [88, 99],
    [88, 99],
  ])
  assert.equal(calls.filter((call) => call[0] === 'post' && call[1] === 'sigil.radial_menu.activation').length, 2)
})

test('radial item dispatcher routes camera recovery through the same snapshot request command path', () => {
  const { calls, dispatcher } = createDispatcherHarness()

  assert.deepEqual(
    dispatcher.commandHandlers.annotationCameraCaptureBundle('ignored', {
      context: {
        item: { id: 'annotation-camera', action: 'annotationSnapshot' },
        reason: 'radial-camera-target-surface-recovery',
      },
    }),
    {
      action: 'annotation_snapshot_requested',
      requested: { requested: true, reason: 'radial-camera-target-surface-recovery' },
    }
  )

  assert.deepEqual(calls, [
    ['snapshot', 'radial-camera-target-surface-recovery'],
  ])
})
