// chrome.js — pure-DOM panel scaffold (header + drag + content slot).
//
// Knows nothing about messaging or contents. Just builds the visual frame
// and reports absolute drag updates through the runtime canvas helper.

import { emit } from '../runtime/bridge.js'
import { moveAbsolute, removeSelf, spawnChild, suspendCanvas } from '../runtime/canvas.js'

export function mountChrome(container, {
  title = 'AOS',
  draggable = true,
  close = true,
  minimize = true,
  onClose = defaultClose,
  onMinimize = null,
} = {}) {
  container.innerHTML = ''
  container.classList.add('aos-panel-root')

  const panel = document.createElement('div')
  panel.className = 'aos-panel'

  const header = document.createElement('div')
  header.className = 'aos-header'
  header.dataset.draggable = String(draggable)

  const titleEl = document.createElement('span')
  titleEl.className = 'aos-title'
  titleEl.textContent = title

  const controlsEl = document.createElement('span')
  controlsEl.className = 'aos-controls'

  const customControlsEl = document.createElement('span')
  customControlsEl.className = 'aos-custom-controls'

  const windowControlsEl = document.createElement('span')
  windowControlsEl.className = 'aos-window-controls'

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

  header.appendChild(titleEl)
  header.appendChild(controlsEl)

  const content = document.createElement('div')
  content.className = 'aos-content'

  panel.appendChild(header)
  panel.appendChild(content)
  container.appendChild(panel)

  if (draggable) wireDrag(header, controlsEl)

  return {
    panelEl: panel,
    headerEl: header,
    titleEl,
    controlsEl,
    customControlsEl,
    windowControlsEl,
    contentEl: content,
    setTitle(text) { titleEl.textContent = text },
    setControls(html) { customControlsEl.innerHTML = html },
  }
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
  const x = Number(window.screenX ?? window.screenLeft ?? 80)
  const y = Number(window.screenY ?? window.screenTop ?? 80)
  const width = Math.min(280, Math.max(180, Number(window.innerWidth || 240) * 0.42))
  return [
    Math.round(Number.isFinite(x) ? x : 80),
    Math.round(Number.isFinite(y) ? y : 80),
    Math.round(width),
    38,
  ]
}

function chipUrl({ target, title }) {
  const url = new URL(window.location.href)
  const path = url.pathname || ''
  if (path.includes('/panel/')) {
    url.pathname = `${path.slice(0, path.indexOf('/panel/') + '/panel/'.length)}minimized-chip.html`
  } else if (path.includes('/components/')) {
    url.pathname = `${path.slice(0, path.indexOf('/components/'))}/panel/minimized-chip.html`
  } else {
    return new URL('./minimized-chip.html', window.location.href).href
  }
  url.hash = ''
  url.searchParams.set('target', target)
  url.searchParams.set('title', title)
  return url.href
}

function defaultMinimize({ title = 'AOS' } = {}) {
  const target = currentCanvasId()
  if (!target) {
    console.warn('[aos-panel] minimize failed: missing canvas id')
    return
  }
  const chipId = `aos-chip-${target}-${Date.now().toString(36)}`
  spawnChild({
    id: chipId,
    url: chipUrl({ target, title }),
    frame: chipFrame(),
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

export function wireDrag(header, controlsEl, { move = moveAbsolute } = {}) {
  header.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    if (e.target instanceof Node && controlsEl.contains(e.target)) return
    const pointerId = e.pointerId
    const offsetX = e.clientX
    const offsetY = e.clientY
    header.dataset.dragging = 'true'
    e.preventDefault()
    // Drag lifecycle matters to the daemon: mixed-DPI seam placement keeps a
    // direct path during active drags and only falls back to re-home behavior
    // for non-drag placements.
    emit('drag_start')

    try { header.setPointerCapture(pointerId) } catch {}

    const onMove = (ev) => {
      if (ev.pointerId !== pointerId) return
      move(ev.screenX, ev.screenY, offsetX, offsetY)
    }

    const onUp = (ev) => {
      if (ev && ev.pointerId !== pointerId) return
      delete header.dataset.dragging
      header.removeEventListener('pointermove', onMove)
      header.removeEventListener('pointerup', onUp)
      header.removeEventListener('pointercancel', onUp)
      header.removeEventListener('lostpointercapture', onUp)
      try {
        if (header.hasPointerCapture(pointerId)) header.releasePointerCapture(pointerId)
      } catch {}
      emit('drag_end')
    }

    header.addEventListener('pointermove', onMove)
    header.addEventListener('pointerup', onUp)
    header.addEventListener('pointercancel', onUp)
    header.addEventListener('lostpointercapture', onUp)
  })
}
