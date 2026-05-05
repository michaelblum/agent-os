// chrome.js — pure-DOM panel scaffold (header + drag + content slot).
//
// Knows nothing about messaging or contents. Just builds the visual frame
// and reports absolute drag updates through the runtime canvas helper.

import { emit, wireBridge } from '../runtime/bridge.js'
import { moveAbsolute, mutateSelf, removeSelf, spawnChild, suspendCanvas } from '../runtime/canvas.js'
import { normalizeCanvasInputMessage } from '../runtime/input-events.js'
import { subscribe, unsubscribe } from '../runtime/subscribe.js'
import { createPanelTransferController, wirePanelTransferDisplayGeometry } from './drag-transfer.js'
import {
  chipFrameForPanelFrame,
  clampFrameToWorkArea as placementClampFrameToWorkArea,
  cloneFrame as placementCloneFrame,
  finiteNumber,
  frameFromWindow as placementFrameFromWindow,
  normalizePanelDisplays,
  positiveNumber,
  workAreaForFrameTopLeft as placementWorkAreaForFrameTopLeft,
  workAreaForPoint as placementWorkAreaForPoint,
  workAreaFromWindow as placementWorkAreaFromWindow,
} from './placement.js'

let displayGeometryWired = false
let panelDisplays = []
let currentPanelFrame = null

export function mountChrome(container, {
  title = 'AOS',
  draggable = true,
  drag = {},
  close = true,
  minimize = true,
  maximize = false,
  resizable = false,
  resize = {},
  onClose = defaultClose,
  onMinimize = null,
  onMaximize = null,
} = {}) {
  container.innerHTML = ''
  container.classList.add('aos-panel-root')

  const panel = document.createElement('div')
  panel.className = 'aos-panel'

  const header = document.createElement('div')
  header.className = 'aos-header'
  header.dataset.draggable = String(draggable)

  const gripEl = document.createElement('span')
  gripEl.className = 'aos-panel-grip'
  gripEl.setAttribute('aria-hidden', 'true')

  const titleEl = document.createElement('span')
  titleEl.className = 'aos-title'
  titleEl.textContent = title

  const controlsEl = document.createElement('span')
  controlsEl.className = 'aos-controls'

  const customControlsEl = document.createElement('span')
  customControlsEl.className = 'aos-custom-controls'

  const windowControlsEl = document.createElement('span')
  windowControlsEl.className = 'aos-window-controls'
  wirePanelDisplayGeometry()

  let maximizeController = null
  if (maximize) {
    const maximizeButton = document.createElement('button')
    maximizeButton.type = 'button'
    maximizeButton.className = 'aos-window-button aos-window-maximize'
    maximizeButton.setAttribute('aria-label', 'Maximize panel')
    maximizeButton.setAttribute('aria-pressed', 'false')
    maximizeButton.title = 'Maximize'
    maximizeButton.textContent = '+'
    maximizeController = createMaximizeController({
      onStateChange(state) {
        syncMaximizeButton(maximizeButton, state)
      },
    })
    syncMaximizeButton(maximizeButton, maximizeController.getState())
    maximizeButton.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (onMaximize) onMaximize(maximizeController, event)
      else maximizeController.toggle()
    })
    windowControlsEl.appendChild(maximizeButton)
  }

  if (minimize) {
    const minimizeButton = document.createElement('button')
    minimizeButton.type = 'button'
    minimizeButton.className = 'aos-window-button aos-window-minimize'
    minimizeButton.setAttribute('aria-label', 'Minimize panel')
    minimizeButton.title = 'Minimize'
    minimizeButton.textContent = '-'
    minimizeButton.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const action = onMinimize || (() => defaultMinimize({ title: titleEl.textContent || title }))
      action?.()
    })
    windowControlsEl.appendChild(minimizeButton)
  }

  if (close) {
    const closeButton = document.createElement('button')
    closeButton.type = 'button'
    closeButton.className = 'aos-window-button aos-window-close'
    closeButton.setAttribute('aria-label', 'Close panel')
    closeButton.title = 'Close'
    closeButton.textContent = 'x'
    closeButton.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      onClose?.()
    })
    windowControlsEl.appendChild(closeButton)
  }

  controlsEl.appendChild(customControlsEl)
  controlsEl.appendChild(windowControlsEl)

  header.appendChild(gripEl)
  header.appendChild(titleEl)
  header.appendChild(controlsEl)

  const content = document.createElement('div')
  content.className = 'aos-content'

  panel.appendChild(header)
  panel.appendChild(content)
  container.appendChild(panel)

  if (maximizeController) {
    header.addEventListener('dblclick', (event) => {
      const NodeCtor = globalThis.Node
      if ((!NodeCtor || event.target instanceof NodeCtor) && controlsEl?.contains?.(event.target)) return
      event.preventDefault()
      maximizeController.toggle()
    })
  }

  const { onStateChange: onDragStateChange, ...dragOptions } = drag
  const dragController = draggable
    ? wireDrag(header, controlsEl, {
      clampOnEnd: true,
      transfer: true,
      ...dragOptions,
      onStateChange(state) {
        const transferActive = Boolean(state.transferActive)
        panel.classList.toggle('aos-panel-transfer-active', transferActive)
        panel.dataset.transferActive = String(transferActive)
        onDragStateChange?.(state)
      },
    })
    : null
  const resizeController = resizable
    ? wireResize(panel, {
      ...resize,
      onStart(edge, event, controller) {
        resize.onStart?.(edge, event, controller)
        if (maximizeController?.getState().maximized) maximizeController.restore()
      },
    })
    : null

  return {
    panelEl: panel,
    headerEl: header,
    titleEl,
    controlsEl,
    customControlsEl,
    windowControlsEl,
    contentEl: content,
    maximizeController,
    dragController,
    resizeController,
    setTitle(text) { titleEl.textContent = text },
    setControls(html) { customControlsEl.innerHTML = html },
  }
}

