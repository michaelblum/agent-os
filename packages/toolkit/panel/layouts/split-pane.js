// split-pane.js — two-pane panel/workbench layout with a draggable separator.
//
// The controller is pure DOM: it owns geometry, constraints, keyboard/pointer
// affordances, and optional ratio persistence. Consumers still own pane content.

import { wireBridge, emit } from '../../runtime/bridge.js'
import { subscribe } from '../../runtime/subscribe.js'
import { evalCanvas, spawnChild } from '../../runtime/canvas.js'
import { declareManifest, emitReady } from '../../runtime/manifest.js'
import { createRouter } from '../router.js'

const ORIENTATIONS = new Set(['horizontal', 'vertical'])

function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function positiveNumber(value, fallback = 1) {
  return Math.max(1, finiteNumber(value, fallback))
}

function normalizeRatio(value, fallback = 0.5) {
  const number = finiteNumber(value, fallback)
  return Math.max(0, Math.min(1, number))
}

function normalizeOrientation(value) {
  return ORIENTATIONS.has(value) ? value : 'horizontal'
}

function axis(orientation) {
  return orientation === 'vertical'
    ? { size: 'height', client: 'clientY', origin: 'top', flexDirection: 'column', aria: 'horizontal', minStyle: 'minHeight', maxStyle: 'maxHeight' }
    : { size: 'width', client: 'clientX', origin: 'left', flexDirection: 'row', aria: 'vertical', minStyle: 'minWidth', maxStyle: 'maxWidth' }
}

function addClass(element, ...names) {
  if (!element) return
  if (element.classList?.add) {
    element.classList.add(...names)
    return
  }
  const current = new Set(String(element.className || '').split(/\s+/).filter(Boolean))
  for (const name of names) current.add(name)
  element.className = Array.from(current).join(' ')
}

function setStyle(element, name, value) {
  if (!element?.style) return
  if (name.startsWith('--') && element.style.setProperty) element.style.setProperty(name, value)
  else element.style[name] = value
}

function removeStyle(element, name) {
  if (!element?.style) return
  if (name.startsWith('--') && element.style.removeProperty) element.style.removeProperty(name)
  else element.style[name] = ''
}

function setData(element, name, value) {
  if (element?.dataset) element.dataset[name] = String(value)
}

function removeData(element, name) {
  if (element?.dataset) delete element.dataset[name]
}

function normalizePane(value) {
  return value === 'start' || value === 'end' ? value : null
}

function cloneState(state) {
  return {
    orientation: state.orientation,
    ratio: state.ratio,
    startSize: state.startSize,
    endSize: state.endSize,
    availableSize: state.availableSize,
    closedPane: state.closedPane,
    closedSize: state.closedSize,
  }
}

function stateFromSource(source = null) {
  if (typeof source === 'number') return { ratio: source }
  if (typeof source === 'string') {
    const trimmed = source.trim()
    if (!trimmed) return null
    const parsedNumber = Number(trimmed)
    if (Number.isFinite(parsedNumber)) return { ratio: parsedNumber }
    try {
      return stateFromSource(JSON.parse(trimmed))
    } catch {
      return null
    }
  }
  if (source && typeof source === 'object') {
    return {
      ratio: source.ratio,
      restoreRatio: source.restoreRatio,
      closedPane: normalizePane(source.closedPane),
    }
  }
  return null
}

function readStoredState(storage, storageKey) {
  if (!storage || !storageKey) return null
  try {
    return stateFromSource(storage.getItem(storageKey))
  } catch {
    return null
  }
}

function writeStoredState(storage, storageKey, state) {
  if (!storage || !storageKey) return
  try {
    storage.setItem(storageKey, JSON.stringify({
      ratio: state.ratio,
      closedPane: state.closedPane,
    }))
  } catch {}
}

function defaultStorage() {
  try {
    return globalThis.window?.localStorage || null
  } catch {
    return null
  }
}

