// drag-drop.js - first-class toolkit movement contract for draggable panels.
//
// This is the One-World/union-backed drag path for ordinary panel movement.
// It updates native panel coordinates directly and settles through the shared
// placement contract; it does not create display-transfer outline handoffs.

import { mutateSelf, moveAbsolute } from '../runtime/canvas.js'
import {
  cloneFrame,
  createPlacementPlan,
  workAreaForPoint,
} from './placement.js'

function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function screenPoint(pointer = null) {
  const x = finiteNumber(pointer?.screenX ?? pointer?.x, null)
  const y = finiteNumber(pointer?.screenY ?? pointer?.y, null)
  return x == null || y == null ? null : { x, y }
}

function framesEqual(lhs, rhs) {
  const a = cloneFrame(lhs)
  const b = cloneFrame(rhs)
  return a.every((value, index) => value === b[index])
}

function nextGeometryTransactionId(prefix = 'geometry') {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`
}

function frameFromWindowLike(view = globalThis.window) {
  if (!view) return [0, 0, 1, 1]
  return [
    finiteNumber(view.screenX, 0),
    finiteNumber(view.screenY, 0),
    Math.max(1, finiteNumber(view.innerWidth, 1)),
    Math.max(1, finiteNumber(view.innerHeight, 1)),
  ]
}

function defaultUpdateFrame(frame, geometry = null) {
  mutateSelf(geometry ? { frame: cloneFrame(frame), geometry } : { frame: cloneFrame(frame) })
}

export function dragFrameFromPointer(pointer = {}, offsetX = 0, offsetY = 0, frame = frameFromWindowLike()) {
  const source = cloneFrame(frame)
  return cloneFrame([
    finiteNumber(pointer.screenX, source[0] + finiteNumber(offsetX, 0)) - finiteNumber(offsetX, 0),
    finiteNumber(pointer.screenY, source[1] + finiteNumber(offsetY, 0)) - finiteNumber(offsetY, 0),
    source[2],
    source[3],
  ])
}

export function createDragDropController({
  move = moveAbsolute,
  getFrame = () => frameFromWindowLike(),
  getWorkArea = () => frameFromWindowLike(),
  getDragWorkArea = (frame = getFrame(), pointer = null) => workAreaForPoint(pointer, [], getWorkArea(frame)),
  updateFrame = defaultUpdateFrame,
  clampOnEnd = false,
  viewportOverflowPolicy = 'clamp',
  minVisibleWidth = 160,
  minVisibleHeight = 44,
  onStateChange = null,
} = {}) {
  let active = null
  let frame = cloneFrame(getFrame())

  function state(extra = {}) {
    return {
      active: Boolean(active),
      frame: cloneFrame(frame),
      transactionId: active?.transactionId || null,
      transferActive: false,
      ...extra,
    }
  }

  function notify(extra = {}) {
    const snapshot = state(extra)
    onStateChange?.(snapshot)
    return snapshot
  }

  return {
    start(pointer = {}) {
      const transactionId = nextGeometryTransactionId('placement-drag')
      const startPoint = screenPoint(pointer)
      active = {
        transactionId,
        pointerId: pointer.pointerId ?? null,
        offsetX: finiteNumber(pointer.clientX, 0),
        offsetY: finiteNumber(pointer.clientY, 0),
        frame: cloneFrame(getFrame()),
        lastPointer: startPoint,
      }
      frame = cloneFrame(active.frame)
      return notify({ phase: 'start' })
    },
    move(pointer = {}) {
      if (!active) return state({ phase: 'idle' })
      active.lastPointer = screenPoint(pointer) || active.lastPointer
      move(
        finiteNumber(pointer.screenX, active.frame[0] + active.offsetX),
        finiteNumber(pointer.screenY, active.frame[1] + active.offsetY),
        active.offsetX,
        active.offsetY,
        {
          change: 'origin',
          cause: 'placement.drag',
          phase: 'update',
          transaction_id: active.transactionId,
        }
      )
      frame = dragFrameFromPointer(pointer, active.offsetX, active.offsetY, active.frame)
      return notify({ phase: 'move' })
    },
    end(pointer = {}) {
      if (!active) return state({ phase: 'idle' })
      const releasePointer = screenPoint(pointer) || active.lastPointer
      const startFrame = cloneFrame(active.frame)
      const transactionId = active.transactionId
      active = null
      if (clampOnEnd) {
        const actualFrame = cloneFrame(getFrame())
        // WKWebView can report display-local pointer coordinates while the
        // daemon moved the panel in native global coordinates. Prefer the
        // daemon-reported frame at release when it changed during the drag.
        frame = framesEqual(actualFrame, startFrame) ? cloneFrame(frame) : actualFrame
        const plan = createPlacementPlan({
          requestedFrame: frame,
          workArea: getDragWorkArea(frame, releasePointer),
          viewportOverflowPolicy,
          minVisibleWidth,
          minVisibleHeight,
        })
        frame = cloneFrame(plan.final_settled_frame)
        updateFrame(frame, {
          change: 'origin',
          cause: 'placement.drag',
          phase: 'settled',
          transaction_id: transactionId,
          placement: plan,
        })
      } else {
        frame = cloneFrame(getFrame())
      }
      return notify({ phase: 'end', transactionId })
    },
    getState() {
      return state()
    },
  }
}