const cloneFrame = placementCloneFrame

export function frameFromWindow(view = window) {
  return placementFrameFromWindow(view, {
    currentFrame: typeof window !== 'undefined' && view === window ? currentPanelFrame : null,
  })
}

export function workAreaFromWindow(view = window) {
  return placementWorkAreaFromWindow(view, frameFromWindow(view))
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function finiteLimit(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

export function workAreaForFrameTopLeft(frame = frameFromWindow(), displays = panelDisplays, fallback = null) {
  return placementWorkAreaForFrameTopLeft(frame, displays, fallback)
}

export function workAreaForWindowTopLeft(view = window, displays = panelDisplays) {
  return workAreaForFrameTopLeft(frameFromWindow(view), displays, workAreaFromWindow(view))
}

function screenPoint(pointer = null) {
  const x = finiteNumber(pointer?.screenX ?? pointer?.x, null)
  const y = finiteNumber(pointer?.screenY ?? pointer?.y, null)
  return x == null || y == null ? null : { x, y }
}

function updateSelfFrame(frame) {
  currentPanelFrame = cloneFrame(frame)
  mutateSelf({ frame: currentPanelFrame })
}

export const clampFrameToWorkArea = placementClampFrameToWorkArea

function framesEqual(lhs, rhs) {
  const a = cloneFrame(lhs)
  const b = cloneFrame(rhs)
  return a.every((value, index) => value === b[index])
}

export function dragFrameFromPointer(pointer = {}, offsetX = 0, offsetY = 0, frame = frameFromWindow()) {
  const source = cloneFrame(frame)
  return cloneFrame([
    finiteNumber(pointer.screenX, source[0] + finiteNumber(offsetX, 0)) - finiteNumber(offsetX, 0),
    finiteNumber(pointer.screenY, source[1] + finiteNumber(offsetY, 0)) - finiteNumber(offsetY, 0),
    source[2],
    source[3],
  ])
}

export function createDragController({
  move = moveAbsolute,
  getFrame = () => frameFromWindow(),
  getWorkArea = (frame = frameFromWindow()) => workAreaForFrameTopLeft(frame, panelDisplays, workAreaFromWindow()),
  getDragWorkArea = (frame = frameFromWindow(), pointer = null) => (
    placementWorkAreaForPoint(pointer, panelDisplays, getWorkArea(frame))
  ),
  updateFrame = updateSelfFrame,
  clampOnEnd = false,
  transfer = false,
  transferController = null,
  minVisibleWidth = 160,
  minVisibleHeight = 44,
  onStateChange = null,
} = {}) {
  let active = null
  let frame = cloneFrame(getFrame())
  const transferOptions = transfer && typeof transfer === 'object' ? transfer : {}
  const panelTransfer = transferController || (transfer
    ? createPanelTransferController({ enabled: true, ...transferOptions })
    : null)
  if (panelTransfer && !transferController) wirePanelTransferDisplayGeometry(panelTransfer)

  function state(extra = {}) {
    const transferActive = Boolean(panelTransfer?.getState?.().active)
    return {
      active: Boolean(active),
      frame: cloneFrame(frame),
      transferActive,
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
      const startPoint = screenPoint(pointer)
      active = {
        pointerId: pointer.pointerId ?? null,
        offsetX: finiteNumber(pointer.clientX, 0),
        offsetY: finiteNumber(pointer.clientY, 0),
        frame: cloneFrame(getFrame()),
        lastPointer: startPoint,
      }
      frame = cloneFrame(active.frame)
      panelTransfer?.start({ frame, pointer })
      return notify({ phase: 'start' })
    },
    move(pointer = {}) {
      if (!active) return state({ phase: 'idle' })
      active.lastPointer = screenPoint(pointer) || active.lastPointer
      const transferResult = panelTransfer?.move({
        frame: active.frame,
        pointer,
        offsetX: active.offsetX,
        offsetY: active.offsetY,
      })
      if (transferResult?.mode === 'outline') {
        frame = cloneFrame(active.frame)
        return notify({ phase: 'move' })
      }

      move(
        finiteNumber(pointer.screenX, active.frame[0] + active.offsetX),
        finiteNumber(pointer.screenY, active.frame[1] + active.offsetY),
        active.offsetX,
        active.offsetY
      )
      frame = dragFrameFromPointer(pointer, active.offsetX, active.offsetY, active.frame)
      return notify({ phase: 'move' })
    },
    end(pointer = {}) {
      if (!active) return state({ phase: 'idle' })
      const releasePointer = screenPoint(pointer) || active.lastPointer
      active = null
      const transferResult = panelTransfer?.end()
      if (transferResult?.nativeFrame) {
        frame = cloneFrame(transferResult.nativeFrame)
        updateFrame(frame)
      } else if (clampOnEnd) {
        frame = cloneFrame(frame)
        const clamped = clampFrameToWorkArea(frame, {
          workArea: getDragWorkArea(frame, releasePointer),
          minVisibleWidth,
          minVisibleHeight,
        })
        if (!framesEqual(frame, clamped)) {
          frame = clamped
          updateFrame(clamped)
        }
      } else {
        frame = cloneFrame(getFrame())
      }
      return notify({ phase: 'end' })
    },
    getState() {
      return state()
    },
  }
}

export function normalizeResizeEdge(edge = '') {
  const value = String(edge || '').toLowerCase()
  const vertical = value.includes('north') || value.includes('top') || value === 'n' || value.startsWith('n')
    ? 'n'
    : value.includes('south') || value.includes('bottom') || value === 's' || value.startsWith('s')
      ? 's'
      : ''
  const horizontal = value.includes('west') || value.includes('left') || value === 'w' || value.endsWith('w')
    ? 'w'
    : value.includes('east') || value.includes('right') || value === 'e' || value.endsWith('e')
      ? 'e'
      : ''
  return `${vertical}${horizontal}` || 'se'
}

export function resizeFrame(frame, edge, deltaX = 0, deltaY = 0, {
  minWidth = 240,
  minHeight = 160,
  maxWidth = Infinity,
  maxHeight = Infinity,
  workArea = null,
  minVisibleWidth = 120,
  minVisibleHeight = 44,
} = {}) {
  const source = cloneFrame(frame)
  const next = cloneFrame(source)
  const normalizedEdge = normalizeResizeEdge(edge)
  const right = source[0] + source[2]
  const bottom = source[1] + source[3]
  const minW = positiveNumber(minWidth, 1)
  const minH = positiveNumber(minHeight, 1)
  let maxW = Math.max(minW, finiteLimit(maxWidth, Infinity))
  let maxH = Math.max(minH, finiteLimit(maxHeight, Infinity))

  if (workArea) {
    const area = cloneFrame(workArea)
    const areaRight = area[0] + area[2]
    const areaBottom = area[1] + area[3]
    if (normalizedEdge.includes('e')) maxW = Math.min(maxW, Math.max(minW, areaRight - source[0]))
    if (normalizedEdge.includes('w')) maxW = Math.min(maxW, Math.max(minW, right - area[0]))
    if (normalizedEdge.includes('s')) maxH = Math.min(maxH, Math.max(minH, areaBottom - source[1]))
    if (normalizedEdge.includes('n')) maxH = Math.min(maxH, Math.max(minH, bottom - area[1]))
  }

  if (normalizedEdge.includes('e')) next[2] = source[2] + finiteNumber(deltaX, 0)
  if (normalizedEdge.includes('s')) next[3] = source[3] + finiteNumber(deltaY, 0)
  if (normalizedEdge.includes('w')) {
    next[0] = source[0] + finiteNumber(deltaX, 0)
    next[2] = source[2] - finiteNumber(deltaX, 0)
  }
  if (normalizedEdge.includes('n')) {
    next[1] = source[1] + finiteNumber(deltaY, 0)
    next[3] = source[3] - finiteNumber(deltaY, 0)
  }

  next[2] = clamp(next[2], minW, maxW)
  next[3] = clamp(next[3], minH, maxH)
  if (normalizedEdge.includes('w')) next[0] = right - next[2]
  if (normalizedEdge.includes('n')) next[1] = bottom - next[3]

  return clampFrameToWorkArea(next, { workArea, minVisibleWidth, minVisibleHeight })
}

export function createResizeController({
  getFrame = () => frameFromWindow(),
  getWorkArea = (frame = frameFromWindow()) => workAreaForFrameTopLeft(frame, panelDisplays, workAreaFromWindow()),
  updateFrame = updateSelfFrame,
  minWidth = 240,
  minHeight = 160,
  maxWidth = Infinity,
  maxHeight = Infinity,
  onStateChange = null,
} = {}) {
  let active = null
  let frame = cloneFrame(getFrame())

  function state(extra = {}) {
    return {
      active: Boolean(active),
      edge: active?.edge || null,
      frame: cloneFrame(frame),
      ...extra,
    }
  }

  function apply(nextFrame, extra = {}) {
    frame = cloneFrame(nextFrame)
    updateFrame(frame)
    const snapshot = state(extra)
    onStateChange?.(snapshot)
    return snapshot
  }

  return {
    start(edge, pointer = {}) {
      active = {
        edge: normalizeResizeEdge(edge),
        startX: finiteNumber(pointer.screenX, 0),
        startY: finiteNumber(pointer.screenY, 0),
        frame: cloneFrame(getFrame()),
      }
      frame = cloneFrame(active.frame)
      const snapshot = state({ phase: 'start' })
      onStateChange?.(snapshot)
      return snapshot
    },
    move(pointer = {}) {
      if (!active) return state({ phase: 'idle' })
      const dx = finiteNumber(pointer.screenX, active.startX) - active.startX
      const dy = finiteNumber(pointer.screenY, active.startY) - active.startY
      return apply(resizeFrame(active.frame, active.edge, dx, dy, {
        minWidth,
        minHeight,
        maxWidth,
        maxHeight,
        workArea: getWorkArea(active.frame),
      }), { phase: 'move' })
    },
    end() {
      active = null
      const snapshot = state({ phase: 'end' })
      onStateChange?.(snapshot)
      return snapshot
    },
    resize(edge, deltaX = 0, deltaY = 0) {
      return apply(resizeFrame(getFrame(), edge, deltaX, deltaY, {
        minWidth,
        minHeight,
        maxWidth,
        maxHeight,
        workArea: getWorkArea(getFrame()),
      }), { phase: 'resize', edge: normalizeResizeEdge(edge) })
    },
    getState() {
      return state()
    },
  }
}

export function createMaximizeController({
  getFrame = () => frameFromWindow(),
  getWorkArea = (frame = frameFromWindow()) => workAreaForFrameTopLeft(frame, panelDisplays, workAreaFromWindow()),
  updateFrame = updateSelfFrame,
  onStateChange = null,
} = {}) {
  let maximized = false
  let restoreFrame = null

  function state() {
    return {
      maximized,
      restoreFrame: restoreFrame ? cloneFrame(restoreFrame) : null,
    }
  }

  function notify() {
    onStateChange?.(state())
  }

  function maximizePanel() {
    if (maximized) return state()
    restoreFrame = cloneFrame(getFrame())
    maximized = true
    updateFrame(cloneFrame(getWorkArea(restoreFrame)))
    notify()
    return state()
  }

  function restorePanel() {
    if (!maximized || !restoreFrame) return state()
    const frame = cloneFrame(restoreFrame)
    maximized = false
    restoreFrame = null
    updateFrame(frame)
    notify()
    return state()
  }

  return {
    maximize: maximizePanel,
    restore: restorePanel,
    toggle() {
      return maximized ? restorePanel() : maximizePanel()
    },
    getState: state,
  }
}

export function syncMaximizeButton(button, state = {}) {
  const maximized = Boolean(state.maximized)
  button.setAttribute('aria-label', maximized ? 'Restore panel' : 'Maximize panel')
  button.setAttribute('aria-pressed', String(maximized))
  button.title = maximized ? 'Restore' : 'Maximize'
  button.textContent = maximized ? '[]' : '+'
  button.dataset.maximized = String(maximized)
}

function currentCanvasId() {
  return window.__aosCanvasId || window.__aosSurfaceCanvasId || null
}

function defaultClose() {
  removeSelf({ orphan_children: true }).catch((error) => {
    console.warn('[aos-panel] close failed', error)
  })
}

function chipFrame() {
  return chipFrameFromWindow(window)
}

export function chipFrameFromWindow(view = window, {
  margin = 10,
  minWidth = 180,
  maxWidth = 280,
  height = 38,
  displays = panelDisplays,
} = {}) {
  const frame = frameFromWindow(view)
  return chipFrameForPanelFrame(frame, {
    displays,
    fallbackWorkArea: workAreaFromWindow(view),
    sourceWidth: view.innerWidth || frame[2],
    margin,
    minWidth,
    maxWidth,
    height,
  })
}

function chipUrl({ target, title, restoreFrame, chipId = null, chipFrame = null }) {
  let url = new URL(window.location.href)
  const path = url.pathname || ''
  if (path.includes('/panel/')) {
    url.pathname = `${path.slice(0, path.indexOf('/panel/') + '/panel/'.length)}minimized-chip.html`
  } else if (path.includes('/components/')) {
    url.pathname = `${path.slice(0, path.indexOf('/components/'))}/panel/minimized-chip.html`
  } else {
    url = new URL('./minimized-chip.html', window.location.href)
  }
  url.hash = ''
  url.searchParams.set('target', target)
  url.searchParams.set('title', title)
  if (restoreFrame) url.searchParams.set('restoreFrame', JSON.stringify(cloneFrame(restoreFrame)))
  if (chipId) url.searchParams.set('chip', chipId)
  if (chipFrame) url.searchParams.set('chipFrame', JSON.stringify(cloneFrame(chipFrame)))
  return url.href
}

function defaultMinimize({ title = 'AOS' } = {}) {
  const target = currentCanvasId()
  if (!target) {
    console.warn('[aos-panel] minimize failed: missing canvas id')
    return
  }
  const chipId = `aos-chip-${target}-${Date.now().toString(36)}`
  const restoreFrame = frameFromWindow(window)
  const minimizedFrame = chipFrame()
  spawnChild({
    id: chipId,
    url: chipUrl({ target, title, restoreFrame, chipId, chipFrame: minimizedFrame }),
    frame: minimizedFrame,
    interactive: true,
    focus: false,
    parent: target,
    cascade: false,
  })
    .then(() => suspendCanvas(target))
    .catch((error) => {
      console.warn('[aos-panel] minimize failed', error)
    })
}

function wirePanelDisplayGeometry() {
  if (displayGeometryWired || typeof window === 'undefined') return
  displayGeometryWired = true
  wireBridge((message) => {
    const payload = message?.payload || message?.data || message
    const type = message?.type || payload?.type
    if (type === 'display_geometry' && payload?.displays) {
      panelDisplays = normalizePanelDisplays(payload.displays)
      return
    }
    if (type !== 'canvas_lifecycle') return
    const id = payload?.canvas_id || payload?.id || payload?.canvas?.id || null
    if (!id || id !== currentCanvasId()) return
    const frame = payload?.at || payload?.canvas?.at || null
    if (Array.isArray(frame) && frame.length >= 4) currentPanelFrame = cloneFrame(frame)
  })
  subscribe(['display_geometry', 'canvas_lifecycle'], { snapshot: true })
}

export function wireDrag(header, controlsEl, {
  controller = null,
  move = moveAbsolute,
  globalInput = true,
  onStart = null,
  onEnd = null,
  ...controllerOptions
} = {}) {
  const dragController = controller || createDragController({ move, ...controllerOptions })
  let activePointerId = null
  let finishDrag = null
  let inputBridgeInstalled = false

  function installInputBridge() {
    if (inputBridgeInstalled || !globalInput) return
    inputBridgeInstalled = true
    wireBridge((message) => {
      if (!finishDrag) return
      const input = normalizeCanvasInputMessage(message)
      if (!input) return
      const eventType = input.type || input.eventKind || input.sourceEvent
      const x = Number(input.x)
      const y = Number(input.y)
      if ((eventType === 'left_mouse_dragged' || eventType === 'mouse_moved') && Number.isFinite(x) && Number.isFinite(y)) {
        dragController.move({
          pointerId: activePointerId,
          screenX: x,
          screenY: y,
        })
        return
      }
      if (eventType === 'left_mouse_up' || eventType === 'pointer_cancel' || eventType === 'mouse_cancel') {
        finishDrag({ pointerId: activePointerId, screenX: x, screenY: y, source: 'input_event' })
      }
    })
  }

  header.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    const NodeCtor = globalThis.Node
    if ((!NodeCtor || e.target instanceof NodeCtor) && controlsEl?.contains?.(e.target)) return
    const pointerId = e.pointerId
    activePointerId = pointerId
    header.dataset.dragging = 'true'
    e.preventDefault()
    // Drag lifecycle matters to the daemon: mixed-DPI seam placement keeps a
    // direct path during active drags and only falls back to re-home behavior
    // for non-drag placements.
    emit('drag_start')
    onStart?.(e, dragController)
    dragController.start(e)
    installInputBridge()
    if (globalInput) subscribe(['input_event'])

    try { header.setPointerCapture(pointerId) } catch {}

    const onMove = (ev) => {
      if (ev.pointerId !== pointerId) return
      dragController.move(ev)
    }

    const onUp = (ev) => {
      if (ev && ev.pointerId !== pointerId) return
      finishDrag?.(ev)
    }

    const onLostPointerCapture = (ev) => {
      if (globalInput) return
      onUp(ev)
    }

    finishDrag = (ev) => {
      if (!finishDrag) return
      delete header.dataset.dragging
      header.removeEventListener('pointermove', onMove)
      header.removeEventListener('pointerup', onUp)
      header.removeEventListener('pointercancel', onUp)
      header.removeEventListener('lostpointercapture', onLostPointerCapture)
      try {
        if (header.hasPointerCapture(pointerId)) header.releasePointerCapture(pointerId)
      } catch {}
      dragController.end(ev)
      emit('drag_end')
      if (globalInput) unsubscribe(['input_event'])
      activePointerId = null
      finishDrag = null
      onEnd?.(ev, dragController)
    }

    header.addEventListener('pointermove', onMove)
    header.addEventListener('pointerup', onUp)
    header.addEventListener('pointercancel', onUp)
    header.addEventListener('lostpointercapture', onLostPointerCapture)
  })
  return dragController
}

