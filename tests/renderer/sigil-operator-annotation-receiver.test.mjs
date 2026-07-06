import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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
    resolvePointer(message) {
      assert.equal(message.origin_x, 120)
      assert.equal(message.origin_y, 88)
      return { x: 2120, y: 1188, valid: true }
    },
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
  assert.deepEqual(liveState.selectionMode.cursor, { x: 2120, y: 1188, valid: true })
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
      pointer: { x: 2120, y: 1188, valid: true },
      snapshot: liveState.selectionMode,
    },
  }])
})

test('Sigil operator annotation receiver falls back to live pointer when resolver has no point', () => {
  const liveState = {
    pointerPos: { x: 20, y: 30, valid: true },
    selectionMode: { active: false },
  }

  const receiver = createSigilOperatorAnnotationReceiver({
    startEventType: OPERATOR_ANNOTATION_START_EVENT,
    getPointer: () => liveState.pointerPos,
    resolvePointer: () => null,
    enterSelectionMode(pointer) {
      liveState.selectionMode = {
        active: true,
        cursor: pointer,
      }
      return liveState.selectionMode
    },
  })

  const handled = receiver.handleMessage({
    type: OPERATOR_ANNOTATION_START_EVENT,
    menu_item_id: 'annotate-this-thing',
  })

  assert.equal(handled.handled, true)
  assert.deepEqual(liveState.selectionMode.cursor, { x: 20, y: 30, valid: true })
})

test('Sigil operator annotation receiver consumes secondary segment starts without side effects', () => {
  let entered = 0
  const warnings = []
  const receiver = createSigilOperatorAnnotationReceiver({
    startEventType: OPERATOR_ANNOTATION_START_EVENT,
    isPrimarySurfaceSegment: () => false,
    enterSelectionMode() {
      entered += 1
      return { active: true }
    },
    warn: (...args) => warnings.push(args),
  })

  assert.deepEqual(receiver.handleMessage({
    type: OPERATOR_ANNOTATION_START_EVENT,
    menu_item_id: 'annotate-this-thing',
  }), {
    handled: true,
    ignored: true,
    reason: 'secondary_surface_segment',
  })
  assert.equal(receiver.handleOrWarn({
    type: OPERATOR_ANNOTATION_START_EVENT,
    menu_item_id: 'annotate-this-thing',
  }), true)
  assert.equal(entered, 0)
  assert.equal(warnings.length, 0)
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

test('Sigil main guards native operator annotation messages to the primary segment', async () => {
  const source = await readFile(new URL('../../apps/sigil/renderer/live-modules/main.js', import.meta.url), 'utf8')
  const globalFilter = source.match(/function shouldProcessGlobalDaemonEvent\(msg = \{\}\) \{[\s\S]*?\n\}/)?.[0] || ''
  const statusHandler = source.match(/async function handleStatusMenuAction\(msg = \{\}\) \{[\s\S]*?const id =/)?.[0] || ''
  const receiverConfig = source.match(/const sigilOperatorAnnotationReceiver = createSigilOperatorAnnotationReceiver\(\{[\s\S]*?\n\}\);/)?.[0] || ''

  assert.match(globalFilter, /msg\.type === 'status_item\.menu_action'/)
  assert.match(globalFilter, /msg\.type === OPERATOR_ANNOTATION_START_EVENT/)
  assert.match(statusHandler, /if \(!isPrimarySurfaceSegment\(\)\) return true;/)
  assert.match(receiverConfig, /resolvePointer: resolveOperatorAnnotationPointer/)
  assert.match(receiverConfig, /isPrimarySurfaceSegment/)
})

test('Sigil main operator annotation pointer resolver converts status origin before fallback', async () => {
  const source = await readFile(new URL('../../apps/sigil/renderer/live-modules/main.js', import.meta.url), 'utf8')
  const originFunction = source.match(/function originFromMessage\(msg = \{\}\) \{[\s\S]*?\n\}/)?.[0] || ''
  const fallbackFunction = source.match(/function pointerFromSelectionState\(fallback = liveJs\.pointerPos\) \{[\s\S]*?\n\}/)?.[0] || ''
  const resolverFunction = source.match(/function resolveOperatorAnnotationPointer\(msg = \{\}, fallback = null\) \{[\s\S]*?\n\}/)?.[0] || ''
  assert.ok(originFunction)
  assert.ok(fallbackFunction)
  assert.ok(resolverFunction)

  const calls = []
  const liveJs = {
    displays: [{ id: 1 }],
    pointerPos: { x: 20, y: 30, valid: true },
  }
  const nativeToDesktopWorldPoint = (point, displays) => {
    calls.push({ point, displays })
    return { x: point.x + 2000, y: point.y + 3000, valid: true }
  }
  const buildResolver = new Function(
    'nativeToDesktopWorldPoint',
    'liveJs',
    `${originFunction}\n${fallbackFunction}\n${resolverFunction}\nreturn resolveOperatorAnnotationPointer;`,
  )
  const resolvePointer = buildResolver(nativeToDesktopWorldPoint, liveJs)

  assert.deepEqual(resolvePointer({ origin_x: 120, origin_y: 88 }), {
    x: 2120,
    y: 3088,
    valid: true,
  })
  assert.deepEqual(calls, [{
    point: { x: 120, y: 88 },
    displays: liveJs.displays,
  }])
  assert.deepEqual(resolvePointer({}, { x: 50, y: 60, valid: true }), {
    x: 50,
    y: 60,
    valid: true,
  })
  assert.deepEqual(resolvePointer({}, null), {
    x: 20,
    y: 30,
    valid: true,
  })
})
