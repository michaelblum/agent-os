// chrome.js — pure-DOM panel scaffold (header + drag + content slot).
//
// Knows nothing about messaging or contents. Just builds the visual frame
// and reports absolute drag updates through the runtime canvas helper.

import { emit } from '../runtime/bridge.js'
import { moveAbsolute, removeSelf } from '../runtime/canvas.js'

export function mountChrome(container, {
  title = 'AOS',
  draggable = true,
  close = true,
  onClose = defaultClose,
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

function defaultClose() {
  removeSelf({ orphan_children: true }).catch((error) => {
    console.warn('[aos-panel] close failed', error)
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
