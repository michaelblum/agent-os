import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  OPERATOR_ANNOTATION_START_EVENT,
  routeOperatorAnnotationMenuAction,
} from '../../packages/toolkit/runtime/operator-annotation-menu.js'
import {
  createSigilOperatorAnnotationReceiver,
  SIGIL_OPERATOR_ANNOTATION_ENTRY_SOURCE,
} from '../../apps/sigil/renderer/live-modules/operator-annotation-receiver.js'

const sigilMenu = [
  {
    id: 'annotate-this-thing',
    label: 'Annotate This Thing',
    kind: 'operator_annotation',
    surface: 'avatar-main',
    action_id: 'aos.sigil.operator_annotation.start',
    mode: 'selection_annotation',
    create_pending_annotation: true,
  },
]

test('Sigil operator annotation route reaches Selection Mode receiver state', () => {
  const liveState = {
    currentState: 'RADIAL',
    pointerPos: { x: 20, y: 30, valid: true },
    selectionMode: { active: false },
  }
  const posts = []
  let resetCount = 0

  const receiver = createSigilOperatorAnnotationReceiver({
    startEventType: OPERATOR_ANNOTATION_START_EVENT,
    mountedSurfaceId: 'avatar-main',
    getPointer: () => liveState.pointerPos,
    enterSelectionMode(pointer, reason) {
      liveState.selectionMode = {
        active: true,
        cursor: pointer,
        events: [{ type: 'enter', reason }],
      }
      return liveState.selectionMode
    },
    resetAvatarDoubleClick() {
      resetCount += 1
    },
    setInteractionState(next, reason) {
      liveState.currentState = next
      liveState.interactionReason = reason
    },
    post(type, payload) {
      posts.push({ type, payload })
    },
  })

  const host = {
    post(type, payload) {
      assert.equal(type, 'canvas.send')
      assert.equal(payload.target, 'avatar-main')
      const handled = receiver.handleMessage(payload.message)
      assert.equal(handled.handled, true)
    },
  }

  const routed = routeOperatorAnnotationMenuAction({
    type: 'status_item.menu_action',
    id: 'aos.sigil.operator_annotation.start',
    origin_x: 120,
    origin_y: 88,
    modifiers: ['option'],
  }, sigilMenu, host)

  assert.equal(routed.handled, true)
  assert.equal(liveState.selectionMode.active, true)
  assert.deepEqual(liveState.selectionMode.cursor, { x: 120, y: 88, valid: true })
  assert.deepEqual(liveState.selectionMode.events, [{
    type: 'enter',
    reason: SIGIL_OPERATOR_ANNOTATION_ENTRY_SOURCE,
  }])
  assert.equal(liveState.currentState, 'IDLE')
  assert.equal(liveState.interactionReason, 'operator-annotation-start')
  assert.equal(resetCount, 1)
  assert.deepEqual(posts, [{
    type: 'sigil.selection_mode.enter',
    payload: {
      entry_source: SIGIL_OPERATOR_ANNOTATION_ENTRY_SOURCE,
      target_surface: 'avatar-main',
      action_id: 'aos.sigil.operator_annotation.start',
      menu_item_id: 'annotate-this-thing',
      mode: 'selection_annotation',
      create_pending_annotation: true,
      modifiers: ['option'],
      pointer: { x: 120, y: 88, valid: true },
      snapshot: liveState.selectionMode,
    },
  }])
})

test('Sigil operator annotation receiver fails closed without a selection receiver', () => {
  const warnings = []
  const receiver = createSigilOperatorAnnotationReceiver({
    startEventType: OPERATOR_ANNOTATION_START_EVENT,
    warn: (...args) => warnings.push(args),
  })

  assert.deepEqual(receiver.handleMessage({
    type: 'status_item.menu_action',
  }), {
    handled: false,
    reason: 'not_operator_annotation_start',
  })
  assert.equal(receiver.handleOrWarn({
    type: OPERATOR_ANNOTATION_START_EVENT,
  }), true)
  assert.equal(warnings.length, 1)
  assert.match(String(warnings[0][1]), /missing_selection_mode_receiver/)
})