export function clampSplitPaneState({
  ratio = 0.5,
  size = 1,
  dividerSize = 8,
  minStart = 160,
  minEnd = 160,
  maxStart = Infinity,
  maxEnd = Infinity,
} = {}) {
  const availableSize = Math.max(1, positiveNumber(size) - Math.max(0, finiteNumber(dividerSize, 8)))
  const startMin = Math.max(0, finiteNumber(minStart, 0))
  const endMin = Math.max(0, finiteNumber(minEnd, 0))
  const startMax = Math.max(startMin, finiteNumber(maxStart, Infinity))
  const endMax = Math.max(endMin, finiteNumber(maxEnd, Infinity))
  const minSizeFromEnd = Math.max(0, availableSize - endMax)
  const maxSizeFromEnd = Math.max(0, availableSize - endMin)
  const lower = Math.min(availableSize, Math.max(startMin, minSizeFromEnd))
  const upper = Math.max(lower, Math.min(availableSize, startMax, maxSizeFromEnd))
  const requested = normalizeRatio(ratio) * availableSize
  const startSize = Math.round(Math.max(lower, Math.min(upper, requested)))
  const endSize = Math.max(0, Math.round(availableSize - startSize))

  return {
    ratio: startSize / availableSize,
    startSize,
    endSize,
    availableSize,
  }
}

