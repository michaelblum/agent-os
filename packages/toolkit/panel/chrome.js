// chrome.js — pure-DOM panel scaffold (header + drag + content slot).
//
// Knows nothing about messaging or contents. Just builds the visual frame
// and reports absolute drag updates through the runtime canvas helper.

import { emit, wireBridge } from '../runtime/bridge.js'
import { moveAbsolute, mutateSelf, removeSelf, removeCanvas, resumeCanvas, spawnChild, suspendCanvas } from '../runtime/canvas.js'
import { registerInputRegion, removeInputRegion, updateInputRegion } from '../runtime/input-region.js'
import { normalizeCanvasInputMessage } from '../runtime/input-events.js'
import { subscribe, unsubscribe } from '../runtime/subscribe.js'
import { nativeToDesktopWorldRect } from '../runtime/spatial.js'
import { defaultDesktopWorldStageUrl, ensureDesktopWorldStage, sendDesktopWorldStageLayer } from './drag-transfer.js'
import { createDragDropController, dragFrameFromPointer } from './drag-drop.js'
import {
  chipFrameForPanelFrame,
  clampFrameToWorkArea as placementClampFrameToWorkArea,
  cloneFrame as placementCloneFrame,
  createPlacementPlan,
  finiteNumber,
  frameFromWindow as placementFrameFromWindow,
  normalizePanelDisplays,
  normalizeViewportOverflowPolicy,
  positiveNumber,
  workAreaForFrameTopLeft as placementWorkAreaForFrameTopLeft,
  workAreaForPoint as placementWorkAreaForPoint,
  workAreaFromWindow as placementWorkAreaFromWindow,
} from './placement.js'
import {
  createStageAffordance,
  insetFrame,
  stageAffordanceRegionId,
} from './stage-affordance.js'

let displayGeometryWired = false
let panelDisplays = []
let currentPanelFrame = null