export function wireResize(panel, {
  edges = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'],
  controller = null,
  onStart = null,
  ...controllerOptions
} = {}) {
  const resizeController = controller || createResizeController(controllerOptions)
  const handles = []
  for (const edge of edges) {
    const normalizedEdge = normalizeResizeEdge(edge)
    const handle = document.createElement('div')
    handle.className = `aos-resize-handle aos-resize-${normalizedEdge}`
    handle.dataset.edge = normalizedEdge
    handle.setAttribute('aria-hidden', 'true')
    panel.appendChild(handle)
    handles.push(handle)

    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return
      const pointerId = event.pointerId
      event.preventDefault()
      event.stopPropagation?.()
      emit('resize_start', { edge: normalizedEdge })
      onStart?.(normalizedEdge, event, resizeController)
      resizeController.start(normalizedEdge, event)
      try { handle.setPointerCapture(pointerId) } catch {}

      const onMove = (moveEvent) => {
        if (moveEvent.pointerId !== pointerId) return
        resizeController.move(moveEvent)
      }

      const onUp = (upEvent) => {
        if (upEvent && upEvent.pointerId !== pointerId) return
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
        handle.removeEventListener('pointercancel', onUp)
        handle.removeEventListener('lostpointercapture', onUp)
        try {
          if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId)
        } catch {}
        resizeController.end()
        emit('resize_end', { edge: normalizedEdge })
      }

      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
      handle.addEventListener('pointercancel', onUp)
      handle.addEventListener('lostpointercapture', onUp)
    })
  }
  return { controller: resizeController, handles }
}