export function createSplitPane({
  root = null,
  startPane = null,
  endPane = null,
  divider = null,
  document: documentRef = null,
  orientation = 'horizontal',
  initialRatio = 0.5,
  restoreState = null,
  storageKey = '',
  storage = null,
  dividerSize = 8,
  minStart = 160,
  minEnd = 160,
  maxStart = Infinity,
  maxEnd = Infinity,
  closedStartSize = 0,
  closedEndSize = 0,
  keyboardStep = 24,
  ariaLabel = 'Resize panes',
  onChange = null,
} = {}) {
  const doc = documentRef || root?.ownerDocument || globalThis.document
  if (!doc?.createElement) throw new Error('createSplitPane: document with createElement is required')

  const rootEl = root || doc.createElement('div')
  const startEl = startPane || doc.createElement('div')
  const endEl = endPane || doc.createElement('div')
  const dividerEl = divider || doc.createElement('div')
  const resolvedStorage = storage || defaultStorage()
  const stored = readStoredState(resolvedStorage, storageKey)
  const restored = stateFromSource(restoreState) || stored || { ratio: initialRatio }
  const splitOrientation = normalizeOrientation(orientation)
  const splitAxis = axis(splitOrientation)

  addClass(rootEl, 'aos-split-pane')
  addClass(startEl, 'aos-split-pane-pane', 'aos-split-pane-start')
  addClass(endEl, 'aos-split-pane-pane', 'aos-split-pane-end')
  addClass(dividerEl, 'aos-split-pane-divider')

  rootEl.dataset.orientation = splitOrientation
  setStyle(rootEl, 'flexDirection', splitAxis.flexDirection)
  setStyle(rootEl, '--aos-split-divider-size', `${positiveNumber(dividerSize, 8)}px`)
  setStyle(rootEl, '--aos-split-min-start', `${Math.max(0, finiteNumber(minStart, 0))}px`)
  setStyle(rootEl, '--aos-split-min-end', `${Math.max(0, finiteNumber(minEnd, 0))}px`)
  const accordionStartSize = Math.max(0, finiteNumber(closedStartSize, 0))
  const accordionEndSize = Math.max(0, finiteNumber(closedEndSize, 0))
  if (accordionStartSize > 0 || accordionEndSize > 0) {
    rootEl.dataset.collapseMode = 'accordion'
    setStyle(rootEl, '--aos-split-closed-start-size', `${accordionStartSize}px`)
    setStyle(rootEl, '--aos-split-closed-end-size', `${accordionEndSize}px`)
  }

  dividerEl.setAttribute('role', 'separator')
  dividerEl.setAttribute('tabindex', '0')
  dividerEl.setAttribute('aria-orientation', splitAxis.aria)
  dividerEl.setAttribute('aria-label', ariaLabel)

  if (!rootEl.contains?.(startEl)) rootEl.appendChild(startEl)
  if (!rootEl.contains?.(dividerEl)) {
    if (rootEl.contains?.(endEl) && rootEl.insertBefore) rootEl.insertBefore(dividerEl, endEl)
    else rootEl.appendChild(dividerEl)
  }
  if (!rootEl.contains?.(endEl)) rootEl.appendChild(endEl)

  const state = {
    orientation: splitOrientation,
    ratio: normalizeRatio(restored.ratio, initialRatio),
    restoreRatio: normalizeRatio(restored.restoreRatio ?? restored.ratio, initialRatio),
    closedPane: normalizePane(restored.closedPane),
    startSize: 0,
    endSize: 0,
    availableSize: 0,
    closedSize: 0,
  }

  function bounds() {
    return rootEl.getBoundingClientRect?.() || { left: 0, top: 0, width: 1, height: 1 }
  }

  function apply(nextRatio, { notify = true, persist = true } = {}) {
    const rect = bounds()
    state.ratio = normalizeRatio(nextRatio, state.ratio)

    if (state.closedPane) {
      state.restoreRatio = state.ratio
      const fullSize = positiveNumber(rect[splitAxis.size], 1)
      const closedSize = state.closedPane === 'start' ? accordionStartSize : accordionEndSize
      const startOpen = state.closedPane !== 'start'
      const endOpen = state.closedPane !== 'end'
      state.closedSize = closedSize
      state.startSize = startOpen ? Math.max(0, fullSize - closedSize) : closedSize
      state.endSize = endOpen ? Math.max(0, fullSize - closedSize) : closedSize
      state.availableSize = fullSize

      startEl.hidden = !startOpen && closedSize === 0
      endEl.hidden = !endOpen && closedSize === 0
      dividerEl.hidden = true
      setStyle(startEl, 'flex', `0 0 ${state.startSize}px`)
      setStyle(endEl, 'flex', `0 0 ${state.endSize}px`)
      setStyle(dividerEl, 'flex', '0 0 0px')
      setStyle(startEl, splitAxis.minStyle, `${startOpen ? Math.max(0, finiteNumber(minStart, 0)) : closedSize}px`)
      setStyle(endEl, splitAxis.minStyle, `${endOpen ? Math.max(0, finiteNumber(minEnd, 0)) : closedSize}px`)
      if (!startOpen) setStyle(startEl, splitAxis.maxStyle, `${closedSize}px`)
      else if (Number.isFinite(maxStart)) setStyle(startEl, splitAxis.maxStyle, `${maxStart}px`)
      else removeStyle(startEl, splitAxis.maxStyle)
      if (!endOpen) setStyle(endEl, splitAxis.maxStyle, `${closedSize}px`)
      else if (Number.isFinite(maxEnd)) setStyle(endEl, splitAxis.maxStyle, `${maxEnd}px`)
      else removeStyle(endEl, splitAxis.maxStyle)
      setData(rootEl, 'closedPane', state.closedPane)
      setData(rootEl, 'closedSize', closedSize)
      setData(rootEl, 'ratio', state.ratio.toFixed(4))
      dividerEl.setAttribute('aria-valuemin', '0')
      dividerEl.setAttribute('aria-valuemax', '100')
      dividerEl.setAttribute('aria-valuenow', String(Math.round(state.ratio * 100)))

      const closedSnapshot = cloneState(state)
      if (persist) writeStoredState(resolvedStorage, storageKey, closedSnapshot)
      if (notify) onChange?.(closedSnapshot)
      return closedSnapshot
    }

    startEl.hidden = false
    endEl.hidden = false
    dividerEl.hidden = false
    state.closedSize = 0
    removeData(rootEl, 'closedPane')
    removeData(rootEl, 'closedSize')
    const next = clampSplitPaneState({
      ratio: state.ratio,
      size: rect[splitAxis.size],
      dividerSize,
      minStart,
      minEnd,
      maxStart,
      maxEnd,
    })
    state.ratio = next.ratio
    state.restoreRatio = next.ratio
    state.startSize = next.startSize
    state.endSize = next.endSize
    state.availableSize = next.availableSize

    setStyle(startEl, 'flex', `0 0 ${state.startSize}px`)
    setStyle(endEl, 'flex', '1 1 0')
    setStyle(dividerEl, 'flex', `0 0 ${positiveNumber(dividerSize, 8)}px`)
    setStyle(startEl, splitAxis.minStyle, `${Math.max(0, finiteNumber(minStart, 0))}px`)
    setStyle(endEl, splitAxis.minStyle, `${Math.max(0, finiteNumber(minEnd, 0))}px`)
    if (Number.isFinite(maxStart)) setStyle(startEl, splitAxis.maxStyle, `${maxStart}px`)
    else removeStyle(startEl, splitAxis.maxStyle)
    if (Number.isFinite(maxEnd)) setStyle(endEl, splitAxis.maxStyle, `${maxEnd}px`)
    else removeStyle(endEl, splitAxis.maxStyle)

    setData(rootEl, 'ratio', state.ratio.toFixed(4))
    setData(dividerEl, 'ratio', state.ratio.toFixed(4))
    dividerEl.setAttribute('aria-valuemin', '0')
    dividerEl.setAttribute('aria-valuemax', '100')
    dividerEl.setAttribute('aria-valuenow', String(Math.round(state.ratio * 100)))

    const snapshot = cloneState(state)
    if (persist) writeStoredState(resolvedStorage, storageKey, snapshot)
    if (notify) onChange?.(snapshot)
    return snapshot
  }

  function setRatio(nextRatio, options = {}) {
    return apply(nextRatio, options)
  }

  function setStartSize(nextSize, options = {}) {
    const available = Math.max(1, state.availableSize || (bounds()[splitAxis.size] - positiveNumber(dividerSize, 8)))
    return apply(finiteNumber(nextSize, state.startSize) / available, options)
  }

  function closePane(pane = 'end', options = {}) {
    const targetPane = normalizePane(pane) || 'end'
    if (state.closedPane === targetPane) return cloneState(state)
    if (!state.closedPane) state.restoreRatio = state.ratio
    state.closedPane = targetPane
    return apply(state.ratio, options)
  }

  function openPane(pane = state.closedPane, options = {}) {
    const targetPane = normalizePane(pane) || state.closedPane
    if (!state.closedPane || (targetPane && state.closedPane !== targetPane)) return cloneState(state)
    state.closedPane = null
    return apply(state.restoreRatio ?? state.ratio, options)
  }

  function togglePane(pane = 'end', options = {}) {
    const targetPane = normalizePane(pane) || 'end'
    return state.closedPane === targetPane ? openPane(targetPane, options) : closePane(targetPane, options)
  }

  function isPaneOpen(pane = 'end') {
    const targetPane = normalizePane(pane) || 'end'
    return state.closedPane !== targetPane
  }

  let pointerId = null

  function pointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return
    pointerId = event.pointerId
    dividerEl.dataset.dragging = 'true'
    rootEl.dataset.dragging = 'true'
    dividerEl.setPointerCapture?.(pointerId)
    event.preventDefault?.()
  }

  function pointerMove(event) {
    if (pointerId === null || event.pointerId !== pointerId) return
    const rect = bounds()
    const rawSize = finiteNumber(event[splitAxis.client], rect[splitAxis.origin]) - finiteNumber(rect[splitAxis.origin], 0) - (positiveNumber(dividerSize, 8) / 2)
    setStartSize(rawSize)
    event.preventDefault?.()
  }

  function stopDrag(event = {}) {
    if (pointerId === null || (event.pointerId !== undefined && event.pointerId !== pointerId)) return
    const activePointer = pointerId
    pointerId = null
    delete dividerEl.dataset.dragging
    delete rootEl.dataset.dragging
    try {
      if (dividerEl.hasPointerCapture?.(activePointer)) dividerEl.releasePointerCapture(activePointer)
    } catch {}
  }

  function keyDown(event) {
    const available = Math.max(1, state.availableSize)
    const step = positiveNumber(keyboardStep, 24)
    let delta = 0
    if (splitOrientation === 'horizontal') {
      if (event.key === 'ArrowLeft') delta = -step
      if (event.key === 'ArrowRight') delta = step
    } else {
      if (event.key === 'ArrowUp') delta = -step
      if (event.key === 'ArrowDown') delta = step
    }
    if (event.key === 'Home') {
      setStartSize(0)
      event.preventDefault?.()
      return
    }
    if (event.key === 'End') {
      setStartSize(available)
      event.preventDefault?.()
      return
    }
    if (delta !== 0) {
      setStartSize(state.startSize + delta)
      event.preventDefault?.()
    }
  }

  dividerEl.addEventListener('pointerdown', pointerDown)
  dividerEl.addEventListener('pointermove', pointerMove)
  dividerEl.addEventListener('pointerup', stopDrag)
  dividerEl.addEventListener('pointercancel', stopDrag)
  dividerEl.addEventListener('lostpointercapture', stopDrag)
  dividerEl.addEventListener('keydown', keyDown)

  let resizeObserver = null
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => apply(state.ratio, { notify: false, persist: false }))
    resizeObserver.observe(rootEl)
  }

  apply(state.ratio, { notify: false, persist: false })

  return {
    root: rootEl,
    startPane: startEl,
    endPane: endEl,
    divider: dividerEl,
    getState() {
      return cloneState(state)
    },
    setRatio,
    setStartSize,
    closePane,
    openPane,
    togglePane,
    isPaneOpen,
    destroy() {
      dividerEl.removeEventListener?.('pointerdown', pointerDown)
      dividerEl.removeEventListener?.('pointermove', pointerMove)
      dividerEl.removeEventListener?.('pointerup', stopDrag)
      dividerEl.removeEventListener?.('pointercancel', stopDrag)
      dividerEl.removeEventListener?.('lostpointercapture', stopDrag)
      dividerEl.removeEventListener?.('keydown', keyDown)
      resizeObserver?.disconnect?.()
    },
  }
}