export function mountChrome(container, {
  title = 'AOS',
  draggable = true,
  drag = {},
  placement = {},
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
  stampPanelDragTarget(header, title)

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

  const { onStateChange: onDragStateChange, ...dragOptions } = drag
  let maximizeButton = null
  const panelWindowController = createPanelWindowController({
    initialPlacement: placement,
    drag: draggable ? { clampOnEnd: true, ...dragOptions } : false,
    resize: resizable ? resize : false,
    maximize: Boolean(maximize),
    minimize: minimize ? minimize : false,
    close: false,
    onDragStateChange(state) {
      onDragStateChange?.(state)
    },
    onMaximizeStateChange(state) {
      if (maximizeButton) syncMaximizeButton(maximizeButton, state)
    },
  })
  if (typeof window !== 'undefined') {
    window.__aosPanelWindowController = panelWindowController
  }
  panelWindowController.settleInitialPlacement()
  const maximizeController = panelWindowController.maximizeController

  if (maximizeController) {
    maximizeButton = document.createElement('button')
    maximizeButton.type = 'button'
    maximizeButton.className = 'aos-window-button aos-window-maximize'
    maximizeButton.setAttribute('aria-label', 'Maximize panel')
    maximizeButton.setAttribute('aria-pressed', 'false')
    maximizeButton.title = 'Maximize'
    maximizeButton.textContent = '+'
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
    const minimizeController = panelWindowController.minimizeController
    const minimizeButton = document.createElement('button')
    minimizeButton.type = 'button'
    minimizeButton.className = 'aos-window-button aos-window-minimize'
    minimizeButton.setAttribute('aria-label', 'Minimize panel')
    minimizeButton.title = 'Minimize'
    minimizeButton.textContent = '-'
    minimizeButton.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (minimizeController.getState().inFlight) return
      minimizeButton.disabled = true
      minimizeButton.dataset.inFlight = 'true'
      const action = onMinimize
        ? () => onMinimize(minimizeController, event)
        : () => minimizeController.minimize({ title: titleEl.textContent || title })
      Promise.resolve(action?.())
        .catch((error) => {
          console.warn('[aos-panel] minimize failed', error)
        })
        .finally(() => {
          minimizeButton.disabled = false
          delete minimizeButton.dataset.inFlight
        })
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

  const dragController = draggable
    ? panelWindowController.wireDrag(header, controlsEl)
    : null
  const resizeController = resizable
    ? panelWindowController.wireResize(panel, {
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
    panelWindowController,
    maximizeController,
    dragController,
    resizeController,
    setTitle(text) {
      titleEl.textContent = text
      stampPanelDragTarget(header, text)
    },
    setControls(html) { customControlsEl.innerHTML = html },
  }
}

const cloneFrame = placementCloneFrame

export function frameFromWindow(view = window) {
  if (
    typeof window !== 'undefined'
    && view === window
    && !currentPanelFrame
    && Array.isArray(window.__aosInitialFrame)
  ) {
    return cloneFrame(window.__aosInitialFrame)
  }
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

function defaultPanelWorkArea(frame = frameFromWindow()) {
  return workAreaForFrameTopLeft(frame, panelDisplays, workAreaFromWindow())
}

function defaultPanelDragWorkArea(frame = frameFromWindow(), pointer = null) {
  return workAreaForPoint(pointer, panelDisplays, defaultPanelWorkArea(frame))
}

function updateSelfFrame(frame) {
  currentPanelFrame = cloneFrame(frame)
  mutateSelf({ frame: currentPanelFrame })
}

function updateSelfFrameWithGeometry(frame, geometry = null) {
  currentPanelFrame = cloneFrame(frame)
  mutateSelf(geometry ? { frame: currentPanelFrame, geometry } : { frame: currentPanelFrame })
}

function nextGeometryTransactionId(prefix = 'geometry') {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`
}

export const clampFrameToWorkArea = placementClampFrameToWorkArea
export { createPlacementPlan, normalizeViewportOverflowPolicy }
export { createDragDropController, dragFrameFromPointer }

function optionObject(value) {
  return value && typeof value === 'object' ? value : {}
}

function monotonicNow() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

export function createPanelWindowController({
  getCanvasId = currentCanvasId,
  getFrame = () => frameFromWindow(),
  getWorkArea = defaultPanelWorkArea,
  getDragWorkArea = defaultPanelDragWorkArea,
  getChipFrame = chipFrame,
  updateFrame = updateSelfFrameWithGeometry,
  move = moveAbsolute,
  drag = true,
  resize = false,
  maximize = false,
  minimize = true,
  initialPlacement = true,
  close = true,
  closeAction = defaultClose,
  onDragStateChange = null,
  onResizeStateChange = null,
  onMaximizeStateChange = null,
  onMinimizeStateChange = null,
} = {}) {
  const dragOptions = optionObject(drag)
  const resizeOptions = optionObject(resize)
  const maximizeOptions = optionObject(maximize)
  const minimizeOptions = optionObject(minimize)
  const initialPlacementOptions = optionObject(initialPlacement)
  const dragEnabled = Boolean(drag)
  const resizeEnabled = Boolean(resize)
  const maximizeEnabled = Boolean(maximize)
  const minimizeEnabled = Boolean(minimize)
  const initialPlacementEnabled = initialPlacement !== false
  let initialPlacementSettled = false

  const maximizeController = maximizeEnabled
    ? createMaximizeController({
      getFrame,
      getWorkArea,
      updateFrame,
      ...maximizeOptions,
      onStateChange(state) {
        maximizeOptions.onStateChange?.(state)
        onMaximizeStateChange?.(state)
      },
    })
    : null

  const dragController = dragEnabled
    ? createDragController({
      move,
      getFrame,
      getWorkArea,
      getDragWorkArea,
      updateFrame,
      clampOnEnd: true,
      ...dragOptions,
      onStateChange(state) {
        dragOptions.onStateChange?.(state)
        onDragStateChange?.(state)
      },
    })
    : null

  const resizeController = resizeEnabled
    ? createResizeController({
      getFrame,
      getWorkArea,
      updateFrame,
      ...resizeOptions,
      onStateChange(state) {
        resizeOptions.onStateChange?.(state)
        onResizeStateChange?.(state)
      },
    })
    : null

  const minimizeController = minimizeEnabled
    ? createMinimizeController({
      getCanvasId,
      getFrame,
      getChipFrame,
      maximizeController,
      ...minimizeOptions,
      onStateChange(state) {
        minimizeOptions.onStateChange?.(state)
        onMinimizeStateChange?.(state)
      },
    })
    : null
  if (
    minimizeController
    && minimizeOptions.prewarmStage !== false
    && minimizeOptions.useStageChips !== false
  ) {
    minimizeController.prewarmStage()
  }

  return {
    dragController,
    resizeController,
    maximizeController,
    minimizeController,
    settleInitialPlacement(options = {}) {
      if (!initialPlacementEnabled || initialPlacementSettled) return null
      initialPlacementSettled = true
      const merged = { ...initialPlacementOptions, ...options }
      const requestedFrame = cloneFrame(merged.requestedFrame || getFrame())
      const plan = createPlacementPlan({
        requestedFrame,
        workArea: merged.workArea || getWorkArea(requestedFrame),
        viewportOverflowPolicy: merged.viewportOverflowPolicy || merged.viewport_overflow_policy || 'clamp',
        anchorFrame: merged.anchorFrame || merged.anchor_frame || null,
        gap: merged.gap || 0,
        ...(merged.minVisibleWidth == null ? {} : { minVisibleWidth: merged.minVisibleWidth }),
        ...(merged.minVisibleHeight == null ? {} : { minVisibleHeight: merged.minVisibleHeight }),
        cause: merged.cause || 'placement.initial',
      })
      updateFrame(cloneFrame(plan.final_settled_frame), {
        change: 'frame',
        cause: plan.cause,
        phase: 'settled',
        transaction_id: merged.transactionId || merged.transaction_id || nextGeometryTransactionId('placement-initial'),
        placement: plan,
      })
      return plan
    },
    close() {
      if (!close) return null
      return closeAction?.()
    },
    minimize(options) {
      return minimizeController?.minimize(options) || null
    },
    maximize() {
      return maximizeController?.maximize() || null
    },
    restore() {
      return maximizeController?.restore() || null
    },
    toggleMaximize() {
      return maximizeController?.toggle() || null
    },
    wireDrag(header, controlsEl, options = {}) {
      if (!dragController) return null
      return wireDrag(header, controlsEl, { controller: dragController, ...options })
    },
    wireResize(panel, options = {}) {
      if (!resizeController) return null
      return wireResize(panel, { controller: resizeController, ...options })
    },
    getState() {
      return {
        drag: dragController?.getState?.() || null,
        resize: resizeController?.getState?.() || null,
        maximize: maximizeController?.getState?.() || null,
        minimize: minimizeController?.getState?.() || null,
      }
    },
  }
}

export function createDragController({
  move = moveAbsolute,
  getFrame = () => frameFromWindow(),
  getWorkArea = defaultPanelWorkArea,
  getDragWorkArea = (frame = frameFromWindow(), pointer = null) => (
    placementWorkAreaForPoint(pointer, panelDisplays, getWorkArea(frame))
  ),
  updateFrame = updateSelfFrameWithGeometry,
  clampOnEnd = false,
  viewportOverflowPolicy = 'clamp',
  minVisibleWidth = 160,
  minVisibleHeight = 44,
  onStateChange = null,
} = {}) {
  return createDragDropController({
    move,
    getFrame,
    getWorkArea,
    getDragWorkArea,
    updateFrame,
    clampOnEnd,
    viewportOverflowPolicy,
    minVisibleWidth,
    minVisibleHeight,
    onStateChange,
  })
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
  updateFrame = updateSelfFrameWithGeometry,
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
      transactionId: active?.transactionId || null,
      ...extra,
    }
  }

  function apply(nextFrame, extra = {}) {
    frame = cloneFrame(nextFrame)
    updateFrame(frame, {
      change: extra.change || 'frame',
      cause: extra.cause || 'resize.drag',
      phase: extra.geometryPhase || (extra.phase === 'move' ? 'update' : 'settled'),
      transaction_id: active?.transactionId || extra.transactionId || null,
    })
    const snapshot = state(extra)
    onStateChange?.(snapshot)
    return snapshot
  }

  return {
    start(edge, pointer = {}) {
      active = {
        transactionId: nextGeometryTransactionId('resize-drag'),
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
      }), { phase: 'move', change: 'frame', cause: 'resize.drag', geometryPhase: 'update' })
    },
    end() {
      const transactionId = active?.transactionId || null
      active = null
      const snapshot = state({ phase: 'end', transactionId })
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
      }), { phase: 'resize', edge: normalizeResizeEdge(edge), change: 'frame', cause: 'unknown', geometryPhase: 'settled' })
    },
    getState() {
      return state()
    },
  }
}

export function createMaximizeController({
  getFrame = () => frameFromWindow(),
  getWorkArea = (frame = frameFromWindow()) => workAreaForFrameTopLeft(frame, panelDisplays, workAreaFromWindow()),
  updateFrame = updateSelfFrameWithGeometry,
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
    const requestedFrame = cloneFrame(getWorkArea(restoreFrame))
    const plan = createPlacementPlan({
      requestedFrame,
      workArea: requestedFrame,
      viewportOverflowPolicy: 'allow',
      cause: 'layout.maximize',
    })
    maximized = true
    updateFrame(cloneFrame(plan.final_settled_frame), {
      change: 'frame',
      cause: 'layout.maximize',
      phase: 'settled',
      transaction_id: nextGeometryTransactionId('layout-maximize'),
      placement: plan,
    })
    notify()
    return state()
  }

  function restorePanel() {
    if (!maximized || !restoreFrame) return state()
    const plan = createPlacementPlan({
      requestedFrame: restoreFrame,
      workArea: getWorkArea(restoreFrame),
      viewportOverflowPolicy: 'clamp',
      cause: 'layout.restore',
    })
    const frame = cloneFrame(plan.final_settled_frame)
    maximized = false
    restoreFrame = null
    updateFrame(frame, {
      change: 'frame',
      cause: 'layout.restore',
      phase: 'settled',
      transaction_id: nextGeometryTransactionId('layout-restore'),
      placement: plan,
    })
    notify()
    return state()
  }

  function resetPanel() {
    if (!maximized && !restoreFrame) return state()
    maximized = false
    restoreFrame = null
    notify()
    return state()
  }

  return {
    maximize: maximizePanel,
    restore: restorePanel,
    reset: resetPanel,
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
  if (typeof window === 'undefined') return null
  return window.__aosCanvasId || window.__aosSurfaceCanvasId || null
}

function panelDragTargetRef(title = 'AOS') {
  const surface = currentCanvasId() || 'aos-panel'
  return `${surface}:drag-handle`
}

function stampPanelDragTarget(header, title = 'AOS') {
  if (!header) return
  header.setAttribute('role', 'button')
  header.setAttribute('aria-label', `Drag ${title || 'AOS'} panel`)
  header.dataset.aosRef = panelDragTargetRef(title)
  header.dataset.aosSurface = currentCanvasId() || 'aos-panel'
  header.dataset.semanticTargetId = 'drag-handle'
  header.dataset.aosAction = 'panel_drag'
  header.dataset.aosActions = 'drag'
}

function defaultClose() {
  removeSelf({ orphan_children: true }).catch((error) => {
    console.warn('[aos-panel] close failed', error)
  })
}

export function suspendOnClose() {
  suspendCanvas().catch((error) => {
    console.warn('[aos-panel] suspend-on-close failed', error)
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

function chipRegionIds(chipId) {
  return {
    restore: stageAffordanceRegionId(chipId, 'restore'),
    close: stageAffordanceRegionId(chipId, 'close'),
    body: stageAffordanceRegionId(chipId, 'body'),
  }
}

function chipStageLayer({ chipId, title, frame }) {
  return {
    id: chipId,
    kind: 'chip',
    label: title,
    frame: cloneFrame(frame),
    zIndex: 20_000,
    style: {
      color: 'rgba(245, 247, 250, 0.96)',
      fill: 'rgba(27, 31, 38, 0.92)',
      strokeWidth: 1,
    },
    metadata: {
      toolkit_role: 'minimized_panel_chip',
    },
  }
}

export function stageLayerFrameFromNativeFrame(frame, displays = panelDisplays) {
  const source = cloneFrame(frame)
  const rect = nativeToDesktopWorldRect({
    x: source[0],
    y: source[1],
    w: source[2],
    h: source[3],
  }, displays)
  if (!rect) return source
  return cloneFrame([rect.x, rect.y, rect.w, rect.h])
}

export function createMinimizeController({
  getCanvasId = currentCanvasId,
  getFrame = () => frameFromWindow(window),
  getChipFrame = chipFrame,
  makeChipUrl = chipUrl,
  spawn = spawnChild,
  suspend = suspendCanvas,
  resume = resumeCanvas,
  remove = removeCanvas,
  registerRegion = registerInputRegion,
  updateRegion = updateInputRegion,
  removeRegion = removeInputRegion,
  ensureStage = ensureDesktopWorldStage,
  stageCanvasId = 'aos-desktop-world-stage',
  stageUrl = defaultDesktopWorldStageUrl,
  sendStageMessage = (message) => sendDesktopWorldStageLayer(stageCanvasId, message),
  getStageLayerFrame = stageLayerFrameFromNativeFrame,
  useStageChips = true,
  maximizeController = null,
  now = monotonicNow,
  onStateChange = null,
} = {}) {
  let inFlight = false
  let last = null
  let activeStageChip = null
  let stageEnsureRecord = null
  const chipDragThreshold = 4

  function restoreFrameForMinimize() {
    const maximizeState = maximizeController?.getState?.()
    if (maximizeState?.maximized && maximizeState.restoreFrame) return cloneFrame(maximizeState.restoreFrame)
    return cloneFrame(getFrame())
  }

  function snapshot(extra = {}) {
    return {
      sourceCanvasId: last?.sourceCanvasId || null,
      chipCanvasId: last?.chipCanvasId || null,
      chipLayerId: last?.chipLayerId || null,
      regionIds: last?.regionIds ? { ...last.regionIds } : null,
      registeredRegionIds: last?.registeredRegionIds ? [...last.registeredRegionIds] : [],
      stageEnsureStatus: last?.stageEnsureStatus || null,
      stageLayerUpsertSent: Boolean(last?.stageLayerUpsertSent),
      fallbackChipCreated: Boolean(last?.fallbackChipCreated),
      fallbackChipResumed: Boolean(last?.fallbackChipResumed),
      mode: last?.mode || 'idle',
      inFlight,
      restoreFrame: last?.restoreFrame ? cloneFrame(last.restoreFrame) : null,
      targetSuspendSucceeded: Boolean(last?.targetSuspendSucceeded),
      rollbackRemovedChip: Boolean(last?.rollbackRemovedChip),
      fallbackCleanupAttempted: Boolean(last?.fallbackCleanupAttempted),
      fallbackCleanupAttempts: last?.fallbackCleanupAttempts || 0,
      cleanupRemovedRegions: Boolean(last?.cleanupRemovedRegions),
      cleanupRemovedLayer: Boolean(last?.cleanupRemovedLayer),
      status: last?.status || 'idle',
      error: last?.error || null,
      timing: last?.timing ? { ...last.timing } : null,
      ...extra,
    }
  }

  function notify(extra = {}) {
    const state = snapshot(extra)
    onStateChange?.(state)
    return state
  }

  async function cleanupStageChip(record = activeStageChip, { resumeSource = false, removeSource = false } = {}) {
    if (!record) return { removedRegions: false, removedLayer: false }
    try {
      await record.affordance?.cleanup?.()
    } catch {}
    const affordanceState = record.affordance?.getState?.()
    const removedRegions = Boolean(affordanceState?.cleanupStatus?.removedRegions)
    const removedLayer = Boolean(affordanceState?.cleanupStatus?.removedLayer)
    if (resumeSource && record.sourceCanvasId) {
      try { await resume(record.sourceCanvasId) } catch {}
    }
    if (removeSource && record.sourceCanvasId) {
      try { await remove(record.sourceCanvasId, { orphan_children: true }) } catch {}
    }
    if (activeStageChip?.chipId === record.chipId) activeStageChip = null
    if (last?.chipLayerId === record.chipId) {
      last.cleanupRemovedRegions = removedRegions
      last.cleanupRemovedLayer = removedLayer
    }
    notify()
    return { removedRegions, removedLayer }
  }

  async function createStageChip({ target, chipId, title, restoreFrame, minimizedFrame }) {
    const regionIds = chipRegionIds(chipId)
    const closeWidth = Math.min(36, Math.max(28, Math.round(minimizedFrame[3] * 0.9)))
    const record = {
      sourceCanvasId: target,
      chipId,
      regionIds,
      restoreFrame: cloneFrame(restoreFrame),
      frame: cloneFrame(minimizedFrame),
      title,
      affordance: null,
      gesture: null,
    }
    const timedEnsureStage = async (options = {}) => {
      markTiming('stageEnsureStart')
      const result = await ensureStageForMinimize(options)
      markTiming('stageEnsureEnd')
      last.timing.stageEnsureDurationMs = duration(
        last.timing.stageEnsureStart,
        last.timing.stageEnsureEnd
      )
      return result
    }
    const timedSendStageMessage = (message) => {
      sendStageMessage(message)
      if (message?.type === 'desktop_world_stage.layer.upsert') {
        markTiming('stageLayerUpsertSentAt')
      }
    }
    const timedRegisterRegion = async (region) => {
      if (!last.timing.inputRegionRegistrationStart) {
        markTiming('inputRegionRegistrationStart')
        last.timing.inputRegionRegistrationCount = 0
      }
      await registerRegion(region)
      last.timing.inputRegionRegistrationCount = (last.timing.inputRegionRegistrationCount || 0) + 1
      markTiming('inputRegionRegistrationEnd')
      last.timing.inputRegionRegistrationDurationMs = duration(
        last.timing.inputRegionRegistrationStart,
        last.timing.inputRegionRegistrationEnd
      )
    }
    const updateStageChipFrame = async (nextFrame) => {
      record.frame = cloneFrame(nextFrame)
      const layer = chipStageLayer({ chipId, title, frame: getStageLayerFrame(record.frame) })
      layer.metadata = {
        ...layer.metadata,
        toolkit_affordance_id: chipId,
        resource_scope_id: chipId,
        owner_canvas_id: target,
        source_canvas_id: target,
        target_canvas_id: stageCanvasId,
        stage_affordance_mode: 'minimized_panel_chip',
      }
      timedSendStageMessage({
        type: 'desktop_world_stage.layer.upsert',
        payload: layer,
      })
      await Promise.all([
        updateRegion({
          ...common,
          id: regionIds.body,
          frame: insetFrame(record.frame),
          semantic_label: 'drag',
          priority: 1150,
          consume_policy: 'captured',
          metadata: { ...common.metadata, action: 'drag_restore_body', click_action: 'restore', drag_threshold_px: chipDragThreshold },
        }),
        updateRegion({
          ...common,
          id: regionIds.restore,
          frame: insetFrame(record.frame, { insetRight: closeWidth }),
          semantic_label: 'restore',
          priority: 1100,
          consume_policy: 'captured',
          metadata: { ...common.metadata, action: 'restore_or_drag', drag_threshold_px: chipDragThreshold },
        }),
        updateRegion({
          ...common,
          id: regionIds.close,
          frame: insetFrame(record.frame, { insetLeft: record.frame[2] - closeWidth }),
          semantic_label: 'close',
          priority: 1200,
          consume_policy: 'down_only',
          metadata: { ...common.metadata, action: 'close' },
        }),
      ])
    }
    const pointFromRegionMessage = (message = {}) => {
      const normalized = normalizeCanvasInputMessage(message) || message
      const native = normalized.native || normalized.payload?.native || normalized.data?.native || null
      const point = native || normalized.desktop_world || normalized.point || normalized.payload?.point || null
      const x = finiteNumber(point?.x ?? normalized.x ?? normalized.screenX ?? normalized.payload?.x, NaN)
      const y = finiteNumber(point?.y ?? normalized.y ?? normalized.screenY ?? normalized.payload?.y, NaN)
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
    }
    const finishBodyGesture = (activeRecord, { restoreIfClick = false } = {}) => {
      const gesture = activeRecord.gesture
      activeRecord.gesture = null
      if (restoreIfClick && gesture && !gesture.dragging) {
        cleanupStageChip(activeRecord, { resumeSource: true }).catch((error) => {
          console.warn('[aos-panel] minimized chip restore cleanup failed', error)
        })
      }
    }
    const handleBodyGesture = (activeRecord, message, phase) => {
      const point = pointFromRegionMessage(message)
      if (phase === 'down') {
        activeRecord.gesture = point
          ? { start: point, last: point, startFrame: cloneFrame(activeRecord.frame), dragging: false }
          : { start: null, last: null, startFrame: cloneFrame(activeRecord.frame), dragging: false }
        return
      }
      const gesture = activeRecord.gesture
      if (!gesture) return
      if (phase === 'cancel') {
        finishBodyGesture(activeRecord)
        return
      }
      if (phase === 'drag' && point && gesture.start) {
        const dx = point.x - gesture.start.x
        const dy = point.y - gesture.start.y
        if (!gesture.dragging && Math.hypot(dx, dy) >= chipDragThreshold) {
          gesture.dragging = true
        }
        if (gesture.dragging) {
          const nextFrame = cloneFrame([
            gesture.startFrame[0] + dx,
            gesture.startFrame[1] + dy,
            gesture.startFrame[2],
            gesture.startFrame[3],
          ])
          updateStageChipFrame(nextFrame).catch((error) => {
            console.warn('[aos-panel] minimized chip drag update failed', error)
          })
        }
        gesture.last = point
        return
      }
      if (phase === 'up') {
        finishBodyGesture(activeRecord, { restoreIfClick: true })
      }
    }
    const common = {
      owner_canvas_id: target,
      coordinate_space: 'native',
      remove_on_owner_suspend: false,
      enabled: true,
      metadata: {
        toolkit_role: 'minimized_panel_chip',
        chip_id: chipId,
      },
    }
    const affordance = createStageAffordance({
      id: chipId,
      ownerCanvasId: target,
      sourceCanvasId: target,
      targetCanvasId: stageCanvasId,
      mode: 'minimized_panel_chip',
      layer: chipStageLayer({ chipId, title, frame: getStageLayerFrame(minimizedFrame) }),
      regions: [
        {
          ...common,
          id: regionIds.body,
          frame: insetFrame(minimizedFrame),
          semantic_label: 'drag',
          priority: 1150,
          consume_policy: 'captured',
          metadata: { ...common.metadata, action: 'drag_restore_body', click_action: 'restore', drag_threshold_px: chipDragThreshold },
        },
        {
          ...common,
          id: regionIds.restore,
          frame: insetFrame(minimizedFrame, { insetRight: closeWidth }),
          semantic_label: 'restore',
          priority: 1100,
          consume_policy: 'captured',
          metadata: { ...common.metadata, action: 'restore_or_drag', drag_threshold_px: chipDragThreshold },
        },
        {
          ...common,
          id: regionIds.close,
          frame: insetFrame(minimizedFrame, { insetLeft: minimizedFrame[2] - closeWidth }),
          semantic_label: 'close',
          priority: 1200,
          consume_policy: 'down_only',
          metadata: { ...common.metadata, action: 'close' },
        },
      ],
      cleanupRegionIds: [regionIds.restore, regionIds.close, regionIds.body],
      stageCanvasId,
      stageUrl,
      createStage: spawn,
      ensureStage: timedEnsureStage,
      sendStageMessage: timedSendStageMessage,
      registerRegion: timedRegisterRegion,
      removeRegion,
      onInputRegionEvent({ message }) {
        const normalized = normalizeCanvasInputMessage(message) || message
        const phase = normalized.phase || message.phase || message.payload?.phase || message.data?.phase
        const regionId = normalized.regionId || normalized.region_id || message.region_id || message.payload?.region_id || message.data?.region_id
        if (!phase) return
        const activeRecord = activeStageChip?.chipId === chipId ? activeStageChip : record
        if (regionId === regionIds.close) {
          if (phase !== 'down') return
          cleanupStageChip(activeRecord, { removeSource: true }).catch((error) => {
            console.warn('[aos-panel] minimized chip close cleanup failed', error)
          })
          return
        }
        if (regionId === regionIds.restore || regionId === regionIds.body) {
          handleBodyGesture(activeRecord, message, phase)
        }
      },
      onSourceRemoved() {
        const activeRecord = activeStageChip?.chipId === chipId ? activeStageChip : record
        cleanupStageChip(activeRecord).catch((error) => {
          console.warn('[aos-panel] minimized chip owner cleanup failed', error)
        })
      },
    })
    record.affordance = affordance

    try {
      await affordance.setup()
      const affordanceState = affordance.getState?.() || {}
      record.stageEnsureStatus = affordanceState.stageEnsureStatus || null
      record.stageLayerUpsertSent = Boolean(affordanceState.stageLayerUpsertSent)
      record.registeredRegionIds = [...(affordanceState.registeredRegionIds || [])]
      activeStageChip = record
      return record
    } catch (error) {
      const affordanceState = affordance.getState?.() || {}
      error.stageEnsureStatus = error.stageEnsureStatus || affordanceState.stageEnsureStatus || null
      error.stageLayerUpsertSent = Boolean(affordanceState.stageLayerUpsertSent)
      error.registeredRegionIds = [...(affordanceState.registeredRegionIds || [])]
      await cleanupStageChip(record)
      throw error
    }
  }

  async function rollbackChip(chipId, { resumeSource = false, sourceCanvasId = null } = {}) {
    let removed = false
    try {
      if (last) {
        last.fallbackCleanupAttempted = true
        last.fallbackCleanupAttempts = (last.fallbackCleanupAttempts || 0) + 1
      }
      await remove(chipId, { orphan_children: true })
      removed = true
    } catch {}
    if (resumeSource && sourceCanvasId) {
      try { await resume(sourceCanvasId) } catch {}
    }
    return removed
  }

  async function cleanupFallbackChipCreateFailure(chipId) {
    if (!chipId) return false
    const retryDelays = [0, 50, 150]
    let removed = false
    for (const delayMs of retryDelays) {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
      removed = await rollbackChip(chipId)
      if (removed) break
    }
    return removed
  }

  function markTiming(name) {
    if (!last) return null
    if (!last.timing) last.timing = {}
    const value = now()
    last.timing[name] = value
    return value
  }

  function duration(start, end) {
    return Number.isFinite(start) && Number.isFinite(end)
      ? Math.max(0, end - start)
      : null
  }

  function stageEnsureKey(id, url) {
    return `${id || ''}:${url || ''}`
  }

  function stageUrlValue() {
    return typeof stageUrl === 'function' ? stageUrl() : stageUrl
  }

  function beginStageEnsure({ id = stageCanvasId, url = stageUrlValue(), createStage = spawn, force = false } = {}) {
    if (!useStageChips) {
      return Promise.resolve({
        ok: false,
        status: 'stage_chips_disabled',
        id,
        url,
        created: false,
      })
    }
    const key = stageEnsureKey(id, url)
    if (!force && stageEnsureRecord?.key === key) return stageEnsureRecord.promise
    const promise = Promise.resolve()
      .then(() => ensureStage({ id, url, createStage }))
      .catch((error) => ({
        ok: false,
        status: 'ensure_failed',
        id,
        url,
        created: false,
        error: String(error?.message || error),
      }))
    stageEnsureRecord = {
      key,
      promise,
    }
    return promise
  }

  function prewarmStage({ force = false, retry = false } = {}) {
    return beginStageEnsure({ force: force || retry })
  }

  function ensureStageForMinimize(options = {}) {
    return beginStageEnsure(options)
  }

  async function minimize({ title = 'AOS' } = {}) {
    if (inFlight) return notify({ status: 'ignored_in_flight' })
    const handlerStart = now()
    const target = getCanvasId()
    if (!target) {
      last = {
        sourceCanvasId: null,
        chipCanvasId: null,
        chipLayerId: null,
        regionIds: null,
        registeredRegionIds: [],
        stageEnsureStatus: null,
        stageLayerUpsertSent: false,
        fallbackChipCreated: false,
        fallbackChipResumed: false,
        mode: 'none',
        restoreFrame: null,
        targetSuspendSucceeded: false,
        rollbackRemovedChip: false,
        fallbackCleanupAttempted: false,
        fallbackCleanupAttempts: 0,
        cleanupRemovedRegions: false,
        cleanupRemovedLayer: false,
        status: 'missing_canvas_id',
        error: 'missing_canvas_id',
        timing: {
          handlerStart,
          totalElapsedMs: 0,
        },
      }
      return notify()
    }

    const chipId = `aos-chip-${target}-${now().toString(36)}`
    const restoreFrame = restoreFrameForMinimize()
    const minimizedFrame = cloneFrame(getChipFrame())
    last = {
      sourceCanvasId: target,
      chipCanvasId: null,
      chipLayerId: null,
      regionIds: null,
      registeredRegionIds: [],
      stageEnsureStatus: null,
      stageLayerUpsertSent: false,
      fallbackChipCreated: false,
      fallbackChipResumed: false,
      mode: useStageChips ? 'stage' : 'fallback_webview',
      restoreFrame,
      targetSuspendSucceeded: false,
      rollbackRemovedChip: false,
      fallbackCleanupAttempted: false,
      fallbackCleanupAttempts: 0,
      cleanupRemovedRegions: false,
      cleanupRemovedLayer: false,
      status: 'creating_chip',
      error: null,
      timing: {
        handlerStart,
      },
    }
    inFlight = true
    notify()

    let chipCreated = false
    let stageCreated = false
    let stageRecord = null
    try {
      if (useStageChips) {
        try {
          stageRecord = await createStageChip({ target, chipId, title, restoreFrame, minimizedFrame })
          stageCreated = true
          last.chipLayerId = chipId
          last.regionIds = { ...stageRecord.regionIds }
          last.registeredRegionIds = [...(stageRecord.registeredRegionIds || [])]
          last.stageEnsureStatus = stageRecord.stageEnsureStatus || null
          last.stageLayerUpsertSent = Boolean(stageRecord.stageLayerUpsertSent)
        } catch (error) {
          last.mode = 'fallback_webview'
          last.status = 'stage_unavailable_fallback'
          last.error = String(error?.message || error || 'stage_unavailable')
          last.stageEnsureStatus = error?.stageEnsureStatus || null
          last.stageLayerUpsertSent = Boolean(error?.stageLayerUpsertSent)
          last.registeredRegionIds = [...(error?.registeredRegionIds || [])]
          console.warn('[aos-panel] minimized chip stage unavailable; using WebView fallback', error)
          notify()
        }
      } else {
        last.mode = 'fallback_webview'
      }

      if (!stageCreated) {
        last.chipCanvasId = chipId
        last.mode = 'fallback_webview'
        try {
          markTiming('fallbackCreateStart')
          await spawn({
            id: chipId,
            url: makeChipUrl({ target, title, restoreFrame, chipId, chipFrame: minimizedFrame }),
            frame: minimizedFrame,
            interactive: true,
            focus: false,
            parent: target,
            cascade: false,
            suspended: true,
          })
          markTiming('fallbackCreateEnd')
          last.timing.fallbackCreateDurationMs = duration(
            last.timing.fallbackCreateStart,
            last.timing.fallbackCreateEnd
          )
        } catch (error) {
          console.warn('[aos-panel] minimized fallback chip create failed; source remains active', error)
          last.rollbackRemovedChip = await cleanupFallbackChipCreateFailure(chipId)
          throw error
        }
        chipCreated = true
        last.fallbackChipCreated = true
      }
      last.status = 'suspending_source'
      notify()
      markTiming('sourceSuspendStart')
      await suspend(target)
      markTiming('sourceSuspendEnd')
      last.timing.sourceSuspendDurationMs = duration(
        last.timing.sourceSuspendStart,
        last.timing.sourceSuspendEnd
      )
      last.targetSuspendSucceeded = true
      maximizeController?.reset?.()
      last.status = 'showing_chip'
      notify()
      if (chipCreated) {
        try {
          markTiming('fallbackResumeStart')
          await resume(chipId)
          markTiming('fallbackResumeEnd')
          last.timing.fallbackResumeDurationMs = duration(
            last.timing.fallbackResumeStart,
            last.timing.fallbackResumeEnd
          )
          last.fallbackChipResumed = true
        } catch (error) {
          console.warn('[aos-panel] minimized fallback chip resume failed; rolling back', error)
          throw error
        }
      }
      last.status = 'success'
      last.timing.totalElapsedMs = duration(last.timing.handlerStart, now())
      notify()
    } catch (error) {
      const message = String(error?.message || error || 'unknown')
      const resumeSource = Boolean(last.targetSuspendSucceeded)
      if (chipCreated) {
        last.rollbackRemovedChip = await rollbackChip(chipId, {
          resumeSource,
          sourceCanvasId: target,
        })
      }
      if (stageCreated || stageRecord) {
        await cleanupStageChip(stageRecord, { resumeSource })
      }
      last.status = 'failed'
      last.error = message
      if (last?.timing) last.timing.totalElapsedMs = duration(last.timing.handlerStart, now())
      notify()
      throw error
    } finally {
      inFlight = false
      notify()
    }
    return snapshot()
  }

  return {
    prewarmStage,
    minimize,
    getState() {
      return snapshot()
    },
  }
}

function defaultMinimize({ title = 'AOS' } = {}) {
  return createMinimizeController().minimize({ title }).catch((error) => {
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
  let lastGlobalPointer = null

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
      const globalPointer = Number.isFinite(x) && Number.isFinite(y)
        ? { pointerId: activePointerId, screenX: x, screenY: y, source: 'input_event' }
        : null
      if ((eventType === 'left_mouse_dragged' || eventType === 'mouse_moved') && Number.isFinite(x) && Number.isFinite(y)) {
        lastGlobalPointer = globalPointer
        dragController.move(globalPointer)
        return
      }
      if (eventType === 'left_mouse_up' || eventType === 'pointer_cancel' || eventType === 'mouse_cancel') {
        if (globalPointer) lastGlobalPointer = globalPointer
        finishDrag(globalPointer || lastGlobalPointer || { pointerId: activePointerId, source: 'input_event' })
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
    onStart?.(e, dragController)
    const startState = dragController.start(e)
    // Drag lifecycle matters to the daemon: mixed-DPI seam placement keeps a
    // direct path during active drags and only falls back to re-home behavior
    // for non-drag placements.
    emit('drag_start', {
      geometry_change: 'origin',
      geometry_cause: 'placement.drag',
      geometry_phase: 'start',
      geometry_transaction_id: startState?.transactionId,
    })
    installInputBridge()
    if (globalInput) subscribe(['input_event'])

    try { header.setPointerCapture(pointerId) } catch {}

    const onMove = (ev) => {
      if (ev.pointerId !== pointerId) return
      if (globalInput) return
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
      const releasePointer = globalInput && ev?.source !== 'input_event'
        ? lastGlobalPointer || ev
        : ev
      delete header.dataset.dragging
      header.removeEventListener('pointermove', onMove)
      header.removeEventListener('pointerup', onUp)
      header.removeEventListener('pointercancel', onUp)
      header.removeEventListener('lostpointercapture', onLostPointerCapture)
      try {
        if (header.hasPointerCapture(pointerId)) header.releasePointerCapture(pointerId)
      } catch {}
      const endState = dragController.end(releasePointer)
      emit('drag_end', {
        geometry_change: 'origin',
        geometry_cause: 'placement.drag',
        geometry_phase: 'settled',
        geometry_transaction_id: endState?.transactionId || startState?.transactionId,
      })
      if (globalInput) unsubscribe(['input_event'])
      activePointerId = null
      finishDrag = null
      lastGlobalPointer = null
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
      onStart?.(normalizedEdge, event, resizeController)
      const startState = resizeController.start(normalizedEdge, event)
      emit('resize_start', {
        edge: normalizedEdge,
        geometry_change: 'frame',
        geometry_cause: 'resize.drag',
        geometry_phase: 'start',
        geometry_transaction_id: startState?.transactionId,
      })
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
        const endState = resizeController.end()
        emit('resize_end', {
          edge: normalizedEdge,
          geometry_change: 'frame',
          geometry_cause: 'resize.drag',
          geometry_phase: 'settled',
          geometry_transaction_id: endState?.transactionId || startState?.transactionId,
        })
      }

      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
      handle.addEventListener('pointercancel', onUp)
      handle.addEventListener('lostpointercapture', onUp)
    })
  }
  return { controller: resizeController, handles }
}