export function createFixedSidebarPane({
  root = null,
  mainPane = null,
  sidebarPane = null,
  toggleButton = null,
  document: documentRef = null,
  side = 'end',
  openSize = 340,
  closedSize = 42,
  minMain = 320,
  dividerSize = 0,
  storageKey = '',
  storage = null,
  initiallyOpen = true,
  ariaLabel = 'Resize main and sidebar panes',
  expandedLabel = 'Collapse sidebar',
  collapsedLabel = 'Expand sidebar',
  expandedText = '>',
  collapsedText = '<',
  onChange = null,
} = {}) {
  const doc = documentRef || root?.ownerDocument || globalThis.document
  if (!doc?.createElement) throw new Error('createFixedSidebarPane: document with createElement is required')

  const sidebarSide = side === 'start' ? 'start' : 'end'
  const rootEl = root || doc.createElement('div')
  const mainEl = mainPane || doc.createElement('section')
  const sidebarEl = sidebarPane || doc.createElement('aside')
  const rootSize = positiveNumber(rootEl.getBoundingClientRect?.().width, 1000)
  const sidebarOpenSize = positiveNumber(openSize, 340)
  const sidebarClosedSize = Math.max(0, finiteNumber(closedSize, 42))
  const mainMin = Math.max(1, finiteNumber(minMain, 320))
  const initialMainSize = Math.max(mainMin, rootSize - sidebarOpenSize - Math.max(0, finiteNumber(dividerSize, 0)))
  const initialRatio = sidebarSide === 'start'
    ? sidebarOpenSize / rootSize
    : initialMainSize / rootSize

  const split = createSplitPane({
    root: rootEl,
    startPane: sidebarSide === 'start' ? sidebarEl : mainEl,
    endPane: sidebarSide === 'start' ? mainEl : sidebarEl,
    document: doc,
    orientation: 'horizontal',
    initialRatio,
    storage,
    storageKey,
    dividerSize,
    minStart: sidebarSide === 'start' ? sidebarOpenSize : mainMin,
    maxStart: sidebarSide === 'start' ? sidebarOpenSize : Infinity,
    minEnd: sidebarSide === 'start' ? mainMin : sidebarOpenSize,
    maxEnd: sidebarSide === 'start' ? Infinity : sidebarOpenSize,
    closedStartSize: sidebarSide === 'start' ? sidebarClosedSize : 0,
    closedEndSize: sidebarSide === 'end' ? sidebarClosedSize : 0,
    ariaLabel,
    onChange(state) {
      syncSidebarState()
      onChange?.(state)
    },
  })

  addClass(rootEl, 'aos-fixed-sidebar')
  addClass(sidebarEl, 'aos-fixed-sidebar-pane')
  addClass(mainEl, 'aos-fixed-sidebar-main')
  rootEl.dataset.sidebarSide = sidebarSide

  const toggleHandler = () => toggleSidebar()
  if (toggleButton) {
    toggleButton.setAttribute('type', toggleButton.getAttribute?.('type') || 'button')
    toggleButton.addEventListener('click', toggleHandler)
  }

  function syncSidebarState() {
    const open = split.isPaneOpen(sidebarSide)
    rootEl.dataset.sidebarOpen = String(open)
    sidebarEl.dataset.sidebarOpen = String(open)
    if (toggleButton) {
      toggleButton.textContent = open ? expandedText : collapsedText
      toggleButton.setAttribute('aria-expanded', String(open))
      toggleButton.setAttribute('aria-label', open ? expandedLabel : collapsedLabel)
      toggleButton.title = open ? expandedLabel : collapsedLabel
    }
    return open
  }

  function setSidebarOpen(open, options = {}) {
    const result = open ? split.openPane(sidebarSide, options) : split.closePane(sidebarSide, options)
    syncSidebarState()
    return result
  }

  function toggleSidebar(options = {}) {
    return setSidebarOpen(!split.isPaneOpen(sidebarSide), options)
  }

  setSidebarOpen(Boolean(initiallyOpen), { notify: false, persist: false })

  return {
    ...split,
    mainPane: mainEl,
    sidebarPane: sidebarEl,
    toggleButton,
    getSidebarOpen() {
      return split.isPaneOpen(sidebarSide)
    },
    setSidebarOpen,
    toggleSidebar,
    destroy() {
      if (toggleButton) toggleButton.removeEventListener?.('click', toggleHandler)
      split.destroy()
    },
  }
}

export function SplitPane(startFactory, endFactory, options = {}) {
  if (!startFactory || !endFactory) {
    throw new Error('SplitPane: requires start and end content factories')
  }

  return {
    kind: 'split-pane',
    startFactory,
    endFactory,
    mount(chrome) {
      const consumerOnChange = typeof options.onChange === 'function' ? options.onChange : null
      const split = createSplitPane({
        ...options,
        onChange(state) {
          consumerOnChange?.(state)
          emit('split-pane/resized', state)
        },
      })
      chrome.contentEl.innerHTML = ''
      chrome.contentEl.appendChild(split.root)

      const contents = [
        typeof startFactory === 'function' ? startFactory() : startFactory,
        typeof endFactory === 'function' ? endFactory() : endFactory,
      ]
      const panes = [split.startPane, split.endPane]
      const hostByContent = new Map()

      contents.forEach((content, index) => {
        const host = makeHost(panes[index], content)
        hostByContent.set(content, host)
        const rendered = content.render(host)
        if (rendered instanceof Node) panes[index].appendChild(rendered)
        else if (typeof rendered === 'string') panes[index].innerHTML = rendered
        const requires = content.manifest?.requires || []
        if (requires.length > 0) subscribe(requires, { snapshot: true })
      })

      declareManifest({
        name: chrome.titleEl.textContent || 'split-pane',
        accepts: contents.flatMap(content => (content.manifest?.accepts || []).map(type => `${content.manifest?.channelPrefix}/${type}`)),
        emits: [
          'split-pane/resized',
          ...contents.flatMap(content => (content.manifest?.emits || []).map(type => `${content.manifest?.channelPrefix}/${type}`)),
        ],
        layout: {
          kind: 'split-pane',
          orientation: split.getState().orientation,
        },
        contents: contents.map((content, index) => ({
          pane: index === 0 ? 'start' : 'end',
          name: content.manifest?.name,
          prefix: content.manifest?.channelPrefix,
        })),
      })

      const router = createRouter({ contents, hostByContent })
      wireBridge(router)

      emitReady()
      return split
    },
  }
}

function makeHost(slotEl, content) {
  return {
    contentEl: slotEl,
    setTitle() {},
    emit(type, payload) {
      const prefix = content.manifest?.channelPrefix
      const fullType = prefix ? `${prefix}/${type}` : type
      emit(fullType, payload)
    },
    subscribe(events, options) { subscribe(events, options) },
    spawnChild(opts) { return spawnChild(opts) },
    evalCanvas(id, js, options) { return evalCanvas(id, js, options) },
  }
}
